#!/usr/bin/env node
/**
 * Bind the guard's reviewed public-supervisor profile to canonical source.
 * The generated constants ship inside the guard. A host manifest or command
 * argument cannot replace them. Source changes require generation and review.
 * @module scripts/generate-scratch-supervisor-profile
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Render the two fixed constants from complete canonical supervisor bytes.
 * @param {string} guard - Editable canonical guard source.
 * @param {Buffer} source - Complete canonical supervisor bytes.
 * @returns {string} Guard with the exact source profile.
 */
export function renderScratchProfile(guard, source) {
  const text = source.toString("utf8");
  if (!Buffer.from(text).equals(source) || source.length > 262144) {
    throw new Error("Canonical supervisor source is not bounded UTF8");
  }
  const count = [
    ...text.matchAll(
      /^\s*rm -rf "(\$_quarantine|\$_root|\$_entry|\$LISA_SCRATCH_ROOT)"/gm
    ),
  ].length;
  if (count === 0)
    throw new Error("Canonical supervisor cleanup profile is absent");
  const values = {
    SHA256: createHash("sha256").update(source).digest("hex"),
    CLEANUP_COUNT: String(count),
  };
  return Object.entries(values).reduce((current, [key, value]) => {
    const expression = new RegExp(
      `^readonly SCRATCH_SUPERVISOR_${key}='[^'\\n]*'$`,
      "gm"
    );
    if ([...current.matchAll(expression)].length !== 1) {
      throw new Error("Canonical guard source profile is ambiguous");
    }
    return current.replace(
      expression,
      `readonly SCRATCH_SUPERVISOR_${key}='${value}'`
    );
  }, guard);
}

if (invokedAsScript(import.meta.url)) {
  if (
    process.argv.slice(2).some(argument => argument !== "--check") ||
    process.argv.length > 3
  ) {
    throw new Error("Usage: generate-scratch-supervisor-profile.mjs [--check]");
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const guardPath = path.join(
    root,
    "plugins/src/base/hooks/parity-safety-net.sh"
  );
  const current = readFileSync(guardPath, "utf8");
  const rendered = renderScratchProfile(
    current,
    readFileSync(
      path.join(root, "all/copy-overwrite/scripts/lisa-scratch-run.sh")
    )
  );
  if (process.argv.includes("--check")) {
    if (current !== rendered)
      throw new Error("Canonical supervisor source profile is stale");
  } else if (current !== rendered) {
    writeFileSync(guardPath, rendered);
  }
}
