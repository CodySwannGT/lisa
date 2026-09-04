import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  MAIN_CONFIG,
  project,
  RENDERER,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";
import {
  DEFAULT_RUNNER,
  DEFAULT_UNPROVEN,
  LEVELS,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { DEFAULT_HARNESS } from "../../../src/core/config.js";
import { DEFAULT_PROJECT_LEARNINGS_FILE } from "../../../src/core/learnings-location.js";
import { BUILT_IN_DEFAULTS } from "../../../plugins/src/base/hooks/inject-resolved-config.mjs";
import { shouldShipScript } from "../../../scripts/lib/per-agent-hook-filter.mjs";

/**
 * The renderer's own source.
 *
 * The two vocabularies below are COPIES: the renderer ships inside a plugin
 * payload in an arbitrary host project, where neither the TypeScript module nor
 * the shipped gate script it copied them from can be imported. Reading the
 * source and asserting the copies still spell what their owners export is what
 * keeps the copy from drifting in silence.
 * @returns The renderer file's text
 */
const rendererSource = (): string =>
  readFileSync(path.resolve(RENDERER), "utf8");

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor } = hookRunner(process.env);

describe("inject-resolved-config: bounded output", () => {
  it("stops at the budget and counts what it did not render", () => {
    const root = project();
    // Many nested objects, so the body is many LINES rather than one long one:
    // the budget reads a line as indivisible, and `MAX_LINE` handles the other
    // shape.
    const deep = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `section${index}`,
        { setting: `value-for-section-number-${index}` },
      ])
    );
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      deploy: { branches: { production: "main" } },
      policy: deep,
    });

    const context = contextFor(root);

    expect(context).toContain("further rendered line(s) omitted");
    expect(context.length).toBeLessThan(6000);
  });

  it("truncates a single pathological line instead of spending the whole budget on it", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      policy: { note: "x".repeat(3000) },
    });

    const context = contextFor(root);

    expect(context).toContain("… (line truncated)");
    expect(context).toContain("tracker: github");
    expect(context.length).toBeLessThan(2000);
  });

  it("summarises a wide object instead of listing every child", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      policy: Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [`flag${index}`, true])
      ),
    });

    expect(contextFor(root)).toContain("+18 more");
  });

  it("groups gates by moment and level rather than truncating the list", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      gates: {
        runner: "bun run",
        "code-style": { commit: "required", "pull-request": "required" },
        "dead-code": { run: "knip:check", push: "required" },
        "test-node-suites": { push: "off" },
      },
    });

    const context = contextFor(root);

    expect(context).toContain("gates (3 declared)");
    expect(context).toContain("commit required: code-style");
    expect(context).toContain("push required: dead-code");
    expect(context).toContain("push off: test-node-suites");
    // `run` is a gate's prover, not a moment. Reading it as one produced a
    // bogus "run knip:check" bucket.
    expect(context).not.toContain("run knip:check:");
  });
});

describe("inject-resolved-config: copied vocabularies still agree with their owners", () => {
  it("pins each built-in default's PATH to the constant that owns its value", () => {
    // Pairs, not membership. Asserting that each constant's text appears
    // somewhere in the source pinned only the SET of values present, so
    // swapping the `harness` and `gates.unproven` entries left every test in
    // both suites green while every session with no declared harness was told
    // its harness was `warn`.
    expect(
      BUILT_IN_DEFAULTS.map(({ path: key, value }) => [key, value])
    ).toEqual([
      ["harness", DEFAULT_HARNESS],
      ["gates.runner", DEFAULT_RUNNER],
      ["gates.unproven", DEFAULT_UNPROVEN],
      ["learnings.file", DEFAULT_PROJECT_LEARNINGS_FILE],
    ]);
  });

  it("holds both budgets at the values the gap fixes were made to respect", () => {
    // Not a fix — a ratchet. Every defect this suite covers had a one-line
    // "fix" available in raising a number here, and every one of them would
    // have paid for it out of every session's context in exchange for hiding
    // the symptom rather than the cause. Ordering and accounting are the fix.
    const source = rendererSource();

    expect(source).toContain("const CONTEXT_BUDGET = 4000;");
    expect(source).toContain("const MAX_LINE = 400;");
  });

  it("pins the gate-level vocabulary against the gate registry's LEVELS", () => {
    const source = rendererSource();

    expect(source).toContain(
      `const LEVELS = new Set([${LEVELS.map((level: string) => `"${level}"`).join(", ")}]);`
    );
  });
});

describe("inject-resolved-config: agent fan-out", () => {
  it.each([
    ["claude", true],
    ["codex", true],
    ["cursor", true],
    ["copilot", true],
    // agy has no SessionStart event; the gap is compensated by the shared
    // gate-runner and `lisa doctor` rungs, not by an agent-layer hook.
    ["agy", false],
  ])("ships to %s: %s", (agent, expected) => {
    expect(shouldShipScript("inject-resolved-config.sh", agent)).toBe(expected);
  });
});
