import * as vscode from "vscode"
import { Status } from "../git.js"
import { findGitHunk, getGitHunks, mapGitLine, runGit } from "../gitPatch.js"
import { getGitStagingContext, hasUnsavedChanges, setGitFileStaging } from "../gitStaging.js"

export async function toggleGitHunkStaging(): Promise<void> {
  try {
    const context = await getGitStagingContext()
    if (!context) return
    if (!context.version || context.line === undefined) {
      void vscode.window.showInformationMessage("请在工作区文件、当前未暂存差异或已暂存文本视图中定位 Git 块。")
      return
    }
    if (context.mode !== "staged" && hasUnsavedChanges(context)) {
      void vscode.window.showInformationMessage("当前文件有未保存编辑，请先保存后再切换 Git 块暂存状态。")
      return
    }
    const working = context.mode !== "staged" && context.working ? await getGitHunks(context, false) : []
    const staged = context.mode !== "unstaged" && context.staged ? await getGitHunks(context, true) : []
    const indexLine = context.version === "working" ? mapGitLine(working, context.line, true) : context.version === "head" ? mapGitLine(staged, context.line, false) : context.line
    let hunk = context.mode !== "staged" ? findGitHunk(working, context.version === "working" ? context.line : indexLine, context.version !== "working") : undefined
    let unstage = false
    if (!hunk && context.mode !== "unstaged") {
      hunk = findGitHunk(staged, context.version === "head" ? context.line : indexLine, context.version === "head")
      unstage = !!hunk
    }
    if (!hunk && context.mode !== "staged" && (context.working?.status === Status.UNTRACKED || context.working?.status === Status.INTENT_TO_ADD)) {
      await setGitFileStaging(context, false)
      return
    }
    if (!hunk) {
      void vscode.window.showInformationMessage("光标所在位置没有可切换的 Git 改动块。")
      return
    }
    await runGit(context, ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", ...(unstage ? ["--reverse"] : []), "-"], Buffer.from(hunk.patch, "latin1"))
    await context.repository.status()
  } catch (error) {
    void vscode.window.showErrorMessage(`切换 Git 块暂存状态失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
