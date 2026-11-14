import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import type { GitStagingContext } from "./gitStaging.js"
import { Status } from "./git.js"

export interface GitHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  patch: string
}

export function runGit(context: GitStagingContext, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      context.gitPath,
      ["--literal-pathspecs", ...args],
      { cwd: context.repository.rootUri.fsPath, encoding: "buffer", windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !(args.includes("--no-index") && error.code === 1)) reject(new Error(stderr.toString("utf8").trim() || error.message))
        else resolve(stdout)
      }
    )
    child.stdin?.on("error", () => {})
    child.stdin?.end(input)
  })
}

export async function getGitHunks(context: GitStagingContext, staged: boolean): Promise<GitHunk[]> {
  const options = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=0", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/"]
  let patch: Buffer
  if (staged && context.staged?.status === Status.INDEX_RENAMED) {
    // Compare contents under the destination path: reversing a content hunk must preserve the rename.
    const directory = await mkdtemp(join(tmpdir(), "quick-actions-hunk-"))
    try {
      const original = join(directory, "original")
      const modified = join(directory, "modified")
      await writeFile(original, await context.repository.buffer("HEAD", context.staged.originalUri.fsPath))
      await writeFile(modified, await context.repository.buffer("", context.uri.fsPath))
      patch = await runGit(context, [...options, "--no-index", "--", original, modified])
      const path = relative(context.repository.rootUri.fsPath, context.uri.fsPath).replaceAll("\\", "/")
      const quoted = (prefix: string) =>
        '"' +
        Buffer.from(prefix + path).reduce(
          (text, byte) => text + (byte >= 32 && byte < 127 && byte !== 34 && byte !== 92 ? String.fromCharCode(byte) : "\\" + byte.toString(8).padStart(3, "0")),
          ""
        ) +
        '"'
      const text = patch.toString("latin1").replace(/^--- .*\n\+\+\+ .*\n/m, `--- ${quoted("a/")}\n+++ ${quoted("b/")}\n`)
      patch = Buffer.from(text, "latin1")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  } else {
    patch = await runGit(context, [...options, ...(staged ? ["--cached"] : []), "--", context.uri.fsPath])
  }
  // latin1 is deliberately byte preserving: patches may contain text in any file encoding.
  const text = patch.toString("latin1")
  const headers = [...text.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*\n/gm)]
  const prefix = text.slice(0, headers[0]?.index ?? 0).replace(/^(?:old mode|new mode) .*\n/gm, "")
  return headers.map((match, index) => ({
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
    patch: prefix + text.slice(match.index, headers[index + 1]?.index ?? text.length)
  }))
}

export function findGitHunk(hunks: GitHunk[], line: number, original: boolean): GitHunk | undefined {
  return hunks.find((hunk) => {
    const start = original ? hunk.oldStart : hunk.newStart
    const count = original ? hunk.oldCount : hunk.newCount
    return count === 0 ? line === Math.max(1, start) : line >= start && line < start + count
  })
}

export function mapGitLine(hunks: GitHunk[], line: number, reverse: boolean): number {
  let offset = 0
  for (const hunk of hunks) {
    const fromStart = reverse ? hunk.newStart : hunk.oldStart
    const fromCount = reverse ? hunk.newCount : hunk.oldCount
    const toStart = reverse ? hunk.oldStart : hunk.newStart
    const toCount = reverse ? hunk.oldCount : hunk.newCount
    if (line < fromStart || (fromCount === 0 && line === fromStart)) break
    if (fromCount > 0 && line < fromStart + fromCount) return Math.max(1, toStart + Math.min(line - fromStart, Math.max(0, toCount - 1)))
    offset += toCount - fromCount
  }
  return Math.max(1, line + offset)
}
