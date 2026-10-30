import { $ } from "bun";
// import { logger } from "@sinwan/logger";

await $`bunx rimraf dist`;
await $`bunx tsc -p tsconfig.build.json`;

await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  minify: true,
  target: "bun",
  // Bun.build inlines `process.env.NODE_ENV` by default ("development"), which
  // removed the production checks in ErrorNormalizer/ErrorHandler from the
  // bundle: error messages and stacks leaked in production. Keep it a runtime read.
  define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
});

// Guard: the bundle must still read NODE_ENV at runtime.
const bundle = await Bun.file("./dist/index.js").text();
if (!bundle.includes("process.env.NODE_ENV")) {
  throw new Error("dist/index.js no longer reads process.env.NODE_ENV at runtime; production error masking would be lost.");
}

// logger({ context: "Core build" }).info("Core package built successfully.");
