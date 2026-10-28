import { build, context } from "esbuild"

const flags = new Set(process.argv.slice(2))
for (const flag of flags) if (!["--production", "--watch", "--tests"].includes(flag)) throw Error(`Unknown option: ${flag}`)
const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "es2022",
  format: "cjs",
  external: ["vscode"],
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
