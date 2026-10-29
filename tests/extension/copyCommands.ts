import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"
import * as vscode from "vscode"
import { testCopyCurrentFilePath } from "./copyCurrentFilePath.js"

export async function testCopyCommands(root: string, cases: string[]): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    await testCopyCurrentFilePath(root, cases)
    return
  }
  // Materialize clipboard formats before replacing them; restore after the test.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$saved = New-Object System.Windows.Forms.DataObject
if ($null -ne $original) {
  foreach ($format in $original.GetFormats($false)) {
    $value = $original.GetData($format, $false)
    if ($null -ne $value) { $saved.SetData($format, $false, $value) }
  }
}
try {
  [Console]::WriteLine('ready')
  while ($null -ne [Console]::ReadLine()) {
    $files = @([System.Windows.Forms.Clipboard]::GetFileDropList())
    $effect = [System.Windows.Forms.Clipboard]::GetDataObject().GetData('Preferred DropEffect')
    $preferred = if ($null -ne $effect) { [BitConverter]::ToUInt32($effect.ToArray(), 0) } else { $null }
    [Console]::WriteLine((ConvertTo-Json -InputObject @{ files = $files; effect = $preferred } -Compress))
  }
} finally {
  if ($null -eq $original) { [System.Windows.Forms.Clipboard]::Clear() }
  else { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true) }
}
`
  const clipboard = spawn(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  )
  const lines = createInterface({ input: clipboard.stdout })[Symbol.asyncIterator]()
  let stderr = ""
  clipboard.stderr.on("data", (data) => {
    stderr += String(data)
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    clipboard.once("error", reject)
    clipboard.once("exit", resolve)
  })
  const copiedFiles = async () => {
    clipboard.stdin.write("read\n")
    const result = await lines.next()
    assert.equal(result.done, false, stderr)
    const data = JSON.parse(result.value!) as { files: string[]; effect: number }
    assert.ok(data.effect === null || data.effect === 1, "Clipboard must not request move")
    return data.files
  }
  try {
    assert.equal((await lines.next()).value, "ready", stderr)
    // Run text clipboard cases inside the native clipboard snapshot as well.
    await testCopyCurrentFilePath(root, cases)
    const uri = vscode.Uri.file(join(root, "文件 ' $() & sample.txt"))
    await writeFile(uri.fsPath, "saved content\n")
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document, { preview: false })
    await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), "unsaved\n"))
    await vscode.commands.executeCommand("quickActions.copyCurrentFile")
    assert.deepEqual(await copiedFiles(), [uri.fsPath])
    assert.equal(await readFile(uri.fsPath, "utf8"), "saved content\n")
    assert.equal(document.getText(), "saved content\nunsaved\n")
    assert.ok(document.isDirty)
    cases.push("copy-file-drop-list-unicode-special-path-without-saving")

    const left = vscode.Uri.file(join(root, "original.txt"))
    await writeFile(left.fsPath, "original\n")
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(left))
    await vscode.commands.executeCommand("quickActions.copyCurrentFile")
    assert.deepEqual(await copiedFiles(), [left.fsPath])
    await vscode.commands.executeCommand("vscode.diff", left, uri, "Copy fixture", { preview: false })
    await vscode.commands.executeCommand("quickActions.copyCurrentFile")
    assert.deepEqual(await copiedFiles(), [uri.fsPath])
    cases.push("copy-diff-modified-file")

    await vscode.window.showTextDocument(document)
    await vscode.commands.executeCommand("workbench.action.files.revert")
    await unlink(uri.fsPath)
    await vscode.commands.executeCommand("quickActions.copyCurrentFile")
    assert.deepEqual(await copiedFiles(), [uri.fsPath])
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument())
    await vscode.commands.executeCommand("quickActions.copyCurrentFile")
    assert.deepEqual(await copiedFiles(), [uri.fsPath])
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    await vscode.commands.executeCommand("quickActions.copyCurrentFile")
    assert.deepEqual(await copiedFiles(), [uri.fsPath])
    cases.push("copy-unavailable-file-preserves-clipboard")
  } finally {
    clipboard.stdin.end()
    assert.equal(await exited, 0, stderr)
  }
}
