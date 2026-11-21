/** The same canonical proof evidence determines report-only lifecycle drift. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  commit,
} from "../../support/work-item-cli.js";
import {
  attachRecord,
  proofCli,
  proofCliSpawned,
  proofFixture,
  setApi,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";
import { addRevision } from "../../support/work-item-proof-history.js";

vi.mock("node:child_process", async original =>
  (await import("../../support/work-item-inprocess-gh.js")).routeFakeGh(
    await original()
  )
);
useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

const WORKFLOW = path.resolve(
  import.meta.dirname,
  "../../../.github/workflows/lifecycle-drift-sweep.yml"
);

/**
 * Run the repository workflow's actual report consumer against the CLI output.
 * @param directory - Real fixture Git repository
 * @param accepted - Whether the CLI read completed successfully
 * @returns The consumer's exit status and output
 */
function consume(directory: string, accepted: boolean) {
  const workflow = parse(readFileSync(WORKFLOW, "utf8")) as {
    jobs: { sweep: { steps: { name?: string; run?: string }[] } };
  };
  const step = workflow.jobs.sweep.steps.find(
    row => row.name === "Fail when drift exists"
  );
  expect(step?.run).toBeTruthy();
  return boundedSpawnSync({
    label: "Lifecycle drift workflow consumer",
    command: "bash",
    args: ["-e", "-c", step!.run!],
    cwd: directory,
    env: {
      ...process.env,
      SWEEP_OUTCOME: accepted ? "success" : "failure",
    },
  });
}

describe("report-only sweep uses accepted proof without changing tracker state", () => {
  it.each([
    { kind: "pending", accepted: false, row: "PENDING VERIFICATION", alert: 0 },
    { kind: "authorized", accepted: true, row: "DRIFT", alert: 1 },
  ])(
    "reports a $kind item and preserves native state",
    ({ kind, accepted, row, alert }) => {
      const fixture = proofFixture();
      if (accepted) attachRecord(fixture);
      const stateFile = fixture.env.FAKE_GH_STATE_FILE!;
      const before = readFileSync(stateFile, "utf8");
      const result = proofCli(fixture, [
        "sweep",
        "--since",
        fixture.before,
        "--branch",
        "main",
      ]);
      const report = path.join(fixture.root, "sweep.txt");
      writeFileSync(report, result.stdout);
      const decision = consume(fixture.root, result.status === 0);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`${row}  ${PROOF_REF}`);
      expect(result.stdout).not.toContain("Re-run with --apply");
      if (kind === "pending")
        expect(result.stdout).toContain("canonical Verify/evidence");
      expect(decision.status, decision.stdout + decision.stderr).toBe(alert);
      expect(readFileSync(stateFile, "utf8")).toBe(before);
      expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
      expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe(
        ""
      );
    }
  );

  it.each([
    {
      kind: "invalid",
      category: "invalid-proof",
      reason: "current full primary specification",
    },
    { kind: "revoked", category: "invalid-proof", reason: "was revoked" },
    { kind: "unreadable", category: "read-error", reason: "asset-metadata" },
  ])(
    "refuses $kind proof and the workflow fails without a tracker write",
    ({ kind, category, reason }) => {
      const fixture = proofFixture();
      if (kind === "revoked") {
        addRevision(fixture, 1, "accepted-for-completion");
        addRevision(fixture, 2, "revoked");
      } else {
        attachRecord(
          fixture,
          kind === "invalid"
            ? { ...fixture.record, spec_sha256: "0".repeat(64) }
            : fixture.record
        );
      }
      if (kind === "unreadable") {
        setApi(fixture, ["api", "repos/acme/code/releases/assets/4"], {
          status: 403,
          stderr: "gh: Resource not accessible by integration (HTTP 403)",
        });
      }
      const stateFile = fixture.env.FAKE_GH_STATE_FILE!;
      const before = readFileSync(stateFile, "utf8");
      const args = ["sweep", "--since", fixture.before, "--branch", "main"];
      const result =
        kind === "invalid"
          ? proofCliSpawned(fixture, args)
          : proofCli(fixture, args);
      writeFileSync(path.join(fixture.root, "sweep.txt"), result.stdout);
      const decision = consume(fixture.root, result.status === 0);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`VERIFICATION FAILED  ${PROOF_REF}`);
      expect(result.stdout).toContain(`[${category}]`);
      expect(result.stdout).toContain(reason);
      expect(result.stdout).not.toContain("PENDING VERIFICATION");
      expect(decision.status, decision.stdout + decision.stderr).toBe(1);
      expect(decision.stdout).toContain("could not verify every covered item");
      expect(readFileSync(stateFile, "utf8")).toBe(before);
      expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
      expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe(
        ""
      );
    }
  );

  it("reports pending, authorized drift and unreadable evidence independently in one sweep", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const knownFile = fixture.env.FAKE_GH_STATE_FILE!;
    const known = JSON.parse(readFileSync(knownFile, "utf8"));
    const pending = path.join(fixture.root, "pending-issue.json");
    const unreadable = path.join(fixture.root, "unreadable-issue.json");
    writeFileSync(
      pending,
      JSON.stringify({
        ...known,
        number: 43,
        id: "ISSUE_43",
        body: "Verification is pending.",
        comments: [],
      })
    );
    writeFileSync(
      unreadable,
      JSON.stringify({
        ...known,
        number: 44,
        id: "ISSUE_44",
        body: "Verification records are unavailable.",
      })
    );
    const registry = path.join(fixture.root, "report-issues.json");
    writeFileSync(
      registry,
      JSON.stringify({
        repository: "acme/code",
        default_number: "42",
        issues: {
          42: { state_file: knownFile, children: [], timeline: [] },
          43: { state_file: pending, children: [], timeline: [] },
          44: { state_file: unreadable, children: [], timeline: [] },
        },
      })
    );
    fixture.env.FAKE_GH_ISSUES_FILE = registry;
    setApi(
      fixture,
      [
        "api",
        "--paginate",
        "--slurp",
        "repos/acme/code/issues/44/comments?per_page=100",
      ],
      {
        status: 403,
        stderr: "gh: Resource not accessible by integration (HTTP 403)",
      }
    );
    commit(fixture, "fix: fixture pending row\n\nWork-Item: acme/code#43\n");
    commit(fixture, "fix: fixture unreadable row\n\nWork-Item: acme/code#44\n");
    const before = [knownFile, pending, unreadable].map(file =>
      readFileSync(file, "utf8")
    );

    const result = proofCli(fixture, [
      "sweep",
      "--since",
      fixture.before,
      "--branch",
      "main",
    ]);
    writeFileSync(path.join(fixture.root, "sweep.txt"), result.stdout);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("DRIFT  acme/code#42");
    expect(result.stdout).toContain("PENDING VERIFICATION  acme/code#43");
    expect(result.stdout).toContain("VERIFICATION FAILED  acme/code#44");
    expect(result.stdout).toContain(
      "1 authorized drift, 1 pending verification, 1 verification failed"
    );
    expect(consume(fixture.root, false).status).toBe(1);
    expect(
      [knownFile, pending, unreadable].map(file => readFileSync(file, "utf8"))
    ).toEqual(before);
    expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });
});
