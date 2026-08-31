/**
 * Caller-role and agent-surface parity for the Linear state-write guard (#3356).
 *
 * Two questions this file answers, which the guard's own unit tests cannot:
 *
 * 1. **Do the callers actually declare a role?** A chokepoint that can refuse is
 *    worth nothing if the skills routed around it. Every base surface that
 *    instructs a Linear workflow-state write must name the lifecycle role it is
 *    applying, and must not be telling a reader to compute a `stateId` itself.
 * 2. **Did every supported coding agent get it?** The guard ships as plugin
 *    bytes. A fix present only in `plugins/src/base` leaves consumers on the
 *    broken version, so each generated variant is checked for the same script
 *    and the same contract prose.
 *
 * It also pins the CONTROLS the issue was careful about: the Linear, JIRA and
 * GitHub claim paths already resolve their configured `claimed` role, and this
 * change must leave that true rather than "fix" it into something else. None of
 * these assertions claims any of those paths caused the observed transition.
 * @module tests/unit/strategies/linear-lifecycle-guard-parity
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Repository root; every path below is resolved from it. */
const ROOT = process.cwd();

/** The one lifecycle role every claim path on every vendor must resolve. */
const CLAIMED = "claimed";

/** The direct-claim skill, asserted as a caller and again as a control. */
const LINEAR_CLAIM = "plugins/src/base/skills/lisa-linear-claim/SKILL.md";

/** The evidence and agent surfaces checked for review-shaped default prose. */
const LINEAR_EVIDENCE = "plugins/src/base/skills/lisa-linear-evidence/SKILL.md";
const LINEAR_AGENT = "plugins/src/base/agents/linear-agent.md";

/** The guard's path inside any plugin root, and its authored source. */
const GUARD_IN_PLUGIN = "scripts/linear-state-write-target.mjs";
const GUARD_SOURCE = `plugins/src/base/${GUARD_IN_PLUGIN}`;
const ACCESS_SKILL = "plugins/src/base/skills/lisa-linear-access/SKILL.md";

/**
 * Every generated agent surface that carries the base plugin's scripts.
 *
 * The same roster the pre-existing lifecycle resolver ships to — a guard that
 * reached fewer surfaces than the resolver it calls would be inert exactly
 * where the resolver still runs.
 */
const AGENT_SURFACES = [
  "plugins/lisa",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
];

/** Generated copies of the access contract, including the Codex artifact. */
const ACCESS_SKILL_COPIES = [
  ...AGENT_SURFACES.map(root =>
    join(root, "skills/lisa-linear-access/SKILL.md")
  ),
  "plugins/lisa/.codex-plugin/skills/lisa-linear-access/SKILL.md",
];

/**
 * Read a repository-relative file.
 *
 * @param {string} path repository-relative path
 * @returns {string} file contents
 */
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/**
 * Base surfaces that instruct a Linear workflow-state write, and the lifecycle
 * roles each one must name on that write.
 *
 * Listed explicitly rather than derived, because the assertion is about intent:
 * "this caller applies the `blocked` role here" is a claim about the lifecycle,
 * not something a regex can infer from the file.
 */
const STATE_WRITERS = [
  { path: LINEAR_CLAIM, roles: [CLAIMED] },
  {
    path: "plugins/src/base/skills/lisa-linear-build-intake/SKILL.md",
    roles: [CLAIMED, "blocked", "done"],
  },
  { path: LINEAR_EVIDENCE, roles: ["review"] },
  {
    path: "plugins/src/base/skills/lisa-linear-write-issue/SKILL.md",
    roles: ["ready"],
  },
  { path: LINEAR_AGENT, roles: ["blocked"] },
];

describe("every Linear state writer declares the role it is applying", () => {
  it.each(STATE_WRITERS)(
    "$path names its lifecycle role",
    ({ path, roles }) => {
      const text = read(path);

      for (const role of roles)
        expect(text).toContain(`lifecycle_role: ${role}`);
    }
  );

  it.each(STATE_WRITERS)(
    "$path no longer tells a caller to set a raw stateId",
    ({ path }) => {
      expect(read(path)).not.toMatch(/setting `stateId`|set `stateId`/);
    }
  );

  it("routes the rollup writers through a declared role too", () => {
    for (const path of [
      "plugins/src/base/skills/lisa-linear-sync/SKILL.md",
      "plugins/src/base/skills/lisa-repair-intake/SKILL.md",
    ])
      expect(read(path)).toContain("lifecycle_role: <derived role>");
  });
});

describe("the access layer documents a resolved write, not a checked one", () => {
  it("declares lifecycle_role on the save-issue contract", () => {
    expect(read(ACCESS_SKILL)).toContain(
      "operation: save-issue payload:{...} [lifecycle_role:<ROLE>] [env:<KEY>]"
    );
  });

  it("invokes the guard before either transport", () => {
    const text = read(ACCESS_SKILL);

    expect(text).toContain(GUARD_IN_PLUGIN);
    expect(text).toContain("before either transport");
  });

  it("keeps metadata-only updates out of lifecycle validation", () => {
    expect(read(ACCESS_SKILL)).toContain(
      "Metadata-only `save-issue` is untouched"
    );
  });
});

describe("CONTROL — the claim paths still resolve their configured role", () => {
  it.each([
    [LINEAR_CLAIM, CLAIMED],
    ["plugins/src/base/skills/lisa-jira-claim/SKILL.md", CLAIMED],
    ["plugins/src/base/skills/lisa-github-claim/SKILL.md", CLAIMED],
  ])("%s resolves the configured %s role", (path, role) => {
    expect(read(path)).toContain(role);
  });

  it("delegates the vendor-neutral claim rather than writing a lane itself", () => {
    const text = read("plugins/src/base/skills/lisa-tracker-claim/SKILL.md");

    expect(text).toContain("lisa-linear-claim");
    expect(text).toContain("configured claimed");
  });

  it("never seeds an optional review binding during Linear setup", () => {
    const text = read("plugins/src/base/skills/lisa-setup-linear/SKILL.md");

    expect(text).toContain("optional, never seeded");
    expect(text).not.toMatch(/\| `review` \| `In Review` \|/);
  });

  it("names no review-shaped literal as a Linear write target", () => {
    for (const path of [
      LINEAR_CLAIM,
      LINEAR_EVIDENCE,
      LINEAR_AGENT,
      "plugins/src/base/agents/linear-build-intake.md",
    ])
      expect(read(path)).not.toMatch(/default[^.\n]*`In Review`/);
  });
});

describe("every supported agent surface carries the same guard", () => {
  const source = read(GUARD_SOURCE);

  it.each(AGENT_SURFACES)("%s ships a byte-identical validator", surface => {
    const path = join(surface, GUARD_IN_PLUGIN);

    expect(existsSync(join(ROOT, path))).toBe(true);
    expect(read(path)).toBe(source);
  });

  it.each(ACCESS_SKILL_COPIES)("%s carries the guard contract", path => {
    expect(read(path)).toContain(GUARD_IN_PLUGIN);
  });

  it("ships the guard everywhere the resolver it calls ships", () => {
    for (const surface of AGENT_SURFACES)
      expect(
        existsSync(join(ROOT, surface, "scripts/resolve-lifecycle-role.mjs"))
      ).toBe(true);
  });
});
