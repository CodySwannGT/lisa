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
 * Two kinds of test live here. The text pins assert every generated copy
 * carries the check. The executed cases run step 4's own command block,
 * extracted from the source skill, against a scratch remote and assert its
 * tri-state exit status: 0 present, 1 absent, anything else a failed check.
 * The ready-gate cases are a test-local model of S13's rule applied to those
 * real exit statuses; they prove the command's statuses are sufficient to
 * decide the gate, not that an agent applies the prose — that remains
 * agent-executed text, pinned only by the text tests.
 * @module tests/unit/strategies/shipped-prerequisite-check
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import {
  CHECK_NAME,
  commandBlock,
  DEFAULT_BRANCH,
  gateS13,
  git,
  NESTED_NOT_SHIPPED,
  NESTED_SHIPPED,
  PRESENT_FILE,
  read,
  READY_RULES,
  SKILL_ROOTS,
  stepFour,
  TRI_STATE,
  VALIDATORS,
} from "./shipped-prerequisite-check-helpers.js";

describe.each(SKILL_ROOTS)("shipped-prerequisite check text (%s)", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);

  it("step 4 verifies shipped claims on the default branch and links blockers", () => {
    const step = stepFour(skill("lisa-task-decomposition"));
    const flat = step.replace(/\s+/g, " ");
    expect(step.toLowerCase()).toContain(CHECK_NAME);
    expect(step).toContain("is blocked by");
    expect(step).toContain("git grep -F -n -w");
    expect(step).toContain("git rev-parse --verify -q");
    expect(step).toContain("':(exclude,glob)**/tests/**'");
    expect(step).toContain("+refs/heads/$default:refs/remotes/origin/$default");
    expect(step).toContain("gh repo view --json defaultBranchRef");
    expect(flat).toContain(TRI_STATE);
    expect(flat).toContain("handler symbol or file");
    expect(flat).not.toContain("endpoint");
    expect(step).toContain("stale-state-claims");
    expect(step).toContain("empirical-inquiry");
  });

  it.each(VALIDATORS)(
    "%s S13 points at step 4 and states the tri-state",
    validator => {
      const s13 = gateS13(skill(validator));
      const flat = s13.replace(/\s+/g, " ");
      expect(s13.toLowerCase()).toContain(CHECK_NAME);
      expect(s13).toContain("origin/<default>");
      expect(s13).toContain("`lisa-task-decomposition` step 4");
      expect(flat).toContain(TRI_STATE);
      expect(s13).toContain("FAIL");
      // The commands live once, in step 4; the validators only point at them.
      expect(s13).not.toContain("git grep");
      expect(s13).not.toContain("git cat-file");
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

/** S13's verdict for a leaf. */
interface GateVerdict {
  readonly verdict: "PASS" | "FAIL" | "ERROR";
  readonly unlinked: readonly string[];
  readonly errored: readonly string[];
}

describe("the step 4 command block, executed (source)", () => {
  const block = commandBlock(
    read("plugins/src/base/skills/lisa-task-decomposition/SKILL.md")
  );
  const symbolLine = block.find(line => line.startsWith("git grep")) ?? "";
  const fileLine = block.find(line => line.startsWith("git cat-file")) ?? "";
  let root = "";
  let clone = "";
  let fakeBin = "";

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

  /**
   * Write a file, creating its directory.
   * @param file - Absolute path
   * @param body - Contents
   */
  const put = (file: string, body: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };

  /**
   * Clone the fixture remote.
   * @param name - Directory name under the scratch root
   * @param extra - Extra clone arguments
   * @returns The clone path
   */
  const cloneRemote = (name: string, ...extra: string[]): string => {
    const dir = path.join(root, name);
    git(root, "clone", "--quiet", ...extra, path.join(root, "remote.git"), dir);
    return dir;
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "shipped-prereq-"));
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    git(root, "init", "--quiet", "--bare", "-b", DEFAULT_BRANCH, remote);
    mkdirSync(seed);
    git(seed, "init", "--quiet", "-b", DEFAULT_BRANCH);
    put(
      path.join(seed, PRESENT_FILE),
      "export const presentResolver = () => 1;\n" +
        "export const QueryXcreateUser = 1;\n" +
        "Mutation.updateUser = () => 2;\n"
    );
    put(
      path.join(seed, "wiki/plan.md"),
      "We will add `wikiOnlyResolver` soon.\n"
    );
    put(
      path.join(seed, "tests/resolvers.test.ts"),
      "it('testOnlyResolver', () => {});\n"
    );
    for (const [file, symbol] of [...NESTED_NOT_SHIPPED, NESTED_SHIPPED]) {
      put(path.join(seed, file), `const ${symbol} = 1;\n`);
    }
    commitAll(seed, "seed");
    git(seed, "push", "--quiet", remote, DEFAULT_BRANCH);
    clone = cloneRemote("clone");
    // A local, unpushed commit: the check must read the remote default
    // branch, not the working tree, so this must still count as absent.
    put(
      path.join(clone, "src/mutations.ts"),
      "export const absentMutationRoot = {};\n"
    );
    commitAll(clone, "local only");
    // A `gh` stand-in: prints FAKE_GH_DEFAULT, or fails when it is empty.
    fakeBin = path.join(root, "bin");
    put(
      path.join(fakeBin, "gh"),
      '#!/bin/sh\n[ -n "$FAKE_GH_DEFAULT" ] || exit 1\necho "$FAKE_GH_DEFAULT"\n'
    );
    chmodSync(path.join(fakeBin, "gh"), 0o755);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Where and how to run one check. */
  interface CheckOptions {
    readonly cwd?: string;
    readonly ghDefault?: string;
  }

  /**
   * Run step 4's whole block for one claim, minus the line for the other kind.
   * @param claim - The shipped claim
   * @param options - Clone to run in, and what the `gh` stand-in reports
   * @returns The block's exit status
   */
  const check = (
    claim: ShippedClaim,
    options: CheckOptions = {}
  ): number | null => {
    if (symbolLine === "" || fileLine === "") {
      throw new Error("step 4 carries no shipped-prerequisite command block");
    }
    const skip = claim.kind === "symbol" ? fileLine : symbolLine;
    const script = block.filter(line => line !== skip).join("\n");
    return boundedSpawnSync({
      label: "shipped-prerequisite check block",
      command: "/bin/bash",
      args: ["-c", script],
      cwd: options.cwd ?? clone,
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: root,
        GIT_CONFIG_NOSYSTEM: "1",
        FAKE_GH_DEFAULT: options.ghDefault ?? "",
        SYMBOL: claim.name,
        FILE: claim.name,
      },
    }).status;
  };

  /**
   * A test-local model of S13 over real exit statuses: an absent claim needs
   * an `is blocked by` link to its owner; a failed check is never absent.
   * @param leaf - The fixture leaf
   * @param options - How to run each check
   * @returns ERROR when any check failed, else FAIL with unlinked claims, else PASS
   */
  const classify = (leaf: Leaf, options: CheckOptions = {}): GateVerdict => {
    const results = leaf.claims.map(claim => ({
      claim,
      status: check(claim, options),
    }));
    const errored = results
      .filter(r => r.status !== 0 && r.status !== 1)
      .map(r => r.claim.name);
    const unlinked = results
      .filter(r => r.status === 1)
      .filter(
        r =>
          r.claim.owner === undefined || !leaf.blockedBy.includes(r.claim.owner)
      )
      .map(r => r.claim.name);
    if (errored.length > 0) return { verdict: "ERROR", unlinked, errored };
    return {
      verdict: unlinked.length === 0 ? "PASS" : "FAIL",
      unlinked,
      errored,
    };
  };

  const claims: readonly ShippedClaim[] = [
    { kind: "symbol", name: "presentResolver" },
    { kind: "symbol", name: "absentMutationRoot", owner: "ITEM-2" },
    { kind: "file", name: PRESENT_FILE },
  ];

  it("exits 0 for a symbol and a file on the default branch", () => {
    expect(check({ kind: "symbol", name: "presentResolver" })).toBe(0);
    expect(check({ kind: "file", name: PRESENT_FILE })).toBe(0);
  });

  it("exits 1 for a symbol only committed locally, and a missing file", () => {
    expect(check({ kind: "symbol", name: "absentMutationRoot" })).toBe(1);
    expect(check({ kind: "file", name: "src/mutations.ts" })).toBe(1);
  });

  it("matches whole words only", () => {
    expect(check({ kind: "symbol", name: "presentResolve" })).toBe(1);
  });

  it("matches a dotted name literally", () => {
    expect(check({ kind: "symbol", name: "Mutation.updateUser" })).toBe(0);
    expect(check({ kind: "symbol", name: "Query.createUser" })).toBe(1);
  });

  it.each(NESTED_NOT_SHIPPED)(
    "does not count a hit only in %s as shipped, at any depth",
    (_file, symbol) => {
      expect(check({ kind: "symbol", name: symbol })).toBe(1);
    }
  );

  it("counts a hit in nested shipped source as present", () => {
    expect(check({ kind: "symbol", name: NESTED_SHIPPED[1] })).toBe(0);
  });

  it("does not count a hit only in wiki or tests as shipped", () => {
    expect(check({ kind: "symbol", name: "wikiOnlyResolver" })).toBe(1);
    expect(check({ kind: "symbol", name: "testOnlyResolver" })).toBe(1);
  });

  it("falls back to gh when origin/HEAD is unset", () => {
    const dir = cloneRemote("no-head");
    git(dir, "remote", "set-head", "origin", "-d");
    expect(
      check(
        { kind: "symbol", name: "presentResolver" },
        { cwd: dir, ghDefault: DEFAULT_BRANCH }
      )
    ).toBe(0);
  });

  it("recreates a missing remote-tracking ref with the explicit refspec", () => {
    const dir = cloneRemote("no-tracking", "--single-branch");
    git(dir, "remote", "set-head", "origin", "-d");
    git(dir, "update-ref", "-d", `refs/remotes/origin/${DEFAULT_BRANCH}`);
    expect(
      check(
        { kind: "file", name: PRESENT_FILE },
        { cwd: dir, ghDefault: DEFAULT_BRANCH }
      )
    ).toBe(0);
  });

  it("exits outside {0,1} when the default branch cannot be resolved", () => {
    const dir = cloneRemote("unresolvable");
    git(dir, "remote", "set-head", "origin", "-d");
    const symbol = check(
      { kind: "symbol", name: "presentResolver" },
      { cwd: dir }
    );
    const file = check({ kind: "file", name: PRESENT_FILE }, { cwd: dir });
    expect([0, 1]).not.toContain(symbol);
    expect([0, 1]).not.toContain(file);
  });

  it("fails the ready gate for an absent prerequisite with no blocker link", () => {
    expect(classify({ claims, blockedBy: [] })).toEqual({
      verdict: "FAIL",
      unlinked: ["absentMutationRoot"],
      errored: [],
    });
  });

  it("passes once the owning item is linked as `is blocked by`", () => {
    expect(classify({ claims, blockedBy: ["ITEM-2"] })).toEqual({
      verdict: "PASS",
      unlinked: [],
      errored: [],
    });
  });

  it("reports a failed check as ERROR, never as absent", () => {
    const dir = cloneRemote("gate-error");
    git(dir, "remote", "set-head", "origin", "-d");
    expect(classify({ claims, blockedBy: [] }, { cwd: dir })).toEqual({
      verdict: "ERROR",
      unlinked: [],
      errored: ["presentResolver", "absentMutationRoot", PRESENT_FILE],
    });
  });
});
