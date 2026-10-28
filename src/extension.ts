import * as vscode from "vscode"
import { openGitDiff, type DiffMode } from "./commands/openGitDiff.js"

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("quick-actions-empty", { provideTextDocumentContent: () => "" }))
  const registerDiff = (command: string, mode: DiffMode) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        try {
          await openGitDiff(mode)
        } catch (error) {
          void vscode.window.showErrorMessage(`打开 Git 差异失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })
    )
  }
  registerDiff("quickActions.openUnstagedDiff", "unstaged")
  registerDiff("quickActions.openHeadDiff", "head")
  registerDiff("quickActions.openStagedDiff", "staged")
  registerDiff("quickActions.openGitDiff", "auto")
}
