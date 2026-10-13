/**
 * The condition `ensure-deploy-outcome-guard` writes must read the way a person
 * would have written it, keep the host's own YAML style, and be left alone on a
 * second run (CodySwannGT/lisa#4456).
 *
 * The migration's first release rewrote conditions that were semantically right
 * and textually wrong: `!cancelled() && !cancelled () && x=='y'`, always as a
 * `>-` block. A host that asserts its workflow text in its own tests went red on
 * update, and every reviewer saw a garbled condition. These cases pin the TEXT;
 * each also re-checks, through `jobRuns`, the evaluator that knows nothing about
 * this migration, that a failed release no longer skips the job — so a
 * formatting change cannot quietly undo the repair it is formatting.
 * @module tests/unit/migrations/deploy-outcome-guard-render
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { load as loadYaml } from "js-yaml";
import { beforeEach, describe, expect, it } from "vitest";

import { jobRuns } from "../../../src/core/github-actions-condition.js";
import { EnsureDeployOutcomeGuardMigration } from "../../../src/migrations/ensure-deploy-outcome-guard.js";
import { SilentLogger } from "../../../src/logging/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** The upstream job every fixture also needs, beside the release. */
const CHECK = "needs.check_eas_setup.outputs.has_eas_setup == 'true'";

/** The release gate the migration removes. */
const GATE = "needs.release.result == 'success'";

/** The continuation-line indent of a job-level key in these fixtures. */
const INNER = "      ";

/** The expo deploy job's condition before #3738: `always()` plus the gate. */
const EXPO_BEFORE = `always() && ${CHECK} && ${GATE}`;

/** The rails deploy job's condition before #3738: no mention of the release. */
const RAILS_BEFORE =
  "${{ github.event_name != 'push' || " +
  "!startsWith(github.event.head_commit.message, 'chore(release):') }}";

/**
 * A host `deploy.yml` whose deploy job carries the given `if:` value.
 * @param condition - Text after `if: `, or null for a job with no `if:`
 * @returns Workflow source
 */
function hostWorkflow(condition: string | null): string {
  return [
    "name: Deploy",
    "on:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  release:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Cut the release",
    "        run: echo release",
    "  deploy:",
    "    needs: [release, check_eas_setup]",
    ...(condition === null ? [] : [`    if: ${condition}`]),
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Ship it",
    "        run: echo deploying",
    "",
  ].join("\n");
}

/**
 * A block-scalar `if:` value: the indicator, then one indented line per part.
 * @param indicator - `|`, `>-`, …
 * @param parts - The condition's lines
 * @returns Text to follow `if: `
 */
function block(indicator: string, ...parts: readonly string[]): string {
  return [indicator, ...parts.map(part => `${INNER}${part}`)].join("\n");
}

/** A failed release, with everything else configured. */
const FAILED_RELEASE: Parameters<typeof jobRuns>[1] = {
  needs: {
    release: { result: "failure" },
    check_eas_setup: { result: "success", outputs: { has_eas_setup: "true" } },
  },
  github: {
    "github.event_name": "push",
    "github.event.head_commit.message": "feat: x",
  },
  cancelled: false,
};

/**
 * The deploy job's parsed `if:` value.
 * @param source - Workflow source
 * @returns The condition, or "" when absent
 */
function parsedIf(source: string): string {
  const document = loadYaml(source) as {
    readonly jobs?: Readonly<Record<string, { readonly if?: string }>>;
  };
  return document.jobs?.deploy?.if ?? "";
}

/**
 * The deploy job's `if:` key exactly as written: the key line and its
 * continuation lines, without the explanatory comment above it.
 * @param source - Workflow source
 * @returns The raw key text
 */
function rawIf(source: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex(line => line.startsWith("    if:"));
  const after = lines.slice(start + 1);
  const length = after.findIndex(line => !line.startsWith(INNER));
  return lines.slice(start, start + 1 + Math.max(length, 0)).join("\n");
}

describe("ensure-deploy-outcome-guard renders canonical text (#4456)", () => {
  let projectDir: string;

  beforeEach(async () => {
    const tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await mkdir(path.join(projectDir, ".github", "workflows"), {
      recursive: true,
    });
    return async (): Promise<void> => {
      await cleanupTempDir(tempDir);
    };
  });

  /**
   * Seed the host workflow and run the migration over it.
   * @param source - Workflow source to seed
   * @returns The workflow source after the run
   */
  async function migrate(source: string): Promise<string> {
    const file = path.join(projectDir, ".github", "workflows", "deploy.yml");
    await writeFile(file, source);
    const ctx = {
      projectDir,
      lisaDir: ROOT,
      detectedTypes: ["typescript" as const],
      dryRun: false,
      logger: new SilentLogger(),
    };
    const migration = new EnsureDeployOutcomeGuardMigration();
    if (await migration.applies(ctx)) await migration.apply(ctx);
    return readFile(file, "utf8");
  }

  it.each([
    [
      "a plain line that already carries always(), kept plain",
      EXPO_BEFORE,
      `    if: always() && ${CHECK}`,
    ],
    [
      "a condition that already carries !cancelled()",
      `\${{ !cancelled() && ${GATE} && github.event_name == 'push' }}`,
      "    if: ${{ !cancelled() && github.event_name == 'push' }}",
    ],
    [
      "a function call inside a disjunction",
      `\${{ ${GATE} && (github.event_name != 'push' || ` +
        "!startsWith(github.event.head_commit.message, 'chore(release):')) }}",
      "    if: ${{ !cancelled() && (github.event_name != 'push' || " +
        "!startsWith(github.event.head_commit.message, 'chore(release):')) }}",
    ],
    [
      "a literal block scalar",
      block("|", `${CHECK} &&`, GATE),
      `    if: |\n${INNER}!cancelled() &&\n${INNER}${CHECK}`,
    ],
    [
      "a folded block scalar",
      block(">-", `${CHECK} &&`, GATE),
      `    if: >-\n${INNER}!cancelled() &&\n${INNER}${CHECK}`,
    ],
    [
      "a parenthesised `&&` group, kept on one line",
      block("|", `${GATE} &&`, `(github.event_name == 'push' && ${CHECK})`),
      `    if: |\n${INNER}!cancelled() &&\n` +
        `${INNER}(github.event_name == 'push' && ${CHECK})`,
    ],
    [
      "a multi-line literal block that never names the release",
      block("|", "github.event_name == 'push' &&", CHECK),
      `    if: |\n${INNER}!cancelled() &&\n` +
        `${INNER}(github.event_name == 'push' &&\n${INNER}${CHECK})`,
    ],
    [
      "a plain unwrapped line, which YAML cannot start with `!`",
      `${GATE} && github.event_name == 'push'`,
      `    if: >-\n${INNER}!cancelled() &&\n${INNER}github.event_name == 'push'`,
    ],
  ])("writes %s canonically", async (_label, condition, expected) => {
    const after = await migrate(hostWorkflow(condition));

    expect(rawIf(after)).toBe(expected);
    expect(jobRuns(parsedIf(after), FAILED_RELEASE)).toBe(true);
  });

  it.each([
    ["no `if:`", null],
    ["the rails condition", RAILS_BEFORE],
    ["the expo condition", EXPO_BEFORE],
    ["a literal block scalar", block("|", "always() &&", GATE)],
  ])(
    "re-applying over %s is a byte-for-byte no-op",
    async (_label, condition) => {
      const before = hostWorkflow(condition);
      const once = await migrate(before);
      const twice = await migrate(once);

      expect(once).not.toBe(before);
      expect(twice).toBe(once);
    }
  );
});
