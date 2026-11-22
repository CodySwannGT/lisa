/**
 * A proof never changes what the check is, on a file system that does not
 * tell letter cases apart, held by the two built commands.
 *
 * On such a file system (the default on macOS and Windows) a patch whose
 * headers read `.lisa.config.JSON` is applied by git to the repository's
 * `.lisa.config.json`: they are one file. A rule that compares only the
 * names the patch writes finds no file it knows, the "violating change"
 * swaps the check's command for one that fails with the declared text, and
 * `lisa controls attest` reads a check that enforces nothing as proved.
 *
 * Each case builds that repository, runs the built `lisa controls
 * proof-check` and `lisa controls attest` on it, and holds the two to the
 * same refusal. On a file system that does tell letter cases apart git does
 * not apply such a patch at all, so there is nothing to run and the cases
 * are skipped, saying so; `tests/unit/controls/proof-change-letter-case.test.ts`
 * holds the rule itself everywhere.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  ACCEPTS_EVERYTHING,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  proofFiles,
  proofPatches,
  provedGates,
  REJECTS_EVERYTHING,
  replaceFilePatch,
} from "../helpers/control-proofs.js";
import { configFile } from "../helpers/control-register.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { heldTogether, removeHeld } from "../support/proof-check-and-attest.js";
import { temporaryFoldersIgnoreLetterCase } from "../support/letter-case.js";

useIoLatencyBudget();

const ENTRY = "code-style@.";
const REQUIREMENT = "SI7";
const DECLARATION_CHANGED = "declaration-changed";
const CLEAN = proofPatches("F-none", F_NONE_SOURCE).clean;

/** Why the cases do not run on a file system that tells letter cases apart. */
const NOT_HERE =
  "the temporary folder is on a file system that tells letter cases apart, where git does not apply a patch to a file under another spelling of its name";

/** Whether the repositories these cases build ignore letter case. */
const IGNORES_CASE = temporaryFoldersIgnoreLetterCase();

/**
 * A manifest whose `lint` script is one Node program.
 * @param program - What the script runs
 * @returns The file's content
 */
function manifestRunning(program: string): string {
  const scripts = { lint: `node -e ${JSON.stringify(program)}` };
  return `${JSON.stringify({ name: "fixture", private: true, scripts }, null, 2)}\n`;
}

const LINT_PASSES = manifestRunning("console.log('All checks passed')");
const LINT_FAILS = manifestRunning(
  `console.log('${FAILURE_TEXT}'); process.exit(1)`
);
const ENFORCES_NOTHING = provedGates([{ command: ACCEPTS_EVERYTHING }]);

afterEach(() => {
  removeHeld();
});

describe("a pair whose violating change names a file that says what the check is in another letter case", () => {
  it.for([
    {
      name: "the declaration, as .lisa.config.JSON",
      gates: ENFORCES_NOTHING,
      files: {},
      violation: replaceFilePatch(
        ".lisa.config.JSON",
        configFile(ENFORCES_NOTHING),
        configFile(provedGates([{ command: REJECTS_EVERYTHING }]))
      ),
      edits: ".lisa.config.json, the file that says what each check runs",
    },
    {
      name: "the manifest of a check run through npm, as Package.json",
      gates: provedGates([{ command: ["npm", "run", "--silent", "lint"] }]),
      files: { "package.json": LINT_PASSES },
      violation: replaceFilePatch("Package.json", LINT_PASSES, LINT_FAILS),
      edits: "package.json, whose scripts this check's command runs",
    },
  ])(
    "is refused by proof-check and settles unknown in attest, for the same reason: $name",
    ({ gates, files, violation, edits }, context) => {
      context.skip(!IGNORES_CASE, NOT_HERE);
      const held = heldTogether(gates, {
        ...files,
        ...proofFiles({ violation, clean: CLEAN }),
      });
      const part = held.parts[ENTRY];

      expect(part).toMatchObject({
        checked: "not-ready",
        checkedBecause: DECLARATION_CHANGED,
        attested: "unknown",
        attestedBecause: DECLARATION_CHANGED,
      });
      expect(part?.checkedDetail).toContain(
        `The violating change edits ${edits}`
      );
      expect(part?.attestedDetail).toBe(
        `No proof was run. ${part?.checkedDetail ?? ""}`
      );
      expect(held.checkCode).toBe(1);
      expect(held.attestCode).toBe(1);
      expect(held.requirements[REQUIREMENT]).toBe("unknown");
    }
  );
});
