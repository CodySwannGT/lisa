/**
 * An undeclared project must see no change from wiring the two `PreToolUse`
 * refusal scripts through the gate façade — in every branch but one, which is
 * named and proved here rather than left implicit.
 *
 * THE EQUIVALENCE CONTROL is the one most likely to be waved through as
 * "obviously fine", and it is the one that catches a façade silently changing
 * what happens for the overwhelming majority of projects, which declare
 * nothing. It runs the PRE-CHANGE script — recovered from git and pinned, not
 * reconstructed — and the shipped one against the same fixture, and compares
 * status, stderr and what each invoked, for a payload that must be refused and
 * one that must be permitted.
 *
 * THE ONE DELIBERATE DIVERGENCE is the jq-absent branch, where the pre-change
 * scripts permitted a write they had been unable to inspect at all. That is a
 * guard reporting success having checked nothing, which is the defect #3007 is
 * about, so it is fixed rather than preserved — and a divergence nobody wrote
 * down is indistinguishable from a regression, so it is asserted in both
 * directions here.
 *
 * @module tests/integration/pre-tool-refusal-equivalence
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PERMITTED,
  PRE_FACADE,
  REFUSED,
  SUBJECTS,
} from "./support/pre-tool-refusal-fixture.js";
import type { Subject } from "./support/pre-tool-refusal-fixture.js";
import {
  createHarness,
  REPO_ROOT,
} from "./support/pre-tool-refusal-harness.js";
import type { Harness } from "./support/pre-tool-refusal-harness.js";

/**
 * The pinned pre-change text and the shipped text for one subject.
 *
 * The snapshots are byte-exact `git show` output from the commit before the
 * façade landed, and they are CHECKED IN rather than read from the default
 * branch. Reading the branch would mean that the moment this work merges the
 * "before" and the "after" become the same file and the comparison passes by
 * comparing the new script against itself — a control that silently stops
 * testing, arriving on the merge that closed the ticket.
 * @param subject The script under test.
 * @returns Its pre-change text and its shipped text.
 */
function bothVersions(subject: Subject): { before: string; after: string } {
  return {
    before: fs.readFileSync(
      path.join(REPO_ROOT, PRE_FACADE, subject.before),
      "utf8"
    ),
    after: fs.readFileSync(path.join(REPO_ROOT, subject.script), "utf8"),
  };
}

describe("an undeclared project sees no change", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
    await harness.undeclare();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it.each(SUBJECTS)(
    "$script judges both payloads exactly as it did before the façade change",
    async subject => {
      const { before, after } = bothVersions(subject);
      // The snapshot must genuinely BE the "before": one that had already grown
      // the façade would make this compare the change to itself.
      expect(before).not.toContain("lisa_edit_gate_tasks");
      expect(after).toContain("lisa_edit_gate_tasks");

      for (const payload of [subject.refuses, subject.permits]) {
        const beforeRun = await harness.run(
          await harness.install(before, false),
          payload
        );
        const afterRun = await harness.run(
          await harness.install(after, true),
          payload
        );

        expect(afterRun.status).toBe(beforeRun.status);
        expect(afterRun.stderr).toBe(beforeRun.stderr);
        expect(afterRun.trace).toEqual(beforeRun.trace);
      }
    }
  );

  it.each(SUBJECTS)(
    "$script refuses a write it cannot inspect, where it used to permit it",
    async subject => {
      // Without jq the payload cannot be parsed at all — not the path, not the
      // file type, not the proposed text — so the pre-change script had no way
      // to tell a suppression or a hand-written migration from any other write,
      // and permitted it. #2957's equivalence criterion is about the COMMAND an
      // undeclared project invokes, and neither version invokes one here.
      const { before, after } = bothVersions(subject);

      const beforeRun = await harness.run(
        await harness.install(before, false),
        subject.refuses,
        { path: harness.noJqDir }
      );
      const afterRun = await harness.run(
        await harness.install(after, true),
        subject.refuses,
        { path: harness.noJqDir }
      );

      expect(beforeRun.status).toBe(PERMITTED);
      expect(afterRun.status).toBe(REFUSED);
    }
  );

  it.each(SUBJECTS)(
    "$script says jq is why, so the refusal is actionable",
    async subject => {
      // A refusal an operator cannot act on is a wall. The message has to name
      // the missing binary, not merely decline.
      //
      // The STATUS is asserted here too, and it is not redundant: the
      // pre-change NestJS copy printed "jq not available, allowing edit" and
      // then permitted the write, so a message-only assertion passed against
      // the exact defect this case exists to catch. Naming the binary while
      // waving the write through is worse than saying nothing.
      const { status, stderr } = await harness.run(
        await harness.installShipped(subject),
        subject.permits,
        { path: harness.noJqDir }
      );

      expect(stderr).toContain("jq");
      expect(status).toBe(REFUSED);
    }
  );
});
