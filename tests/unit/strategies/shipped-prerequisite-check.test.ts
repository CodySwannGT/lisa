/**
 * Contract for the shipped-prerequisite check (CodySwannGT/lisa#4761).
 *
 * A leaf's description said two prerequisites had already shipped — a
 * resolver and a mutation root another item was to deliver. Neither was on the
 * default branch, decomposition linked no `is blocked by` relation, and the
 * gap surfaced mid-build. Ticket text written ahead of delivery is a claim,
 * not a fact, so `lisa-task-decomposition` step 4 and the validators' S13 now
 * verify every prerequisite a leaf calls shipped against `origin/<default>`
 * and require an `is blocked by` link to the owning item for each one absent.
 *
 * These tests pin the text in every generated copy and execute the exact
 * command block step 4 prescribes against a scratch remote, then feed its
 * verdicts through a ready-gate classification of a fixture leaf.
 * @module tests/unit/strategies/shipped-prerequisite-check
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GIT_BIN } from "../../support/git-executable.js";

/** Every skill root a runtime reads: the source plus each projection. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const VALIDATORS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

/** Every checked-in copy of the definition-of-ready rule. */
const READY_RULES = [
  "plugins/src/base/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-copilot/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-devin/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-cursor/rules/work-item-definition-of-ready-reference.mdc",
] as const;

const CHECK_NAME = "shipped-prerequisite check";
const BLOCK_MARKER = "# shipped-prerequisite check";
/** A file the fixture remote ships on its default branch. */
const PRESENT_FILE = "src/resolvers.ts";

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * The step 4 command block from a decomposition skill copy.
 * @param skill - The skill text
 * @returns The block's lines, or an empty list when absent
 */
const commandBlock = (skill: string): readonly string[] =>
  (
    new RegExp(
      `\`\`\`bash\\n[ ]*(${BLOCK_MARKER}[\\s\\S]*?)\\n[ ]*\`\`\``
    ).exec(skill)?.[1] ?? ""
  )
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");

/**
 * Text of step 4 "Map Dependencies" in a decomposition skill copy.
 * @param skill - The skill text
 * @returns Step 4 up to step 4.5
 */
const stepFour = (skill: string): string =>
  skill.split("### 4. Map Dependencies")[1]?.split("### 4.5.")[0] ?? "";

/**
 * Text of the S13 gate definition in a validator copy.
 * @param skill - The validator text
 * @returns S13 up to S14
 */
const gateS13 = (skill: string): string =>
  skill.split("#### S13 — Relationship Search")[1]?.split("#### S14")[0] ?? "";

describe.each(SKILL_ROOTS)("shipped-prerequisite check text (%s)", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);

  it("step 4 verifies shipped claims on the default branch and links blockers", () => {
    const step = stepFour(skill("lisa-task-decomposition"));
    expect(step.toLowerCase()).toContain(CHECK_NAME);
    expect(step).toContain("is blocked by");
    expect(step).toContain("git symbolic-ref --short refs/remotes/origin/HEAD");
    expect(step).toContain("git grep -n -w");
    expect(step).toContain("git cat-file -e");
    expect(step).toContain("stale-state-claims");
    expect(step).toContain("empirical-inquiry");
    expect(commandBlock(skill("lisa-task-decomposition")).length).toBe(5);
  });

  it.each(VALIDATORS)(
    "%s S13 fails an absent prerequisite without a blocker",
    validator => {
      const s13 = gateS13(skill(validator));
      expect(s13.toLowerCase()).toContain(CHECK_NAME);
      expect(s13).toContain("origin/<default>");
      expect(s13).toContain("FAIL");
    }
  );
});

describe.each(READY_RULES)("definition of ready (%s)", rulePath => {
  it("names the shipped-prerequisite check under S13", () => {
    const rule = read(rulePath).replace(/\s+/g, " ");
    expect(rule.toLowerCase()).toContain(CHECK_NAME);
    expect(rule).toContain("S13");
  });
});

/** A prerequisite a leaf's text calls already shipped. */
interface ShippedClaim {
  /** `symbol` is checked with git grep, `file` with git cat-file. */
  readonly kind: "symbol" | "file";
  /** The symbol name or repo-relative path. */
  readonly name: string;
  /** The item that owns delivering it, when one exists. */
  readonly owner?: string;
}

/** A fixture leaf: its shipped claims and its `is blocked by` links. */
interface Leaf {
  readonly claims: readonly ShippedClaim[];
  readonly blockedBy: readonly string[];
}

describe("the step 4 command block, executed (source)", () => {
  const block = commandBlock(
    read("plugins/src/base/skills/lisa-task-decomposition/SKILL.md")
  );
  const prelude = block.filter(
    line => line.startsWith("default=") || line.startsWith("git fetch")
  );
  const symbolLine = block.find(line => line.startsWith("git grep")) ?? "";
  const fileLine = block.find(line => line.startsWith("git cat-file")) ?? "";
  let root = "";
  let clone = "";

  /**
   * Run git in a directory, failing the test on error.
   * @param cwd - Working directory
   * @param args - git arguments
   */
  const git = (cwd: string, ...args: string[]): void => {
    const out = spawnSync(GIT_BIN, args, { cwd, encoding: "utf8" });
    if (out.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${out.stderr}`);
    }
  };

  /**
   * Stage everything and commit it under a throwaway identity.
   * @param cwd - Repository root
   * @param message - Commit message
   */
  const commitAll = (cwd: string, message: string): void => {
    git(cwd, "add", ".");
    git(
      cwd,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "--quiet",
      "-m",
      message
    );
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "shipped-prereq-"));
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    clone = path.join(root, "clone");
    git(root, "init", "--quiet", "--bare", "-b", "trunk", remote);
    mkdirSync(seed);
    git(seed, "init", "--quiet", "-b", "trunk");
    mkdirSync(path.join(seed, "src"));
    writeFileSync(
      path.join(seed, PRESENT_FILE),
      "export const presentResolver = () => 1;\n"
    );
    commitAll(seed, "seed");
    git(seed, "push", "--quiet", remote, "trunk");
    git(root, "clone", "--quiet", remote, clone);
    // A local, unpushed commit: the check must read the remote default
    // branch, not the working tree, so this must still count as absent.
    writeFileSync(
      path.join(clone, "src/mutations.ts"),
      "export const absentMutationRoot = {};\n"
    );
    commitAll(clone, "local only");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Run the prescribed check for one claim from the clone.
   * @param claim - The shipped claim
   * @returns The command's exit status
   */
  const check = (claim: ShippedClaim): number | null => {
    if (symbolLine === "" || fileLine === "") {
      throw new Error("step 4 carries no shipped-prerequisite command block");
    }
    return spawnSync(
      "/bin/bash",
      [
        "-c",
        [...prelude, claim.kind === "symbol" ? symbolLine : fileLine].join(
          "\n"
        ),
      ],
      {
        cwd: clone,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: root,
          GIT_CONFIG_NOSYSTEM: "1",
          SYMBOL: claim.name,
          FILE: claim.name,
        },
      }
    ).status;
  };

  /**
   * The ready-gate verdict for a leaf: every claim absent from the default
   * branch must carry an `is blocked by` link to its owning item.
   * @param leaf - The fixture leaf
   * @returns PASS, or FAIL with the unlinked absent claims
   */
  const classify = (
    leaf: Leaf
  ): { verdict: "PASS" | "FAIL"; unlinked: readonly string[] } => {
    const unlinked = leaf.claims
      .filter(claim => check(claim) !== 0)
      .filter(
        claim =>
          claim.owner === undefined || !leaf.blockedBy.includes(claim.owner)
      )
      .map(claim => claim.name);
    return { verdict: unlinked.length === 0 ? "PASS" : "FAIL", unlinked };
  };

  const claims: readonly ShippedClaim[] = [
    { kind: "symbol", name: "presentResolver" },
    { kind: "symbol", name: "absentMutationRoot", owner: "ITEM-2" },
    { kind: "file", name: PRESENT_FILE },
  ];

  it("carries the prelude, symbol and file commands", () => {
    expect(prelude).toHaveLength(2);
    expect(symbolLine).toContain('"$SYMBOL"');
    expect(fileLine).toContain("$FILE");
  });

  it("exits 0 for a symbol and a file on the default branch", () => {
    expect(check({ kind: "symbol", name: "presentResolver" })).toBe(0);
    expect(check({ kind: "file", name: PRESENT_FILE })).toBe(0);
  });

  it("exits non-zero for a symbol only committed locally, and a missing file", () => {
    expect(check({ kind: "symbol", name: "absentMutationRoot" })).not.toBe(0);
    expect(check({ kind: "file", name: "src/mutations.ts" })).not.toBe(0);
  });

  it("matches whole words only", () => {
    expect(check({ kind: "symbol", name: "presentResolve" })).not.toBe(0);
  });

  it("fails the ready gate for an absent prerequisite with no blocker link", () => {
    expect(classify({ claims, blockedBy: [] })).toEqual({
      verdict: "FAIL",
      unlinked: ["absentMutationRoot"],
    });
  });

  it("passes once the owning item is linked as `is blocked by`", () => {
    expect(classify({ claims, blockedBy: ["ITEM-2"] })).toEqual({
      verdict: "PASS",
      unlinked: [],
    });
  });
});
