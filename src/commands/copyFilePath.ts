import * as vscode from "vscode"
import { resolveFilePath } from "../filePath.js"

export async function copyFilePath(relative: boolean, withLine = false): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor
    const uri = editor && resolveFilePath(editor.document.uri)
    if (!editor || !uri) {
      void vscode.window.showInformationMessage("请先打开有本地路径的文件或 Git 文本内容。")
      return
    }
    const path = relative ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath
    const text = withLine ? `${path}:${editor.selection.active.line + 1}` : path
    await vscode.env.clipboard.writeText(text)
    vscode.window.setStatusBarMessage(withLine ? "已复制路径及行号" : "已复制文件路径", 3000)
  } catch (error) {
    void vscode.window.showErrorMessage(`复制路径失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
