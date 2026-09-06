/**
 * A row of the failure-signature index may assert only what its evidence
 * supports (CodySwannGT/lisa#3812).
 *
 * The index used to answer "the merge driver is not registered" to a conflict
 * whose driver had RUN, declined, and printed its own resolution three lines
 * earlier — one symptom, two opposite causes, and a confident wrong answer
 * that sent the reader away from what was already on their screen. `exit 1`
 * from a driver carries "declined" and "never ran" alike, so the exit code
 * cannot separate them either.
 *
 * Two mechanisms exist against that, and both are asserted here in BOTH
 * directions: `excludes` withholds a row when the output carries the
 * counter-evidence that refutes it, and `determination` measures the checkout
 * and reports NOT DETERMINED when the measurement does not answer. The third
 * arm is asserted as hard as the two confident ones — a row that must pick a
 * side when it could not measure is the fail-open shape this exists against.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";
import {
  formatReport,
  matchEntries,
  probeGitConfig,
  runCheck,
  validateIndex,
} from "../../../plugins/src/base/hooks/failure-signature-index.mjs";

/** Where an explanation already lives. */
interface Record {
  readonly file: string;
  readonly anchor: string;
}

/** The measurement a row makes before choosing which cause to name. */
interface Determination {
  readonly question: string;
  readonly gitConfigKeys: readonly string[];
  readonly present: string;
  readonly absent: string;
  readonly unknown: string;
}

/** One row of the routing table. */
interface Entry {
  readonly id: string;
  readonly symptom: string;
  readonly sample: string;
  readonly signature: string;
  readonly cause: string;
  readonly records: readonly Record[];
  readonly excludes?: string;
  readonly counterSample?: string;
  readonly determination?: Determination;
}

/** Local `git config` keys a fixture repository is created with. */
interface GitConfig {
  readonly [key: string]: string;
}

const ANCHOR = "leave water in the kettle";
const NOTE = `${ANCHOR}\n`;
/** The one config key every determination fixture measures. */
const VALVE = "kettle.valve";

const HEALTHY: Entry = {
  id: "kettle-boils-dry",
  symptom: "a scorched smell from the kitchen",
  sample: "kettle: thermal cutout tripped",
  signature: "thermal cutout tripped",
  cause: "the kettle was switched on empty",
  records: [{ file: "NOTES.md", anchor: ANCHOR }],
};

/**
 * A throwaway repository holding one index and one cited record.
 * @param entries - Rows to write into the index
 * @returns Absolute path to the fixture root
 */
function fixture(entries: readonly unknown[]): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "failure-signatures-"))
  );
  fs.writeFileSync(path.join(root, "NOTES.md"), NOTE);
  fs.writeFileSync(
    path.join(root, "failure-signatures.json"),
    JSON.stringify({ version: 1, entries })
  );
  return root;
}

/** A row that fires on a symptom, plus the counter-evidence that refutes it. */
const DISCRIMINATING: Entry = {
  ...HEALTHY,
  id: "kettle-boils-dry-unattended",
  excludes: "kettle: refilled by the safety valve",
  counterSample:
    "kettle: thermal cutout tripped\nkettle: refilled by the safety valve",
};

/**
 * A throwaway git repository, so a determination can read real config.
 * @param config - `git config` keys to set locally, by key
 * @returns Absolute path to the repository root
 */
function gitFixture(config: GitConfig): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "failure-signatures-git-"))
  );
  // An absolute git and a scrubbed environment: a fixture repository that
  // inherits `GIT_DIR` from the outer checkout stops being about itself, which
  // is precisely the confusion these rows exist to prevent.
  const options = { cwd: root, env: cleanGitEnv(), stdio: "ignore" } as const;
  execFileSync(GIT_BIN, ["init", "--quiet"], options);
  for (const [key, value] of Object.entries(config)) {
    execFileSync(GIT_BIN, ["config", key, value], options);
  }
  fs.writeFileSync(path.join(root, "NOTES.md"), NOTE);
  return root;
}

/** A row whose cause is chosen by what the checkout measures. */
const MEASURING: Entry = {
  ...HEALTHY,
  id: "kettle-cutout-cause-measured",
  determination: {
    question: "whether the safety valve is fitted",
    gitConfigKeys: [VALVE],
    present: "the valve IS fitted, so an empty kettle is EXCLUDED",
    absent: "no valve is fitted, so the kettle boiled dry",
    unknown: "NOT DETERMINED — the valve could not be inspected",
  },
};

describe("failure-signature index — a row asserts only what its evidence supports", () => {
  it("withholds a row when the output carries the counter-evidence", () => {
    expect(
      matchEntries(DISCRIMINATING.counterSample!, [DISCRIMINATING])
    ).toHaveLength(0);
  });

  it("still fires on the same symptom when the counter-evidence is absent", () => {
    expect(matchEntries(DISCRIMINATING.sample, [DISCRIMINATING])).toHaveLength(
      1
    );
  });

  it("stays silent rather than guessing when its discriminator will not compile", () => {
    const broken = { ...DISCRIMINATING, excludes: "refilled (by" };
    expect(matchEntries(broken.sample, [broken])).toHaveLength(0);
  });

  it("fails a check when a discriminator has nothing proving it discriminates", () => {
    const { counterSample: _dropped, ...unproven } = DISCRIMINATING;
    const root = fixture([unproven]);
    expect(validateIndex([unproven], root).problems.join("\n")).toContain(
      'has "excludes" but no "counterSample"'
    );
    expect(runCheck(root)).toBe(1);
  });

  it("fails a check when the counter-sample is not in fact excluded", () => {
    const toothless: Entry = {
      ...DISCRIMINATING,
      counterSample: "kettle: thermal cutout tripped",
    };
    const root = fixture([toothless]);
    expect(validateIndex([toothless], root).problems.join("\n")).toContain(
      "does not discriminate"
    );
    expect(runCheck(root)).toBe(1);
  });

  it("fails a check when the counter-sample never matched the signature", () => {
    const irrelevant: Entry = {
      ...DISCRIMINATING,
      counterSample: "kettle: refilled by the safety valve",
    };
    const root = fixture([irrelevant]);
    expect(validateIndex([irrelevant], root).problems.join("\n")).toContain(
      "never tested the exclusion"
    );
  });

  it("fails a check when a row excludes its own sample and can never fire", () => {
    const suicidal: Entry = {
      ...DISCRIMINATING,
      excludes: "thermal cutout tripped",
    };
    const root = fixture([suicidal]);
    expect(validateIndex([suicidal], root).problems.join("\n")).toContain(
      "can never fire"
    );
  });

  it("fails a check when a discriminator is not a valid regular expression", () => {
    const broken: Entry = { ...DISCRIMINATING, excludes: "refilled (by" };
    const root = fixture([broken]);
    expect(runCheck(root)).toBe(1);
  });
});

describe("failure-signature index — a determination measures instead of asserting", () => {
  it("reads an unset key as a real answer", () => {
    expect(probeGitConfig(gitFixture({}), [VALVE]).verdict).toBe("absent");
  });

  it("reads a set key as the opposite answer", () => {
    expect(
      probeGitConfig(gitFixture({ [VALVE]: "fitted" }), [VALVE]).verdict
    ).toBe("present");
  });

  it("refuses to pick a side on a mixed reading", () => {
    const root = gitFixture({ [VALVE]: "fitted" });
    expect(probeGitConfig(root, [VALVE, "kettle.cutout"]).verdict).toBe(
      "unknown"
    );
  });

  it("names the arm the measurement selected, and shows the reading", () => {
    const root = gitFixture({});
    const report = formatReport([MEASURING], root);
    expect(report).toContain(`${VALVE}=absent`);
    expect(report).toContain("no valve is fitted, so the kettle boiled dry");
    expect(report).not.toContain("the valve IS fitted");
  });

  it("reports NOT DETERMINED rather than collapsing into either answer", () => {
    const root = gitFixture({ [VALVE]: "fitted" });
    const undecidable: Entry = {
      ...MEASURING,
      determination: {
        ...MEASURING.determination!,
        gitConfigKeys: [VALVE, "kettle.cutout"],
      },
    };
    const report = formatReport([undecidable], root);
    expect(report).toContain("UNKNOWN");
    expect(report).toContain("NOT DETERMINED");
    expect(report).not.toContain("so the kettle boiled dry");
    expect(report).not.toContain("the valve IS fitted");
  });

  it("fails a check when a determination cannot say it did not determine", () => {
    const twoArmed = {
      ...MEASURING,
      determination: { ...MEASURING.determination!, unknown: "" },
    };
    const root = fixture([twoArmed]);
    expect(validateIndex([twoArmed], root).problems.join("\n")).toContain(
      'determination "unknown" is missing or empty'
    );
    expect(runCheck(root)).toBe(1);
  });

  it("fails a check when a determination measures nothing at all", () => {
    const blind = {
      ...MEASURING,
      determination: { ...MEASURING.determination!, gitConfigKeys: [] },
    };
    const root = fixture([blind]);
    expect(validateIndex([blind], root).problems.join("\n")).toContain(
      "measures nothing"
    );
  });
});
