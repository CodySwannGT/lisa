/** Real canonical CLI allow-paths; provider payloads remain synthetic/local. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  proofCli,
  PROOF_REF,
  putAsset,
} from "../../support/work-item-proof-fixture.js";

const COMPLETED = "work-item completed:";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/** The native state and attempted writes, not a read-count promise of success. */
function observed(fixture: ReturnType<typeof proofFixture>) {
  const state = JSON.parse(
    readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
  );
  const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
  expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  return { state, writes };
}

describe("accepted completion proof through actual CLI", () => {
  it("preserves distinct quality execution and delivered remote evidence heads", () => {
    const fixture = proofFixture();
    const captured = putAsset(
      fixture,
      5,
      Buffer.from(
        "PASS synthetic quality > enforces required behavior\nTests 1 passed\n"
      )
    );
    const evidence = {
      ...captured,
      evidence_id: "EV-quality",
      kind: "test-run-log",
      captured_at: new Date().toISOString(),
      artifact_head_sha: fixture.prHead,
    };
    const verdict = putAsset(fixture, 6, {
      schema_version: 2,
      status: "pass",
      not_established_reviewed: true,
      artifact: {
        repository: "acme/code",
        environment: "ci",
        head_sha: fixture.prHead,
      },
      evidence: [evidence],
      claims: [
        {
          claim_id: "C-quality",
          boundary: "code-unit",
          required_for_gate: true,
          required_evidence_kinds: ["test-run-log"],
          status: "established",
          evidence_refs: ["EV-quality"],
          not_established: [],
        },
      ],
      criteria: [
        {
          task: "Quality",
          criterion: "Required quality control",
          status: "pass",
        },
      ],
    });
    fixture.record.evidence.push(evidence);
    fixture.record.verdicts.push({ ...verdict, role: "quality" });
    fixture.record.requirements[0]!.claim_ids.push("C-quality");
    const report = JSON.parse(
      readFileSync(
        path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "3.bin"),
        "utf8"
      )
    );
    report.requirements = fixture.record.requirements.map(row => ({
      ...row,
      status: "pass",
    }));
    Object.assign(
      fixture.record.obligations.conformance.report,
      putAsset(fixture, 3, report)
    );
    attachRecord(fixture);
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(observed(fixture).state.state).toBe("CLOSED");
  });

  it("allows exact accepted direct completion and a repeated completion writes nothing", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const first = proofCli(fixture, [
      "complete",
      "--ref",
      PROOF_REF,
      "--pr-url",
      "https://github.com/acme/code/pull/7",
    ]);
    console.log(
      JSON.stringify({
        name: "accepted direct completion",
        status: first.status,
        stdout: first.stdout,
        stderr: first.stderr,
        controlledProvider: true,
        actualCanonicalCli: true,
        realTrackerWriteExecuted: false,
      })
    );
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(COMPLETED);
    const after = observed(fixture);
    expect(after.state.state).toBe("CLOSED");
    expect(
      after.state.labels.map((row: { name: string }) => row.name).sort()
    ).toEqual(["component:ci", "status:done", "type:Bug"]);
    expect(after.state.assignees).toEqual([{ login: "fixture-owner" }]);
    expect(after.writes).toHaveLength(2);
    const repeated = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(repeated.status).toBe(0);
    expect(repeated.stderr).toBe("");
    expect(repeated.stdout).toMatch(/completed:/);
    expect(observed(fixture).writes).toEqual(after.writes);
  });

  it("allows the same accepted proof through the actual applying-sweep CLI", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const result = proofCli(fixture, [
      "sweep",
      "--apply",
      "--since",
      fixture.before,
      "--branch",
      "main",
    ]);
    console.log(
      JSON.stringify({
        name: "accepted applying sweep",
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        controlledProvider: true,
        actualCanonicalCli: true,
        realTrackerWriteExecuted: false,
      })
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(COMPLETED);
    expect(observed(fixture).state.state).toBe("CLOSED");
    expect(observed(fixture).writes).toHaveLength(2);
  });

  it("publishes immutable proof, reads it back, and the resulting locator permits completion", () => {
    const fixture = proofFixture();
    const file = path.join(fixture.root, "record-input.json");
    writeFileSync(file, JSON.stringify(fixture.record));
    const result = proofCli(fixture, [
      "publish-completion-proof",
      "--ref",
      PROOF_REF,
      "--record",
      file,
    ]);
    console.log(
      JSON.stringify({
        name: "actual producer round trip",
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        controlledProvider: true,
        actualCanonicalCli: true,
        realTrackerWriteExecuted: false,
      })
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const publication = JSON.parse(result.stdout);
    expect(publication.category).toBe("published");
    expect(publication.terminal_mutation).toBe(false);
    const beforeComplete = observed(fixture);
    expect(beforeComplete.state.state).toBe("OPEN");
    expect(
      beforeComplete.writes.some(
        (args: string[]) =>
          args[0] === "issue" && ["edit", "close"].includes(args[1]!)
      )
    ).toBe(false);
    expect(
      beforeComplete.state.comments.some((row: { body: string }) =>
        row.body.startsWith("[lisa-completion-authorization]\n")
      )
    ).toBe(true);
    const completed = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(completed.stderr).toBe("");
    expect(completed.status).toBe(0);
    expect(completed.stdout).toContain(COMPLETED);
    expect(observed(fixture).state.state).toBe("CLOSED");
  });
});
