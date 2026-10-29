/** Raw API fixture for the actual installed review-evidence CLI. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  terminalResponses,
  type TerminalScenario,
} from "./review-terminal-responses.js";
export type { TerminalScenario } from "./review-terminal-responses.js";

const root = path.resolve(import.meta.dirname, "../..");
const source =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

/**
 * Install unchanged prover bytes and raw external fixtures in an owned root.
 * @param folder - Disposable fixture root
 * @param scenario - Native check and independent evidence facts
 * @param jq - Actual jq binary discovered in the inherited test environment
 * @returns Installed declaration, raw responses, and executable directory
 */
function installFixture(
  folder: string,
  scenario: TerminalScenario,
  jq: string
) {
  const bindir = path.join(folder, "bin");
  const declaration = {
    ruleset: { repo: "acme/code", ids: [1], baseline_fetched_at: "2026-10-28" },
    workflows: [".github/workflows/ci.yml"],
    required_contexts: ["CodeRabbit"],
    required_contexts_by_branch: { main: ["CodeRabbit"] },
    skip_job_declarations: {},
    evidence_bearing_checks: {
      CodeRabbit: {
        ...(scenario.waive ? { waive: [scenario.waive] } : {}),
        ...(scenario.satisfy
          ? { satisfy: [scenario.satisfy], proof: [scenario.satisfy] }
          : {}),
      },
    },
  };
  const raw = terminalResponses(scenario);
  fs.mkdirSync(bindir);
  fs.cpSync(
    path.join(root, "typescript/copy-overwrite/scripts/lib"),
    path.join(folder, "scripts/lib"),
    { recursive: true }
  );
  fs.copyFileSync(
    path.join(root, source),
    path.join(folder, "scripts/check-skipped-required-checks.mjs")
  );
  fs.writeFileSync(
    path.join(bindir, "gh"),
    `#!${process.execPath}\nprocess.argv.splice(2, 0, ${JSON.stringify(folder)}, ${JSON.stringify(jq)});\n${fs.readFileSync(path.join(root, "tests/fixtures/review-terminal-gh.cjs"), "utf8")}`,
    { mode: 0o755 }
  );
  fs.mkdirSync(path.join(folder, ".github/workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, ".github/workflows/ci.yml"),
    "jobs:\n  quality:\n    with:\n      skip_jobs: ''\n"
  );
  fs.writeFileSync(
    path.join(folder, ".github/required-checks.json"),
    JSON.stringify(declaration)
  );
  fs.writeFileSync(path.join(folder, "responses.json"), JSON.stringify(raw));
  fs.writeFileSync(path.join(folder, "calls.jsonl"), "");
  return { bindir, declaration, raw };
}

/**
 * Execute the installed source CLI with raw external observations and real jq.
 * @param scenario - Independent native API facts
 * @param env - Actual test environment, supplied explicitly by the test
 * @returns Actual command, streams, native inputs, and full API trace
 */
export function runTerminalReview(
  scenario: TerminalScenario,
  env: NodeJS.ProcessEnv
) {
  const folder = fs.mkdtempSync(path.join(tmpdir(), "review-terminal-"));
  try {
    const jq = boundedSpawnSync({
      label: "resolve actual jq",
      command: "/usr/bin/which",
      args: ["jq"],
      env,
      baseMs: 30000,
    });
    if (jq.status !== 0)
      throw new Error("The raw review fixture requires actual jq.");
    const { bindir, declaration, raw } = installFixture(
      folder,
      scenario,
      String(jq.stdout).trim()
    );
    const args = [
      "scripts/check-skipped-required-checks.mjs",
      "--vacuity",
      "--require-review-evidence",
      "--repo=acme/code",
      "--pr=1234",
      "--base=main",
      "--settle-timeout=0",
      "--json",
    ];
    const result = boundedSpawnSync({
      label: "actual terminal review CLI",
      command: process.execPath,
      args,
      cwd: folder,
      env: { ...env, PATH: `${bindir}${path.delimiter}${env.PATH ?? ""}` },
      baseMs: 30000,
    });
    return {
      scenario,
      declaration,
      raw,
      command: [process.execPath, ...args],
      sourceSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(root, source)))
        .digest("hex"),
      status: result.status,
      stdout: String(result.stdout),
      stderr: String(result.stderr),
      calls: fs
        .readFileSync(path.join(folder, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
