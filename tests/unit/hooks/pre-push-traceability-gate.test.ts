/**
 * `gates.traceability` governs the pre-push hook that bears its name.
 *
 * It did not. The hook's eleventh line read
 * `node "$WORK_ITEM_SCRIPT" validate-push "${1:-origin}" || exit 1`,
 * unconditionally, while every other check in the same file resolved through
 * `lisa-run-gates.mjs --moment=push`. Declaring the gate `off` still blocked the
 * push; declaring it `required` changed nothing, because the call already ran.
 * That is the defect #2680 measured in CI — one moment earlier, and it was the
 * last gate in either hook still bypassing the façade.
 *
 * The decision is inline shell, so the shell is what these tests execute: the
 * block is sliced out of each hook and run against fixture projects, the way the
 * audit-transport tests slice the bun block. Asserting on the text alone would
 * not tell a working resolver from a deleted one.
 *
 * Three states, mirroring the CI job:
 *
 * - declared at push, any level → the registry owns it, the built-in stands down
 * - not declared, unreadable, or declared at some OTHER moment → the built-in
 *   runs, byte for byte as it always has
 * - declared, but the registry proved nothing → the built-in runs late rather
 *   than not at all, because a declared gate must never be a quieter way of
 *   switching a check off than declaring it `off`
 * @module tests/unit/hooks/pre-push-traceability-gate
 */

import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { trackedHookCopies } from "../../helpers/hook-roster.js";

import {
  REGISTRY,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { BUILTIN_FLOOR } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

const ROOT = process.cwd();

/**
 * Every tracked copy of the pre-push hook, derived rather than written down.
 *
 * Two entries were typed here while a third tracked copy carried no gate façade
 * at all — declaring `traceability` could not reach it in any direction
 * (CodySwannGT/lisa#2847).
 */
const HOOKS = [...trackedHookCopies("pre-push")];

/** The gate id under test. */
const GATE = "traceability";

/** The registry the hooks resolve declarations through. */
const GATES_SCRIPT = path.join(
  ROOT,
  "all/copy-overwrite/scripts/lisa-gates.mjs"
);

/**
 * The directory the staged scripts reach into for their shared modules.
 *
 * A directory, not a file. This named `lib/invoked-as-script.mjs` and stopped
 * being a faithful copy the moment a staged script imported a second sibling
 * (CodySwannGT/lisa#2980) — the fixture then failed with an
 * ERR_MODULE_NOT_FOUND inside `node_modules/@codyswann/lisa/…`, which reads as
 * the published package missing a file rather than as the fixture naming what
 * it should have read. CodySwannGT/lisa#3082.
 */
const REGISTRY_LIB_DIR = path.join(ROOT, "all/copy-overwrite/scripts/lib");

/** What the stub validator writes when the built-in step actually runs. */
const RAN = "validate-push";

/** The exact log line one built-in run leaves behind. */
const RAN_ONCE = `${RAN} upstream\n`;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Read one hook's source.
 * @param relative - Repo-relative path to the hook
 * @returns The hook's full text
 */
const hook = (relative: string): string =>
  readFileSync(path.join(ROOT, relative), "utf8");

/**
 * Cut the push-moment decision out of a hook, verbatim.
 *
 * Located on the validator invocation rather than on the guard around it: a
 * locator that only matches the fixed shape could not show the bug it was
 * written for, and the unconditional call is exactly what this must still find.
 * @param relative - Repo-relative path to the hook
 * @returns The block as a runnable script body
 */
function decisionBlock(relative: string): string {
  const lines = hook(relative).split("\n");
  const call = lines.findIndex(line => line.includes(`${RAN} "\${1:-origin}"`));
  const start = lines.findIndex(line => line === 'GATE_REGISTRY=""');
  const end = lines.findIndex((line, index) => index > call && line === "fi");
  expect(call).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(-1);
  expect(start).toBeLessThan(call);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * Cut the LATE half out of a hook — the one that reads the coverage file.
 * @param relative - Repo-relative path to the hook
 * @returns The block as a runnable script body
 */
function lateBlock(relative: string): string {
  const lines = hook(relative).split("\n");
  const start = lines.findIndex(
    line => line === `if lisa_gate_covers ${GATE}; then`
  );
  const end = lines.findIndex((line, index) => index > start && line === "fi");
  expect(start).toBeGreaterThan(-1);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * The hook's own `lisa_gate_covers`, verbatim.
 * @param relative - Repo-relative path to the hook
 * @returns The function definition
 */
function coversFunction(relative: string): string {
  const source = hook(relative);
  const start = source.indexOf("lisa_gate_covers() {");
  const end = source.indexOf("\n}\n", start);
  const definition = source.slice(start, end + 3);
  expect(start).toBeGreaterThan(-1);
  return definition;
}

/**
 * A throwaway project carrying a real registry and a stub validator.
 * @param gates - The `gates` block, or null to write no config at all
 * @param options - Fixture switches
 * @param options.registry - Whether to install the registry script at all
 * @param options.config - Raw config text, overriding `gates`
 * @param options.validatorExit - Exit code the stub validator returns
 * @returns The project root, the PATH prefix, and the validator log path
 */
function stageProject(
  gates: object | null,
  options: {
    registry?: boolean;
    config?: string;
    validatorExit?: number;
  } = {}
): { root: string; bin: string; log: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-traceability-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "validator.log");
  const validator = path.join(root, "scripts/lisa-work-item.mjs");
  const config = options.config ?? (gates ? JSON.stringify({ gates }) : null);
  dirs.push(root);
  mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
  mkdirSync(bin);
  symlinkSync(process.execPath, path.join(bin, "node"));

  if (options.registry !== false) {
    copyFileSync(GATES_SCRIPT, path.join(root, "scripts/lisa-gates.mjs"));
    cpSync(REGISTRY_LIB_DIR, path.join(root, "scripts/lib"), {
      recursive: true,
    });
  }
  // Stub, because what is under test is WHETHER the validator runs, not what it
  // concludes. Its exit code is passed through so the blocking half is provable.
  writeFileSync(
    validator,
    `import { appendFileSync } from "node:fs";\n` +
      `appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\n` +
      `process.exit(${options.validatorExit ?? 0});\n`
  );
  chmodSync(validator, 0o644);
  if (config !== null) {
    writeFileSync(path.join(root, ".lisa.config.json"), config);
  }
  return { root, bin, log };
}

/**
 * What a fixture's validator log holds.
 * @param log - Path the stub appends to
 * @returns The log text, or "" when the validator never ran
 */
function validatorLog(log: string): string {
  try {
    return readFileSync(log, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run one hook's decision block in a fixture project.
 * @param relative - Repo-relative path to the hook
 * @param gates - The `gates` block, or null for no config
 * @param options - Fixture switches, forwarded to `stageProject`
 * @returns Exit status, both streams, and whether the validator ran
 */
function runDecision(
  relative: string,
  gates: object | null,
  options: Parameters<typeof stageProject>[1] = {}
): { status: number; stdout: string; stderr: string; validated: string } {
  const { root, bin, log } = stageProject(gates, options);
  const body = `WORK_ITEM_SCRIPT="scripts/lisa-work-item.mjs"\n${decisionBlock(relative)}\n`;
  const child = boundedSpawnSync({
    label: "pre-push traceability decision block",
    command: "/bin/sh",
    args: ["-c", body, "hook", "upstream"],
    cwd: root,
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  return {
    status: child.status ?? -1,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    validated: validatorLog(log),
  };
}

/**
 * Run one hook's late half against a coverage file.
 * @param relative - Repo-relative path to the hook
 * @param declared - What the early half decided
 * @param covered - Ids the runner recorded, or null for no coverage file
 * @returns Exit status and whether the validator ran
 */
function runLate(
  relative: string,
  declared: string,
  covered: string[] | null
): { status: number; validated: string } {
  const { root, bin, log } = stageProject(null);
  const file = path.join(root, "coverage.txt");
  if (covered) writeFileSync(file, covered.map(id => `${id}\n`).join(""));
  const body = [
    `WORK_ITEM_SCRIPT="scripts/lisa-work-item.mjs"`,
    `TRACEABILITY_DECLARED="${declared}"`,
    `LISA_GATE_COVERAGE="${covered ? file : ""}"`,
    coversFunction(relative),
    lateBlock(relative),
  ].join("\n");
  const child = boundedSpawnSync({
    label: "pre-push traceability late block",
    command: "/bin/sh",
    args: ["-c", body, "hook", "upstream"],
    cwd: root,
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  return { status: child.status ?? -1, validated: validatorLog(log) };
}

describe("the traceability gate is declarable at push", () => {
  it("legalises push alongside pull-request, and nothing else", () => {
    expect(REGISTRY[GATE].moments).toEqual(["push", "pull-request"]);
  });

  it("proves the push moment with validate-push, not validate-pr", () => {
    // `check:work-item` is `validate-pr`, which requires a pull request that
    // does not exist on the first push of a branch. Resolving the pull-request
    // prover at push would fail every one of those.
    const at = (moment: string): string | null =>
      resolveMoment({
        gates: { [GATE]: { push: "required", "pull-request": "required" } },
        moment,
      }).find((gate: { id: string }) => gate.id === GATE)?.task ?? null;
    expect(at("push")).toBe("check:work-item:push");
    expect(at("pull-request")).toBe("check:work-item");
  });

  it("still lets a project name its own prover at push", () => {
    const resolved = resolveMoment({
      gates: { [GATE]: { push: { level: "required", run: "trace:mine" } } },
      moment: "push",
    }).find((gate: { id: string }) => gate.id === GATE);
    expect(resolved?.task).toBe("trace:mine");
  });

  it("maps the push task onto a script that runs validate-push", () => {
    const scripts = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    ).scripts;
    expect(scripts["check:work-item:push"]).toBe(
      "node scripts/lisa-work-item.mjs validate-push"
    );
  });

  it("puts the property in the push floor, so a hook may stand its step down", () => {
    // Without this the coverage file could never name it, and the built-in step
    // would be one that can never be handed over.
    expect(BUILTIN_FLOOR.push).toContain(GATE);
  });
});

describe.each(HOOKS)("%s resolves the push declaration", relative => {
  it("runs the built-in validator when nothing is declared", () => {
    // The regression that would be worse than the bug: an unconfigured project
    // must keep exactly the protection it had.
    const { status, validated } = runDecision(relative, null);
    expect(status).toBe(0);
    expect(validated).toBe(RAN_ONCE);
  });

  it("hands the property over when the gate is declared required", () => {
    const { status, stdout, validated } = runDecision(relative, {
      [GATE]: { push: "required" },
    });
    expect(status).toBe(0);
    expect(validated).toBe("");
    expect(stdout).toContain("declared at push");
  });

  it("runs nothing when the gate is declared off", () => {
    // The whole point of the defect: `off` used to be unable to turn this off.
    const { status, validated } = runDecision(relative, {
      [GATE]: { push: "off" },
    });
    expect(status).toBe(0);
    expect(validated).toBe("");
  });

  it("still runs the built-in when the gate is declared at another moment", () => {
    // A pull-request declaration says nothing about push, and reading it as if
    // it did would delete the push check for every project already declaring
    // the gate — which is every project that adopted the CI façade.
    const { status, validated } = runDecision(relative, {
      [GATE]: { "pull-request": "required" },
    });
    expect(status).toBe(0);
    expect(validated).toBe(RAN_ONCE);
  });

  it("runs the built-in when the registry is not installed", () => {
    const { status, validated } = runDecision(
      relative,
      { [GATE]: { push: "required" } },
      { registry: false }
    );
    expect(status).toBe(0);
    expect(validated).toBe(RAN_ONCE);
  });

  it("runs the built-in when the config cannot be parsed, and says so", () => {
    // Fail-safe, and loud with it: nothing here discards stderr, so a broken
    // config cannot read as a project that simply declared nothing.
    const { status, stderr, validated } = runDecision(relative, null, {
      config: "{ not json",
    });
    expect(status).toBe(0);
    expect(validated).toBe(RAN_ONCE);
    expect(stderr).toMatch(/not readable|Invalid/u);
  });

  it("blocks the push when the built-in validator refuses", () => {
    // The half that must not weaken: the fallback still fails closed.
    const { status, validated } = runDecision(relative, null, {
      validatorExit: 1,
    });
    expect(status).toBe(1);
    expect(validated).toBe(RAN_ONCE);
  });
});

describe.each(HOOKS)("%s does not lose a declared gate", relative => {
  it("stands the built-in down when the runner recorded the property", () => {
    const { status, validated } = runLate(relative, "declared", [GATE]);
    expect(status).toBe(0);
    expect(validated).toBe("");
  });

  it("runs the built-in late when the runner proved nothing", () => {
    // A runner that could not run, or could not write its coverage, means
    // nothing was proved. Deferring to it in that state would make `required`
    // a quieter way of switching the check off than `off` is.
    const { status, validated } = runLate(relative, "declared", null);
    expect(status).toBe(0);
    expect(validated).toBe(RAN_ONCE);
  });

  it("runs nothing late when the gate was never declared", () => {
    // It already ran, early, with the pushed refs still on stdin.
    const { status, validated } = runLate(relative, "", null);
    expect(status).toBe(0);
    expect(validated).toBe("");
  });
});

describe("every copy of the hook decides identically", () => {
  it("keeps the push-moment decision byte-identical apart from where the registry lives", () => {
    // Several implementations of one decision cannot be kept in step by
    // intention: that is precisely how the bun audit block fail-open reached
    // the fleet in one copy and not the other. Compared against the first copy
    // rather than destructured as a pair, so a third copy cannot slip past.
    const decisions = HOOKS.map(relative => [
      relative,
      decisionBlock(relative)
        .split("\n")
        .filter(line => !line.includes('lisa-gates.mjs"'))
        .join("\n"),
    ]);
    const [reference] = decisions;
    expect(reference).toBeDefined();
    for (const [relative, block] of decisions.slice(1)) {
      expect(`${relative}\n${block}`).toBe(
        `${relative}\n${reference?.[1] ?? ""}`
      );
    }
  });
});
