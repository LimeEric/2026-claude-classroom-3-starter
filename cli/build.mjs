import { readFile } from "node:fs/promises";
import { build } from "esbuild";

// One file in dist/, which bin/ai-tutor.js imports. Runtime dependencies stay
// imports, resolved from node_modules; everything else — the schemas in
// @ai-tutor/api, which ship as TypeScript source — is bundled in.
const pkg = JSON.parse(
  await readFile(new URL("package.json", import.meta.url)),
);
const outfile = new URL("dist/ai-tutor.js", import.meta.url).pathname;

await build({
  entryPoints: [new URL("src/main.ts", import.meta.url).pathname],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: Object.keys(pkg.dependencies),
  define: { CLI_VERSION: JSON.stringify(pkg.version) },
  logLevel: "warning",
});
