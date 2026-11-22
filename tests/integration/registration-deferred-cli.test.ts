/** Execute the installed registration gate, rather than only its pure seams. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  configureRegistrationReads,
  installReviewEvidenceProver,
  installReviewGh,
  reviewEvidenceStep,
  writeReviewDeclaration,
} from "../helpers/review-evidence-registration-fixture.js";

useIoLatencyBudget();
const ROOT = path.resolve(import.meta.dirname, "../..");
const LATE = "Late plugin check";
const REVIEWER = "CodeRabbit";
const HEAD = "a".repeat(40);
const WORKFLOWS = [
  ".github/workflows/review-evidence.yml",
  "typescript/create-only/.github/workflows/review-evidence.yml",
];

/**
 * Run the real workflow shell with only external GitHub observations controlled.
 * @param workflow Repository or create-only workflow path.
 * @param deferred Optional reasoned late-check declarations.
 * @param required Exact required context roster.
 * @returns Actual CLI exit status and combined output.
 */
async function runGate(
  workflow: string,
  deferred?: Record<string, string>,
  required = [REVIEWER, LATE]
) {
  const workdir = await fs.mkdtemp(path.join(tmpdir(), "deferral-cli-"));
  const bindir = path.join(workdir, "bin");
  try {
    await fs.ensureDir(bindir);
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, required);
    const file = path.join(workdir, ".github/required-checks.json");
    if (deferred !== undefined) {
      const declaration = await fs.readJson(file);
      await fs.writeJson(file, {
        ...declaration,
        registration_deferred: deferred,
      });
    }
    await installReviewGh(
      bindir,
      [{ name: REVIEWER, state: "SUCCESS", description: "Review completed" }],
      HEAD
    );
    await configureRegistrationReads(bindir, null);
    const result = boundedSpawnSync({
      label: "installed registration deferral CLI",
      command: "/bin/sh",
      args: ["-c", reviewEvidenceStep(ROOT, workflow)],
      cwd: workdir,
      env: {
        ...process.env,
        PATH: `${bindir}${path.delimiter}${process.env.PATH ?? ""}`,
        VACUITY_PR: "1234",
        GITHUB_REPOSITORY: "owner/name",
        GITHUB_BASE_REF: "main",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_EVENT_PATH: path.join(bindir, "event.json"),
        GITHUB_OUTPUT: "",
        GITHUB_STEP_SUMMARY: "",
        GITHUB_REF: "",
        NODE_OPTIONS: `--import=${path.join(bindir, "clock.mjs")}`,
      },
      baseMs: 30000,
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    await fs.remove(workdir);
  }
}

describe.each(WORKFLOWS)("installed registration deferral: %s", workflow => {
  it("settles on the first observation and names the declared late check", async () => {
    const result = await runGate(workflow, {
      [LATE]: "Queues after slow prerequisite shards.",
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain(
      "Required registration settled after 0s; 1 of 1 required contexts observed"
    );
    expect(result.output).toContain(`1 deferred by declaration: ${LATE}`);
    expect(result.output).not.toContain("absent_required_check");
    expect(result.output).toContain("REVIEWED");
  });

  it("continues to fail after the full existing window for an undeclared missing check", async () => {
    const result = await runGate(workflow);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("after 300s");
    expect(result.output).toContain("absent_required_check");
    expect(result.output).toContain(LATE);
  });

  it("refuses a typo declaration without reporting a review verdict", async () => {
    const result = await runGate(workflow, {
      Typo: "A reason cannot authorize an unknown name.",
    });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('registration_deferred entry "Typo"');
    expect(result.output).toContain("not in the selected required set");
    expect(result.output).not.toContain("REVIEWED");
  });
});
