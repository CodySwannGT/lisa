/**
 * Tests for the live ruleset branch-reach health check.
 *
 * A ruleset whose include patterns match no branch is active and governs
 * nothing, and the two surfaces that already read ruleset conditions both call
 * it healthy: `compareRulesets` compares the include list against Lisa's
 * TEMPLATE (both say `refs/heads/dev`, so no drift), and `mapRulesetRow` ORs
 * across rows so one governing ruleset masks every other. CodySwannGT/lisa#2781.
 *
 * Every expectation here is written against a literal repository state rather
 * than derived from the detector, so a change to the matching rules shows up as
 * a failing test instead of a quietly agreeing one.
 * @module tests/unit/health/ruleset-reach-inspection
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import type { HealthRuleset } from "../../../src/health/ruleset-inspection.js";
import {
  rulesetReachFinding,
  type BranchReader,
  type RepositoryBranches,
} from "../../../src/health/ruleset-reach-inspection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The installed Lisa package carrying the shipped detector. */
const LISA_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The ruleset from the defect: its whole include list names one dead ref. */
const DEAD_RULESET = "nightly e2e health";

/** Its sibling in the same directory, which governs the default branch. */
const LIVE_RULESET = "bdd coverage";

/** The include entry naming a branch this repository does not have. */
const DEAD_PATTERN = "refs/heads/dev";

/** The include entry that follows the repository's default branch. */
const DEFAULT_PATTERN = "~DEFAULT_BRANCH";

/** The status every unproven answer carries. */
const WARN = "warn";

/** A project whose settings name a repository. */
const CONFIG = { github: { org: "acme", repo: "app" } };

/** A repository whose only branch is its default. */
const ONLY_DEFAULT: RepositoryBranches = {
  branches: ["main"],
  defaultBranch: "main",
};

const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map(root => rm(root, { recursive: true, force: true }))
  );
});

/**
 * Creates an empty directory that holds no shipped detector.
 * @returns The directory path.
 */
async function emptyRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-reach-root-"));
  temporaryRoots.push(root);
  return root;
}

/**
 * Builds one active branch ruleset.
 * @param name Ruleset name.
 * @param include Include entries.
 * @returns A material ruleset as the live reader answers.
 */
function ruleset(name: string, include: readonly string[]): HealthRuleset {
  return {
    name,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: [...include], exclude: [] } },
    rules: [],
  };
}

/**
 * Runs the check against fixed live state.
 * @param rulesets Live rulesets.
 * @param branches The repository's branches, or a reader that throws.
 * @param lisaRoot The installed Lisa package to load the detector from.
 * @returns The finding.
 */
async function finding(
  rulesets: readonly HealthRuleset[] | undefined,
  branches: RepositoryBranches | undefined,
  lisaRoot: string = LISA_ROOT
) {
  const readBranches: BranchReader = async () => {
    if (branches === undefined) throw new Error("branches unreadable");
    return branches;
  };
  return rulesetReachFinding(
    lisaRoot,
    LISA_ROOT,
    CONFIG,
    async () => {
      if (rulesets === undefined) throw new Error("rulesets unreadable");
      return rulesets;
    },
    readBranches,
    1_000,
    new AbortController().signal
  );
}

describe("rulesetReachFinding", () => {
  // THE DEFECT. The shipped nightly E2E health ruleset's whole include list is
  // [DEAD_PATTERN]. On a repository whose only branch is its default, the
  // required context it carries is required on no ref that exists — so the
  // gate reports and blocks no one, and nothing anywhere says so.
  it("fails and names a ruleset that governs no branch", async () => {
    const result = await finding(
      [ruleset(DEAD_RULESET, [DEAD_PATTERN])],
      ONLY_DEFAULT
    );

    expect(result.check).toBe("github.ruleset-reach");
    expect(result.status).toBe("fail");
    expect(result.reason).toContain(DEAD_RULESET);
    expect(result.reason).toContain(DEAD_PATTERN);
  });

  // THE NEGATIVE CONTROL. Its sibling in the same directory includes
  // ~DEFAULT_BRANCH, which governs `main` on the same repository. A check that
  // flagged it too would be reporting a convention as a defect, and the
  // report would be noise an operator learns to ignore.
  it("passes for a ruleset that governs the default branch", async () => {
    const result = await finding(
      [ruleset(LIVE_RULESET, [DEFAULT_PATTERN])],
      ONLY_DEFAULT
    );

    expect(result.status).toBe("pass");
    expect(result.reason).not.toContain(LIVE_RULESET);
  });

  it("names only the ruleset that governs nothing when both are live", async () => {
    const result = await finding(
      [
        ruleset(DEAD_RULESET, [DEAD_PATTERN]),
        ruleset(LIVE_RULESET, [DEFAULT_PATTERN]),
      ],
      ONLY_DEFAULT
    );

    expect(result.status).toBe("fail");
    expect(result.reason).toContain(DEAD_RULESET);
    expect(result.reason).not.toContain(LIVE_RULESET);
  });

  // FAIL CLOSED, and the distinction #3030 drew between unreadable and absent
  // applied here: a branch list this run could not read is not a repository
  // with no branches, and reporting the second would name every ruleset in the
  // repository.
  it("warns rather than failing when the branches cannot be listed", async () => {
    const result = await finding(
      [ruleset(DEAD_RULESET, [DEAD_PATTERN])],
      undefined
    );

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("Unproven");
    expect(result.reason).toContain("an unread branch list is not an empty");
  });

  it("warns rather than passing when the rulesets cannot be read", async () => {
    const result = await finding(undefined, ONLY_DEFAULT);

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("Unproven");
  });

  // A token without the ruleset scope, an organization-level ruleset this
  // reader cannot see, and a repository with no protection all arrive here as
  // zero rows. This run inspected nothing rather than finding nothing.
  it("warns rather than passing when the repository reports no rulesets", async () => {
    const result = await finding([], ONLY_DEFAULT);

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("inspected nothing rather than finding");
  });

  it("warns when a ruleset uses a pattern the detector does not model", async () => {
    const result = await finding(
      [ruleset("unmodelled", ["refs/heads/re[a-z]*"])],
      ONLY_DEFAULT
    );

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("unmodelled");
  });

  // ~DEFAULT_BRANCH is the entry most rulesets rely on, so a default branch
  // that could not be resolved decides the whole verdict from a guess.
  it("warns when the default branch could not be resolved", async () => {
    const result = await finding([ruleset("base", [DEFAULT_PATTERN])], {
      branches: ["main"],
      defaultBranch: undefined,
    });

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("base");
  });

  it("warns rather than passing when the shipped detector is unavailable", async () => {
    const result = await finding(
      [ruleset(DEAD_RULESET, [DEAD_PATTERN])],
      ONLY_DEFAULT,
      await emptyRoot()
    );

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("detector could not be located");
  });

  it("warns when no GitHub repository is configured", async () => {
    const result = await rulesetReachFinding(
      LISA_ROOT,
      LISA_ROOT,
      {},
      async () => [],
      async () => ONLY_DEFAULT,
      1_000,
      new AbortController().signal
    );

    expect(result.status).toBe(WARN);
    expect(result.reason).toContain("no GitHub repository is configured");
  });
});
