#!/usr/bin/env bun
import { rm, cp } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const ROOT = import.meta.dir;
const DIST = join(ROOT, "dist");

const ENTRIES = [
  "src/options.js",
  "src/steamsorry-worker.js",
  "src/steamsorry-content.js",
  "src/steamsorry-page.js",
];

const STATIC = ["manifest.json", "src/options.html"];
const STATIC_DIRS = ["icons"];

const argv = process.argv.slice(2);
const mode = argv.includes("dev") ? "dev" : "prod";

await rm(DIST, { recursive: true, force: true });

await Bun.build({
  entrypoints: ENTRIES.map((r) => join(ROOT, r)),
  outdir: join(DIST, "src"),
  format: "iife",
  target: "browser",
  minify: false,
  sourcemap: "none",
});

for (const rel of STATIC) {
  await cp(join(ROOT, rel), join(DIST, rel), { recursive: true });
}
for (const rel of STATIC_DIRS) {
  await cp(join(ROOT, rel), join(DIST, rel), { recursive: true });
}

console.log(`Built (${mode}) → dist/`);