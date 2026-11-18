/**
 * `lisa controls proof-check`: whether each change can be put on the last
 * commit, and whether it is in the place that starts the part's check
 * (CodySwannGT/lisa#5011).
 *
 * At commit and at push the gate runner starts a part only when the change
 * touches the part's own folder. A proof whose change is somewhere else
 * never starts the check, and the attest step then reads that half as not
 * started. So a change outside the folder is refused here, by the runner's
 * own rule, before anybody finds out the slow way.
 * @module tests/unit/controls/proof-check-changes
 */
import { afterEach, describe, expect, it } from "vitest";

import { PROOF_CHECK_EXIT } from "../../../src/controls/commands/proof-check.js";
import {
  ACCEPTS_EVERYTHING,
  API_SOURCE,
  appendLinePatch,
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  PROOFS,
  provedGates,
  WEB_SOURCE,
} from "../../helpers/control-proofs.js";
import { configFile } from "../../helpers/control-register.js";
import {
  checkedPart,
  declared,
  onlyPart,
  proofCheck,
} from "./support/proof-check-run.js";
import { removeScratch } from "./support/proof-copy-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const NOT_READY = "not-ready";
const OUTSIDE_FOLDER = "outside-folder";
const LINTER = checks(F_NONE_SOURCE);
const API_LINTER = checks("src/api/greeting.py");
const API_PATCHES = proofPatches("F-mixed", API_SOURCE);
const WEB_PATCHES = proofPatches("F-mixed", WEB_SOURCE);
const F_NONE_PATCHES = proofPatches("F-none", F_NONE_SOURCE);
const VIOLATION_PATCH = `${PROOFS}/lint.violation.patch`;

/** A change to a file that is not in the last commit. */
const STALE_PATCH = appendLinePatch(
  F_NONE_SOURCE,
  "this is not what the file holds\n",
  "PLANTED_VIOLATION = 1"
);

/**
 * A change that adds one new file.
 * @param file - The file to add, from the repository root
 * @param line - The one line it holds
 * @returns The patch file's content
 */
function newFilePatch(file: string, line: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    "@@ -0,0 +1 @@",
    `+${line}`,
    "",
  ].join("\n");
}

/**
 * Check F-mixed with one check declared for the folder `api`.
 * @param patches - The pair of changes
 * @param patches.violation - The violating change
 * @param patches.clean - The clean change
 * @returns The run
 */
async function checkApi(patches: {
  readonly violation: string;
  readonly clean: string;
}): ReturnType<typeof proofCheck> {
  return proofCheck(
    declared(
      provedGates([{ scope: "api", command: API_LINTER }]),
      proofFiles(patches),
      "F-mixed"
    )
  );
}

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("a part for one folder of a repository with two", () => {
  it("reads ready when both changes are inside the folder, and the check ran in that folder", async () => {
    const run = await checkApi(API_PATCHES);
    const part = onlyPart(run);

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(part).toMatchObject({
      entry_id: "code-style@api",
      scope: "api",
      result: "ready",
    });
    expect(part.halves.map(half => half.changed_paths)).toEqual([
      [API_SOURCE],
      [API_SOURCE],
    ]);
  });

  it("refuses a violating change that only touches the other folder, names the folder, and exits 1", async () => {
    const run = await checkApi({
      violation: WEB_PATCHES.violation,
      clean: API_PATCHES.clean,
    });
    const part = onlyPart(run);

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
    expect(part).toMatchObject({ result: NOT_READY, reason: OUTSIDE_FOLDER });
    expect(part.detail).toBe(
      "The violating change does not touch any file inside the folder api, so the check for api would never start. Change a file under api."
    );
    expect(part.halves).toMatchObject([
      { half: "violation", changed_paths: [WEB_SOURCE], run: null },
      { half: "clean", changed_paths: [API_SOURCE], run: null },
    ]);
  });

  it("refuses a clean change outside the folder the same way", async () => {
    const part = onlyPart(
      await checkApi({
        violation: API_PATCHES.violation,
        clean: WEB_PATCHES.clean,
      })
    );

    expect(part).toMatchObject({ result: NOT_READY, reason: OUTSIDE_FOLDER });
    expect(part.detail).toBe(
      "The clean change does not touch any file inside the folder api, so the check for api would never start. Change a file under api."
    );
  });

  it("does not take a folder whose name only starts the same for the part's folder", async () => {
    const part = onlyPart(
      await checkApi({
        violation: newFilePatch("api-v2/notes.txt", "PLANTED_VIOLATION"),
        clean: API_PATCHES.clean,
      })
    );

    expect(part).toMatchObject({ result: NOT_READY, reason: OUTSIDE_FOLDER });
  });
});

describe("a change that cannot be used as it is", () => {
  it("refuses a change that does not apply to the last commit, with git's reason, and runs nothing", async () => {
    const { run, part } = await checkedPart(
      provedGates([{ command: LINTER }]),
      proofFiles({ violation: STALE_PATCH, clean: F_NONE_PATCHES.clean })
    );

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
    expect(part).toMatchObject({
      result: NOT_READY,
      reason: "patch-not-applied",
      halves: [],
    });
    expect(part.detail).toMatch(
      new RegExp(
        `^The violating change \\(${VIOLATION_PATCH.replaceAll(".", "\\.")}\\) does not apply to the last commit\\. git did not apply the patch, so nothing was changed: .*patch does not apply.* Make the patch again from the last commit, with nothing else changed\\.$`,
        "u"
      )
    );
  });

  it("reports a change that does not apply before one that is in the wrong place", async () => {
    const part = onlyPart(
      await checkApi({ violation: WEB_PATCHES.violation, clean: STALE_PATCH })
    );

    expect(part).toMatchObject({ reason: "patch-not-applied" });
    expect(part.detail).toContain("The clean change (");
  });

  it("refuses a change that edits the file declaring the checks", async () => {
    const gates = provedGates([{ command: LINTER }]);
    const { part } = await checkedPart(
      gates,
      proofFiles({
        violation: `${F_NONE_PATCHES.violation}${appendLinePatch(".lisa.config.json", configFile(gates), "")}`,
        clean: F_NONE_PATCHES.clean,
      })
    );

    expect(part).toMatchObject({
      result: NOT_READY,
      reason: "declaration-changed",
    });
    expect(part.detail).toBe(
      "The violating change edits .lisa.config.json, the file that says what each check runs. A proof never changes what the check is. Take that file out of the patch."
    );
    expect(part.halves[0]?.changed_paths).toEqual([
      ".lisa.config.json",
      F_NONE_SOURCE,
    ]);
  });

  it("refuses a change that leaves nothing git would commit", async () => {
    const { part } = await checkedPart(provedGates([{ command: LINTER }]), {
      ".gitignore": "scratch/\n",
      ...proofFiles({
        violation: F_NONE_PATCHES.violation,
        clean: newFilePatch("scratch/notes.txt", "a harmless change"),
      }),
    });

    expect(part).toMatchObject({ result: NOT_READY, reason: "no-change" });
    expect(part.detail).toBe(
      "The clean change changes no file that git would commit, so there is nothing for the check to look at. Change a file in the repository that git tracks, or add one it does not ignore."
    );
  });
});

describe("several parts", () => {
  it("gives each its own result, counts them, and exits 1 when any is not ready", async () => {
    const run = await proofCheck(
      declared(
        {
          ...provedGates([{ command: LINTER }]),
          ...provedGates(
            [{ command: ACCEPTS_EVERYTHING, name: "tests" }],
            "test-correctness",
            ["push"]
          ),
          ...provedGates(
            [{ command: LINTER, without: ["violation", "clean"] }],
            "type-correctness",
            ["push"]
          ),
        },
        {
          ...proofFiles(F_NONE_PATCHES),
          ...proofFiles(F_NONE_PATCHES, "tests"),
        }
      )
    );

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
    expect(
      Object.fromEntries(
        (run.result?.parts ?? []).map(part => [part.entry_id, part.result])
      )
    ).toEqual({
      "code-style@.": "ready",
      "test-correctness@.": NOT_READY,
      "type-correctness@.": "no-proof",
    });
    expect(run.result).toMatchObject({
      outcome: NOT_READY,
      counts: { ready: 1, [NOT_READY]: 1, "no-proof": 1 },
      reason:
        '1 of 2 paired proofs are not ready. Each one\'s "detail" says what to change. 1 check declares no proof and stays unproved.',
    });
  });
});
