import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { spawn } from "node:child_process"
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron"
import yauzl from "yauzl"

const flags = new Set(process.argv.slice(2))
assert.ok([...flags].every((flag) => ["--package", "--interactive"].includes(flag)))
const packaged = flags.has("--package")
const interactive = flags.has("--interactive")
assert.ok(!(packaged && interactive))
await mkdir(".vscode-test", { recursive: true })
const runDirectory = await mkdtemp(resolve(".vscode-test", packaged ? "package-" : "development-"))
let extensionRoot = resolve(".")
if (packaged) {
  extensionRoot = resolve(runDirectory, "extension")
  await new Promise((done, fail) => {
    yauzl.open("artifacts/quick-actions.vsix", { lazyEntries: true }, (error, zip) => {
      if (error) return fail(error)
      zip.on("error", fail)
      zip.on("end", done)
      zip.on("entry", (entry) => {
        void (async () => {
          if (entry.fileName.startsWith("extension/")) {
            const path = resolve(extensionRoot, entry.fileName.slice("extension/".length))
            const local = relative(extensionRoot, path)
            assert.ok(!isAbsolute(local) && local !== ".." && !local.startsWith("../") && !local.startsWith("..\\"))
            if (entry.fileName.endsWith("/")) await mkdir(path, { recursive: true })
            else {
              await mkdir(dirname(path), { recursive: true })
              const stream = await new Promise((accept, reject) => zip.openReadStream(entry, (err, value) => (err ? reject(err) : accept(value))))
              await pipeline(stream, createWriteStream(path))
            }
          }
          zip.readEntry()
        })().catch((err) => {
          zip.close()
          fail(err)
        })
      })
      zip.readEntry()
    })
  })
  await mkdir(resolve(extensionRoot, "test"), { recursive: true })
  await copyFile("artifacts/extension-tests/index.cjs", resolve(extensionRoot, "test/index.cjs"))
}
const workspace = resolve(runDirectory, "workspace")
const userData = resolve(runDirectory, "user-data")
const extensions = resolve(runDirectory, "extensions")
await Promise.all([mkdir(workspace), mkdir(resolve(userData, "User"), { recursive: true }), mkdir(extensions)])
await writeFile(
  resolve(userData, "User/settings.json"),
  JSON.stringify({
    "git.autofetch": false,
    "git.openRepositoryInParentFolders": "never",
    "git.detectSubmodules": false,
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "update.mode": "none",
    "telemetry.telemetryLevel": "off",
    "files.autoSave": "off",
    "workbench.startupEditor": "none"
  })
)
const executable = process.env.VSCODE_EXECUTABLE_PATH || (await downloadAndUnzipVSCode("stable"))
const launchArgs = [workspace, "--user-data-dir", userData, "--extensions-dir", extensions, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"]
if (interactive) {
  const child = spawn(executable, [...launchArgs, `--extensionDevelopmentPath=${extensionRoot}`, "--inspect-extensions=9229"], { stdio: "inherit", windowsHide: true })
  child.once("spawn", () => console.log("Isolated desktop host ready"))
  await new Promise((done, fail) => {
    child.once("error", fail)
    child.once("exit", (code) => (code === 0 ? done() : fail(Error(`VS Code exited: ${code}`))))
  })
} else {
  const reportPath = resolve(runDirectory, "report.json")
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: packaged ? resolve(extensionRoot, "test/index.cjs") : resolve("artifacts/extension-tests/index.cjs"),
    extensionTestsEnv: { QUICK_ACTIONS_REPORT: reportPath },
    launchArgs
  })
  const report = JSON.parse(await readFile(reportPath, "utf8"))
  const bundleHash = createHash("sha256")
    .update(await readFile(resolve(extensionRoot, "dist/extension.cjs")))
    .digest("hex")
  assert.equal(report.bundleHash, bundleHash)
  await mkdir("artifacts", { recursive: true })
  await writeFile(`artifacts/${packaged ? "package" : "extension"}-desktop.json`, JSON.stringify({ ...report, packaged }, null, 2) + "\n")
  console.log(`${report.cases.length} desktop cases passed; VS Code ${report.vscodeVersion}; bundle ${bundleHash}`)
}
