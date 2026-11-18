/**
 * How a reconcile run is summed up for an operator (CodySwannGT/lisa#5000).
 *
 * The first line the command prints is the one an operator reads, and the
 * attest step branches on the outcome behind it. Three outcomes are held
 * apart: nothing differs, something differs, and something that was needed
 * could not be read. Only the last is a failure, and it has to say which
 * place was not read.
 */
import { describe, expect, it } from "vitest";

import {
  describeReconcile,
  surfacesOf,
  type SurfaceFacts,
} from "../../../src/controls/reconcile-result.js";
import type {
  ReconcileFinding,
  ReconciledPoint,
  SurfaceRead,
} from "../../../src/controls/reconcile-types.js";

const READ: readonly SurfaceRead[] = [
  { detail: null, state: "read", surface: "register" },
];
const UNREAD: readonly SurfaceRead[] = [
  { detail: "A link.", state: "could-not-read", surface: "hooks" },
];
const NOT_READ = "could-not-read";

/** A command a hook runs that no entry declares. */
const COMMAND: ReconcileFinding = {
  command: "npm audit",
  hook: "pre-commit",
  kind: "undeclared-command",
  line: 3,
  message: "",
  moment: "commit",
  next: "",
  path: ".husky/pre-commit",
};

/** A claimed enforcement point that nothing runs. */
const POINT: ReconcileFinding = {
  criteria: [],
  entry_id: "code-style@.",
  gate: "code-style",
  kind: "enforcement-point-not-wired",
  location: "local-checkout",
  message: "",
  moment: "commit",
  next: "",
  scope: ".",
};

/**
 * An enforcement point in one state.
 * @param state - The state
 * @returns The point
 */
function point(state: ReconciledPoint["state"]): ReconciledPoint {
  return {
    checked: null,
    entry_id: "code-style@.",
    gate: "code-style",
    level: "required",
    location: "local-checkout",
    moment: "commit",
    reason: "",
    scope: ".",
    state,
  };
}

/**
 * The facts of a run in which every read went well.
 * @param change - What differs
 * @returns The facts
 */
function facts(change: Partial<SurfaceFacts> = {}): SurfaceFacts {
  return {
    committed: "current",
    hooks: { commands: [], files: [".husky/pre-commit"], problems: [] },
    needsPlatform: false,
    platform: { asked: false },
    ...change,
  };
}

/**
 * The state of each read, by place.
 * @param surfaces - The reads
 * @returns For example `{ hooks: "read" }`
 */
function states(surfaces: readonly SurfaceRead[]): Record<string, string> {
  return Object.fromEntries(
    surfaces.map(surface => [surface.surface, surface.state])
  );
}

describe("the outcome of a reconcile run", () => {
  it("is in step when nothing differs, and counts what was confirmed", () => {
    expect(describeReconcile([point("wired")], [], READ)).toEqual({
      outcome: "in-step",
      reason:
        "The register and what is installed are in step: 1 of 1 enforcement point was confirmed, and no hook runs a command the register does not declare.",
    });
  });

  it("says how many points it could not check, without calling them missing", () => {
    const described = describeReconcile(
      [point("wired"), point("not-verifiable"), point("not-read")],
      [],
      READ
    );

    expect(described.outcome).toBe("in-step");
    expect(described.reason).toContain(
      "1 of 3 enforcement points was confirmed, 2 could not be checked by this run"
    );
  });

  it("names only the kinds of difference that were found", () => {
    expect(describeReconcile([], [POINT], READ).reason).toBe(
      "The register and what is installed differ: 1 enforcement point the register lists is not wired."
    );
    expect(describeReconcile([], [COMMAND, COMMAND], READ).reason).toBe(
      "The register and what is installed differ: 2 commands run in a hook with no register entry that declares it."
    );
    expect(describeReconcile([], [POINT, COMMAND], READ)).toEqual({
      outcome: "findings",
      reason:
        "The register and what is installed differ: 1 enforcement point the register lists is not wired, and 1 command runs in a hook with no register entry that declares it.",
    });
  });

  it("is incomplete when a needed place could not be read, whatever else was found", () => {
    expect(describeReconcile([], [], UNREAD)).toEqual({
      outcome: "incomplete",
      reason:
        "This comparison is not complete: hooks could not be read. Of what was read, nothing differs.",
    });
    expect(describeReconcile([], [POINT], UNREAD).outcome).toBe("incomplete");
  });
});

describe("what became of each read", () => {
  it("lists the four places in a fixed order", () => {
    expect(surfacesOf(facts()).map(surface => surface.surface)).toEqual([
      "register",
      "carriers",
      "hooks",
      "hosting-platform",
    ]);
  });

  it("notes a committed register that is stale or absent without failing", () => {
    const [stale] = surfacesOf(facts({ committed: "stale" }));
    const [absent] = surfacesOf(facts({ committed: "absent" }));

    expect(stale).toMatchObject({ state: "read" });
    expect(stale?.detail).toContain("is not what the declaration generates");
    expect(absent?.detail).toContain("is not in this checkout");
  });

  it("marks the hooks unread when any hook file could not be read", () => {
    const surfaces = surfacesOf(
      facts({
        hooks: { commands: [], files: [], problems: ["One.", "Two."] },
      })
    );

    expect(states(surfaces).hooks).toBe(NOT_READ);
    expect(surfaces[2]?.detail).toBe("One. Two.");
  });

  it("keeps not needed, not asked, not answered and answered apart", () => {
    const needed = { needsPlatform: true };
    const answer = {
      branch: "main",
      checks: {},
      label: "GitHub",
      required: [],
      rulesets: [],
    };
    const platformOf = (change: Partial<SurfaceFacts>): string | undefined =>
      states(surfacesOf(facts(change)))["hosting-platform"];

    expect(platformOf({})).toBe("not-needed");
    expect(platformOf(needed)).toBe("not-asked");
    expect(
      platformOf({
        ...needed,
        platform: { answer: null, asked: true, detail: "Refused." },
      })
    ).toBe(NOT_READ);
    expect(platformOf({ ...needed, platform: { answer, asked: true } })).toBe(
      "read"
    );
  });
});
