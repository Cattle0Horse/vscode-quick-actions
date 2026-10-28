import { build, context } from "esbuild"
import { copyFile, mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

const flags = new Set(process.argv.slice(2))
for (const flag of flags) if (!["--production", "--watch", "--tests"].includes(flag)) throw Error(`Unknown option: ${flag}`)
const require = createRequire(import.meta.url)
const entry = require.resolve("@crosscopy/clipboard")
const clipboardRequire = createRequire(entry)
const { optionalDependencies } = clipboardRequire("./package.json")
const bindings = Object.keys(optionalDependencies).map((name) => clipboardRequire.resolve(name))
const destination = "dist/node_modules/@crosscopy/clipboard"
await mkdir(destination, { recursive: true })
const files = [entry, join(dirname(entry), "package.json"), ...bindings]
await Promise.all(files.map((source) => copyFile(source, join(destination, basename(source)))))
const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "es2022",
  format: "cjs",
  external: ["vscode", "@crosscopy/clipboard"],
  sourcemap: !flags.has("--production"),
  minify: flags.has("--production")
}
if (flags.has("--watch")) {
  const watcher = await context({
    ...options,
    plugins: [
      {
        name: "watch",
        setup(builder) {
          builder.onStart(() => console.log("[watch] build started"))
          builder.onEnd(() => console.log("[watch] build finished"))
        }
      }
    ]
  })
  await watcher.watch()
} else {
  await build(options)
  if (flags.has("--tests")) await build({ ...options, entryPoints: ["tests/extension/index.ts"], outfile: "artifacts/extension-tests/index.cjs" })
}
