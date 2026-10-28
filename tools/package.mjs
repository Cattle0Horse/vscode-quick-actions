import { mkdir } from "node:fs/promises"
import { createVSIX } from "@vscode/vsce"

await mkdir("artifacts", { recursive: true })
await createVSIX({ packagePath: "artifacts/quick-actions.vsix", dependencies: false, skipLicense: false, allowMissingRepository: true })
