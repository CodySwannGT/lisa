/**
 * The resolved-config block states the effective `dependencies.humanSignOff`.
 *
 * The setting changes what the governed dependency rule asks an agent to do,
 * so the agent has to see it without deciding to open the config file — and an
 * invalid value has to be named as invalid, because printing a quiet `default`
 * would make "the project meant `none` and typed it wrong" indistinguishable
 * from "the project never set it".
 *
 * Its default, and `learnings.lowConfidence`'s, follow `humanGate.mode`
 * (CodySwannGT/lisa#4687), so the block also states the mode in force and
 * which mode each undeclared default came from.
 * @module tests/unit/hooks/inject-resolved-config-dependencies
 */
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  LOCAL_CONFIG,
  MAIN_CONFIG,
  project,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";

const SIGN_OFF_KEY = "dependencies.humanSignOff";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor } = hookRunner(process.env);

/**
 * The exact `dependencies.humanSignOff` line a session sees.
 * @param context - The injected resolved-config block
 * @returns The first line for the key, or undefined when none rendered
 */
const lineFor = (context: string): string | undefined =>
  keyLine(context, SIGN_OFF_KEY);

/**
 * The first rendered line for a dotted key.
 * @param context - The injected resolved-config block
 * @param key - Dotted config key
 * @returns The line, or undefined when none rendered
 */
const keyLine = (context: string, key: string): string | undefined =>
  context.split("\n").find(line => line.startsWith(`${key}:`));

const DEPS_OWNER = "owner: src/core/project-config-dependencies.ts";
const LEARNINGS_OWNER = "owner: src/core/project-config-learnings.ts";
const GATE_OWNER = "owner: src/core/project-config-human-gate.ts";
const MODE_KEY = "humanGate.mode";
const LOW_KEY = "learnings.lowConfidence";

describe("inject-resolved-config: dependencies.humanSignOff", () => {
  it("marks an undeclared value as the access-only built-in default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    expect(lineFor(contextFor(root))).toBe(
      `dependencies.humanSignOff: none   [Lisa built-in default for humanGate.mode access-only — this project declares none; ${DEPS_OWNER}]`
    );
  });

  it("marks an undeclared value as the strict default under strict", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "strict" },
    });

    expect(lineFor(contextFor(root))).toBe(
      `dependencies.humanSignOff: default   [Lisa built-in default for humanGate.mode strict — this project declares none; ${DEPS_OWNER}]`
    );
  });

  it.each(["none", "default"])("prints a declared %s plainly", value => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: value },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe(`dependencies.humanSignOff: ${value}`);
    expect(context).not.toContain("INVALID");
  });

  it("reads a declared value case- and whitespace-insensitively", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: " Default " },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe(`${SIGN_OFF_KEY}: default`);
    expect(context).not.toContain("INVALID");
  });

  it("lets the local override win", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: "default" },
    });
    writeJson(root, LOCAL_CONFIG, { dependencies: { humanSignOff: "none" } });

    expect(lineFor(contextFor(root))).toBe(`${SIGN_OFF_KEY}: none`);
  });

  it("reports an invalid value as invalid and resolves it to the mode default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: "sometimes" },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe(
      `dependencies.humanSignOff: default   [INVALID — this project declares "sometimes", which is not one of "default" | "none"; treated as default; ${DEPS_OWNER}]`
    );
    // Exactly one line for the key: the declared-but-invalid value must not
    // ALSO render as if it were the effective value.
    expect(
      context.split("\n").filter(line => line.includes(SIGN_OFF_KEY)).length
    ).toBe(1);
  });

  it("reports a dependencies block that is not an object as invalid", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github", dependencies: "none" });

    const context = contextFor(root);

    expect(lineFor(context)).toContain(
      'dependencies.humanSignOff: default   [INVALID — this project declares "none" for dependencies'
    );
    expect(context).not.toContain(
      "other declared keys (not summarised here): dependencies"
    );
  });

  it("still renders other keys a future dependencies block carries", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: "none", futureSetting: "on" },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe(`${SIGN_OFF_KEY}: none`);
    expect(context).toContain("dependencies: futureSetting=on");
    expect(context).not.toContain("humanSignOff=none");
  });
});

describe("inject-resolved-config: humanGate.mode and its mode-aware defaults", () => {
  it("states the access-only mode and auto-merge when nothing is declared", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toBe(
      `humanGate.mode: access-only   [Lisa built-in default — this project declares none; ${GATE_OWNER}]`
    );
    expect(keyLine(context, LOW_KEY)).toBe(
      `learnings.lowConfidence: auto-merge   [Lisa built-in default for humanGate.mode access-only — this project declares none; ${LEARNINGS_OWNER}]`
    );
  });

  it("prints a declared strict mode and the strict defaults", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "strict", humanOnly: ["pricing"] },
    });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toBe(`${MODE_KEY}: strict`);
    expect(keyLine(context, LOW_KEY)).toBe(
      `learnings.lowConfidence: human-triage   [Lisa built-in default for humanGate.mode strict — this project declares none; ${LEARNINGS_OWNER}]`
    );
    expect(context).toContain("humanGate: humanOnly=[pricing]");
    expect(context).not.toContain(
      "other declared keys (not summarised here): humanGate"
    );
  });

  it("lets an explicit value win over the mode", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "strict" },
      learnings: { lowConfidence: "auto-merge" },
      dependencies: { humanSignOff: "none" },
    });

    const context = contextFor(root);

    expect(keyLine(context, LOW_KEY)).toBeUndefined();
    expect(context).toContain("lowConfidence=auto-merge");
    expect(lineFor(context)).toBe(`${SIGN_OFF_KEY}: none`);
  });

  it("lets the local override set the mode", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "access-only" },
    });
    writeJson(root, LOCAL_CONFIG, { humanGate: { mode: "strict" } });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toBe(`${MODE_KEY}: strict`);
    expect(lineFor(context)).toContain(`${SIGN_OFF_KEY}: default`);
  });

  it("reports an invalid mode as invalid and fails safe to strict", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "lenient" },
    });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toBe(
      `humanGate.mode: strict   [INVALID — this project declares "lenient", which is not one of "access-only" | "strict"; treated as strict; ${GATE_OWNER}]`
    );
    expect(
      context.split("\n").filter(line => line.startsWith("humanGate.mode:"))
        .length
    ).toBe(1);
    expect(lineFor(context)).toContain(`${SIGN_OFF_KEY}: default`);
    expect(keyLine(context, LOW_KEY)).toContain(
      "learnings.lowConfidence: human-triage"
    );
  });

  it("normalizes the mode's case and whitespace", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: " Strict " },
    });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toBe(`${MODE_KEY}: strict`);
    expect(lineFor(context)).toContain(`${SIGN_OFF_KEY}: default`);
    expect(context).not.toContain("INVALID");
  });

  it("falls back to a valid global mode when the local one is invalid", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "strict" },
    });
    writeJson(root, LOCAL_CONFIG, { humanGate: { mode: "strcit" } });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toBe(
      `humanGate.mode: strict   [INVALID — this project declares "strcit" in .lisa.config.local.json, which is not one of "access-only" | "strict"; treated as strict; ${GATE_OWNER}]`
    );
    expect(lineFor(context)).toContain(`${SIGN_OFF_KEY}: default`);
  });

  it("keeps a valid local mode but still reports an invalid global one", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      humanGate: { mode: "strcit" },
    });
    writeJson(root, LOCAL_CONFIG, { humanGate: { mode: "access-only" } });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toContain(
      'humanGate.mode: access-only   [INVALID — this project declares "strcit"'
    );
    expect(lineFor(context)).toContain(`${SIGN_OFF_KEY}: none`);
  });

  it("reports an invalid lowConfidence and fails safe to human-triage", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      learnings: { lowConfidence: "yolo" },
    });

    const context = contextFor(root);

    expect(keyLine(context, LOW_KEY)).toBe(
      `learnings.lowConfidence: human-triage   [INVALID — this project declares "yolo", which is not one of "auto-merge" | "human-triage"; treated as human-triage; ${LEARNINGS_OWNER}]`
    );
    expect(context).not.toContain("lowConfidence=yolo");
  });

  it("reports a humanGate block that is not an object as invalid", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github", humanGate: "strict" });

    const context = contextFor(root);

    expect(keyLine(context, MODE_KEY)).toContain(
      'humanGate.mode: strict   [INVALID — this project declares "strict" for humanGate, which is not an object'
    );
    expect(context).not.toContain(
      "other declared keys (not summarised here): humanGate"
    );
  });
});
