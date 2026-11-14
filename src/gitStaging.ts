import * as vscode from "vscode"
import { resolveFilePath } from "./filePath.js"
import type { Change, GitExtension, Repository } from "./git.js"

type Version = "working" | "index" | "head" | "empty"

export interface GitStagingContext {
  repository: Repository
  gitPath: string
  uri: vscode.Uri
  working?: Change
  staged?: Change
  mode: "auto" | "unstaged" | "staged"
  version?: Version
  line?: number
}

function getVersion(uri: vscode.Uri): Version | undefined {
  if (uri.scheme === "file") return "working"
  if (uri.scheme === "quick-actions-empty") return "empty"
  if (uri.scheme !== "git") return undefined
  try {
    const { ref } = JSON.parse(uri.query) as { ref?: unknown }
    if (ref === "" || ref === "~") return "index"
    if (ref === "HEAD") return "head"
  } catch {
    return undefined
  }
  return undefined
}

export async function getGitStagingContext(): Promise<GitStagingContext | undefined> {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  const editor = vscode.window.activeTextEditor
  // Git status refreshes can restore an editor's old selection; use the invocation's cursor.
  const focused = editor?.document.uri.toString()
  const cursorLine = editor ? editor.selection.active.line + 1 : undefined
  const diff = input instanceof vscode.TabInputTextDiff ? input : undefined
  const selected = diff?.modified ?? (input instanceof vscode.TabInputText ? input.uri : undefined)
  const source = selected && resolveFilePath(selected)
  if (!selected || !source) {
    void vscode.window.showInformationMessage("请先打开一个 Git 仓库中的文本文件或 Git 差异。")
    return undefined
  }
  const extension = await vscode.extensions.getExtension<GitExtension>("vscode.git")?.activate()
  if (!extension?.enabled) {
    void vscode.window.showInformationMessage("请先启用 VS Code 内置 Git 扩展和 Git 功能。")
    return undefined
  }
  const api = extension.getAPI(1)
  const repository = api.getRepository(source) ?? (await api.openRepository(source))
  if (!repository) {
    void vscode.window.showInformationMessage("当前文件不属于已打开的 Git 仓库。")
    return undefined
  }
  await repository.status()
  const changes = [...repository.state.workingTreeChanges, ...repository.state.untrackedChanges, ...repository.state.indexChanges]
  const renamed = changes.find((change) => change.originalUri.toString() === source.toString())
  const uri = renamed?.uri ?? source
  const matches = (change: Change) => change.uri.toString() === uri.toString()
  if (repository.state.mergeChanges.some(matches)) {
    void vscode.window.showInformationMessage("当前文件存在合并冲突，请先通过源代码管理处理冲突。")
    return undefined
  }
  let mode: GitStagingContext["mode"] = "auto"
  let version = getVersion(selected)
  let line: number | undefined
  if (diff) {
    const left = getVersion(diff.original)
    const right = getVersion(diff.modified)
    const staged = (left === "head" || left === "empty") && (right === "index" || right === "empty")
    const unstaged = (left === "index" || left === "empty") && (right === "working" || right === "empty")
    const head = left === "head" && right === "working"
    const original = resolveFilePath(diff.original)?.toString()
    const sameFile = original === uri.toString() || original === source.toString() || changes.some((change) => matches(change) && change.originalUri.toString() === original)
    mode = staged ? "staged" : unstaged ? "unstaged" : "auto"
    version = sameFile && (staged || unstaged || head) ? (focused === diff.original.toString() ? left : focused === diff.modified.toString() ? right : undefined) : undefined
    if (version === "empty") version = mode === "staged" ? "index" : "working"
    if (version) line = cursorLine
  } else {
    if (version === "index") mode = "staged"
    if (focused === selected.toString()) line = cursorLine
    if (version !== "working" && version !== "index") version = undefined
  }
  return {
    repository,
    gitPath: api.git.path,
    uri,
    working: [...repository.state.workingTreeChanges, ...repository.state.untrackedChanges].find(matches),
    staged: repository.state.indexChanges.find(matches),
    mode,
    version,
    line
  }
}

export function hasUnsavedChanges(context: GitStagingContext): boolean {
  return vscode.workspace.textDocuments.some((document) => document.uri.toString() === context.uri.toString() && document.isDirty)
}

export async function setGitFileStaging(context: GitStagingContext, unstage: boolean): Promise<void> {
  if (!unstage && hasUnsavedChanges(context)) {
    void vscode.window.showInformationMessage("当前文件有未保存编辑，请先保存后再暂存。")
    return
  }
  if (unstage ? !context.staged : !context.working) {
    void vscode.window.showInformationMessage("当前文件没有可切换的 Git 修改。")
    return
  }
  const change = unstage ? context.staged! : context.working!
  const paths = [...new Set([change.uri.fsPath, change.originalUri.fsPath])]
  if (unstage) await context.repository.revert(paths)
  else await context.repository.add(paths)
}
