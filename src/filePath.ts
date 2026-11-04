import { isAbsolute } from "node:path"
import * as vscode from "vscode"
import { decodeGitGraphUri } from "./gitGraph.js"

export function resolveFilePath(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme === "file") return uri
  if (uri.scheme === "quick-actions-empty") return uri.with({ scheme: "file", query: "", fragment: "" })
  if (uri.scheme !== "git") return decodeGitGraphUri(uri)
  // The Git provider's display path may end in .git; the query owns the source path.
  // https://github.com/microsoft/vscode/blob/main/extensions/git/src/uri.ts
  try {
    const data: unknown = JSON.parse(uri.query)
    if (!data || typeof data !== "object" || !("path" in data) || typeof data.path !== "string" || !isAbsolute(data.path)) return undefined
    return vscode.Uri.file(data.path)
  } catch {
    return undefined
  }
}
