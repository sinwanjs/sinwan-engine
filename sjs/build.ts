import { $ } from "bun";

await $`rm -rf dist`;
await $`bunx tsc -p tsconfig.build.json`;

await Bun.build({
  entrypoints: [
    "./src/index.ts",
    "./src/jsx/jsx-runtime.ts",
    "./src/jsx/jsx-dev-runtime.ts",
    "./src/server/index.ts",
  ],
  outdir: "./dist",
  splitting: true,        // ← FIX PRINCIPAL : shared chunks entre entrypoints
  target: "bun",          // ← important pour un lib bun-native
  packages: "external",   // ← ne pas bundler les deps, laisser le runtime les résoudre
  minify: {
    whitespace: true,
    syntax: true,
    identifiers: false,
  },
});