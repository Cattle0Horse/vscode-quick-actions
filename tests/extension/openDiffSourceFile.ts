import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as vscode from "vscode"
import type { GitAPI } from "../../src/git.js"

export async function testOpenDiffSourceFile(root: string, api: GitAPI, cases: string[]): Promise<void> {
  const repo = join(root, "open-source")
  await mkdir(join(repo, "nested"), { recursive: true })
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Sample Developer")
  git("config", "user.email", "sample@example.invalid")
  git("config", "core.autocrlf", "false")
  const source = vscode.Uri.file(join(repo, "nested", "配置 sample.json"))
  await writeFile(source.fsPath, "base\n")
  git("add", ".")
  git("commit", "-m", "fixture")
  assert.ok(await api.openRepository(vscode.Uri.file(repo)))
  await writeFile(source.fsPath, "staged\n")
  git("add", ".")
  await writeFile(source.fsPath, "working\n")
  const command = "quickActions.openDiffSourceFile"
  const diff = async (left: vscode.Uri, right: vscode.Uri) => {
    await vscode.commands.executeCommand("vscode.diff", left, right, "Source fixture", { preview: false })
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff)
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

  const provider = vscode.workspace.registerTextDocumentContentProvider("git-graph", { provideTextDocumentContent: () => "historical\n" })
  const graph = (filePath: string) =>
    vscode.Uri.file("file.json").with({
      scheme: "git-graph",
      query: Buffer.from(JSON.stringify({ repo, filePath, commit: "fixture", exists: true })).toString("base64")
    })
  try {
    // Different paths on the two sides catch accidental use of the focused/original side.
    await diff(graph("old.json"), graph("nested/配置 sample.json"))
    await vscode.commands.executeCommand("workbench.action.compareEditor.focusSecondarySide")
    const focusDeadline = Date.now() + 5000
    while (vscode.window.activeTextEditor?.document.uri.toString() !== graph("old.json").toString() && Date.now() < focusDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), graph("old.json").toString())
    await vscode.commands.executeCommand(command)
    assertSource(source, "working\n")
    cases.push("open-source-from-git-graph-file-json-uses-modified-repo-path")

    await diff(graph("old.json"), source)
    await vscode.commands.executeCommand(command)
    assertSource(source, "working\n")
    cases.push("open-source-from-git-graph-versus-working-file")

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
}
