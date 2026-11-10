import * as vscode from "vscode"
import { resolveFilePath } from "../filePath.js"
import type { GitExtension } from "../git.js"

async function resolveConflictFile(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  // The merge editor's temporary result keeps the output file's path.
  // https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mergeEditor/browser/mergeEditorInputModel.ts
  const source = uri.scheme === "merge-result" ? uri.with({ scheme: "file", query: "", fragment: "" }) : resolveFilePath(uri)
  if (!source) return undefined
  const extension = await vscode.extensions.getExtension<GitExtension>("vscode.git")?.activate()
  if (!extension?.enabled) return undefined
  const api = extension.getAPI(1)
  const repository = api.getRepository(source) ?? (await api.openRepository(source))
  if (!repository) return undefined
  await repository.status()
  return repository.state.mergeChanges.find((change) => change.uri.toString() === source.toString() || change.originalUri.toString() === source.toString())?.uri
}

export async function openDiffSourceFile(): Promise<void> {
  try {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const editor = vscode.window.activeTextEditor
    const focused = editor?.document.uri.toString()
    let source: vscode.Uri | undefined
    let position: vscode.Position | undefined
    if (input instanceof vscode.TabInputTextDiff) {
      source = resolveFilePath(input.modified)
      if (focused === input.modified.toString() || focused === input.original.toString()) position = editor?.selection.active
    } else if (input instanceof vscode.TabInputText && input.uri.scheme === "git") {
      // The built-in Git extension opens staged additions as a single read-only text tab.
      source = resolveFilePath(input.uri)
      if (focused === input.uri.toString()) position = editor?.selection.active
    } else if (input && !(input instanceof vscode.TabInputText) && editor && (editor.viewColumn === undefined || editor.viewColumn === vscode.window.tabGroups.activeTabGroup.viewColumn)) {
      // Merge tabs have no stable TabInput type; verify the focused file against Git conflicts.
      position = editor.selection.active
      source = await resolveConflictFile(editor.document.uri)
    } else {
      void vscode.window.showInformationMessage("请先打开一个 Git 文本视图或差异编辑器。")
      return
    }
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
