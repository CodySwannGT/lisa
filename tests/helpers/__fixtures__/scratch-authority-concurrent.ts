/** One synchronized process competing to establish a scratch namespace. */
import filesystem, { existsSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as path from "node:path";

const base = process.env["LISA_CONCURRENT_SCRATCH_BASE"];
const ready = process.env["LISA_CONCURRENT_SCRATCH_READY"];
const start = process.env["LISA_CONCURRENT_SCRATCH_START"];
const count = Number(process.env["LISA_CONCURRENT_SCRATCH_COUNT"]);

if (
  base === undefined ||
  ready === undefined ||
  start === undefined ||
  !Number.isSafeInteger(count)
) {
  throw new Error("Concurrent scratch fixture requires base, ready, and start");
}

writeFileSync(`${ready}-${String(process.pid)}`, "ready", "utf8");
const sleeper = new Int32Array(new SharedArrayBuffer(4));
while (true) {
  if (existsSync(start)) break;
  Atomics.wait(sleeper, 0, 0, 5);
}

const namespace = path.join(filesystem.realpathSync(base), "lisa-scratch");
const observedPrefix = path.join(base, "observed");
const originalLstat = filesystem.lstatSync.bind(filesystem);
filesystem.lstatSync = ((candidate, options) => {
  try {
    return originalLstat(candidate, options as never);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      candidate !== namespace
    ) {
      throw error;
    }
    writeFileSync(
      `${observedPrefix}-${String(process.pid)}`,
      "observed",
      "utf8"
    );
    const deadline = Date.now() + 30_000;
    while (
      readdirSync(base).filter(name => name.startsWith("observed-")).length <
        count &&
      Date.now() < deadline
    ) {
      Atomics.wait(sleeper, 0, 0, 5);
    }
    throw error;
  }
}) as typeof filesystem.lstatSync;
syncBuiltinESMExports();
const { createScratchNamespaceAuthority } =
  await import("../../../src/configs/vitest/scratch-authority.js");
const authority = createScratchNamespaceAuthority(base);
process.stdout.write(`${JSON.stringify(authority.namespace)}\n`);
