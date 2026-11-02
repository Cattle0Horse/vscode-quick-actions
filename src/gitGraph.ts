import { join } from "node:path"
import * as vscode from "vscode"

// Git Graph stores the real path in the query; uri.path is only a display name.
// https://github.com/mhutchie/vscode-git-graph/blob/develop/src/diffDocProvider.ts
export function decodeGitGraphUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== "git-graph" || !uri.query) return undefined
  try {
    const data: unknown = JSON.parse(Buffer.from(uri.query, "base64").toString("utf8"))
    if (!data || typeof data !== "object" || !("repo" in data) || !("filePath" in data)) return undefined
    if (typeof data.repo !== "string" || typeof data.filePath !== "string" || !data.repo || !data.filePath) return undefined
    return vscode.Uri.file(join(data.repo, data.filePath))
  } catch {
    return undefined
  }
}
