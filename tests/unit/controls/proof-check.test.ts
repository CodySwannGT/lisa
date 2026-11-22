/**
 * `lisa controls proof-check`: what each declared part reads once its pair
 * of test changes has been tried (CodySwannGT/lisa#5011).
 *
 * The command runs a part's own command on its violating change and on its
 * clean change, in a temporary copy of the last commit. These cases use real
 * repositories and real git, and checks that are one-line Node programs, so
 * what is asserted is what actually happened to each change. The sentence a
 * part gets is what the agent writing the patches acts on, so each case
 * holds the sentence as well as the code.
 * @module tests/unit/controls/proof-check
 */
import { afterEach, describe, expect, it } from "vitest";

import { PROOF_CHECK_EXIT } from "../../../src/controls/commands/proof-check.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  FAILS_FOR_ANOTHER_REASON,
  FAILURE_TEXT,
  NEVER_FINISHES,
  PROOFS,
  provedGates,
  REJECTS_EVERYTHING,
  VIOLATION_MARK,
} from "../../helpers/control-proofs.js";
import { checkedPart } from "./support/proof-check-run.js";
import { removeScratch } from "./support/proof-copy-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const LINTER = checks(F_NONE_SOURCE);
const NODE = process.execPath;
const NOT_READY = "not-ready";

/** Prints the declared failure text whether or not it finds the violation. */
const ALWAYS_SAYS_THE_FAILURE_TEXT: readonly string[] = [
  NODE,
  "-e",
  [
    `const bad = require('node:fs').readFileSync(${JSON.stringify(F_NONE_SOURCE)}, 'utf8').includes('${VIOLATION_MARK}');`,
    `console.log(bad ? '${FAILURE_TEXT}' : 'Checked. ${FAILURE_TEXT} last week.');`,
    "process.exit(bad ? 1 : 0);",
  ].join(" "),
];

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("a pair that works", () => {
  it("reads ready and exits 0: the check failed on the violating change with the declared text and passed on the clean one", async () => {
    const { run, part } = await checkedPart(provedGates([{ command: LINTER }]));

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(part).toMatchObject({
      entry_id: "code-style@.",
      gate: "code-style",
      scope: ".",
      result: "ready",
      reason: "ready",
      note: null,
      proof: {
        violation: `${PROOFS}/lint.violation.patch`,
        clean: `${PROOFS}/lint.clean.patch`,
        failure_shape: [FAILURE_TEXT],
      },
    });
    expect(part.detail).toBe(
      "The check failed on the violating change with the declared failure text and passed on the clean change."
    );
    expect(part.halves.map(half => half.half)).toEqual(["violation", "clean"]);
    expect(part.halves.map(half => half.changed_paths)).toEqual([
      [F_NONE_SOURCE],
      [F_NONE_SOURCE],
    ]);
    expect(part.halves[0]?.run).toMatchObject({
      command: [...LINTER],
      exit_status: 1,
      outcome: "rejected",
      reason: "rejected-as-declared",
    });
    expect(part.halves[0]?.run?.matched_lines.join("\n")).toContain(
      FAILURE_TEXT
    );
    expect(part.halves[1]?.run).toMatchObject({
      exit_status: 0,
      outcome: "accepted",
    });
    expect(run.result).toMatchObject({
      schema_version: 1,
      outcome: "ready",
      counts: { ready: 1, [NOT_READY]: 0, "no-proof": 0 },
    });
    expect(run.stderr).toEqual([
      "proof-check: code-style@. is ready. The check failed on the violating change with the declared failure text and passed on the clean change.",
      "proof-check: READY. 1 paired proof is ready: on each, the check failed on the violating change with its declared failure text and passed on the clean change.",
    ]);
  });
});

describe("a pair the check's own answer shows is wrong", () => {
  it.each([
    {
      name: "a violating change the check passes",
      command: ACCEPTS_EVERYTHING,
      reason: "violation-accepted",
      detail:
        "The check passed on the violating change, so it does not catch it. Make the change break the rule the check enforces.",
      ran: ["violation"],
    },
    {
      name: "a failure that is not the declared one",
      command: FAILS_FOR_ANOTHER_REASON,
      reason: "wrong-failure-text",
      detail: `The check failed on the violating change but did not print the failure text this entry declares ("${FAILURE_TEXT}"). Declare text the tool really prints when it fails.`,
      ran: ["violation"],
    },
    {
      name: "a clean change the check fails",
      command: REJECTS_EVERYTHING,
      reason: "clean-rejected",
      detail:
        "The check failed on the clean change. A clean change must be one the check accepts.",
      ran: ["violation", "clean"],
    },
    {
      name: "failure text the check also prints when it passes",
      command: ALWAYS_SAYS_THE_FAILURE_TEXT,
      reason: "failure-text-on-clean",
      detail: `The check passed on the clean change, but what it printed holds the failure text this entry declares ("${FAILURE_TEXT}"), so that text does not tell a failure from a pass. Declare text the tool prints only when it fails.`,
      ran: ["violation", "clean"],
    },
  ])(
    "reads not-ready for $name, and says what to change",
    async ({ command, reason, detail, ran }) => {
      const { run, part } = await checkedPart(provedGates([{ command }]));

      expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
      expect(part).toMatchObject({ result: NOT_READY, reason, detail });
      expect(
        part.halves.filter(half => half.run !== null).map(half => half.half)
      ).toEqual(ran);
      expect(run.stderr).toContain(
        `proof-check: code-style@. is not ready. ${detail}`
      );
      expect(run.stderr.at(-1)).toBe(
        'proof-check: NOT READY. 1 of 1 paired proof is not ready. Each one\'s "detail" says what to change.'
      );
    }
  );

  it("says a clean change that failed without the declared text may have failed for another reason", async () => {
    const [program = "", flag = "", script = ""] = LINTER;
    const brokenOnClean = [
      program,
      flag,
      `${script} console.error('tool is not set up'); process.exit(3);`,
    ];

    const { part } = await checkedPart(
      provedGates([{ command: brokenOnClean }])
    );

    expect(part).toMatchObject({ result: NOT_READY, reason: "clean-rejected" });
    expect(part.detail).toBe(
      "The check failed on the clean change. A clean change must be one the check accepts. It did not print the declared failure text, so it may have failed for another reason, such as a tool that is not installed."
    );
    expect(part.halves[1]?.run).toMatchObject({ exit_status: 3 });
  });
});

describe("a check that gives no answer", () => {
  it("reads not-ready when the program is not installed, and says so", async () => {
    const { run, part } = await checkedPart(
      provedGates([{ command: ["lisa-no-such-linter", "check"] }])
    );

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
    expect(part).toMatchObject({ result: NOT_READY, reason: "not-started" });
    expect(part.detail).toBe(
      'The check could not be started on the violating change, so nothing was checked: the program "lisa-no-such-linter" was not found. Install it, or correct the first item of this part\'s command in .lisa.config.json. The check runs in a copy of the last commit, so what it needs has to be committed or installed on this machine.'
    );
  });

  it("reads not-ready when the check is still running at its time limit, and names the limit", async () => {
    const { part } = await checkedPart(
      provedGates([{ command: NEVER_FINISHES, timeout_seconds: 1 }])
    );

    expect(part).toMatchObject({ result: NOT_READY, reason: "timed-out" });
    expect(part.detail).toBe(
      "The check was still running on the violating change after 1 second and was stopped. Make the change one the check gets through sooner, or allow more time in proof.timeout_seconds (at most 1800)."
    );
  });
});
