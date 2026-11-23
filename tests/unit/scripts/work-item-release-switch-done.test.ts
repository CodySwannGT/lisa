/**
 * The switch-removal done gate inside completion (CodySwannGT/lisa#5188): a
 * work item that declares it removes a release switch cannot be finished while
 * tracked source still references that switch, finishes once the switch is
 * gone, and is not gated when another item owns the removal, when it is live,
 * or when the project is marked as having no live users. Driven through the
 * real CLI against the controlled provider.
 * @module tests/unit/scripts/work-item-release-switch-done
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  primarySpecProjection,
  sha256,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  git,
} from "../../support/work-item-cli.js";
import {
  attachRecord,
  proofCli,
  proofFixture,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";
import { putAsset } from "../../support/work-item-proof-assets.js";
import { editProofState } from "../../support/work-item-proof-history.js";

vi.mock("node:child_process", async original =>
  (await import("../../support/work-item-inprocess-gh.js")).routeFakeGh(
    await original()
  )
);

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

const COMPLETED = "work-item completed:";
const PENDING = "work-item pending-proof: acme/code#42";
const SWITCH = "new-checkout";
const SOURCE_FILE = "checkout-screen.js";

const complete = (fixture: ReturnType<typeof proofFixture>): string =>
  proofCli(fixture, ["complete", "--ref", PROOF_REF]).stdout;

/**
 * A fixture whose item carries a `## Release Switch` declaration, with an
 * accepted proof made for that exact body.
 * @param declaration - The section's one line.
 * @returns Fixture with the accepted proof attached.
 */
function declared(declaration: string): ReturnType<typeof proofFixture> {
  const fixture = proofFixture();
  const body = fixture.body.replace(
    "## Acceptance Criteria",
    `## Release Switch\n${declaration}\n\n## Acceptance Criteria`
  );
  editProofState(fixture, state => {
    state.body = body;
  });
  // The accepted proof and its conformance report are both bound to the exact
  // requirement text, so they are rebuilt for the body that carries the
  // declaration; otherwise completion refuses for that mismatch and never
  // reaches the gate under test.
  const spec = sha256(primarySpecProjection(body));
  const report = putAsset(fixture, 3, {
    verdict: "CONFORMS",
    spec_sha256: spec,
    work_item: PROOF_REF,
    requirements: fixture.record.requirements.map(row => ({
      ...row,
      status: "pass",
    })),
    scenario_names: ["Observed feature is verified"],
  });
  attachRecord(fixture, {
    ...fixture.record,
    spec_sha256: spec,
    obligations: {
      ...fixture.record.obligations,
      conformance: { ...fixture.record.obligations.conformance, report },
    },
  });
  return fixture;
}

/**
 * Track a source file in the fixture repository.
 * @param fixture - Fixture to edit.
 * @param source - File contents.
 */
function track(fixture: ReturnType<typeof proofFixture>, source: string): void {
  writeFileSync(path.join(fixture.root, SOURCE_FILE), source);
  git(fixture.root, ["add", SOURCE_FILE], fixture.env);
}

describe("switch-removal done gate in completion", () => {
  it("refuses, as pending, an item whose switch is still referenced, and names the files", () => {
    const fixture = declared(`Switched off — ${SWITCH}; removed by this item`);
    track(fixture, `if (flags["${SWITCH}"]) showNewCheckout();\n`);
    const output = complete(fixture);
    expect(output).toContain(PENDING);
    expect(output).toContain(`release switch "${SWITCH}"`);
    expect(output).toContain(SOURCE_FILE);
  });

  it("finishes the same item once nothing references the switch", () => {
    const fixture = declared(`Switched off — ${SWITCH}; removed by this item`);
    track(fixture, "showNewCheckout();\n");
    expect(complete(fixture)).toContain(COMPLETED);
  });

  it("counts an item that names itself by reference as the remover", () => {
    const fixture = declared(`Switched off — ${SWITCH}; removed by #42`);
    track(fixture, `if (flags["${SWITCH}"]) showNewCheckout();\n`);
    expect(complete(fixture)).toContain(PENDING);
  });

  it("does not gate an item whose switch another item removes", () => {
    const fixture = declared(`Switched off — ${SWITCH}; removed by #43`);
    track(fixture, `if (flags["${SWITCH}"]) showNewCheckout();\n`);
    expect(complete(fixture)).toContain(COMPLETED);
  });

  it("does not gate an item declared live", () => {
    const fixture = declared("Live — complete and proven at merge");
    track(fixture, `const unrelated = "${SWITCH}";\n`);
    expect(complete(fixture)).toContain(COMPLETED);
  });

  it("does not gate a project marked as having no live users", () => {
    const fixture = declared(`Switched off — ${SWITCH}; removed by this item`);
    track(fixture, `if (flags["${SWITCH}"]) showNewCheckout();\n`);
    const configFile = path.join(fixture.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    writeFileSync(
      configFile,
      JSON.stringify({ ...config, release: { liveUsers: false } })
    );
    expect(complete(fixture)).toContain(COMPLETED);
  });
});
