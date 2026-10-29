import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as vscode from "vscode"

export async function testCopyCurrentFilePath(root: string, cases: string[]): Promise<void> {
  const absolute = "quickActions.copyCurrentFileAbsolutePathWithLine"
  const relative = "quickActions.copyCurrentFileRelativePathWithLine"
  const previous = await vscode.env.clipboard.readText()
  const outside = await mkdtemp(join(tmpdir(), "quick-actions-path-"))
  try {
    await mkdir(join(root, "path fixture"))
    const uri = vscode.Uri.file(join(root, "path fixture", "文件 # sample.txt"))
    const content = "first\nsecond\nthird\nfourth\n"
    await writeFile(uri.fsPath, content)
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document, { preview: false })
    await vscode.commands.executeCommand(absolute)
    assert.equal(await vscode.env.clipboard.readText(), `${uri.fsPath}:1`)
    editor.selection = new vscode.Selection(2, 1, 2, 1)
    await vscode.commands.executeCommand(absolute)
    assert.equal(await vscode.env.clipboard.readText(), `${uri.fsPath}:3`)
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), "path fixture/文件 # sample.txt:3")
    cases.push("copy-path-absolute-relative-unicode-and-current-line")

    // A reversed selection uses its active end, not the normalized range start/end.
    editor.selection = new vscode.Selection(3, 2, 1, 0)
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), "path fixture/文件 # sample.txt:2")
    cases.push("copy-path-selection-active-line")

    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "unsaved\n"))
    editor.selection = new vscode.Selection(4, 0, 4, 0)
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), "path fixture/文件 # sample.txt:5")
    assert.equal(await readFile(uri.fsPath, "utf8"), content)
    assert.ok(document.isDirty)
    assert.equal(document.getText(), `unsaved\n${content}`)
    await vscode.commands.executeCommand("workbench.action.files.revert")
    cases.push("copy-path-unsaved-buffer-without-saving")

    const outsideUri = vscode.Uri.file(join(outside, "outside.txt"))
    await writeFile(outsideUri.fsPath, "outside\n")
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(outsideUri))
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), `${outsideUri.fsPath}:1`)
    cases.push("copy-path-outside-workspace-falls-back-to-absolute")

    await vscode.commands.executeCommand("vscode.diff", uri, outsideUri, "Path fixture", { preview: false })
    await vscode.commands.executeCommand("workbench.action.compareEditor.focusPrimarySide")
    const rightEditor = vscode.window.activeTextEditor!
    assert.equal(rightEditor.document.uri.toString(), outsideUri.toString())
    await vscode.commands.executeCommand(absolute)
    assert.equal(await vscode.env.clipboard.readText(), `${outsideUri.fsPath}:1`)
    await vscode.commands.executeCommand("workbench.action.compareEditor.focusSecondarySide")
    // Focus changes reach the extension host after the workbench command resolves.
    const focusDeadline = Date.now() + 5000
    while (vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString() && Date.now() < focusDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const leftEditor = vscode.window.activeTextEditor!
    assert.equal(leftEditor.document.uri.toString(), uri.toString())
    leftEditor.selection = new vscode.Selection(1, 0, 1, 0)
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), "path fixture/文件 # sample.txt:2")
    cases.push("copy-path-diff-focused-side-and-line")
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")

    const otherUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![1]!.uri, "other.txt")
    await writeFile(otherUri.fsPath, "other\n")
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(otherUri))
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), "other.txt:1")
    const workspaceEditor = await vscode.window.showTextDocument(document)
    workspaceEditor.selection = new vscode.Selection(0, 0, 0, 0)
    await vscode.commands.executeCommand(relative)
    assert.equal(await vscode.env.clipboard.readText(), "path fixture/文件 # sample.txt:1")
    cases.push("copy-path-multiple-workspace-roots-without-folder-prefix")

    const sentinel = "clipboard preserved"
    await vscode.env.clipboard.writeText(sentinel)
    const provider = vscode.workspace.registerTextDocumentContentProvider("quick-actions-path-test", { provideTextDocumentContent: () => "virtual\n" })
    try {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.parse("quick-actions-path-test:/virtual.txt")))
      for (const command of [absolute, relative]) {
        await vscode.commands.executeCommand(command)
        assert.equal(await vscode.env.clipboard.readText(), sentinel)
      }
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors")
      provider.dispose()
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument())
    for (const command of [absolute, relative]) {
      await vscode.commands.executeCommand(command)
      assert.equal(await vscode.env.clipboard.readText(), sentinel)
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    for (const command of [absolute, relative]) {
      await vscode.commands.executeCommand(command)
      assert.equal(await vscode.env.clipboard.readText(), sentinel)
    }
    cases.push("copy-path-unavailable-editor-preserves-clipboard")
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    await vscode.env.clipboard.writeText(previous)
    await rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
