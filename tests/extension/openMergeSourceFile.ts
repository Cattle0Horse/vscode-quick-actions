import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as vscode from "vscode"
import type { GitAPI } from "../../src/git.js"

export async function testOpenMergeSourceFile(root: string, api: GitAPI, cases: string[]): Promise<void> {
  const repo = join(root, "merge-source")
  await mkdir(join(repo, "nested"), { recursive: true })
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Sample Developer")
  git("config", "user.email", "sample@example.invalid")
  git("config", "core.autocrlf", "false")
  const source = vscode.Uri.file(join(repo, "nested", "冲突 # sample.txt"))
  const other = join(repo, "another.txt")
  const tail = Array.from({ length: 100 }, (_, index) => `sample line ${index}`).join("\n")
  for (const path of [source.fsPath, other]) await writeFile(path, `base\n${tail}`)
  git("add", ".")
  git("commit", "-m", "base")
  git("checkout", "-b", "incoming")
  for (const path of [source.fsPath, other]) await writeFile(path, `incoming\n${tail}`)
  git("commit", "-am", "incoming")
  git("checkout", "main")
  for (const path of [source.fsPath, other]) await writeFile(path, `current\n${tail}`)
  git("commit", "-am", "current")
  assert.throws(() => git("merge", "incoming"))
  const repository = await api.openRepository(vscode.Uri.file(repo))
  assert.ok(repository)
  await repository.status()
  assert.equal(repository.state.mergeChanges.length, 2)
  const activeEditor = async (matches: (editor: vscode.TextEditor) => boolean) => {
    const deadline = Date.now() + 5000
    do {
      const editor = vscode.window.activeTextEditor
      if (editor && matches(editor)) return editor
      await new Promise((resolve) => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    assert.fail("Expected merge pane did not receive focus")
  }
  const workspaceFile = vscode.workspace.workspaceFile!
  assert.equal(workspaceFile.scheme, "file")
  const originalWorkspace = await readFile(workspaceFile.fsPath, "utf8")
  const workspace = JSON.parse(originalWorkspace) as { settings?: Record<string, unknown> }
  try {
    for (const useWorkingCopy of [false, true]) {
      // This upstream mode is intentionally unregistered; edit only the isolated test workspace.
      await writeFile(workspaceFile.fsPath, JSON.stringify({ ...workspace, settings: { ...workspace.settings, "mergeEditor.useWorkingCopy": useWorkingCopy } }))
      const deadline = Date.now() + 5000
      while (vscode.workspace.getConfiguration("mergeEditor").get("useWorkingCopy") !== useWorkingCopy) {
        assert.ok(Date.now() < deadline, "Merge mode configuration did not load")
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await vscode.commands.executeCommand("git.openMergeEditor", source)
      await vscode.commands.executeCommand("workbench.action.keepEditor")
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
      const mergeTab = vscode.window.tabGroups.activeTabGroup.activeTab!
      assert.ok(mergeTab)
      assert.ok(!(mergeTab.input instanceof vscode.TabInputText))
      assert.ok(!(mergeTab.input instanceof vscode.TabInputTextDiff))
      const result = await activeEditor((editor) => editor.document.uri.path === source.path && editor.document.uri.scheme !== "git")
      assert.equal(result.document.uri.path, source.path)
      const mode = result.document.uri.scheme === "merge-result" ? "temporary-result" : "working-copy"
      const disk = await readFile(source.fsPath, "utf8")
      const index = git("ls-files", "--stage")
      const document = await vscode.workspace.openTextDocument(source)
      const edit = new vscode.WorkspaceEdit()
      edit.insert(source, new vscode.Position(0, 0), "unsaved source\n")
      assert.ok(await vscode.workspace.applyEdit(edit))
      if (mode === "temporary-result") assert.ok(await result.edit((builder) => builder.insert(new vscode.Position(0, 0), "unsaved merge\n")))
      const content = document.getText()
      const mergedContent = result.document.getText()
      const jump = async (focused: vscode.TextEditor, line: number, column: number, pane: string) => {
        focused.selection = new vscode.Selection(line + 1, 0, line, column)
        await vscode.commands.executeCommand("quickActions.openDiffSourceFile")
        const opened = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        assert.ok(opened instanceof vscode.TabInputText, "Merge source must open in an ordinary text tab")
        assert.equal(opened.uri.toString(), source.toString())
        const editor = vscode.window.activeTextEditor!
        assert.equal(editor.selection.active.line, line)
        assert.equal(editor.selection.active.character, column)
        assert.ok(editor.selection.isEmpty)
        assert.equal(editor.document.getText(), content)
        assert.ok(document.isDirty)
        assert.equal(result.document.getText(), mergedContent)
        assert.equal(await readFile(source.fsPath, "utf8"), disk)
        assert.equal(git("ls-files", "--stage"), index)
        assert.ok(vscode.window.tabGroups.activeTabGroup.tabs.includes(mergeTab))
        cases.push(`open-source-merge-${mode}-${pane}-cursor-and-state`)
      }
      await jump(result, 80, 4, "result")
      const inputContents = new Set<string>()
      for (let side = 0; side < 2; side++) {
        await vscode.commands.executeCommand("git.openMergeEditor", source)
        await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
        await activeEditor((editor) => editor.document.uri.scheme !== "git")
        for (let toggle = 0; toggle <= side; toggle++) {
          const before = vscode.window.activeTextEditor!.document.uri.toString()
          await vscode.commands.executeCommand("mergeEditor.toggleBetweenInputs")
          await activeEditor((editor) => editor.document.uri.scheme === "git" && editor.document.uri.toString() !== before)
        }
        const input = vscode.window.activeTextEditor!
        inputContents.add(input.document.lineAt(0).text)
        await jump(input, 30 + side * 20, 2 + side, `input-${side + 1}`)
      }
      assert.deepEqual(inputContents, new Set(["current", "incoming"]))
      await vscode.commands.executeCommand("workbench.action.files.revert")
      await vscode.commands.executeCommand("git.openMergeEditor", source)
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
      await activeEditor((editor) => editor.document.uri.scheme !== "git")
      if (mode === "temporary-result") await vscode.commands.executeCommand("undo")
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor")
      await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    }
  } finally {
    await writeFile(workspaceFile.fsPath, originalWorkspace)
  }
}
