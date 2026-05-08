import { $ } from "bun";
// import { logger } from "@sinwan/logger";

await $`bunx rimraf dist`;
await $`bunx tsc -p tsconfig.build.json`;

await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  minify: true,
  target: "bun",
});

// logger({ context: "Core build" }).info("Core package built successfully.");
