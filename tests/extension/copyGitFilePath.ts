import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as vscode from "vscode"
import type { GitExtension } from "../../src/git.js"

export async function testCopyGitFilePath(root: string, cases: string[]): Promise<void> {
  const repo = join(root, "copy-git-path")
  await mkdir(repo)
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Sample Developer")
  git("config", "user.email", "sample@example.invalid")
  git("config", "core.autocrlf", "false")
  const old = vscode.Uri.file(join(repo, "旧 文件 #.txt"))
  const source = vscode.Uri.file(join(repo, "新 文件 #.txt"))
  await writeFile(old.fsPath, "base\nsecond\nthird\n")
  git("add", ".")
  git("commit", "-m", "base")
  const api = (await vscode.extensions.getExtension<GitExtension>("vscode.git")!.activate()).getAPI(1)
  assert.ok(await api.openRepository(vscode.Uri.file(repo)))
  git("mv", old.fsPath, source.fsPath)
  await writeFile(source.fsPath, "staged\nsecond\nthird\n")
  git("add", ".")
  await writeFile(source.fsPath, "working\nsecond\nthird\n")

  const checkDiff = async (left: vscode.Uri, right: vscode.Uri, leftFile: vscode.Uri, name: string) => {
    const disk = await readFile(source.fsPath, "utf8")
    const index = git("ls-files", "--stage")
    await vscode.commands.executeCommand("vscode.diff", left, right, name, { preview: false })
    for (const [side, uri, file, line] of [
      ["Primary", right, source, 1],
      ["Secondary", left, leftFile, 2]
    ] as const) {
      const deadline = Date.now() + 5000
      do {
        await vscode.commands.executeCommand(`workbench.action.compareEditor.focus${side}Side`)
        if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      const editor = vscode.window.activeTextEditor!
      assert.equal(editor.document.uri.toString(), uri.toString())
      editor.selection = new vscode.Selection(line, 0, line, 0)
      for (const [command, expected] of [
        ["quickActions.copyFilePath", file.fsPath],
        ["quickActions.copyRelativeFilePath", vscode.workspace.asRelativePath(file, false)],
        ["quickActions.copyCurrentFileAbsolutePathWithLine", `${file.fsPath}:${line + 1}`],
        ["quickActions.copyCurrentFileRelativePathWithLine", `${vscode.workspace.asRelativePath(file, false)}:${line + 1}`]
      ] as const) {
        await vscode.env.clipboard.writeText("not copied")
        await vscode.commands.executeCommand(command)
        assert.equal(await vscode.env.clipboard.readText(), expected, `${name} ${side} ${command}`)
      }
    }
    assert.equal(await readFile(source.fsPath, "utf8"), disk)
    assert.equal(git("ls-files", "--stage"), index)
    cases.push(name)
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
  }

  await checkDiff(api.toGitUri(old, "HEAD"), api.toGitUri(source, ""), old, "copy-path-staged-rename-both-sides")
  await checkDiff(api.toGitUri(source, ""), source, source, "copy-path-unstaged-both-sides")
  // Git may replace the display extension; copying must use the protocol's path.
  await checkDiff(api.toGitUri(old, "HEAD").with({ path: old.path + ".git" }), api.toGitUri(source, ""), old, "copy-path-git-display-extension")
  git("add", ".")
  git("commit", "-m", "rename")
  git("checkout", "-b", "incoming")
  await writeFile(source.fsPath, "incoming\nsecond\nthird\n")
  git("commit", "-am", "incoming")
  git("checkout", "main")
  await writeFile(source.fsPath, "current\nsecond\nthird\n")
  git("commit", "-am", "current")
  assert.throws(() => git("merge", "incoming"))
  assert.ok(git("ls-files", "--unmerged"))
  await checkDiff(api.toGitUri(source, "HEAD"), source, source, "copy-path-conflict-working-diff-both-sides")
  await checkDiff(api.toGitUri(source, ":2"), api.toGitUri(source, ":3"), source, "copy-path-conflict-ours-theirs-both-sides")
  await checkDiff(api.toGitUri(source, ":1"), source, source, "copy-path-conflict-base-both-sides")
}
