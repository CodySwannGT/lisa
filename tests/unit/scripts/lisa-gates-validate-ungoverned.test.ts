/**
 * `validate` must name every property nothing governs.
 *
 * `unconfiguredAt` has been able to answer "what did this project just prove
 * with a command nothing declared" since #2904, and until now it was reachable
 * from exactly two places: the pre-push hook and the workflow report steps.
 * No src caller, nothing in `lisa-gates.mjs validate`, nothing in
 * `lisa doctor`. So the scenario that fires "when gate configuration is
 * VALIDATED" had no implementation to answer it — whatever the seeding covers.
 *
 * The report is ADVISORY, and that is load-bearing rather than timid. Making
 * an absent declaration blocking here would fail `validate` on essentially
 * every installed project on the next bump, which is the ordering #2838 states
 * and #2929 implements behind an opt-in.
 * @module tests/unit/scripts/lisa-gates-validate-ungoverned
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HARDCODED_INVOCATIONS,
  ungovernedProperties,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GATES = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** Wall-clock ceiling for one CLI invocation. */
const CLI_TIMEOUT_MS = 30_000;

/** The settings file `validate` reads. */
const CONFIG_FILE = ".lisa.config.json";

/** The moment the sample assertions ask about. */
const PUSH = "push";

/** A gate every template project proves at push. */
const TYPE_CORRECTNESS = "type-correctness";

describe("ungovernedProperties", () => {
  it("names every property a built-in proves when nothing is declared", () => {
    const findings = ungovernedProperties({ gates: {} });
    // The key is the FULL identity, moment included. Without it a finding
    // missing for one inventory moment passes because the same (gate,
    // artifact) pair exists at another — a control that reports coverage it
    // does not have.
    const covered = new Set(
      findings.map(
        finding => `${finding.gate} ${finding.moment} ${finding.artifact}`
      )
    );
    const expected = new Set(
      HARDCODED_INVOCATIONS.map(
        entry => `${entry.gate} ${entry.moment} ${entry.artifact}`
      )
    );

    expect(findings.length).toBeGreaterThan(0);
    // Every inventory entry is a built-in running ungoverned when the project
    // declares nothing, so the report must reach all of them — one finding per
    // (gate, moment, artifact), never a sample.
    expect([...expected].filter(key => !covered.has(key))).toEqual([]);
  });

  it("reports the moment each property goes ungoverned at", () => {
    for (const finding of ungovernedProperties({ gates: {} })) {
      expect(finding.moment).toBeTruthy();
      expect(finding.gate).toBeTruthy();
      expect(finding.artifact).toBeTruthy();
    }
  });

  it("stops naming a property once it is declared at that moment", () => {
    const before = ungovernedProperties({ gates: {} }).filter(
      finding => finding.gate === TYPE_CORRECTNESS && finding.moment === PUSH
    );
    const after = ungovernedProperties({
      gates: { [TYPE_CORRECTNESS]: { push: "required" } },
    }).filter(
      finding => finding.gate === TYPE_CORRECTNESS && finding.moment === PUSH
    );

    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual([]);
  });

  it("is not silenced by a declaration the validator refuses", () => {
    // An illegal declaration is a config error, not a configuration. It must
    // not buy silence here any more than it does in `unconfiguredAt`.
    const illegal = ungovernedProperties({
      gates: { "test-meaningfulness": { push: "required" } },
    }).filter(
      finding =>
        finding.gate === "test-meaningfulness" && finding.moment === "push"
    );

    expect(illegal.length).toBeGreaterThan(0);
  });
});

describe("lisa-gates.mjs validate", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "validate-ungoverned-"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs `validate` in the fixture project.
   * @returns Exit status and combined output.
   */
  const validate = (): { status: number; output: string } => {
    const result = spawnSync(process.execPath, [GATES, "validate"], {
      cwd: workdir,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    expect(
      result.signal,
      "validate was KILLED rather than completing; its output is empty for " +
        "that reason, not because it printed nothing."
    ).toBeNull();
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  };

  it("names ungoverned properties on a project with no declarations", async () => {
    await fs.writeJson(path.join(workdir, CONFIG_FILE), {});

    const { output } = validate();

    expect(output).toContain("UNGOVERNED");
    expect(output).toContain(TYPE_CORRECTNESS);
    expect(output).toContain(PUSH);
  });

  it("keeps the report advisory rather than blocking", async () => {
    // Blocking here would fail validate on essentially every installed
    // project the day it ships. #2929 owns the enforcing arm, behind an
    // opt-in.
    await fs.writeJson(path.join(workdir, CONFIG_FILE), {});

    expect(validate().status).toBe(0);
  });

  it("still blocks on a genuinely invalid declaration", async () => {
    await fs.writeJson(path.join(workdir, CONFIG_FILE), {
      gates: { "not-a-gate": { push: "required" } },
    });

    expect(validate().status).not.toBe(0);
  });
});
