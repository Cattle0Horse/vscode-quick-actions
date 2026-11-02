import * as vscode from "vscode"
import { decodeGitGraphUri } from "../gitGraph.js"

export async function openDiffSourceFile(): Promise<void> {
  try {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (!(input instanceof vscode.TabInputTextDiff)) {
      void vscode.window.showInformationMessage("请先打开一个 Git 文本差异编辑器。")
      return
    }
    const uri = input.modified
    if (uri.scheme === "git" || uri.scheme === "file") {
      await vscode.commands.executeCommand("git.openFile", uri)
      return
    }
    const source = uri.scheme === "quick-actions-empty" ? uri.with({ scheme: "file", query: "", fragment: "" }) : decodeGitGraphUri(uri)
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
    await vscode.window.showTextDocument(source, { preview: false })
  } catch (error) {
    void vscode.window.showErrorMessage(`打开源文件失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
