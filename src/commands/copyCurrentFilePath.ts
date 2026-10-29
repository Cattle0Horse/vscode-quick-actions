import * as vscode from "vscode"

export async function copyCurrentFilePath(relative: boolean): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.uri.scheme !== "file") {
      void vscode.window.showInformationMessage("请先打开一个有本地路径的文本文件。")
      return
    }

    const uri = editor.document.uri
    const path = relative ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath
    await vscode.env.clipboard.writeText(`${path}:${editor.selection.active.line + 1}`)
    vscode.window.setStatusBarMessage("已复制路径及行号", 3000)
  } catch (error) {
    void vscode.window.showErrorMessage(`复制路径失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
