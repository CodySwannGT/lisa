/**
 * A proof never changes what the check is, held by the two built commands
 * that plant a proof's change.
 *
 * `lisa controls proof-check` and `lisa controls attest` share one rule
 * about what a proof's change may touch (`src/controls/proof-change-rule.ts`).
 * Two ways round it were open after the rule first covered the declaration
 * and the hook files:
 *
 * - a check declared as `npm run lint`, whose script lets everything
 *   through, with a "violating change" that edits `package.json` so the
 *   script prints the failure text and exits 1;
 * - a "violating change" that drops a file at a path the repository
 *   ignores. Git leaves it out of the commit, so no list of changed files
 *   names it, and the check's command finds it on disk.
 *
 * Both read `ready` in `proof-check`, `passed` in `attest`, and the
 * requirement `conforming`, for a check that enforces nothing. Each case
 * here builds that repository, runs the two built commands on it, and holds
 * them to the same refusal.
 */
import { afterEach, describe, expect, it } from "vitest";

import { CONTROL_AUDIT_FIXTURE_FILES } from "../helpers/control-audit-fixtures.js";
import {
  appendLinePatch,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  proofFiles,
  proofPatches,
  provedGates,
  replaceFilePatch,
} from "../helpers/control-proofs.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { heldTogether, removeHeld } from "../support/proof-check-and-attest.js";

useIoLatencyBudget();

const ENTRY = "code-style@.";
const REQUIREMENT = "SI7";
const NOT_READY = "not-ready";
const UNKNOWN = "unknown";
const DECLARATION_CHANGED = "declaration-changed";
const IGNORED_PATH = "ignored-path";
const MANIFEST = "package.json";
const MAKEFILE = "Makefile";
const CLEAN = proofPatches("F-none", F_NONE_SOURCE).clean;
const SOURCE = CONTROL_AUDIT_FIXTURE_FILES["F-none"][F_NONE_SOURCE] ?? "";

/** A file at a path the fixture's ignore file names. */
const IGNORED_FILE = ".cache/planted";

/**
 * A manifest whose `lint` script is one Node program.
 * @param program - What the script runs
 * @returns The file's content
 */
function manifestRunning(program: string): string {
  const scripts = { lint: `node -e ${JSON.stringify(program)}` };
  return `${JSON.stringify({ name: "fixture", private: true, scripts }, null, 2)}\n`;
}

/** A `lint` script that lets every change through. */
const LINT_PASSES = manifestRunning("console.log('All checks passed')");

/** The same script, swapped for one that fails with the declared text. */
const LINT_FAILS = manifestRunning(
  `console.log('${FAILURE_TEXT}'); process.exit(1)`
);

/**
 * A Makefile whose `lint` target is one shell command.
 * @param command - What the target runs
 * @returns The file's content
 */
function makefileRunning(command: string): string {
  return `.PHONY: lint\nlint:\n\t@${command}\n`;
}

/**
 * A check that looks at no source file: it fails, with the declared text,
 * exactly when a file is at the ignored path.
 */
const FAILS_ON_IGNORED_FILE: readonly string[] = [
  process.execPath,
  "-e",
  [
    `if (require('node:fs').existsSync(${JSON.stringify(IGNORED_FILE)})) {`,
    `console.log('${FAILURE_TEXT}'); process.exit(1); }`,
    "console.log('All checks passed');",
  ].join(" "),
];

/** A patch that adds one file at the ignored path. */
const ADDS_IGNORED_FILE = [
  "--- /dev/null",
  `+++ b/${IGNORED_FILE}`,
  "@@ -0,0 +1 @@",
  "+planted",
  "",
].join("\n");

afterEach(() => {
  removeHeld();
});

describe("a pair whose violating change rewrites the script the check's command runs", () => {
  it.each([
    ["npm run", ["npm", "run", "--silent", "lint"]],
    ["npm run behind a shell", ["sh", "-c", "npm run --silent lint"]],
  ])(
    "is refused by proof-check and settles unknown in attest, for the same reason, when the command is %s",
    (_name, command) => {
      // The script lets every change through, so the check enforces
      // nothing. Its "violating change" edits package.json so that the
      // script prints the declared failure text and exits 1.
      const held = heldTogether(provedGates([{ command }]), {
        [MANIFEST]: LINT_PASSES,
        ...proofFiles({
          violation: replaceFilePatch(MANIFEST, LINT_PASSES, LINT_FAILS),
          clean: CLEAN,
        }),
      });
      const part = held.parts[ENTRY];

      expect(part).toMatchObject({
        checked: NOT_READY,
        checkedBecause: DECLARATION_CHANGED,
        attested: UNKNOWN,
        attestedBecause: DECLARATION_CHANGED,
      });
      expect(part?.checkedDetail).toContain(
        `The violating change edits ${MANIFEST}, whose scripts this check's command runs`
      );
      expect(part?.attestedDetail).toBe(
        `No proof was run. ${part?.checkedDetail ?? ""}`
      );
      expect(held.checkCode).toBe(1);
      expect(held.attestCode).toBe(1);
      expect(held.requirements[REQUIREMENT]).toBe(UNKNOWN);
    }
  );

  it("is refused the same way when the command is make and the change swaps the target", () => {
    const passes = makefileRunning("echo All checks passed");
    const fails = makefileRunning(`echo '${FAILURE_TEXT}'; exit 1`);
    const held = heldTogether(provedGates([{ command: ["make", "lint"] }]), {
      [MAKEFILE]: passes,
      ...proofFiles({
        violation: replaceFilePatch(MAKEFILE, passes, fails),
        clean: CLEAN,
      }),
    });

    expect(held.parts[ENTRY]).toMatchObject({
      checked: NOT_READY,
      checkedBecause: DECLARATION_CHANGED,
      attested: UNKNOWN,
      attestedBecause: DECLARATION_CHANGED,
    });
    expect(held.requirements[REQUIREMENT]).toBe(UNKNOWN);
  });
});

describe("a pair whose violating change puts a file where the repository ignores it", () => {
  it("is refused by proof-check and settles unknown in attest: git leaves the file out of the commit and the check finds it on disk", () => {
    // A tracked file is edited too, so there is something to commit.
    const edit = appendLinePatch(F_NONE_SOURCE, SOURCE, "# another change");
    const held = heldTogether(
      provedGates([{ command: FAILS_ON_IGNORED_FILE }]),
      {
        ".gitignore": ".cache/\n",
        ...proofFiles({
          violation: `${edit}${ADDS_IGNORED_FILE}`,
          clean: CLEAN,
        }),
      }
    );
    const part = held.parts[ENTRY];

    expect(part).toMatchObject({
      checked: NOT_READY,
      checkedBecause: IGNORED_PATH,
      attested: UNKNOWN,
      attestedBecause: IGNORED_PATH,
    });
    expect(part?.checkedDetail).toContain(
      `The violating change touches ${IGNORED_FILE}, a path this repository ignores.`
    );
    expect(held.checkCode).toBe(1);
    expect(held.attestCode).toBe(1);
    expect(held.requirements[REQUIREMENT]).toBe(UNKNOWN);
  });
});
