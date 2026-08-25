/**
 * Which mechanism keeps the whole-list mutation bite out, at each moment.
 *
 * Two independent mechanisms exclude the expensive bite cases:
 *
 * - a **file exclusion** baked into the `test:integration:push` task, which
 *   keeps every Stryker-driving suite out of the push pass entirely;
 * - an **environment gate**, `it.runIf(WHOLE_LIST_BITE_ENABLED)`, which skips
 *   the deferred cases unless `LISA_WHOLE_LIST_MUTATION_BITE` is set.
 *
 * CodySwannGT/lisa#3003 read the config, saw the two moments resolve different
 * task names, and concluded that only the environment gate was load-bearing —
 * that the file exclusion was inert and could be retired. **That premise is
 * false, and this suite is what makes it false in a way a reader can check.**
 *
 * Measured, and the numbers below come from CI's own log (run 32792981648,
 * job 97638287591) rather than a developer machine — that distinction is part
 * of the finding, see the wall-clock note.
 *
 * | run | files | result |
 * | --- | --- | --- |
 * | `test:integration` (pull-request) | 90 | 1801 passed, **8 skipped** |
 * | `test:integration:push` (push) | 87 | 1794 passed, 0 skipped |
 * | `test:integration:push` **with the flag SET** | 87 | 1794 passed, 0 skipped |
 *
 * The third row is decisive for the whole-list suite. Disarming the
 * environment gate changes NOTHING about the push pass, because the exclusion
 * means those suites never load — so at push the exclusion is deciding.
 *
 * **The sharper form of the argument is per FILE, not per moment.** The three
 * excluded suites are not gated alike:
 *
 * | suite | environment gate | cases that run regardless | CI cost |
 * | --- | --- | --- | --- |
 * | `mutation-gate-bite.test.ts` | `LISA_WHOLE_LIST_MUTATION_BITE` | 3 | 43,860 ms |
 * | `mutation-gate-diff-bite.test.ts` | **none at all** | **3** | 12,648 ms |
 * | `mutation-sigterm-control.test.ts` | `LISA_MUTATION_SIGTERM_CONTROL` etc. | 1 | 858 ms |
 *
 * `mutation-gate-diff-bite.test.ts` carries **no `runIf` and no environment
 * read whatsoever**. For that file the exclusion is not one of two mechanisms
 * — it is the ONLY one. No amount of reasoning about the environment gate
 * reaches it.
 *
 * ## The wall-clock reading, and how it misleads in both directions
 *
 * Those three files are **57.4 s of a 60.99 s suite** — roughly 94% of the
 * integration suite's time, against 1,796 other tests in 87 other files.
 *
 * A local measurement said the opposite. Two runs of each task on a developer
 * box gave push 37 s / 62 s and pull-request 62 s / 39 s: overlapping ranges,
 * no separation, apparently proving the exclusion buys nothing. That reading
 * was noise. The same task varied 37 → 62 s, so the spread swamped the effect,
 * and local vitest parallelism absorbs three slow files that dominate a
 * narrower CI runner.
 *
 * The ticket made the mirror-image error from the other side, treating a fast
 * pull-request job as proof the exclusion was inert. The job being fast proves
 * the WHOLE-LIST cases are gated; it says nothing about the exclusion, whose
 * contribution is 57 of those seconds.
 *
 * So the mechanisms are **complementary, not redundant**, and retiring either
 * — which is what #3003's two proposed resolutions each amount to — puts all
 * seven still-executing cases, including the ungated diff-bite, onto the local
 * pre-push gate.
 *
 * This file exists because "which of these two is doing the work" cost someone
 * a 56-minute misdiagnosis, and the answer is not readable from the config.
 * @module tests/unit/config/bite-exclusion-vs-env-gate
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  readGates,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The gate whose task differs between the two moments. */
const GATE_ID = "test-integration";

/** The environment variable that re-enables the deferred cases. */
const FLAG = "LISA_WHOLE_LIST_MUTATION_BITE";

/** The suite carrying the deferred, environment-gated cases. */
const BITE_SUITE = "tests/integration/mutation-gate-bite.test.ts";

/**
 * The `--exclude` argument that keeps the bite suite out of a vitest run.
 *
 * Spelled once because it is the SUBJECT of this file: every case here asks
 * whether a given task carries it, and three copies of the string would be
 * three places to update when the suite is renamed — with a stale copy reading
 * as a passing assertion about a suite that no longer exists.
 */
const BITE_EXCLUDE = "--exclude='**/mutation-gate-bite.test.ts'";

/**
 * The task each moment resolves for the integration gate.
 * @param moment - `push` or `pull-request`.
 * @returns The task name, or null when the gate is absent at that moment.
 */
function taskAt(moment: string): string | null {
  const { gates, runner } = readGates() as {
    gates: object;
    runner: string;
  };
  const resolved = resolveMoment({ gates, moment, runner }) as {
    id: string;
    task: string | null;
  }[];
  return resolved.find(entry => entry.id === GATE_ID)?.task ?? null;
}

/**
 * A script body from this repository's own `package.json`.
 * @param name - Script name.
 * @returns The command it runs.
 */
function script(name: string): string {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  return manifest.scripts[name] ?? "";
}

describe("the two bite-exclusion mechanisms are complementary, not redundant", () => {
  it("at push, the FILE EXCLUSION decides, and it does not consult the flag", () => {
    const task = taskAt("push");
    expect(task).toBe("test:integration:push");

    const command = script(task as string);
    // The mechanism is the `--exclude`, and it is in the task itself. A task
    // that stopped excluding the bite suite would leave push protected by
    // nothing: the environment gate cannot help, because a flag set at push
    // would re-enable the very cases this keeps out.
    expect(
      command,
      "push lost its ONLY protection: the bite suite is no longer excluded " +
        "from the push task, and the environment gate does not cover this " +
        "moment — a flag set at push would run the whole-list pass"
    ).toContain(BITE_EXCLUDE);

    // Measured: with LISA_WHOLE_LIST_MUTATION_BITE=1 the push task still ran
    // 1794 tests in 18s, identical to the flag-unset run. The exclusion holds
    // independently, which is exactly what "the exclusion decides here" means.
    expect(
      command.includes(FLAG),
      "the push task must not read the flag — its protection is that the " +
        "suite never loads, which is stronger than any check inside it"
    ).toBe(false);
  });

  it("at pull-request, the ENVIRONMENT GATE decides, and the exclusion is absent", () => {
    const task = taskAt("pull-request");
    expect(task).toBe("test:integration");

    const command = script(task as string);
    // The pull-request pass collects the whole directory on purpose: the
    // mutation gate this suite is the bite control for is itself a
    // pull-request gate, so the control belongs at the moment it controls.
    expect(
      command,
      "the pull-request pass must collect the whole directory — excluding " +
        "the bite suite here would silently move the control away from the " +
        "moment it is a control for"
    ).toBe("vitest run tests/integration");

    // So the only thing standing between a pull request and the ~21-minute
    // whole-list pass is the runIf. Measured: 8 skipped on this path.
    const suite = readFileSync(path.join(REPO_ROOT, BITE_SUITE), "utf8");
    expect(
      suite,
      "pull-request lost its ONLY protection: the deferred cases are no " +
        "longer gated on the environment flag, and the push exclusion does " +
        "not cover this moment — the whole-list pass would run on every PR"
    ).toContain("it.runIf(WHOLE_LIST_BITE_ENABLED)(");
    expect(suite).toContain(`process.env["${FLAG}"] === "1"`);
  });

  it("names the excluded suite that has NO environment gate at all", () => {
    // The sharpest form of the argument, and the one a per-moment reading
    // misses. `mutation-gate-diff-bite.test.ts` carries no `runIf` and reads
    // no environment variable, so for THAT file the exclusion is not one of
    // two mechanisms — it is the only one. It cost 12,648 ms of a 60,990 ms
    // pull-request suite, which is what it would add to every push if the
    // exclusion were retired.
    const ungated = path.join(
      REPO_ROOT,
      "tests/integration/mutation-gate-diff-bite.test.ts"
    );
    const source = readFileSync(ungated, "utf8");

    expect(
      /runIf\(/u.test(source),
      "mutation-gate-diff-bite.test.ts gained an environment gate. That is " +
        "allowed, but this file's argument rests on it NOT having one — " +
        "update the reasoning above rather than deleting this case"
    ).toBe(false);
    expect(/process\.env\[/u.test(source)).toBe(false);

    // And therefore the exclusion must name it. If this fails, an ungated
    // ~12.6s Stryker-driving suite has just been added to every push.
    const pushCommand = script(taskAt("push") as string);
    expect(
      pushCommand,
      "an UNGATED Stryker-driving suite is no longer excluded from the push " +
        "pass — nothing else keeps it off, because it reads no environment " +
        "variable to gate on"
    ).toContain("--exclude='**/mutation-gate-diff-bite.test.ts'");
  });

  it("neither moment is covered by both, so neither mechanism is spare", () => {
    // The claim #3003 made was that one of these could be retired. It cannot:
    // each moment is covered exactly once, so retiring either leaves a moment
    // covered zero times. Stated as an assertion rather than a comment,
    // because the comment is what failed to stop the misreading last time.
    const pushCommand = script(taskAt("push") as string);
    const pullRequestCommand = script(taskAt("pull-request") as string);

    const pushExcludes = pushCommand.includes(BITE_EXCLUDE);
    const pullRequestExcludes = pullRequestCommand.includes(BITE_EXCLUDE);

    expect(pushExcludes).toBe(true);
    expect(
      pullRequestExcludes,
      "if the pull-request task ever gains the exclusion, the environment " +
        "gate becomes the spare rather than the load-bearing mechanism — " +
        "update this suite deliberately rather than deleting the case"
    ).toBe(false);
  });
});
