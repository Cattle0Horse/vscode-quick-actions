import * as vscode from "vscode"
import { getGitStagingContext, hasUnsavedChanges, setGitFileStaging } from "../gitStaging.js"

export async function toggleGitFileStaging(): Promise<void> {
  try {
    const context = await getGitStagingContext()
    if (!context) return
    // A dirty buffer must not make an ordinary file fall through to unstaging.
    const unstage = context.mode === "staged" || (context.mode === "auto" && !context.working && !hasUnsavedChanges(context))
    await setGitFileStaging(context, unstage)
  } catch (error) {
    void vscode.window.showErrorMessage(`切换文件暂存状态失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
