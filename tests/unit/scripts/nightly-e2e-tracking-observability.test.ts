/**
 * RED Actions-observability contract for disabled combined tracking.
 */
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
const FINDINGS = [
  {
    label: "🎭 Playwright Web E2E",
    state: "fail",
    complete: true,
    runUrl: "https://example.invalid/playwright",
  },
  {
    label: "📱 Maestro Native E2E",
    state: "pass",
    complete: true,
    runUrl: "https://example.invalid/maestro",
  },
];

/** Execute the shipped planner with Actions output and summary files. */
function disabled(config: Record<string, unknown>): {
  readonly stdout: string;
  readonly summary: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-tracking-none-"));
  const configPath = path.join(root, "config.json");
  const outputPath = path.join(root, "output.txt");
  const summaryPath = path.join(root, "summary.md");
  fs.writeFileSync(configPath, JSON.stringify(config));
  fs.writeFileSync(summaryPath, "");
  try {
    const stdout = boundedExecFileSync({
      label: "disabled nightly tracking planner",
      command: process.execPath,
      args: [SCRIPT, "--plan"],
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        LISA_CONFIG_PATH: configPath,
        NIGHTLY_E2E_FINDINGS: JSON.stringify(FINDINGS),
      },
    });
    return { stdout, summary: fs.readFileSync(summaryPath, "utf8") };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("disabled nightly tracking is visible in Actions", () => {
  it.each([
    ["absent", {}],
    ["explicit none", { nightlyE2E: { tracking: { destination: "none" } } }],
  ] as const)(
    "reports tracking_disabled for %s configuration",
    (_name, config) => {
      const observed = disabled(config);

      expect(observed.stdout).toBe("tracking_disabled\n");
      expect(observed.summary).toBe("tracking_disabled\n");
    }
  );
});
