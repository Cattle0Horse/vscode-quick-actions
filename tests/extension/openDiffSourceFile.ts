import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as vscode from "vscode"
import type { GitAPI } from "../../src/git.js"
import { testOpenMergeSourceFile } from "./openMergeSourceFile.js"

export async function testOpenDiffSourceFile(root: string, api: GitAPI, cases: string[]): Promise<void> {
  const repo = join(root, "open-source")
  await mkdir(join(repo, "nested"), { recursive: true })
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Sample Developer")
  git("config", "user.email", "sample@example.invalid")
  git("config", "core.autocrlf", "false")
  const source = vscode.Uri.file(join(repo, "nested", "配置 sample.json"))
  const lines = vscode.Uri.file(join(repo, "nested", "lines.txt"))
  const lineContent = Array.from({ length: 120 }, (_, index) => `sample line ${index}`).join("\n")
  await writeFile(source.fsPath, "base\n")
  await writeFile(lines.fsPath, lineContent)
  git("add", ".")
  git("commit", "-m", "fixture")
  const repository = await api.openRepository(vscode.Uri.file(repo))
  assert.ok(repository)
  await writeFile(source.fsPath, "staged\n")
  git("add", ".")
  await writeFile(source.fsPath, "working\n")
  const command = "quickActions.openDiffSourceFile"
  const diff = async (left: vscode.Uri, right: vscode.Uri) => {
    await vscode.commands.executeCommand("vscode.diff", left, right, "Source fixture", { preview: false })
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff)
  }
  const focus = async (side: "Primary" | "Secondary", uri: vscode.Uri) => {
    const deadline = Date.now() + 5000
    do {
      await vscode.commands.executeCommand(`workbench.action.compareEditor.focus${side}Side`)
      if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) return vscode.window.activeTextEditor
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    assert.fail(`Could not focus ${uri.toString()}`)
  }
  const assertSource = (expected: vscode.Uri, text: string) => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    assert.ok(tab instanceof vscode.TabInputText)
    assert.equal(tab.uri.toString(), expected.toString())
    assert.equal(vscode.window.activeTextEditor?.document.getText(), text)
  }

  await diff(api.toGitUri(source, ""), source)
  await vscode.commands.executeCommand(command)
  assertSource(source, "working\n")
  cases.push("open-source-from-unstaged-diff")
  await diff(api.toGitUri(source, "HEAD"), api.toGitUri(source, ""))
  await vscode.commands.executeCommand(command)
  assertSource(source, "working\n")
  cases.push("open-source-from-staged-diff-uses-working-content")

  const document = vscode.window.activeTextEditor!.document
  await vscode.window.activeTextEditor!.edit((edit) => edit.insert(new vscode.Position(1, 0), "unsaved\n"))
  const content = document.getText()
  await diff(api.toGitUri(source, "HEAD"), api.toGitUri(source, ""))
  await vscode.commands.executeCommand(command)
  assertSource(source, content)
  assert.ok(document.isDirty)
  assert.equal(await readFile(source.fsPath, "utf8"), "working\n")
  assert.equal(git("show", ":nested/配置 sample.json"), "staged\n")
  cases.push("open-source-preserves-unsaved-buffer-disk-and-index")
  await vscode.commands.executeCommand("workbench.action.files.revert")

  const provider = vscode.workspace.registerTextDocumentContentProvider("git-graph", { provideTextDocumentContent: () => lineContent })
  const graph = (filePath: string) =>
    vscode.Uri.file("file.json").with({
      scheme: "git-graph",
      query: Buffer.from(JSON.stringify({ repo, filePath, commit: "fixture", exists: true })).toString("base64")
    })
  try {
    // Different paths on the two sides catch accidental use of the focused/original side.
    await diff(graph("old.json"), graph("nested/配置 sample.json"))
    await focus("Secondary", graph("old.json"))
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), graph("old.json").toString())
    await vscode.commands.executeCommand(command)
    assertSource(source, "working\n")
    cases.push("open-source-from-git-graph-file-json-uses-modified-repo-path")

    await diff(graph("old.json"), source)
    await vscode.commands.executeCommand(command)
    assertSource(source, "working\n")
    cases.push("open-source-from-git-graph-versus-working-file")

    const historical = graph("nested/lines.txt")
    for (const [left, right, name] of [
      [api.toGitUri(lines, ""), lines, "unstaged"],
      [api.toGitUri(lines, "HEAD"), api.toGitUri(lines, ""), "staged"],
      [graph("old.json"), historical, "git-graph"],
      [historical, lines, "git-graph-working"]
    ] as const) {
      for (const [side, uri, line, column] of [
        ["Primary", right, 80, 4],
        ["Secondary", left, 30, 2]
      ] as const) {
        // A different position in the existing source tab must not win over the diff cursor.
        const existing = await vscode.window.showTextDocument(lines, { preview: false })
        existing.selection = new vscode.Selection(0, 0, 0, 0)
        await diff(left, right)
        const editor = await focus(side, uri)
        editor.selection = new vscode.Selection(line + 1, 0, line, column)
        await vscode.commands.executeCommand(command)
        assertSource(lines, lineContent)
        const opened: vscode.TextEditor = vscode.window.activeTextEditor!
        assert.ok(opened.selection.isEmpty)
        assert.equal(opened.selection.active.line, line)
        assert.equal(opened.selection.active.character, column)
      }
      cases.push(`open-source-${name}-focused-cursor-line-and-column`)
    }

    // History may be longer than the current file: clamp line and column independently.
    for (const [line, column, expectedLine, expectedColumn] of [
      [90, 4, 1, 0],
      [0, 12, 0, 7]
    ] as const) {
      await diff(graph("old.json"), graph("nested/配置 sample.json"))
      const editor = await focus("Primary", graph("nested/配置 sample.json"))
      editor.selection = new vscode.Selection(line, column, line, column)
      await vscode.commands.executeCommand(command)
      assertSource(source, "working\n")
      assert.equal(vscode.window.activeTextEditor!.selection.active.line, expectedLine)
      assert.equal(vscode.window.activeTextEditor!.selection.active.character, expectedColumn)
    }
    cases.push("open-source-historical-cursor-clamped-to-current-file")

    const dirtyEditor = await vscode.window.showTextDocument(lines, { preview: false })
    await dirtyEditor.edit((edit) => edit.insert(new vscode.Position(0, 0), "unsaved\n"))
    await diff(graph("old.json"), historical)
    const historicalEditor = await focus("Primary", historical)
    historicalEditor.selection = new vscode.Selection(60, 3, 60, 3)
    await vscode.commands.executeCommand(command)
    assertSource(lines, `unsaved\n${lineContent}`)
    assert.equal(vscode.window.activeTextEditor!.selection.active.line, 60)
    assert.equal(vscode.window.activeTextEditor!.selection.active.character, 3)
    assert.ok(vscode.window.activeTextEditor!.document.isDirty)
    assert.equal(await readFile(lines.fsPath, "utf8"), lineContent)
    assert.equal(git("show", ":nested/lines.txt"), lineContent)
    await vscode.commands.executeCommand("workbench.action.files.revert")
    cases.push("open-source-jump-preserves-unsaved-buffer-disk-and-index")

    for (const uri of [graph("deleted.json"), graph("nested/配置 sample.json").with({ query: "invalid" })]) {
      await diff(graph("old.json"), uri)
      const before = vscode.window.tabGroups.activeTabGroup.activeTab
      await vscode.commands.executeCommand(command)
      assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, before)
    }
    cases.push("open-source-unavailable-git-graph-path-keeps-diff")
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    provider.dispose()
  }
  await vscode.commands.executeCommand(command)
  assert.equal(vscode.window.tabGroups.activeTabGroup.tabs.length, 0)
  cases.push("open-source-without-diff-keeps-editors")

  const added = vscode.Uri.file(join(repo, "nested", "新增 staged.txt"))
  await writeFile(added.fsPath, "staged addition\nsecond line\n")
  git("add", "--", added.fsPath)
  await repository.status()
  await vscode.commands.executeCommand("git.openChange", added)
  const addedTab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  assert.ok(addedTab instanceof vscode.TabInputText)
  assert.equal(addedTab.uri.scheme, "git")
  const addedSnapshot = vscode.window.activeTextEditor!
  assert.equal(addedSnapshot.document.getText(), "staged addition\nsecond line\n")
  addedSnapshot.selection = new vscode.Selection(1, 0, 1, 4)
  await vscode.commands.executeCommand(command)
  assertSource(added, "staged addition\nsecond line\n")
  assert.equal(vscode.window.activeTextEditor!.selection.active.line, 1)
  assert.equal(vscode.window.activeTextEditor!.selection.active.character, 4)
  cases.push("open-source-from-native-staged-addition-text-view-with-cursor")

  await writeFile(added.fsPath, "working addition\nsecond line\n")
  const addedEditor = await vscode.window.showTextDocument(added, { preview: false })
  await addedEditor.edit((edit) => edit.insert(new vscode.Position(0, 0), "unsaved\n"))
  const addedContent = addedEditor.document.getText()
  await vscode.window.showTextDocument(addedSnapshot.document, { preview: false })
  await vscode.commands.executeCommand(command)
  assertSource(added, addedContent)
  assert.ok(addedEditor.document.isDirty)
  assert.equal(await readFile(added.fsPath, "utf8"), "working addition\nsecond line\n")
  assert.equal(git("show", ":nested/新增 staged.txt"), "staged addition\nsecond line\n")
  cases.push("open-source-staged-addition-preserves-working-buffer-disk-and-index")
  await vscode.commands.executeCommand("workbench.action.files.revert")

  const ordinaryEditor = vscode.window.activeTextEditor!
  ordinaryEditor.selection = new vscode.Selection(0, 0, 0, 4)
  const ordinaryTab = vscode.window.tabGroups.activeTabGroup.activeTab
  await vscode.commands.executeCommand(command)
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, ordinaryTab)
  assert.ok(ordinaryEditor.selection.isEqual(new vscode.Selection(0, 0, 0, 4)))
  cases.push("open-source-from-ordinary-text-keeps-tab-and-selection")
  await vscode.commands.executeCommand("workbench.action.closeAllEditors")
  await testOpenMergeSourceFile(root, api, cases)
}
