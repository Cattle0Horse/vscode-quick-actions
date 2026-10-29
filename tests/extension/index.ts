import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as vscode from "vscode"
import type { GitExtension } from "../../src/git.js"
import { testCopyCommands } from "./copyCommands.js"

export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath
  const cases: string[] = []
  const git = (directory: string, ...args: string[]) =>
    execFileSync("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd: directory, encoding: "utf8", windowsHide: true })
  const api = (await vscode.extensions.getExtension<GitExtension>("vscode.git")!.activate()).getAPI(1)
  const extension = vscode.extensions.getExtension("cattle-horse.vscode-quick-actions")!
  await extension.activate()
  const first = join(root, "first")
  const second = join(root, "second")
  for (const directory of [first, second]) {
    await mkdir(directory)
    git(directory, "init", "--initial-branch=main")
    git(directory, "config", "user.name", "Sample Developer")
    git(directory, "config", "user.email", "sample@example.invalid")
    git(directory, "config", "core.autocrlf", "false")
    await writeFile(join(directory, "sample.txt"), "base\n")
    git(directory, "add", ".")
    git(directory, "commit", "-m", "fixture")
    assert.ok(await api.openRepository(vscode.Uri.file(directory)))
  }

  const file = vscode.Uri.file(join(first, "sample.txt"))
  const show = async (uri: vscode.Uri) => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false })
    await vscode.commands.executeCommand("workbench.action.files.revert")
    return editor
  }
  const checkDiff = async (uri: vscode.Uri, original: string, modified: string, name: string, command = "quickActions.openGitDiff") => {
    await show(uri)
    await vscode.commands.executeCommand(command)
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    assert.ok(tab instanceof vscode.TabInputTextDiff, name)
    assert.equal((await vscode.workspace.openTextDocument(tab.original)).getText(), original, name + " original")
    assert.equal((await vscode.workspace.openTextDocument(tab.modified)).getText(), modified, name + " modified")
    cases.push(name)
  }
  const reset = async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    git(first, "reset", "--hard", "HEAD")
  }

  await writeFile(file.fsPath, "working\n")
  await checkDiff(file, "base\n", "working\n", "unstaged")
  git(first, "add", "sample.txt")
  await checkDiff(file, "base\n", "working\n", "staged")
  await show(file)
  await vscode.commands.executeCommand("quickActions.openUnstagedDiff")
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)
  cases.push("unstaged-mode-does-not-fall-back-to-staged")
  await checkDiff(file, "base\n", "working\n", "staged-again")
  await vscode.commands.executeCommand("quickActions.openGitDiff")
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff)
  cases.push("repeat-from-staged-diff")
  await writeFile(file.fsPath, "working again\n")
  await checkDiff(file, "working\n", "working again\n", "unstaged-before-staged")
  await checkDiff(file, "working\n", "working again\n", "explicit-unstaged", "quickActions.openUnstagedDiff")
  await checkDiff(file, "base\n", "working\n", "explicit-staged-excludes-working", "quickActions.openStagedDiff")
  await checkDiff(file, "base\n", "working again\n", "head-includes-staged-and-working", "quickActions.openHeadDiff")
  await reset()

  const editor = await show(file)
  await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), "unsaved\n"))
  await vscode.commands.executeCommand("quickActions.openGitDiff")
  const dirtyTab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  assert.ok(dirtyTab instanceof vscode.TabInputTextDiff)
  assert.equal((await vscode.workspace.openTextDocument(dirtyTab.original)).getText(), "base\n")
  assert.equal((await vscode.workspace.openTextDocument(dirtyTab.modified)).getText(), "base\nunsaved\n")
  assert.equal(await readFile(file.fsPath, "utf8"), "base\n")
  assert.equal(git(first, "show", ":sample.txt"), "base\n")
  cases.push("unsaved-buffer-without-saving-or-staging")
  await vscode.commands.executeCommand("quickActions.openHeadDiff")
  const dirtyHead = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  assert.ok(dirtyHead instanceof vscode.TabInputTextDiff)
  assert.equal((await vscode.workspace.openTextDocument(dirtyHead.modified)).getText(), "base\nunsaved\n")
  cases.push("head-includes-unsaved-buffer")
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor")
  // Revert the source document explicitly if the diff command only closed its tab.
  const source = vscode.workspace.textDocuments.find((document) => document.uri.toString() === file.toString())
  if (source?.isDirty) {
    await vscode.window.showTextDocument(source)
    await vscode.commands.executeCommand("workbench.action.files.revert")
  }
  await reset()

  const added = vscode.Uri.file(join(first, "new file 中文.txt"))
  await writeFile(added.fsPath, "new\n")
  await checkDiff(added, "", "new\n", "untracked-unicode-path")
  git(first, "add", "--", added.fsPath)
  await checkDiff(added, "", "new\n", "staged-addition")
  await checkDiff(added, "", "new\n", "head-addition", "quickActions.openHeadDiff")
  await reset()

  git(first, "mv", "sample.txt", "renamed.txt")
  const renamed = vscode.Uri.file(join(first, "renamed.txt"))
  await checkDiff(renamed, "base\n", "base\n", "staged-rename")
  await writeFile(renamed.fsPath, "renamed working\n")
  await checkDiff(renamed, "base\n", "renamed working\n", "renamed-with-unstaged-edit")
  await checkDiff(renamed, "base\n", "renamed working\n", "head-rename", "quickActions.openHeadDiff")
  await reset()

  await show(file)
  git(first, "rm", "sample.txt")
  await vscode.commands.executeCommand("quickActions.openStagedDiff")
  const deleted = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  assert.ok(deleted instanceof vscode.TabInputTextDiff)
  assert.equal((await vscode.workspace.openTextDocument(deleted.original)).getText(), "base\n")
  assert.equal((await vscode.workspace.openTextDocument(deleted.modified)).getText(), "")
  cases.push("staged-deletion")
  await writeFile(file.fsPath, "recreated\n")
  await checkDiff(file, "", "recreated\n", "recreated-after-staged-deletion")
  await checkDiff(file, "base\n", "recreated\n", "head-after-staged-deletion-and-recreation", "quickActions.openHeadDiff")
  await reset()

  const other = vscode.Uri.file(join(second, "sample.txt"))
  await writeFile(other.fsPath, "other repository\n")
  await checkDiff(other, "base\n", "other repository\n", "multiple-repositories")

  await show(file)
  const cleanTabs = vscode.window.tabGroups.activeTabGroup.tabs.length
  await vscode.commands.executeCommand("quickActions.openGitDiff")
  assert.equal(vscode.window.tabGroups.activeTabGroup.tabs.length, cleanTabs)
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)
  cases.push("clean-file-keeps-editor")
  await writeFile(file.fsPath, "only working\n")
  await show(file)
  await vscode.commands.executeCommand("quickActions.openStagedDiff")
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)
  cases.push("staged-mode-does-not-fall-back-to-unstaged")
  await vscode.commands.executeCommand("workbench.action.closeAllEditors")
  await vscode.commands.executeCommand("quickActions.openGitDiff")
  assert.equal(vscode.window.tabGroups.activeTabGroup.tabs.length, 0)
  cases.push("no-editor")

  await testCopyCommands(root, cases)

  const report = {
    cases,
    vscodeVersion: vscode.version,
    bundleHash: createHash("sha256")
      .update(await readFile(join(extension.extensionPath, "dist/extension.cjs")))
      .digest("hex")
  }
  await writeFile(process.env.QUICK_ACTIONS_REPORT!, JSON.stringify(report, null, 2))
}
