/**
 * `lisa controls attest --before-enforce`: what each entry comes out as
 * (CodySwannGT/lisa#5001).
 *
 * The run commits or pushes each check's violating change for real in a
 * fresh clone with nothing installed, then runs the check's own command on
 * the same change. These cases use real repositories and real git, and
 * checks that are one-line Node programs, so what is asserted is what
 * actually happened to the change.
 * @module tests/unit/controls/attest-before-enforce
 */
import { afterEach, describe, expect, it } from "vitest";

import { BEFORE_ENFORCE_EXIT } from "../../../src/controls/commands/attest-before-enforce.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  declaredPart,
  F_NONE_SOURCE,
  FAILS_FOR_ANOTHER_REASON,
  FAILURE_TEXT,
  PROOFS,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  beforeEnforce,
  cloneWithHook,
  declared,
  onlyEntry,
} from "./support/before-enforce-run.js";
import { removeScratch } from "./support/proof-copy-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const LINTER = checks(F_NONE_SOURCE);
const VIOLATION_PATCH = `${PROOFS}/lint.violation.patch`;
const NOT_ENFORCED = "not-enforced";
const NOT_EXERCISED = "not-exercised";
const OUTSIDE_EFFECT = "posts to a chat channel";

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("a check whose tool is present and that nothing enforces", () => {
  it("reads not-enforced: the violating change was committed, and the tool run on it reported the problem", async () => {
    const run = await beforeEnforce(
      declared(provedGates([{ command: LINTER }]))
    );
    const entry = onlyEntry(run);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.ANSWERED);
    expect(entry).toMatchObject({
      entry_id: "code-style@.",
      moment: "commit",
      result: NOT_ENFORCED,
      reason: "violation-accepted",
    });
    expect(entry.canary).toMatchObject({
      patch: VIOLATION_PATCH,
      moment: "commit",
      exit_status: 0,
      outcome: "accepted",
    });
    expect(entry.canary?.command?.slice(0, 2)).toEqual(["git", "commit"]);
    expect(entry.tool).toMatchObject({
      command: [...LINTER],
      exit_status: 1,
      outcome: "rejected",
      reason: "rejected-as-declared",
    });
    expect(entry.tool?.matched_lines.join("\n")).toContain(FAILURE_TEXT);
    expect(entry.detail).toContain(
      "nothing stopped the violating change: git commit exited 0 and the commit was created"
    );
    expect(run.result).toMatchObject({
      outcome: "findings",
      counts: { [NOT_ENFORCED]: 1, enforced: 0, unknown: 0 },
    });
  });

  it("is tried through a real push when push is where it is checked", async () => {
    const run = await beforeEnforce(
      declared(provedGates([{ command: LINTER }], "code-style", ["push"]))
    );
    const entry = onlyEntry(run);

    expect(entry).toMatchObject({ moment: "push", result: NOT_ENFORCED });
    expect(entry.canary?.command?.slice(0, 2)).toEqual(["git", "push"]);
    expect(entry.canary).toMatchObject({ exit_status: 0, outcome: "accepted" });
    expect(entry.detail).toContain(
      "git push exited 0 and the change arrived in the stand-in remote"
    );
  });

  it("still reads not-enforced when the tool passes the violating change, and says the test change needs correcting", async () => {
    const entry = onlyEntry(
      await beforeEnforce(
        declared(provedGates([{ command: ACCEPTS_EVERYTHING }]))
      )
    );

    expect(entry).toMatchObject({ result: NOT_ENFORCED });
    expect(entry.tool).toMatchObject({ exit_status: 0, outcome: "accepted" });
    expect(entry.detail).toContain("this test change does not make it fail");
  });

  it("still reads not-enforced when the tool ran and failed without its declared text", async () => {
    const entry = onlyEntry(
      await beforeEnforce(
        declared(provedGates([{ command: FAILS_FOR_ANOTHER_REASON }]))
      )
    );

    expect(entry).toMatchObject({ result: NOT_ENFORCED });
    expect(entry.tool).toMatchObject({
      exit_status: 2,
      outcome: "unknown",
      reason: "wrong-reason",
    });
  });
});

describe("a check whose violating change does not simply go through", () => {
  it("reads enforced when a hook the clone already has refuses the commit, and the tool is not run", async () => {
    const run = await beforeEnforce(
      declared(provedGates([{ command: LINTER }])),
      {},
      { copy: { build: cloneWithHook("pre-commit", "#!/bin/sh\nexit 1\n") } }
    );
    const entry = onlyEntry(run);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.ANSWERED);
    expect(entry).toMatchObject({
      result: "enforced",
      reason: "violation-rejected",
      tool: null,
    });
    expect(entry.canary).toMatchObject({ exit_status: 1, outcome: "rejected" });
    expect(entry.detail).toContain("no commit was created");
    expect(run.result).toMatchObject({
      outcome: "nothing-found",
      audit_findings: [],
      copy: { hooks: ["pre-commit"] },
    });
  });

  it("reads unknown, with exit 1, when the tool cannot be started here: a tool not shown to be present", async () => {
    const run = await beforeEnforce(
      declared(provedGates([{ command: ["lisa-no-such-linter-5001", "."] }]))
    );
    const entry = onlyEntry(run);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.INCOMPLETE);
    expect(entry).toMatchObject({ result: "unknown", reason: "tool-not-run" });
    expect(entry.canary).toMatchObject({ exit_status: 0, outcome: "accepted" });
    expect(entry.tool).toMatchObject({ reason: "not-started" });
    expect(entry.detail).toContain("this run cannot say the tool is present");
    expect(run.result).toMatchObject({
      outcome: "incomplete",
      audit_findings: [],
    });
  });

  it("reads unknown when the violating change cannot be put in place", async () => {
    const run = await beforeEnforce(
      declared(provedGates([{ command: LINTER }]), {
        [VIOLATION_PATCH]: "this is not a patch\n",
        [`${PROOFS}/lint.clean.patch`]: "nor is this\n",
      })
    );

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.INCOMPLETE);
    expect(onlyEntry(run)).toMatchObject({
      result: "unknown",
      reason: "patch-not-applied",
      canary: null,
      tool: null,
    });
  });
});

describe("an entry that cannot be exercised yet", () => {
  it.each([
    [
      "has no proof patches",
      provedGates([{ command: LINTER, without: ["violation", "clean"] }]),
      "half-missing",
      "The enforce step writes them",
    ],
    [
      "is checked only on pull requests",
      provedGates([{ command: LINTER }], "code-style", ["pull-request"]),
      "pull-request-moment",
      "decided by the hosting platform",
    ],
    [
      "says its proof reaches outside the repository",
      provedGates([{ command: LINTER, external_effects: [OUTSIDE_EFFECT] }]),
      "external-effects",
      OUTSIDE_EFFECT,
    ],
  ])(
    "reads not-exercised with a plain reason when it %s",
    async (_case, gates, reason, said) => {
      const run = await beforeEnforce(declared(gates));
      const entry = onlyEntry(run);

      expect(run.code).toBe(BEFORE_ENFORCE_EXIT.ANSWERED);
      expect(entry).toMatchObject({
        result: NOT_EXERCISED,
        reason,
        canary: null,
        tool: null,
      });
      expect(entry.detail).toMatch(/^Not exercised yet\. /u);
      expect(entry.detail).toContain(said);
      expect(run.result).toMatchObject({
        outcome: "nothing-exercised",
        audit_findings: [],
        copy: null,
      });
    }
  );

  it("reads not-exercised when it is declared optional at commit, since it never refuses", async () => {
    const entry = onlyEntry(
      await beforeEnforce(
        declared({
          "code-style": {
            commit: "optional",
            criteria: ["SI7"],
            parts: [declaredPart({ command: LINTER })],
          },
        })
      )
    );

    expect(entry).toMatchObject({
      result: NOT_EXERCISED,
      reason: "optional-at-moment",
    });
  });

  it("is exercised once the operator has agreed to its outside effects", async () => {
    const entry = onlyEntry(
      await beforeEnforce(
        declared(
          provedGates([{ command: LINTER, external_effects: [OUTSIDE_EFFECT] }])
        ),
        { acknowledgeExternalEffects: true }
      )
    );

    expect(entry).toMatchObject({ result: NOT_ENFORCED });
  });
});
