/** Exact GitHub Actions output semantics for the combined tracking CLI. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const SCRIPT = path.join(
  REPO_ROOT,
  "typescript/copy-overwrite/scripts/reconcile-nightly-e2e-tracking.mjs"
);
const LABELS = ["🎭 Playwright Web E2E", "📱 Maestro Native E2E"];

/** Read one heredoc-form GitHub Actions output. */
function output(raw: string, name: string): string {
  const match = new RegExp(
    `(?:^|\\n)${name}<<([^\\n]+)\\n([^\\n]*)\\n\\1(?:\\n|$)`,
    "u"
  ).exec(raw);
  if (!match) throw new Error(`missing ${name} output`);
  return match[2] ?? "";
}

/** Execute the real `--plan` entry point with isolated files. */
function plan(
  destination: "github" | "none",
  states: readonly ("pass" | "fail" | "unknown")[]
): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-nightly-plan-"));
  const configPath = path.join(root, "config.json");
  const outputPath = path.join(root, "output.txt");
  const config =
    destination === "none"
      ? { nightlyE2E: { tracking: { destination } } }
      : {
          nightlyE2E: { tracking: { destination } },
          github: { org: "acme", repo: "widgets" },
        };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const findings = LABELS.map((label, index) => ({
    label,
    state: states[index],
    complete: states[index] !== "unknown",
    runUrl: `https://example.invalid/runs/${index}`,
  }));
  boundedExecFileSync({
    label: "nightly E2E tracking plan",
    command: process.execPath,
    args: [SCRIPT, "--plan"],
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      LISA_CONFIG_PATH: configPath,
      NIGHTLY_E2E_FINDINGS: JSON.stringify(findings),
    },
  });
  const raw = fs.readFileSync(outputPath, "utf8");
  fs.rmSync(root, { recursive: true, force: true });
  return Object.fromEntries(
    ["destination", "tracking_action"].map(name => [name, output(raw, name)])
  );
}

describe("nightly tracking workflow plan adapter", () => {
  it("requests a provider readback-close when both suites are green", () => {
    expect(plan("github", ["pass", "pass"])).toEqual({
      destination: "github",
      tracking_action: "close",
    });
  });

  it("skips a selected provider while evidence is incomplete", () => {
    expect(plan("github", ["pass", "unknown"])).toEqual({
      destination: "none",
      tracking_action: "none",
    });
  });

  it("skips cleanly when tracking is disabled", () => {
    expect(plan("none", ["fail", "pass"])).toEqual({
      destination: "none",
      tracking_action: "none",
    });
  });
});
