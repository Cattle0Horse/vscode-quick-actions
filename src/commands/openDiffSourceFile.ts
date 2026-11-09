import * as vscode from "vscode"
import { resolveFilePath } from "../filePath.js"

export async function openDiffSourceFile(): Promise<void> {
  try {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (!(input instanceof vscode.TabInputTextDiff)) {
      void vscode.window.showInformationMessage("请先打开一个 Git 文本差异编辑器。")
      return
    }
    const editor = vscode.window.activeTextEditor
    const focused = editor?.document.uri.toString()
    const position = focused === input.original.toString() || focused === input.modified.toString() ? editor?.selection.active : undefined
    const source = resolveFilePath(input.modified)
    if (!source) {
      void vscode.window.showInformationMessage("无法从当前差异解析源文件路径。")
      return
    }
    try {
      const stat = await vscode.workspace.fs.stat(source)
      if (!(stat.type & vscode.FileType.File)) throw new Error("Not a file")
    } catch {
      void vscode.window.showInformationMessage("源文件在当前工作区中不存在。")
      return
    }
    const document = await vscode.workspace.openTextDocument(source)
    const target = position && document.validatePosition(position)
    const selection = target && new vscode.Range(target, target)
    const opened = await vscode.window.showTextDocument(document, { preview: false, selection })
    if (selection) opened.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  } catch (error) {
    void vscode.window.showErrorMessage(`打开源文件失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
