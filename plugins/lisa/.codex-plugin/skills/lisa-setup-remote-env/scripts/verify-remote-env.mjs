#!/usr/bin/env node
/**
 * Prove a remote environment is actually configured the way it was meant to be.
 *
 * This runs identically whatever provisioned the environment — an API, a driven
 * browser, or a human pasting emitted config. That is the point: trust comes
 * from the read-back, not from the mechanism, so the weakest provisioning tier
 * ends up as trustworthy as the strongest.
 *
 * Every assertion is made **without printing a value**. Presence, mode, and
 * shape are all checkable without revealing content, and an environment proof
 * that leaks the thing it is proving is not a proof worth having.
 *
 * One rule this encodes the hard way: never verify against a vendor's own UI.
 * A dashboard counter reported zero tasks for an environment that had
 * demonstrably completed one, because the underlying records carried no
 * environment identifier. Assert against durable state instead.
 *
 * Usage:
 *   verify-remote-env.mjs
 * @module verify-remote-env
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

import { readRemoteEnvConfig } from "./setup-remote-env.mjs";
import { extractVersion } from "./toolchain.mjs";

/** Collected results, so every check runs before anything reports failure. */
const results = [];

/**
 * Record one assertion.
 * @param {boolean} ok Whether it held.
 * @param {string} label What was checked.
 * @param {string} [detail] Extra context, never a secret value.
 */
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
}

/**
 * Assert a path exists with an exact permission mode.
 *
 * The mode is the assertion, not merely existence. A world-readable secrets
 * file is present and wrong, and "present" is what a weaker check would report.
 * @param {string} path Filesystem path.
 * @param {number} mode Expected permission bits.
 * @param {string} label What this path is.
 */
function checkMode(path, mode, label) {
  if (!existsSync(path)) {
    check(false, label, "absent");
    return;
  }
  const actual = statSync(path).mode & 0o777;
  check(
    actual === mode,
    label,
    actual === mode
      ? `mode ${mode.toString(8)}`
      : `mode ${actual.toString(8)}, expected ${mode.toString(8)}`
  );
}

/**
 * Run a sibling skill's script and capture its output.
 * @param {string[]} args Node arguments.
 * @returns {{ok: boolean, out: string}} Result.
 */
function node(args) {
  try {
    const out = execFileSync("node", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out: out.trim() };
  } catch (err) {
    return { ok: false, out: String(err.stderr ?? err.message).trim() };
  }
}

/**
 * Assert each declared tool is present at its pinned or minimum version.
 * @param {object} tools Toolchain manifest.
 */
function verifyToolchain(tools) {
  for (const tool of tools.require ?? []) {
    try {
      const out = execFileSync(tool.name, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      check(true, `tool ${tool.name}`, extractVersion(out) ?? "present");
    } catch {
      check(false, `tool ${tool.name}`, "required but not present");
    }
  }
  for (const tool of tools.install ?? []) {
    try {
      const out = execFileSync(tool.name, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const found = extractVersion(out);
      check(
        found === tool.version,
        `tool ${tool.name}`,
        `${found} (pin ${tool.version})`
      );
    } catch {
      check(
        false,
        `tool ${tool.name}`,
        `pinned ${tool.version} but not installed`
      );
    }
  }
}

/**
 * Assert the working tree is clean.
 *
 * A remote environment that starts dirty will carry unrelated changes into
 * whatever it produces, and the resulting diff is no longer attributable to the
 * task that ran.
 */
function verifyCleanCheckout() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    check(
      out.trim() === "",
      "clean checkout",
      out.trim() ? "working tree is dirty" : ""
    );
  } catch {
    check(false, "clean checkout", "not a git repository");
  }
}

function main() {
  const cfg = readRemoteEnvConfig();
  const secretsDir = process.argv[2];

  verifyToolchain(cfg.tools);

  const surface = node([
    new URL(
      "../../lisa-secrets-access/scripts/resolve-secret.mjs",
      import.meta.url
    ).pathname,
    "surface",
  ]);
  check(surface.ok, "surface detected", surface.out);

  if (secretsDir) {
    checkMode(secretsDir, 0o700, "secrets directory");
    checkMode(`${secretsDir}/secrets.env`, 0o600, "values file");
    checkMode(`${secretsDir}/secret-notes.json`, 0o600, "notes file");
  }

  verifyCleanCheckout();

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"} ${r.label.padEnd(28)} ${r.detail}`
    );
  }
  if (failed) throw new Error(`${failed} environment check(s) failed`);
  console.log("\nRemote environment verified without revealing any value.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
