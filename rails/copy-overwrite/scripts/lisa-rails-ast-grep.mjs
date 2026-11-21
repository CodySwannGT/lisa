#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Run the pinned Rails structural scan and expose its package to CI. */
import { spawnSync } from "node:child_process";

const version = "0.40.4";
const specification = `@ast-grep/cli@${version}`;
const args = ["exec", "--yes", `--package=${specification}`, "--", "ast-grep"];

if (process.argv[2] === "--package") {
  console.log(specification);
} else {
  const tool = spawnSync("npm", [...args, "--version"], { encoding: "utf8" });
  if (tool.status !== 0 || tool.stdout.trim() !== `ast-grep ${version}`) {
    console.error(
      `The Rails structural scan could not start ast-grep ${version}. ` +
        `Install Node.js with npm, then from the repository run: npm ${args.join(" ")} --version`
    );
    process.exitCode = 1;
  } else {
    const scan = spawnSync("npm", [...args, "scan"], { stdio: "inherit" });
    if (scan.status === null) {
      console.error(
        `The Rails structural scan did not finish with ast-grep ${version}. Run npm ${args.join(" ")} --version and retry.`
      );
    }
    process.exitCode = scan.status ?? 1;
  }
}
