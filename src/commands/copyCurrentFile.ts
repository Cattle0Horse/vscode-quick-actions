import { stat } from "node:fs/promises"
import * as vscode from "vscode"

export async function copyCurrentFile(): Promise<void> {
  if (vscode.env.remoteName) {
    void vscode.window.showInformationMessage("文件复制暂不支持远程窗口。")
    return
  }
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  let uri: vscode.Uri | undefined
  if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) {
    uri = input.modified
  } else if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputCustom) {
    uri = input.uri
  }
  if (!uri || uri.scheme !== "file") {
    void vscode.window.showInformationMessage("请先打开一个已保存的本地文件。")
    return
  }
  if (!(await stat(uri.fsPath)).isFile()) {
    void vscode.window.showInformationMessage("当前路径不是文件。")
    return
  }

  // Load native code only when a local file is copied.
  const { setFiles } = await import("@crosscopy/clipboard")
  await setFiles([uri.fsPath])
  vscode.window.setStatusBarMessage("已复制文件", 3000)
}
