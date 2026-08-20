/**
 * Every upstream layer sanctions the Work-Item Traceability gate; no consumer
 * declared it (#2677).
 *
 * Measured across five consumer repositories: `traceability` absent from every
 * `.lisa.config.json`, the context not required on any default branch, and the
 * job absent from recent PR runs entirely. Not a red-but-non-blocking signal an
 * operator might notice — no signal at all.
 *
 * This check repairs the layer that produces a signal (the gate's level) and
 * reports the layer that blocks merges (branch protection), because promoting a
 * required context has its own control and its own ledger.
 * @module tests/unit/cli/doctor-traceability-gate
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkTraceabilityGate,
  declaresTraceability,
  GATE_ID,
  withTraceabilityGate,
} from "../../../src/cli/doctor-traceability-gate.js";

/** The config filename every fixture writes and reads back. */
const CONFIG = ".lisa.config.json";

const roots: string[] = [];

/**
 * Write a project with the given `.lisa.config.json` contents.
 *
 * The fixture also carries the gate's task as a package script. Since #2810 a
 * project without it is a project doctor REFUSES to declare the gate in —
 * declaring a gate whose task is missing is what reddens a passing pipeline —
 * so a fixture lacking the script would exercise the decline path rather than
 * the declaration path these assertions are about. The decline path has its own
 * suite in `doctor-gate-recommendation.test.ts`.
 * @param config - Object to serialize, or a raw string for malformed cases.
 * @returns The project root.
 */
const project = (config: object | string | null): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-trace-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: {
        "check:work-item": "node scripts/lisa-work-item.mjs validate-pr",
      },
    })
  );
  if (config !== null) {
    fs.writeFileSync(
      path.join(root, CONFIG),
      typeof config === "string" ? config : JSON.stringify(config, null, 2)
    );
  }
  return root;
};

/**
 * Read a project's config back after a repair.
 * @param root - Project root.
 * @returns Parsed config.
 */
const readBack = (root: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(root, CONFIG), "utf-8")) as Record<
    string,
    unknown
  >;

describe("traceability gate declaration", () => {
  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("adds the gate when the project declares none", async () => {
    const root = project({
      tracker: "github",
      gates: { "code-style": "required" },
    });

    const result = await checkTraceabilityGate(root);

    expect(result.status).toBe("warn");
    expect(readBack(root).gates).toEqual({
      "code-style": "required",
      [GATE_ID]: { "pull-request": "required" },
    });
  });

  it("adds a gates block to a project that has none", async () => {
    const root = project({ tracker: "github" });
    await checkTraceabilityGate(root);
    expect(readBack(root).gates).toEqual({
      [GATE_ID]: { "pull-request": "required" },
    });
  });

  it("preserves a deliberate opt-out rather than overwriting it", async () => {
    // A repair that reset `off` to `required` would make the gate
    // un-declinable: the project could never express a considered exemption,
    // and the next doctor run would silently undo the decision. That is a
    // worse failure than the hole being closed.
    const root = project({ gates: { [GATE_ID]: "off" } });

    const result = await checkTraceabilityGate(root);

    expect(result.status).toBe("ok");
    expect(readBack(root).gates).toEqual({ [GATE_ID]: "off" });
  });

  it("leaves an already-declared gate exactly as the project set it", async () => {
    const declared = { [GATE_ID]: { "pull-request": "optional" } };
    const root = project({ gates: declared });

    await checkTraceabilityGate(root);

    expect(readBack(root).gates).toEqual(declared);
  });

  it("says what it changed and names the second layer", async () => {
    const root = project({ tracker: "github" });
    const result = await checkTraceabilityGate(root);
    // The repair must be legible: an operator has an uncommitted config edit
    // and needs to know why, and that a running job is not yet a blocking one.
    expect(result.detail).toContain("ADDED");
    expect(result.detail).toContain("required status context");
    expect(result.detail).toContain("off");
  });

  // AC4. An offline check cannot see branch protection, so a bare "ok" on the
  // declared branch would read as "traceability is enforced" when the required
  // context may be absent and every failure merges anyway. Both branches must
  // carry the layer-2 caveat; before this was added, the declared branch said
  // only "left as the project set it" and these two assertions failed.
  it("names the unobservable second layer even when the gate is declared", async () => {
    const root = project({
      gates: { [GATE_ID]: { "pull-request": "required" } },
    });
    const result = await checkTraceabilityGate(root);

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("lisa health");
    expect(result.detail).toContain("scripts/lisa-github-rulesets.sh");
  });

  it("does not claim an undeclared gate stopped the job from running", async () => {
    const root = project({});
    const result = await checkTraceabilityGate(root);

    // #2680 made the job run regardless of the gate; the cost of leaving it
    // undeclared is that the red does not block, not that nothing ran.
    expect(result.detail).not.toContain("never ran");
    expect(result.detail).toContain("merged anyway");
  });

  it("is silent on a directory that is not a Lisa project", async () => {
    const result = await checkTraceabilityGate(project(null));
    expect(result.status).toBe("ok");
  });

  it("reports malformed config instead of throwing or repairing it", async () => {
    const root = project("{ not json");
    const result = await checkTraceabilityGate(root);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("not valid JSON");
    // Must not have rewritten a file it could not parse.
    expect(fs.readFileSync(path.join(root, CONFIG), "utf-8")).toBe(
      "{ not json"
    );
  });
});

describe("pure helpers", () => {
  it("treats any declaration, including off, as declared", () => {
    expect(declaresTraceability({ gates: { [GATE_ID]: "off" } })).toBe(true);
    expect(declaresTraceability({ gates: {} })).toBe(false);
    expect(declaresTraceability({})).toBe(false);
  });

  it("does not mutate the config it is given", () => {
    const original = { gates: { "code-style": "required" } };
    const copy = JSON.parse(JSON.stringify(original)) as typeof original;
    withTraceabilityGate(original);
    expect(original).toEqual(copy);
  });
});
