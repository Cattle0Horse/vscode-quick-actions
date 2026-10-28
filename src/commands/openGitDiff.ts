import { basename } from "node:path"
import * as vscode from "vscode"
import type { Change, GitExtension } from "../git.js"
import { Status } from "../git.js"

export type DiffMode = "unstaged" | "head" | "staged" | "auto"

export async function openGitDiff(mode: DiffMode): Promise<void> {
  // A diff's modified side is the current file even when its original side has focus.
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  let uri = tab instanceof vscode.TabInputTextDiff ? tab.modified : vscode.window.activeTextEditor?.document.uri
  if (uri?.scheme === "quick-actions-empty") uri = uri.with({ scheme: "file" })
  if (!uri || (uri.scheme !== "file" && uri.scheme !== "git")) {
    void vscode.window.showInformationMessage("请先打开一个 Git 仓库中的文本文件。")
    return
  }

  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git")
  const git = await extension?.activate()
  if (!git?.enabled) {
    void vscode.window.showInformationMessage("请先启用 VS Code 内置 Git 扩展和 Git 功能。")
    return
  }
  const api = git.getAPI(1)
  if (uri.scheme === "git") {
    const selected = uri
    const change = api.repositories.flatMap((repository) => repository.state.indexChanges).find((item) => api.toGitUri(item.uri, "").toString() === selected.toString())
    uri = change?.uri
    if (!uri) {
      void vscode.window.showInformationMessage("请在工作区文件或当前已暂存差异中运行此命令。")
      return
    }
  }
  const repository = api.getRepository(uri) ?? (await api.openRepository(uri))
  if (!repository) {
    void vscode.window.showInformationMessage("当前文件不属于已打开的 Git 仓库。")
    return
  }
  await repository.status()
  const matches = (change: Change) => change.uri.toString() === uri.toString()
  if (repository.state.mergeChanges.some(matches)) {
    void vscode.window.showInformationMessage("当前文件存在合并冲突，请先通过源代码管理处理冲突。")
    return
  }
  const working = [...repository.state.workingTreeChanges, ...repository.state.untrackedChanges].find(matches)
  const staged = repository.state.indexChanges.find(matches)
  const document = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString())
  const dirty = document?.isDirty === true
  const selected = mode === "auto" ? (working || dirty ? "unstaged" : "staged") : mode
  if ((selected === "unstaged" && !working && !dirty) || (selected === "staged" && !staged) || (selected === "head" && !working && !staged && !dirty)) {
    void vscode.window.showInformationMessage("当前文件在所选模式下没有 Git 文本差异。")
    return
  }

  const empty = uri.with({ scheme: "quick-actions-empty", query: "", fragment: "" })
  let left: vscode.Uri
  let right: vscode.Uri
  let label: string
  if (selected === "unstaged") {
    const added = working?.status === Status.UNTRACKED || working?.status === Status.INTENT_TO_ADD
    left = added ? empty : api.toGitUri(uri, "")
    right = working?.status === Status.DELETED && !dirty ? empty : uri
    label = "未暂存"
  } else if (selected === "head") {
    const added = staged ? staged.status === Status.INDEX_ADDED : working?.status === Status.UNTRACKED || working?.status === Status.INTENT_TO_ADD
    left = added ? empty : api.toGitUri(staged?.originalUri ?? uri, "HEAD")
    const deleted = working ? working.status === Status.DELETED : staged?.status === Status.INDEX_DELETED
    right = deleted && !dirty ? empty : uri
    label = "HEAD"
  } else {
    left = staged!.status === Status.INDEX_ADDED ? empty : api.toGitUri(staged!.originalUri, "HEAD")
    right = staged!.status === Status.INDEX_DELETED ? empty : api.toGitUri(staged!.uri, "")
    label = "已暂存"
  }
  await vscode.commands.executeCommand("vscode.diff", left, right, `${basename(uri.fsPath)}（${label}）`, { preview: false, override: "default" })
}
