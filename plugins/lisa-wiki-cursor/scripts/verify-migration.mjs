#!/usr/bin/env node
/**
 * verify-migration.mjs — the deterministic half of /doctor. Dependency-free.
 *
 * Composes validate-config + lint-wiki into a grouped report and writes
 * <wikiRoot>/state/migration/doctor-report.json with an overall verdict. Groups D
 * (runtime surfaces) and E (functional smoke) are SKIPPED here — the lisa-wiki-doctor
 * SKILL performs those and merges its results.
 *
 * Usage: node verify-migration.mjs [--wiki <root>] [--config <path>] [--migration]
 * Exit 0 = READY or READY_WITH_WARNINGS, 1 = NOT_READY.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./_wiki-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = n => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : undefined;
};
const migration = argv.includes("--migration");
const configPath = opt("--config");
const { config } = loadConfig(configPath);
const wikiRoot = path.resolve(opt("--wiki") ?? config?.wikiRoot ?? "wiki");

const groups = { A: [], B: [], C: [], D: [], E: [], F: [], G: [] };
const add = (g, id, status, message) => groups[g].push({ id, status, message });

function runNode(script, args) {
  const res = spawnSync("node", [path.join(scriptDir, script), ...args], {
    encoding: "utf8",
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: (res.stderr ?? "") + (res.error ? `\n${res.error.message}` : ""),
  };
}

// --- A. structure & config ------------------------------------------------
const vc = runNode("validate-config.mjs", [
  configPath ?? path.join(wikiRoot, "lisa-wiki.config.json"),
]);
add(
  "A",
  "config-valid",
  vc.status === 0 ? "PASS" : "FAIL",
  vc.status === 0
    ? "config validates"
    : `config invalid: ${(vc.stderr || vc.stdout).trim().split("\n").slice(0, 6).join("; ")}`
);
add(
  "A",
  "schema-version",
  config?.schemaVersion ? "PASS" : "FAIL",
  config?.schemaVersion
    ? `schemaVersion ${config.schemaVersion}`
    : "schemaVersion missing"
);
add(
  "A",
  "readme-mode",
  config?.readme?.mode ? "PASS" : "WARN",
  config?.readme?.mode
    ? `readme.mode ${config.readme.mode}`
    : "readme.mode not recorded (asked by /setup)"
);
add(
  "A",
  "purpose",
  config?.purpose ? "PASS" : "WARN",
  config?.purpose
    ? "purpose set"
    : "purpose not set (asked by /setup; feeds onboarding + contract)"
);

// --- A/B. lint (structure -> A, everything else -> B) ---------------------
const lint = runNode("lint-wiki.mjs", [
  "--wiki",
  wikiRoot,
  ...(configPath ? ["--config", configPath] : []),
  "--json",
]);
let lintReport;
try {
  lintReport = JSON.parse(lint.stdout);
} catch {
  add(
    "B",
    "lint-run",
    "FAIL",
    `lint-wiki did not produce JSON: ${(lint.stderr || lint.stdout).trim().slice(0, 200)}`
  );
}
if (lintReport) {
  const structureItems = lintReport.items.filter(i => i.group === "structure");
  const otherItems = lintReport.items.filter(i => i.group !== "structure");
  if (structureItems.length === 0)
    add("A", "structure", "PASS", "structure conforms to the manifest");
  for (const i of structureItems)
    add(
      "A",
      `structure:${i.group}`,
      i.status,
      `${i.message}${i.file ? ` (${i.file})` : ""}`
    );
  if (otherItems.length === 0)
    add("B", "integrity", "PASS", "no integrity/safety findings");
  for (const i of otherItems)
    add(
      "B",
      `${i.group}`,
      i.status,
      `${i.message}${i.file ? ` (${i.file})` : ""}`
    );
}

// --- C/D/E/F/G: deterministic-light + delegated to the doctor skill --------
add(
  "C",
  "no-loss",
  "SKIP",
  "no-loss/parity needs the migration manifest from /migrate; dangling-link check is covered in B"
);
add(
  "D",
  "runtime",
  "SKIP",
  "runtime surfaces (commands/skills/subagents/MCP) verified by the lisa-wiki-doctor skill"
);
add(
  "E",
  "smoke",
  "SKIP",
  "functional smoke tests (ingest/query/lint/onboard) performed by the lisa-wiki-doctor skill"
);
add(
  "F",
  "mode",
  config?.mode ? "PASS" : "FAIL",
  config?.mode ? `mode: ${config.mode}; wikiRoot resolves` : "mode not set"
);
add(
  "G",
  "git-ci-dist",
  "SKIP",
  "git/CI/distribution checks performed by the lisa-wiki-doctor skill and CI"
);

// --- verdict --------------------------------------------------------------
const all = Object.values(groups).flat();
const isBlockingWarn = (item, group) =>
  migration && (group === "A" || group === "B") && item.status === "WARN";
let verdict = "READY";
if (all.some(i => i.status === "FAIL")) verdict = "NOT_READY";
else if (
  Object.entries(groups).some(([g, items]) =>
    items.some(i => isBlockingWarn(i, g))
  )
)
  verdict = "NOT_READY";
else if (all.some(i => i.status === "WARN")) verdict = "READY_WITH_WARNINGS";

const reportObj = {
  tool: "verify-migration",
  deterministic: true,
  wikiRoot: path.relative(process.cwd(), wikiRoot) || ".",
  mode: config?.mode ?? null,
  migration,
  generatedAt: new Date().toISOString(),
  verdict,
  subset: "deterministic",
  note: "Deterministic subset only. Groups C (no-loss/parity), D (runtime surfaces), E (functional smoke), and G (git/CI/distribution) are completed by the lisa-wiki-doctor skill, which merges its results into this report.",
  groups,
};

const outPath = path.join(wikiRoot, "state", "migration", "doctor-report.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(reportObj, null, 2)}\n`);

const counts = all.reduce(
  (acc, i) => ((acc[i.status] = (acc[i.status] ?? 0) + 1), acc),
  {}
);
console.log(
  `verdict: ${verdict}  (${["PASS", "WARN", "FAIL", "SKIP"].map(s => `${counts[s] ?? 0} ${s}`).join(", ")})`
);
console.log(`report → ${path.relative(process.cwd(), outPath)}`);
console.log(
  "  (deterministic subset — C/D/E/G completed by the /doctor skill)"
);
for (const i of all.filter(i => i.status === "FAIL" || i.status === "WARN")) {
  console.log(`  ${i.status === "FAIL" ? "✗" : "⚠"} [${i.id}] ${i.message}`);
}
process.exit(verdict === "NOT_READY" ? 1 : 0);
