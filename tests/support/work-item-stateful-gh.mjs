#!/usr/bin/env node
/**
 * The controlled provider as a real `gh` executable: the core's behaviour on
 * the process's own argv, environment and streams.
 */
import { readFileSync } from "node:fs";
import { statefulGh } from "./work-item-stateful-gh-core.mjs";

const status = statefulGh(process.argv.slice(2), process.env, {
  out: bytes => process.stdout.write(bytes),
  err: text => process.stderr.write(text),
  fail: code => {
    process.exitCode = code;
  },
  stdin: () => readFileSync(0),
});
if (status !== undefined) process.exit(status);
