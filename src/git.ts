import type { Uri } from "vscode"

// Used subset of the built-in Git extension's API v1:
// https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
// Numeric status values are part of that external protocol.
export const enum Status {
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  DELETED = 6,
  UNTRACKED = 7,
  INTENT_TO_ADD = 9
}

export interface Change {
  readonly uri: Uri
  readonly originalUri: Uri
  readonly status: number
}

export interface Repository {
  readonly rootUri: Uri
  readonly state: {
    readonly workingTreeChanges: Change[]
    readonly untrackedChanges: Change[]
    readonly indexChanges: Change[]
    readonly mergeChanges: Change[]
  }
  status(): Promise<void>
}

export interface GitAPI {
  readonly repositories: Repository[]
  getRepository(uri: Uri): Repository | null
  openRepository(uri: Uri): Promise<Repository | null>
  toGitUri(uri: Uri, ref: string): Uri
}

export interface GitExtension {
  readonly enabled: boolean
  getAPI(version: 1): GitAPI
}
