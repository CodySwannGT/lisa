/**
 * "Nothing runs gates here" must be MEASURED, or it is a control that lies.
 *
 * The `no-runner-for-moment` verdict was an assertion: every declaration in a
 * `pre-deploy` / `post-deploy` / `continuous` family was told "nothing runs
 * gates at this moment at all yet", because when it was written nothing did.
 *
 * That sentence is a fact about the REPOSITORY, not about the gate, and
 * hardcoding it fails in two directions at once the moment a runner ships:
 *
 *  1. it keeps saying "nothing runs this" when something does — a control
 *     lying in the reassuring direction, which is the failure this whole
 *     subsystem exists to refuse; and
 *  2. it keeps EXCUSING a declaration that resolves to no prover — calling it
 *     inert-but-fine at exactly the moment a runner would have executed it and
 *     reported UNPROVABLE.
 *
 * The second is the one with teeth, and it is asserted by name below: with the
 * family executed and no prover shipped, the verdict must be `orphaned`, which
 * blocks `validate`, and not `no-runner-for-moment`, which merely notes.
 * @module tests/unit/scripts/lisa-gates-moment-executors
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifyDeclaredExecutors,
  MOMENT_EXECUTOR_DIR,
  momentsExecutedBy,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The shipped resolver, run as a CLI the way a consumer runs it. */
const GATES_CLI = path.resolve(
  __dirname,
  "../../../all/copy-overwrite/scripts/lisa-gates.mjs"
);

/** Wall-clock ceiling for one CLI invocation. A kill is not a verdict. */
const CLI_TIMEOUT_MS = 30_000;

/** The verdict for a declaration nothing in this repository can execute. */
const NO_RUNNER = "no-runner-for-moment";

/** The verdict for a declaration whose prover does not exist here. */
const ORPHANED = "orphaned";

/** A deploy-only gate whose registry task no stack ships under that name. */
const DAST = "runtime-web-vulnerability";

/** The script two stacks DO ship for it, which the registry aliases through. */
const DAST_SHIPPED = "security:zap";

/** A deploy-only gate with no prover shipped anywhere — declare-only. */
const A11Y = "accessibility";

/** The production deploy moment the issue's own example declares. */
const PRE_DEPLOY = "pre-deploy:production";

/** Its family — what a workflow with a computed environment registers. */
const PRE_DEPLOY_FAMILY = "pre-deploy";

/** What the fixture project's DAST prover is, when it has one. */
const PROVER_COMMAND = "zap-baseline.py";

let root = "";

/**
 * Write one workflow file into the fixture repository.
 * @param name File name under the workflow directory.
 * @param body File contents.
 */
const workflow = (name: string, body: string): void => {
  const dir = path.join(root, MOMENT_EXECUTOR_DIR);
  fs.mkdirpSync(dir);
  fs.writeFileSync(path.join(dir, name), body);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-moment-executors-"));
});

afterEach(() => {
  fs.removeSync(root);
});

describe("momentsExecutedBy", () => {
  it("reads a literal moment a workflow hands to the gate runner", () => {
    workflow(
      "nightly.yml",
      "jobs:\n  g:\n    with:\n      moment: 'continuous:staging'\n"
    );

    expect(momentsExecutedBy({ cwd: root })).toEqual({
      moments: ["continuous:staging"],
      families: [],
    });
  });

  it("reads the family when the environment is computed at run time", () => {
    // Every real deploy façade is this shape: the family is literal, the
    // environment is an expression. Demanding an exact match would report "no
    // runner" for the very workflows that are the runner.
    workflow(
      "deploy.yml",
      "jobs:\n  g:\n    with:\n      moment: pre-deploy:${{ needs.env.outputs.environment }}\n"
    );

    expect(momentsExecutedBy({ cwd: root })).toEqual({
      moments: [],
      families: [PRE_DEPLOY_FAMILY],
    });
  });

  it("reads a --moment= flag as well as a moment: input", () => {
    // Two spellings of one statement. A scan reading only one of them would
    // report a repository as having no runner while looking straight at one.
    workflow(
      "scheduled.yml",
      "jobs:\n  g:\n    steps:\n      - run: node scripts/lisa-run-gates.mjs --moment=post-deploy:production\n"
    );

    expect(momentsExecutedBy({ cwd: root }).moments).toEqual([
      "post-deploy:production",
    ]);
  });

  it("does not count a moment that appears only in a comment", () => {
    // Measured, not anticipated. Lisa's own gates.yml header documents the
    // defect it fixes by quoting `list --moment=pre-deploy:production`, and the
    // first version of this scan read that prose as a runner.
    workflow(
      "documented.yml",
      "# The old bug: `list --moment=pre-deploy:production` printed a gate\n" +
        "# nothing would ever run.\n" +
        "jobs:\n  noop:\n    runs-on: ubuntu-latest\n"
    );

    expect(momentsExecutedBy({ cwd: root })).toEqual({
      moments: [],
      families: [],
    });
  });

  it("does not count a workflow that DEFINES a moment input", () => {
    // `moment:` with its value on following lines is an input declaration, not
    // an invocation. A whitespace-greedy scan captures `description` here and
    // reports a moment named `description`.
    workflow(
      "reusable.yml",
      "on:\n  workflow_call:\n    inputs:\n      moment:\n        description: 'Which gate set applies'\n        default: 'pull-request'\n        type: string\n"
    );

    expect(momentsExecutedBy({ cwd: root })).toEqual({
      moments: [],
      families: [],
    });
  });

  it("ignores a moment with no readable family", () => {
    // `moment: ${{ inputs.moment }}` is one reusable workflow forwarding its
    // own input to another. It is plumbing; the caller at the far end is the
    // one making a statement about a moment.
    workflow(
      "forwarder.yml",
      "jobs:\n  g:\n    with:\n      moment: ${{ inputs.moment }}\n"
    );

    expect(momentsExecutedBy({ cwd: root })).toEqual({
      moments: [],
      families: [],
    });
  });

  it("answers nothing for a repository with no workflows at all", () => {
    expect(momentsExecutedBy({ cwd: root })).toEqual({
      moments: [],
      families: [],
    });
  });
});

describe("a declaration at a moment this repository does not execute", () => {
  it("is reported as having no runner, naming the moment", () => {
    const [finding] = classifyDeclaredExecutors({
      gates: { [DAST]: { [PRE_DEPLOY]: "required" } },
      scripts: { [DAST_SHIPPED]: PROVER_COMMAND },
      executedMoments: { moments: [], families: [] },
    });

    expect(finding?.verdict).toBe(NO_RUNNER);
    expect(finding?.moment).toBe(PRE_DEPLOY);
    expect(finding?.detail).toContain(PRE_DEPLOY);
  });

  it("tells the operator what would make it run", () => {
    // The gate is at the gate: whoever reads this is not necessarily the person
    // who wrote the workflow, so the note has to name the remedy rather than
    // only the symptom.
    const [finding] = classifyDeclaredExecutors({
      gates: { [DAST]: { [PRE_DEPLOY]: "required" } },
      scripts: {},
      executedMoments: { moments: [], families: [] },
    });

    expect(finding?.detail).toContain(MOMENT_EXECUTOR_DIR);
    expect(finding?.detail).toContain("gates.yml");
    expect(finding?.detail).toContain('"off"');
  });
});

describe("a declaration at a moment this repository DOES execute", () => {
  it("stops being excused as inert once a workflow runs that family", () => {
    // The whole point. Same declaration, same missing prover, opposite verdict
    // — because the runner that would have found nothing to run now exists.
    // `no-runner-for-moment` only notes; `orphaned` blocks `validate`.
    const [finding] = classifyDeclaredExecutors({
      gates: { [A11Y]: { [PRE_DEPLOY]: "required" } },
      scripts: {},
      executedMoments: { moments: [], families: [PRE_DEPLOY_FAMILY] },
    });

    expect(finding?.verdict).toBe(ORPHANED);
    expect(finding?.detail).toContain("a11y:check");
  });

  it("says nothing when the project ships the prover", () => {
    // The other direction, without which the case above could be satisfied by
    // calling every deploy declaration an orphan.
    expect(
      classifyDeclaredExecutors({
        gates: { [A11Y]: { [PRE_DEPLOY]: "required" } },
        scripts: { "a11y:check": "pa11y-ci" },
        executedMoments: { families: [PRE_DEPLOY_FAMILY] },
      })
    ).toEqual([]);
  });

  it("resolves the shipped alias rather than inventing an orphan", () => {
    // `security:dast` is the registry's name for the property and NO stack
    // ships a script under it; two ship `security:zap`, which the runner
    // substitutes. A classifier reading only `task` would refuse a
    // configuration that works — the mirror image of an inert guard.
    expect(
      classifyDeclaredExecutors({
        gates: { [DAST]: { [PRE_DEPLOY]: "required" } },
        scripts: { [DAST_SHIPPED]: PROVER_COMMAND },
        executedMoments: { families: [PRE_DEPLOY_FAMILY] },
      })
    ).toEqual([]);
  });

  it("honours the project's own run: override at that moment", () => {
    expect(
      classifyDeclaredExecutors({
        gates: { [A11Y]: { [PRE_DEPLOY]: "required", run: "audit:pages" } },
        scripts: { "audit:pages": "node audit.mjs" },
        executedMoments: { families: [PRE_DEPLOY_FAMILY] },
      })
    ).toEqual([]);
  });

  it("still says nothing about a declaration turned off", () => {
    // `off` is a decision on the record, and the only route that removes a
    // required context along with the job. Demanding an executor for it would
    // argue against the mechanism.
    expect(
      classifyDeclaredExecutors({
        gates: { [A11Y]: { [PRE_DEPLOY]: "off" } },
        scripts: {},
        executedMoments: { families: [PRE_DEPLOY_FAMILY] },
      })
    ).toEqual([]);
  });

  it("reports nothing from a manifest it could not read", () => {
    // `null` is a third answer, distinct from `{}`. A manifest this process
    // cannot read must never make every deploy declaration look like an orphan.
    expect(
      classifyDeclaredExecutors({
        gates: { [A11Y]: { [PRE_DEPLOY]: "required" } },
        scripts: null,
        executedMoments: { families: [PRE_DEPLOY_FAMILY] },
      })
    ).toEqual([]);
  });
});

describe("validate tells the operator a declaration currently has no runner", () => {
  /**
   * Run `validate` in the fixture repository.
   * @returns Exit status and combined output.
   */
  const validate = (): { status: number; output: string } => {
    const result = spawnSync(process.execPath, [GATES_CLI, "validate"], {
      cwd: root,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    if (result.signal !== null) {
      throw new Error(
        `validate was KILLED (${result.signal}) rather than completing.`
      );
    }
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  };

  beforeEach(() => {
    fs.writeJsonSync(path.join(root, "package.json"), {
      name: "fixture",
      private: true,
      version: "1.0.0",
      scripts: { [DAST_SHIPPED]: PROVER_COMMAND },
    });
    fs.writeJsonSync(path.join(root, ".lisa.config.json"), {
      gates: { [DAST]: { [PRE_DEPLOY]: "required" } },
    });
  });

  it("says so, without blocking, when no workflow executes that moment", () => {
    // Not blocking, deliberately. A moment family with no caller yet is a fact
    // about the repository's wiring, not a defect in what the project declared,
    // and refusing it would stop a project declaring the gate before adding the
    // workflow. Visible is the requirement; refused is not.
    const { status, output } = validate();

    expect(status).toBe(0);
    expect(output).toContain(PRE_DEPLOY);
    expect(output).toContain("nothing in this repository runs gates");
  });

  it("stops saying so once a workflow hands that moment to the runner", () => {
    // The half a hardcoded verdict can never reach. Same declaration, same
    // config, one workflow added — and the note has to go, or it is a control
    // that lies in the reassuring direction the moment the fix lands.
    workflow(
      "deploy.yml",
      "jobs:\n  gates:\n    uses: CodySwannGT/lisa/.github/workflows/gates.yml@main\n" +
        "    with:\n      moment: pre-deploy:${{ needs.env.outputs.environment }}\n"
    );

    const { status, output } = validate();

    expect(status).toBe(0);
    expect(output).not.toContain("nothing in this repository runs gates");
  });
});
