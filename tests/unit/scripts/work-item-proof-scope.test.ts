/** Ambiguous/example declarations cannot waive actual runtime obligations. */
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
  putAsset,
  digest,
  SPEC,
  PROOF_REF,
  setApi,
} from "../../support/work-item-proof-fixture.js";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);
const COMPLETED = "work-item completed:";
const INVALID_PROOF = "[invalid-proof]";

/** An internally consistent documentary waiver must not override a real target. */
function waivedRuntime(
  fixture: ReturnType<typeof proofFixture>,
  primary: string
) {
  const state = JSON.parse(
    readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
  );
  state.body = state.body.replace(SPEC, primary);
  writeFileSync(fixture.env.FAKE_GH_STATE_FILE!, JSON.stringify(state));
  fixture.record.spec_sha256 = digest(primary);
  Object.assign(fixture.record.obligations.remote, {
    required: false,
    status: "not-applicable",
    reason: "doc-only",
  });
  Object.assign(fixture.record.obligations.delivery, {
    required: false,
    status: "not-applicable",
    reason: "doc-only",
  });
  fixture.record.requirements[0]!.claim_ids = [];
  const verdict = JSON.parse(
    readFileSync(
      path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "2.bin"),
      "utf8"
    )
  );
  verdict.claims = [];
  Object.assign(fixture.record.verdicts[0]!, putAsset(fixture, 2, verdict));
  const report = JSON.parse(
    readFileSync(
      path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "3.bin"),
      "utf8"
    )
  );
  report.spec_sha256 = digest(primary);
  report.requirements = fixture.record.requirements.map(row => ({
    ...row,
    status: "pass",
  }));
  Object.assign(
    fixture.record.obligations.conformance.report,
    putAsset(fixture, 3, report)
  );
}

describe("actual CLI completion scope", () => {
  it.each([false, true])(
    "requires the visible comment-closing marker attachment (attached=%s)",
    attached => {
      const fixture = proofFixture();
      const primary = `${SPEC}<!-- explanatory example\n--> [EVIDENCE: cli-output: actual]\n`;
      const stateFile = fixture.env.FAKE_GH_STATE_FILE!;
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      state.body = state.body.replace(SPEC, primary);
      writeFileSync(stateFile, JSON.stringify(state));
      fixture.record.spec_sha256 = digest(primary);
      const report = JSON.parse(
        readFileSync(
          path.join(fixture.env.FAKE_GH_ASSET_DIRECTORY!, "3.bin"),
          "utf8"
        )
      );
      report.spec_sha256 = digest(primary);
      Object.assign(
        fixture.record.obligations.conformance.report,
        putAsset(fixture, 3, report)
      );
      if (attached) {
        const capture = putAsset(fixture, 5, {
          command: ["synthetic-verifier", "additional-observation"],
          stdout: "Additional required behavior observed",
          stderr: "",
          exit_code: 0,
        });
        fixture.record.evidence.push({
          ...capture,
          evidence_id: "EV-additional",
          kind: "cli-output",
          captured_at: new Date().toISOString(),
          artifact_head_sha: fixture.merge,
        });
        fixture.record.manifest.push({
          name: "actual",
          kind: "cli-output",
          evidence_id: "EV-additional",
        });
      }
      attachRecord(fixture);
      const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
      const after = JSON.parse(readFileSync(stateFile, "utf8"));
      const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8");
      console.log(
        JSON.stringify({
          name: "visible comment-closing attachment",
          attached,
          command: [
            "node",
            "scripts/lisa-work-item.mjs",
            "complete",
            "--ref",
            PROOF_REF,
          ],
          exit_code: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          observed_state: after.state,
          attempted_writes: writes.trim() ? writes.trim().split("\n") : [],
          controlledProvider: true,
        })
      );
      expect(result.status).toBe(attached ? 0 : 1);
      expect(after.state).toBe(attached ? "CLOSED" : "OPEN");
      if (attached) expect(result.stdout).toContain(COMPLETED);
      else {
        expect(result.stdout).toContain(INVALID_PROOF);
        expect(result.stdout).toContain("manifest");
        expect(writes).toBe("");
      }
      expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe(
        ""
      );
    }
  );

  it("reads a fully paginated native comment history larger than a proof record", () => {
    const fixture = proofFixture();
    const stateFile = fixture.env.FAKE_GH_STATE_FILE!;
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const comment = state.comments[0];
    for (let index = 0; index < 50; index += 1)
      state.comments.push({
        ...comment,
        id: index + 100,
        body: "synthetic historical comment ".repeat(2000),
      });
    expect(Buffer.byteLength(JSON.stringify(state))).toBeGreaterThan(
      2 * 1024 * 1024
    );
    writeFileSync(stateFile, JSON.stringify(state));
    attachRecord(fixture);
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(COMPLETED);
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it.each([
    ["larger than a proof record", 200_000, true],
    ["over the independent native JSON limit", 1_100_000, false],
  ])("handles comparison metadata %s", (_name, repetitions, allowed) => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const args = [
      "api",
      "--paginate",
      "--slurp",
      `repos/acme/code/compare/${fixture.prHead}...${fixture.merge}?per_page=100`,
    ];
    const table = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_API_FILE!, "utf8")
    );
    const response = table[JSON.stringify(args)];
    response.json[0].files = [
      {
        filename: "synthetic-large-change.txt",
        patch: "synthetic patch ".repeat(repetitions),
      },
    ];
    setApi(fixture, args, response);
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(result.status).toBe(allowed ? 0 : 1);
    if (allowed) expect(result.stdout).toContain(COMPLETED);
    else {
      expect(result.stdout).toContain("[read-error]");
      expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
      expect(
        JSON.parse(readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")).state
      ).toBe("OPEN");
    }
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it.each([
    [
      "duplicate real target declaration",
      "## Target Backend Environment\nNone — no runtime behavior change: doc-only\n## Preamble ends\n\n",
    ],
    [
      "fenced example target declaration",
      "```markdown\n## Target Backend Environment\nNone — no runtime behavior change: doc-only\n## Example ends\n```\n\n",
    ],
  ])("does not waive runtime proof for %s", (_name, prefix) => {
    const fixture = proofFixture();
    waivedRuntime(fixture, prefix + SPEC);
    attachRecord(fixture);
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    console.log(
      JSON.stringify({
        name: _name,
        command: [
          "node",
          "scripts/lisa-work-item.mjs",
          "complete",
          "--ref",
          PROOF_REF,
        ],
        exit_code: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        controlledProvider: true,
      })
    );
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
    expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(INVALID_PROOF);
  });

  it("permits an actual documentary leaf with explicit no-runtime scope", () => {
    const fixture = proofFixture();
    waivedRuntime(
      fixture,
      SPEC.replace(
        "\nproduction\n",
        "\nNone — no runtime behavior change: doc-only\n"
      )
    );
    attachRecord(fixture);
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(COMPLETED);
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
  });

  it("retains unknown requirements appended after the managed usage rollup", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const file = fixture.env.FAKE_GH_STATE_FILE!;
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.body +=
      "### Later requirement\nThe delivered behavior must also satisfy this new requirement.\n";
    writeFileSync(file, JSON.stringify(state));
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    expect(result.stdout).toContain(INVALID_PROOF);
    expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
  });
});
