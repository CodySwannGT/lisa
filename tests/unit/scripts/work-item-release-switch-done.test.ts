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
  commit,
  createFixture,
  git,
  githubConfig,
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
 *
 * The gate searches the production commit the proof names, so the source file
 * is committed on `main` BEFORE the fixture builds its pull request and merge:
 * the proof's production snapshot then contains exactly this file.
 * @param declaration - The section's one line.
 * @param source - Contents of the tracked source file in that snapshot.
 * @returns Fixture with the accepted proof attached.
 */
function declared(
  declaration: string,
  source: string
): ReturnType<typeof proofFixture> {
  const base = createFixture({
    ...githubConfig("full", "code"),
    deploy: { branches: { production: "main" } },
  });
  writeFileSync(path.join(base.root, SOURCE_FILE), source);
  git(base.root, ["add", SOURCE_FILE], base.env);
  commit(base, "chore: fixture source");
  const fixture = proofFixture(PROOF_REF, base);
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

const REFERENCED = `if (flags["${SWITCH}"]) showNewCheckout();\n`;
const REMOVED = "showNewCheckout();\n";
const OWN = `Switched off — ${SWITCH}; removed by this item`;

describe("switch-removal done gate in completion", () => {
  it("refuses, as pending, an item whose switch is still referenced, and names the files", () => {
    const output = complete(declared(OWN, REFERENCED));
    expect(output).toContain(PENDING);
    expect(output).toContain(`release switch "${SWITCH}"`);
    expect(output).toContain(SOURCE_FILE);
    expect(output).toContain("production commit");
  });

  it("finishes the same item once nothing references the switch", () => {
    expect(complete(declared(OWN, REMOVED))).toContain(COMPLETED);
  });

  it("judges the production commit the proof names, not the checkout it runs from", () => {
    // Removing the reference only in the working tree does not finish the
    // item: what is in production still carries the switch.
    const stillShipped = declared(OWN, REFERENCED);
    writeFileSync(path.join(stillShipped.root, SOURCE_FILE), REMOVED);
    expect(complete(stillShipped)).toContain(PENDING);
    // And a stray reference that exists only in the working tree does not
    // hold an item whose production commit is clean.
    const clean = declared(OWN, REMOVED);
    writeFileSync(path.join(clean.root, SOURCE_FILE), REFERENCED);
    git(clean.root, ["add", SOURCE_FILE], clean.env);
    expect(complete(clean)).toContain(COMPLETED);
  });

  it("counts an item that names itself by reference as the remover, whatever the case", () => {
    expect(
      complete(declared(`Switched off — ${SWITCH}; removed by #42`, REFERENCED))
    ).toContain(PENDING);
    expect(
      complete(
        declared(
          `Switched off — ${SWITCH}; removed by ACME/Code#42`,
          REFERENCED
        )
      )
    ).toContain(PENDING);
  });

  it("does not gate an item whose switch another item removes", () => {
    expect(
      complete(declared(`Switched off — ${SWITCH}; removed by #43`, REFERENCED))
    ).toContain(COMPLETED);
  });

  it("does not gate an item declared live", () => {
    expect(
      complete(
        declared(
          "Live — complete and proven at merge",
          `const unrelated = "${SWITCH}";\n`
        )
      )
    ).toContain(COMPLETED);
  });

  it("does not gate a project marked as having no live users", () => {
    const fixture = declared(OWN, REFERENCED);
    const configFile = path.join(fixture.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    writeFileSync(
      configFile,
      JSON.stringify({ ...config, release: { liveUsers: false } })
    );
    expect(complete(fixture)).toContain(COMPLETED);
  });
});
