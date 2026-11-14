import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as vscode from "vscode"
import type { GitAPI } from "../../src/git.js"

export async function testToggleGitStaging(root: string, api: GitAPI, cases: string[]): Promise<void> {
  const repo = join(root, "toggle-staging")
  await mkdir(repo)
  const git = (...args: string[]) => execFileSync(api.git.path, ["-c", "core.hooksPath=", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true })
  git("init", "--initial-branch=main")
  git("config", "user.name", "Sample Developer")
  git("config", "user.email", "sample@example.invalid")
  git("config", "core.autocrlf", "false")
  const source = vscode.Uri.file(join(repo, "样本 file.txt"))
  const other = vscode.Uri.file(join(repo, "other.txt"))
  const base = Array.from({ length: 80 }, (_, line) => `fixture line ${line}\n`).join("")
  const changed = (...lines: number[]) =>
    base
      .split("\n")
      .map((text, line) => (lines.includes(line) ? `changed line ${line}` : text))
      .join("\n")
  await writeFile(source.fsPath, base)
  await writeFile(other.fsPath, "other base\n")
  git("add", ".")
  git("commit", "-m", "fixture")
  const repository = await api.openRepository(vscode.Uri.file(repo))
  assert.ok(repository)
  const fileCommand = "quickActions.toggleGitFileStaging"
  const hunkCommand = "quickActions.toggleGitHunkStaging"
  const index = (path = source) => git("show", `:${path.fsPath.slice(repo.length + 1).replaceAll("\\", "/")}`)
  const show = async (uri = source, line = 5) => {
    const editor = await vscode.window.showTextDocument(uri, { preview: false })
    editor.selection = new vscode.Selection(line, 0, line, 0)
    return editor
  }
  const reset = async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    git("reset", "--hard", "HEAD")
    git("clean", "-fd")
  }
  const prepare = async (staged: string, working = staged) => {
    await reset()
    await writeFile(source.fsPath, staged)
    git("add", "--", source.fsPath)
    await writeFile(source.fsPath, working)
    await repository.status()
  }
  const diff = async (staged: boolean, side: "Primary" | "Secondary", line = 5, uri = source) => {
    const left = api.toGitUri(uri, staged ? "HEAD" : "")
    const right = staged ? api.toGitUri(uri, "") : uri
    await vscode.commands.executeCommand("vscode.diff", left, right, "Staging fixture", { preview: false })
    const target = side === "Primary" ? right : left
    const deadline = Date.now() + 5000
    do {
      await vscode.commands.executeCommand(`workbench.action.compareEditor.focus${side}Side`)
      if (vscode.window.activeTextEditor?.document.uri.toString() === target.toString()) {
        vscode.window.activeTextEditor.selection = new vscode.Selection(line, 0, line, 0)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    } while (Date.now() < deadline)
    assert.fail(`Could not focus ${target.toString()}`)
  }
  const check = async (expectedIndex: string, expectedDisk: string, name: string) => {
    assert.equal(index(), expectedIndex, name + " index")
    assert.equal(await readFile(source.fsPath, "utf8"), expectedDisk, name + " disk")
    cases.push(name)
  }

  await prepare(base, changed(5, 30))
  await writeFile(other.fsPath, "other staged\n")
  git("add", "--", other.fsPath)
  await show()
  await vscode.commands.executeCommand(fileCommand)
  await check(changed(5, 30), changed(5, 30), "toggle-file-stages-current-file")
  await vscode.commands.executeCommand(fileCommand)
  await check(base, changed(5, 30), "toggle-file-unstages-current-file")
  assert.equal(index(other), "other staged\n")
  cases.push("toggle-file-preserves-other-staged-files")

  await prepare(changed(5), changed(5, 30))
  await show()
  await vscode.commands.executeCommand(fileCommand)
  await check(changed(5, 30), changed(5, 30), "toggle-file-mixed-ordinary-view-stages-remainder")
  for (const side of ["Primary", "Secondary"] as const) {
    await prepare(changed(5), changed(5, 30))
    await diff(true, side)
    await vscode.commands.executeCommand(fileCommand)
    await check(base, changed(5, 30), `toggle-file-staged-diff-${side}-unstages`)
    await prepare(changed(5), changed(5, 30))
    await diff(false, side, 30)
    await vscode.commands.executeCommand(fileCommand)
    await check(changed(5, 30), changed(5, 30), `toggle-file-unstaged-diff-${side}-stages`)
  }

  await prepare(base, changed(5, 30, 60))
  await show()
  await vscode.commands.executeCommand(hunkCommand)
  await check(changed(5), changed(5, 30, 60), "toggle-hunk-stages-only-cursor-block")
  await vscode.commands.executeCommand(hunkCommand)
  await check(base, changed(5, 30, 60), "toggle-hunk-ordinary-view-unstages-cursor-block")
  await show(source, 20)
  await vscode.commands.executeCommand(hunkCommand)
  await check(base, changed(5, 30, 60), "toggle-hunk-clean-line-preserves-index")

  for (const side of ["Primary", "Secondary"] as const) {
    await prepare(changed(60), changed(5, 30, 60))
    await diff(false, side)
    await vscode.commands.executeCommand(hunkCommand)
    await check(changed(5, 60), changed(5, 30, 60), `toggle-hunk-unstaged-diff-${side}-preserves-other-hunks`)
    await prepare(changed(5, 30), changed(5, 30, 60))
    await diff(true, side, 30)
    await vscode.commands.executeCommand(hunkCommand)
    await check(changed(5), changed(5, 30, 60), `toggle-hunk-staged-diff-${side}-preserves-working-changes`)
  }

  for (const side of ["Primary", "Secondary"] as const) {
    const staged = "staged first\nstaged second\n" + base
    const working = "staged first\nstaged second\n" + changed(30)
    await prepare(staged, working)
    const left = api.toGitUri(source, "HEAD")
    await vscode.commands.executeCommand("vscode.diff", left, source, "HEAD fixture", { preview: false })
    await vscode.commands.executeCommand(`workbench.action.compareEditor.focus${side}Side`)
    const editor = vscode.window.activeTextEditor!
    const line = side === "Primary" ? 32 : 30
    editor.selection = new vscode.Selection(line, 0, line, 0)
    await vscode.commands.executeCommand(hunkCommand)
    await check(working, working, `toggle-hunk-head-diff-${side}-maps-past-staged-insertion`)
  }

  const inserted = "inserted one\ninserted two\n" + changed(30)
  await prepare(changed(30), inserted)
  await show(source, 32)
  await vscode.commands.executeCommand(hunkCommand)
  await check(base, inserted, "toggle-hunk-maps-working-cursor-past-unstaged-insertion")

  const stagedInsertion = changed(30).split("\n")
  stagedInsertion.splice(5, 0, "staged insertion one", "staged insertion two")
  for (const side of ["Primary", "Secondary"] as const) {
    await prepare(stagedInsertion.join("\n"))
    await diff(true, side, side === "Primary" ? 32 : 30)
    await vscode.commands.executeCommand(hunkCommand)
    const expected = base.split("\n")
    expected.splice(5, 0, "staged insertion one", "staged insertion two")
    await check(expected.join("\n"), stagedInsertion.join("\n"), `toggle-hunk-staged-${side}-uses-focused-version-line`)
  }

  const deletedLine = base.split("\n")
  deletedLine.splice(5, 1)
  for (const side of ["Primary", "Secondary"] as const) {
    await prepare(base, deletedLine.join("\n"))
    await diff(false, side, side === "Primary" ? 4 : 5)
    await vscode.commands.executeCommand(hunkCommand)
    await check(deletedLine.join("\n"), deletedLine.join("\n"), `toggle-hunk-deletion-${side}`)
  }

  await prepare(base, base.trimEnd())
  await show(source, 79)
  await vscode.commands.executeCommand(hunkCommand)
  await check(base.trimEnd(), base.trimEnd(), "toggle-hunk-preserves-missing-final-newline")
  await vscode.commands.executeCommand(hunkCommand)
  await check(base, base.trimEnd(), "toggle-hunk-restores-only-index-final-newline")

  await prepare(base)
  git("config", "core.autocrlf", "true")
  git("config", "diff.noprefix", "true")
  git("config", "apply.whitespace", "fix")
  const crlf = changed(5, 30).replaceAll("\n", "\r\n")
  await writeFile(source.fsPath, crlf)
  await show()
  await vscode.commands.executeCommand(hunkCommand)
  await check(changed(5), crlf, "toggle-hunk-respects-crlf-and-overrides-patch-format-config")
  git("config", "core.autocrlf", "false")
  git("config", "--unset", "diff.noprefix")
  git("config", "--unset", "apply.whitespace")

  await prepare(base, changed(5))
  const dirty = await show()
  await dirty.edit((edit) => edit.insert(new vscode.Position(0, 0), "unsaved\n"))
  const dirtyText = dirty.document.getText()
  for (const command of [fileCommand, hunkCommand]) {
    await vscode.commands.executeCommand(command)
    assert.ok(dirty.document.isDirty)
    assert.equal(dirty.document.getText(), dirtyText)
    await check(base, changed(5), `toggle-staging-${command}-rejects-unsaved-content`)
  }
  git("add", "--", source.fsPath)
  await diff(true, "Primary")
  await vscode.commands.executeCommand(hunkCommand)
  await check(base, changed(5), "toggle-hunk-staged-view-preserves-dirty-working-buffer")
  assert.equal(dirty.document.getText(), dirtyText)
  assert.ok(dirty.document.isDirty)
  await show()
  await vscode.commands.executeCommand("workbench.action.files.revert")

  await prepare(base, changed(5))
  const graph = vscode.Uri.file("file.json").with({
    scheme: "git-graph",
    query: Buffer.from(JSON.stringify({ repo, filePath: "样本 file.txt", commit: "fixture", exists: true })).toString("base64")
  })
  const provider = vscode.workspace.registerTextDocumentContentProvider("git-graph", { provideTextDocumentContent: () => "historical content\n" })
  try {
    await vscode.window.showTextDocument(graph, { preview: false })
    await vscode.commands.executeCommand(fileCommand)
    await check(changed(5), changed(5), "toggle-file-git-graph-view-uses-current-working-file")
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    provider.dispose()
  }

  await prepare(base)
  const added = vscode.Uri.file(join(repo, "新增 staged.txt"))
  await writeFile(added.fsPath, "new text\n")
  await show(added, 0)
  await vscode.commands.executeCommand(hunkCommand)
  assert.equal(index(added), "new text\n")
  cases.push("toggle-hunk-stages-untracked-unicode-file")
  await repository.status()
  await vscode.commands.executeCommand("git.openChange", added)
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)
  await vscode.commands.executeCommand(hunkCommand)
  assert.equal(git("ls-files", "--", added.fsPath), "")
  assert.equal(await readFile(added.fsPath, "utf8"), "new text\n")
  cases.push("toggle-hunk-unstages-native-added-single-text-view")
  await show(added, 0)
  await vscode.commands.executeCommand(fileCommand)
  await repository.status()
  await vscode.commands.executeCommand("git.openChange", added)
  await vscode.commands.executeCommand(fileCommand)
  assert.equal(git("ls-files", "--", added.fsPath), "")
  cases.push("toggle-file-unstages-native-added-single-text-view")

  await prepare(base)
  const renamed = vscode.Uri.file(join(repo, "renamed 中文.txt"))
  git("mv", "--", source.fsPath, renamed.fsPath)
  await writeFile(renamed.fsPath, changed(5, 30))
  git("add", "--", renamed.fsPath)
  await show(renamed, 5)
  await vscode.commands.executeCommand(hunkCommand)
  assert.equal(index(renamed), changed(30))
  assert.equal(git("ls-files", "--", source.fsPath), "")
  assert.equal(await readFile(renamed.fsPath, "utf8"), changed(5, 30))
  cases.push("toggle-hunk-unstages-renamed-file-content-without-reverting-rename")
  await vscode.commands.executeCommand("vscode.diff", api.toGitUri(source, "HEAD"), api.toGitUri(renamed, ""), "Staged rename", { preview: false })
  await vscode.commands.executeCommand(fileCommand)
  assert.equal(git("diff", "--cached"), "")
  assert.equal(await readFile(renamed.fsPath, "utf8"), changed(5, 30))
  cases.push("toggle-file-unstages-both-rename-paths")

  await prepare(base)
  await show()
  git("rm", "--", source.fsPath)
  await vscode.commands.executeCommand("quickActions.openStagedDiff")
  await vscode.commands.executeCommand(fileCommand)
  assert.equal(index(), base)
  await assert.rejects(readFile(source.fsPath))
  cases.push("toggle-file-unstages-deletion-without-restoring-disk")
  await vscode.commands.executeCommand("quickActions.openUnstagedDiff")
  await vscode.commands.executeCommand(hunkCommand)
  assert.equal(git("ls-files", "--", source.fsPath), "")
  cases.push("toggle-hunk-stages-deletion-from-empty-diff-side")

  await prepare(changed(5))
  await vscode.commands.executeCommand("vscode.diff", api.toGitUri(source, "HEAD"), api.toGitUri(source, "HEAD"), "History", { preview: false })
  await vscode.commands.executeCommand(hunkCommand)
  assert.equal(index(), changed(5))
  cases.push("toggle-hunk-rejects-history-diff")
  await reset()
  await vscode.commands.executeCommand(hunkCommand)
  await vscode.commands.executeCommand(fileCommand)
  assert.equal(git("diff", "--cached"), "")
  cases.push("toggle-staging-without-editor-preserves-index")

  git("checkout", "-b", "incoming")
  await writeFile(source.fsPath, "incoming\n")
  git("add", ".")
  git("commit", "-m", "incoming fixture")
  git("checkout", "main")
  await writeFile(source.fsPath, "current\n")
  git("add", ".")
  git("commit", "-m", "current fixture")
  assert.throws(() => git("merge", "incoming"))
  await show(source, 0)
  const conflicts = git("ls-files", "--stage")
  const conflictText = await readFile(source.fsPath, "utf8")
  await vscode.commands.executeCommand(fileCommand)
  await vscode.commands.executeCommand(hunkCommand)
  assert.equal(git("ls-files", "--stage"), conflicts)
  assert.equal(await readFile(source.fsPath, "utf8"), conflictText)
  cases.push("toggle-staging-preserves-unresolved-conflicts")
  await vscode.commands.executeCommand("workbench.action.closeAllEditors")
}
