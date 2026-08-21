/**
 * `lisa doctor` may not recommend a gate whose task it cannot verify resolves.
 *
 * The specific defect (#2810): doctor declared `gates.traceability` in projects
 * that had no `check:work-item` script, and the gate's CI job then failed with
 * `Missing script`. An operator ran the tool that tells them what to fix, did
 * exactly what it said, and got a red pipeline they did not have before.
 *
 * The general defect is the one worth pinning. Doctor's recommendations are
 * trusted precisely by the people least able to evaluate them, so a
 * recommendation Lisa cannot prove is runnable is worse than silence. This
 * suite asserts the DECLINE — that doctor, handed a gate whose task is absent,
 * leaves the config alone and says why — rather than asserting that some
 * template contains a script line. A containment assertion would pass with the
 * guard deleted; these do not.
 * @module tests/unit/cli/doctor-gate-recommendation
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canRecommendGate,
  declareGate,
  withGate,
} from "../../../src/cli/doctor-gate-recommendation.js";
import type { GateRecommendation } from "../../../src/cli/doctor-gate-recommendation.js";
import { checkTraceabilityGate } from "../../../src/cli/doctor-traceability-gate.js";

const CONFIG = ".lisa.config.json";
const PACKAGE = "package.json";

/** A script every fixture has, and no gate ever resolves to. */
const UNRELATED = { test: "vitest run" } as const;

/** The gate ids and tasks the generality assertions range over. */
const TRACEABILITY = "traceability";
const WORK_ITEM = "check:work-item";
const CODE_STYLE = "code-style";
const LINT = "lint";
const PULL_REQUEST = "pull-request";

const roots: string[] = [];

/**
 * Build a project fixture.
 * @param scripts - The package.json `scripts` block, or null for no manifest.
 * @returns The project root.
 */
const project = (scripts: Record<string, string> | null): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-gate-rec-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, CONFIG),
    `${JSON.stringify({ tracker: "github" }, null, 2)}\n`
  );
  if (scripts !== null) {
    fs.writeFileSync(
      path.join(root, PACKAGE),
      `${JSON.stringify({ name: "fixture", scripts }, null, 2)}\n`
    );
  }
  return root;
};

/**
 * Read a fixture's config back.
 * @param root - Project root.
 * @returns Parsed config.
 */
const readBack = (root: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(root, CONFIG), "utf-8")) as Record<
    string,
    unknown
  >;

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

describe("doctor declines to recommend a gate whose task is absent", () => {
  it("leaves the config untouched when the gate's task has no script", async () => {
    const root = project({ ...UNRELATED });

    await checkTraceabilityGate(root);

    // Writing the gate here is what reddens the pipeline: the CI job resolves
    // `check:work-item` and npm answers `Missing script`.
    expect(readBack(root).gates).toBeUndefined();
  });

  it("names the task it could not resolve, in words an operator can act on", async () => {
    const root = project({ ...UNRELATED });

    const result = await checkTraceabilityGate(root);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain(WORK_ITEM);
    expect(result.detail).toContain("lisa apply");
    expect(result.detail).not.toContain("ADDED");
  });

  it("declines when the project has no package.json at all", async () => {
    const root = project(null);

    const result = await checkTraceabilityGate(root);

    expect(readBack(root).gates).toBeUndefined();
    expect(result.status).toBe("warn");
  });

  it("still declares the gate once the task resolves", async () => {
    const root = project({
      "check:work-item": "node scripts/lisa-work-item.mjs validate-pr",
    });

    const result = await checkTraceabilityGate(root);

    expect(readBack(root).gates).toEqual({
      [TRACEABILITY]: { [PULL_REQUEST]: "required" },
    });
    expect(result.detail).toContain("ADDED");
  });
});

describe("the guard generalises past the gate that exposed it", () => {
  /** A registry standing in for whatever gates a future Lisa ships. */
  const registry = {
    REGISTRY: {
      [CODE_STYLE]: { task: LINT },
      [TRACEABILITY]: {
        task: WORK_ITEM,
        taskAt: { push: "check:work-item:push" },
      },
      "no-task": {},
    },
  };

  /**
   * Ask the guard about one gate in one project.
   * @param root - Project root.
   * @param gateId - Gate being considered.
   * @param moment - Moment it would be declared at.
   * @param level - Level it would be declared at.
   * @returns The guard's verdict.
   */
  const ask = async (
    root: string,
    gateId: string,
    moment = PULL_REQUEST,
    level = "required"
  ): Promise<GateRecommendation> =>
    canRecommendGate({
      targetPath: root,
      config: {},
      gateId,
      moment,
      level,
      loadRegistry: async () => registry,
    });

  it.each([
    [CODE_STYLE, LINT],
    [TRACEABILITY, WORK_ITEM],
  ])("declines %s when its task %s is absent", async (gateId, task) => {
    const verdict = await ask(project({ ...UNRELATED }), gateId);
    expect(verdict.recommend).toBe(false);
    expect(verdict.task).toBe(task);
  });

  it.each([
    [CODE_STYLE, LINT],
    [TRACEABILITY, WORK_ITEM],
  ])("recommends %s once its task %s exists", async (gateId, task) => {
    const verdict = await ask(project({ [task]: "echo run" }), gateId);
    expect(verdict.recommend).toBe(true);
  });

  it("asks about the task the MOMENT resolves, not the gate's default", async () => {
    // traceability proves push with `validate-push`; a project holding only the
    // pull-request script cannot run the push gate, and saying otherwise would
    // recommend a red build one moment over.
    const root = project({ [WORK_ITEM]: "echo pr" });
    const verdict = await ask(root, TRACEABILITY, "push");
    expect(verdict.task).toBe("check:work-item:push");
    expect(verdict.recommend).toBe(false);
  });

  it("permits `off` with no task, because off runs nothing", async () => {
    const root = project({ ...UNRELATED });
    expect((await ask(root, TRACEABILITY, PULL_REQUEST, "off")).recommend).toBe(
      true
    );
  });

  it("declines a gate this Lisa does not know", async () => {
    const verdict = await ask(project({ [LINT]: "echo" }), "invented-gate");
    expect(verdict.recommend).toBe(false);
  });

  it("declines a gate that names no task at that moment", async () => {
    const verdict = await ask(project({ [LINT]: "echo" }), "no-task");
    expect(verdict.recommend).toBe(false);
  });

  it("declines when it cannot read the registry at all", async () => {
    // Unverifiable and known-bad cost a consumer the same red build, so an
    // unreadable registry is never treated as permission.
    const verdict = await canRecommendGate({
      targetPath: project({ [LINT]: "echo" }),
      config: {},
      gateId: CODE_STYLE,
      moment: PULL_REQUEST,
      level: "required",
      loadRegistry: async () => null,
    });
    expect(verdict.recommend).toBe(false);
  });

  it("writes nothing when it declines, and the declaration when it does not", async () => {
    const blocked = project({ ...UNRELATED });
    const allowed = project({ [LINT]: "echo run" });

    const refused = await declareGate({
      targetPath: blocked,
      config: {},
      gateId: CODE_STYLE,
      moment: PULL_REQUEST,
      level: "required",
      loadRegistry: async () => registry,
    });
    const written = await declareGate({
      targetPath: allowed,
      config: { gates: { other: "off" } },
      gateId: CODE_STYLE,
      moment: PULL_REQUEST,
      level: "required",
      loadRegistry: async () => registry,
    });

    expect(refused.outcome).toBe("declined");
    expect(readBack(blocked).gates).toBeUndefined();
    expect(written.outcome).toBe("declared");
    expect(readBack(allowed).gates).toEqual({
      other: "off",
      [CODE_STYLE]: { [PULL_REQUEST]: "required" },
    });
  });
});

describe("declaring a gate keeps what that gate already declares", () => {
  /** The registry the write-path assertion resolves against. */
  const registry = { REGISTRY: { [TRACEABILITY]: { task: WORK_ITEM } } };

  it("keeps a moment already declared for the same gate", () => {
    // A gate is declared per moment and doctor declares one moment per call.
    // Replacing the per-gate object drops the other moment silently: the config
    // still names the gate, so nothing reads as missing, and the moment that
    // stopped running is invisible until something ships past it.
    const next = withGate(
      { gates: { [TRACEABILITY]: { push: "required" } } },
      TRACEABILITY,
      PULL_REQUEST,
      "required"
    );

    expect(next.gates?.[TRACEABILITY]).toEqual({
      push: "required",
      [PULL_REQUEST]: "required",
    });
  });

  it("keeps a gate-level `run` override alongside the new moment", () => {
    // `run` is a sibling of the moment keys, not a moment — this repository's
    // own config declares `dead-code` as `{run, push, pull-request}`. A merge
    // that preserved the moments but dropped `run` would silently send the gate
    // back to its registry default task, which is a different check than the
    // project asked for and one that passes without saying so.
    const next = withGate(
      { gates: { "dead-code": { run: "knip:check", push: "required" } } },
      "dead-code",
      PULL_REQUEST,
      "optional"
    );

    expect(next.gates?.["dead-code"]).toEqual({
      run: "knip:check",
      push: "required",
      [PULL_REQUEST]: "optional",
    });
  });

  it("still overwrites the one moment it was asked to declare", () => {
    const next = withGate(
      { gates: { [TRACEABILITY]: { [PULL_REQUEST]: "optional" } } },
      TRACEABILITY,
      PULL_REQUEST,
      "required"
    );

    expect(next.gates?.[TRACEABILITY]).toEqual({ [PULL_REQUEST]: "required" });
  });

  it("replaces a declaration that is not an object rather than spreading it", () => {
    // `gates."<id>"` must be an object; a bare string is malformed, and
    // spreading one splays its characters into index keys. Repairing it to a
    // well-formed declaration is the honest outcome.
    const next = withGate(
      { gates: { [CODE_STYLE]: "required" } },
      CODE_STYLE,
      PULL_REQUEST,
      "required"
    );

    expect(next.gates?.[CODE_STYLE]).toEqual({ [PULL_REQUEST]: "required" });
  });

  it("writes both moments through the guarded door", async () => {
    const root = project({ [WORK_ITEM]: "echo pr" });

    const result = await declareGate({
      targetPath: root,
      config: { gates: { [TRACEABILITY]: { push: "required" } } },
      gateId: TRACEABILITY,
      moment: PULL_REQUEST,
      level: "required",
      loadRegistry: async () => registry,
    });

    expect(result.outcome).toBe("declared");
    expect(readBack(root).gates).toEqual({
      [TRACEABILITY]: { push: "required", [PULL_REQUEST]: "required" },
    });
  });
});

describe("the guard is the only door", () => {
  it("leaves no doctor check able to write .lisa.config.json around it", () => {
    // A guard a caller must remember to invoke is a guard a future caller
    // forgets. `declareGate` verifies AND writes, so the only way to declare a
    // gate without the check is to hand-roll a write — which this assertion
    // turns into a failing build rather than a consumer's red pipeline.
    const dir = path.join(process.cwd(), "src", "cli");
    const writers = fs
      .readdirSync(dir)
      .filter(name => name.startsWith("doctor") && name.endsWith(".ts"))
      .filter(name => {
        const body = fs.readFileSync(path.join(dir, name), "utf-8");
        return body.includes("writeFile") && body.includes(CONFIG);
      });
    expect(writers).toEqual(["doctor-gate-recommendation.ts"]);
  });
});
