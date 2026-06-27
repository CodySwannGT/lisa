#!/usr/bin/env node
// This file is managed by Lisa.
// -----------------------------------------------------------------------------
// Mutation-testing gate (StrykerJS)
// -----------------------------------------------------------------------------
// Opt-in, diff-only mutation-testing gate shared by the pre-push hook and CI.
//
// Behavior:
//   1. Reads `mutation.gate.json`. If the gate is disabled (the default), it
//      prints a notice and exits 0 — pushes and CI are never slowed down until
//      a project explicitly opts in.
//   2. When enabled, it computes the source files changed on this branch
//      (vs the merge-base with the configured `since` ref) and runs Stryker on
//      ONLY those files. Mutation testing is slow, so a full-repo run is never
//      done by this gate.
//   3. The mutation-score threshold itself lives in `stryker.conf.*`
//      (`thresholds.break`) — Stryker exits non-zero when the score is below it,
//      which fails the gate.
//
// Configuration (`mutation.gate.json`, project-owned / create-only):
//   { "enabled": false, "since": "main" }
//
// Overridable via env: MUTATION_ENABLED=true|false, MUTATION_SINCE=<ref>.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const CWD = process.cwd();

const readGate = () => {
  const gatePath = path.join(CWD, "mutation.gate.json");
  if (!fs.existsSync(gatePath)) {
    return { enabled: false, since: "main" };
  }
  try {
    return JSON.parse(fs.readFileSync(gatePath, "utf8"));
  } catch (err) {
    console.error(`⚠️  Could not parse mutation.gate.json: ${err.message}`);
    return { enabled: false, since: "main" };
  }
};

const envFlag = name => {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return v === "true" || v === "1";
};

const gate = readGate();
const enabled = envFlag("MUTATION_ENABLED") ?? gate.enabled === true;
const since = process.env.MUTATION_SINCE || gate.since || "main";

if (!enabled) {
  console.log(
    '⚪ Mutation-testing gate disabled (mutation.gate.json: "enabled": false). Skipping.\n' +
      '   Flip "enabled": true (and tune thresholds.break in stryker.conf.json) to turn it on.'
  );
  process.exit(0);
}

// --- Resolve the diff base (merge-base with the `since` ref) -----------------
// stderr is ignored: failed merge-base/diff probes are expected (e.g. a missing
// origin/<ref> candidate) and handled by the surrounding try/catch.
const git = args =>
  execFileSync("git", args, {
    cwd: CWD,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

let base;
try {
  // Prefer the remote ref when present (CI checks out detached); fall back to local.
  const candidates = [`origin/${since}`, since];
  let resolved = "";
  for (const ref of candidates) {
    try {
      resolved = git(["merge-base", ref, "HEAD"]);
      if (resolved) break;
    } catch {
      /* try next candidate */
    }
  }
  base = resolved;
} catch {
  base = "";
}

if (!base) {
  console.log(
    `⚪ Mutation gate: could not resolve a merge-base against "${since}" ` +
      "(shallow clone or unknown ref). Skipping rather than mutating the whole repo."
  );
  process.exit(0);
}

// --- Compute changed, mutate-eligible source files ---------------------------
const isMutable = f =>
  /\.(ts|tsx)$/.test(f) &&
  !/\.(spec|test)\.(ts|tsx)$/.test(f) &&
  !f.endsWith(".d.ts") &&
  !f.endsWith(".stories.tsx") &&
  (f.startsWith("src/") || f.startsWith("lib/"));

let changed = [];
try {
  changed = git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
    .split("\n")
    .map(f => f.trim())
    .filter(Boolean)
    .filter(isMutable)
    .filter(f => fs.existsSync(path.join(CWD, f)));
} catch (err) {
  console.error(`⚠️  Could not compute changed files: ${err.message}`);
  process.exit(0);
}

if (changed.length === 0) {
  console.log(
    "⚪ Mutation gate: no changed source files vs " +
      since +
      ". Nothing to mutate."
  );
  process.exit(0);
}

console.log(
  `🧬 Mutation gate: running Stryker on ${changed.length} changed file(s):`
);
for (const f of changed) console.log(`   • ${f}`);

// --- Run Stryker on just the changed files (diff-only) -----------------------
const strykerBin = path.join(
  CWD,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "stryker.cmd" : "stryker"
);
const useLocal = fs.existsSync(strykerBin);
const command = useLocal ? strykerBin : "npx";
const args = useLocal
  ? ["run", "--mutate", changed.join(",")]
  : ["--yes", "stryker", "run", "--mutate", changed.join(",")];

const result = spawnSync(command, args, {
  cwd: CWD,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
