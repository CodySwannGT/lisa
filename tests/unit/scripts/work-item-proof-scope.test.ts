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
} from "../../support/work-item-proof-fixture.js";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

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
    expect(result.stdout).toContain("[invalid-proof]");
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
    expect(result.stdout).toContain("work-item completed:");
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
    expect(result.stdout).toContain("[invalid-proof]");
    expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
  });
});
