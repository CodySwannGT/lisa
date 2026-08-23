/**
 * Unit tests for scripts/check-delivery-deletion-conflicts.mjs (issue #2714).
 *
 * Lisa builds a consumer's tree from two manifests nobody ever compared: the
 * delivery lanes (`<stack>/create-only/`, `<stack>/copy-overwrite/`, …) and the
 * deletion manifests (`<stack>/deletions.json`). A path in both is created and
 * then destroyed inside one `apply`, silently, because deletions run after
 * every lane and are unconditional.
 *
 * 52 released tags carried at least one such contradiction — among them
 * `all/copy-overwrite/.claude/rules/coding-philosophy.md` against
 * `all/deletions.json` for 32 consecutive releases, and `all` is active for
 * every project. Each was found by hand, later, by someone who noticed a file
 * refusing to stay put.
 *
 * Two of these tests carry more weight than the rest:
 *
 *   - `the live repository has no conflicts` is the gate itself. It is what
 *     turns this file from documentation into enforcement.
 *   - the two constants-agree tests are the anti-drift arm. Both `STACK_PARENT`
 *     and `DELIVERY_LANES` restate something `src/core/config.ts` owns. Adding
 *     a stack or a strategy there without updating the script would silently
 *     shrink the gate's reach rather than fail anything, which is the same
 *     fail-open shape the gate exists to remove.
 *
 * The exit-2 case matters for the same reason: a gate that scans nothing, or
 * that meets a manifest it cannot parse, has to say so rather than report a
 * clean run.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED rather than
 * computed by calling the functions under test.
 *
 * @module tests/unit/scripts/check-delivery-deletion-conflicts
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  COPY_STRATEGIES,
  PROJECT_TYPE_HIERARCHY,
} from "../../../src/core/config.js";
import {
  DELIVERY_LANES,
  STACK_PARENT,
  ancestryChain,
  classifyRelation,
  destinationPath,
  effectiveDeletions,
  findConflicts,
  matchDeletion,
  parseArgs,
} from "../../../scripts/check-delivery-deletion-conflicts.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve("scripts/check-delivery-deletion-conflicts.mjs");
const GIT = resolveGit();
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The one strategy whose source filename differs from its destination. */
const PACKAGE_LISA_STRATEGY = "package-lisa";

/** Stack names used throughout, as literals the linter counts. */
const TYPESCRIPT = "typescript";
const CDK = "cdk";
const EXPO = "expo";

/** A path the typescript stack ships and cdk deletes — the worked override. */
const INHERITED_JEST_LOCAL = "jest.config.local.ts";

/** Relation names the classifier returns. */
const ANCESTOR_DELETES = "ancestor-deletes";

/** The lane used for most fixtures. */
const CREATE_ONLY = "create-only";

/** A deletions manifest path used in the direct-call cases. */
const MANIFEST_LABEL = "x/deletions.json";

/** A probe path for a lane fixture. */
const PROBE = "probe.txt";

/** Body for a fixture file; the gate never reads contents, only paths. */
const BODY = "x\n";

/** A directory entry and a file nested beneath it. */
const DELETED_DIR = ".claude/skills/jira-create";

/**
 * Sort strings deterministically. A bare `.sort()` is lexicographic by UTF-16
 * code unit, which SonarCloud rates a bug in its own right.
 * @param values - the strings to order.
 * @returns A new array in locale order.
 */
function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Create a temporary git repository with `files` written and committed. The
 * gate reads `git ls-files`, so an uncommitted file is invisible to it — which
 * is deliberate, and means these fixtures must be committed to be seen.
 * @param files - relative path to file contents.
 * @returns The absolute repository root.
 */
function tempRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2714-"));
  const env = cleanGitEnv(process.env);
  const entries = Object.entries(files);
  const git = (...args: readonly string[]): void => {
    boundedExecFileSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT,
      args,
      cwd: root,
      env,
      stdio: "ignore",
    });
  };
  roots.push(root);
  for (const [relative, content] of entries) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  if (entries.length > 0) {
    git("add", "-A");
    git("commit", "-q", "-m", "seed");
  }
  return root;
}

/**
 * Run the CLI and capture its exit code plus output.
 * @param args - CLI arguments after the script path.
 * @returns The exit code, stdout, and stderr text.
 */
function run(args: readonly string[]): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = boundedExecFileSync({
      label: "check-delivery-deletion-conflicts.mjs",
      command: process.execPath,
      args: [SCRIPT, ...args],
    });
    return { code: 0, stderr: "", stdout };
  } catch (error) {
    const e = error as { exitCode?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.exitCode === "number" ? e.exitCode : -1,
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
    };
  }
}

/**
 * Serialize a deletions manifest.
 * @param paths - entries for `paths`.
 * @param keep - entries for `keep`.
 * @returns The manifest JSON text.
 */
function manifest(
  paths: readonly string[],
  keep: readonly string[] = []
): string {
  return `${JSON.stringify({ keep, paths }, null, 2)}\n`;
}

describe("the live repository", () => {
  it("has no path that is both delivered and deleted in the same apply", () => {
    const result = run(["--root", REPO_ROOT]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  it("still ships the deliberate child-overrides-parent overrides", () => {
    // CDK inherits typescript/create-only, which ships jest.config.local.ts,
    // and cdk/deletions.json then removes it. That override is the documented
    // design (see loadPendingDeletions), so the gate must REPORT it without
    // failing. A gate that could not tell it apart from a real conflict would
    // have to be switched off on its first day.
    const report = JSON.parse(run(["--root", REPO_ROOT, "--json"]).stdout);
    expect(report.summary.violations).toBe(0);
    expect(
      report.conflicts.some(
        (row: Record<string, string>) =>
          row.shipper === TYPESCRIPT &&
          row.deleter === CDK &&
          row.destination === INHERITED_JEST_LOCAL &&
          row.relation === "descendant-deletes"
      )
    ).toBe(true);
  });
});

describe("constants agree with src/core/config.ts", () => {
  it("STACK_PARENT matches PROJECT_TYPE_HIERARCHY", () => {
    // Restating the hierarchy in .mjs is the price of a dependency-free gate.
    // Drift would not fail anything at runtime; it would quietly stop
    // classifying a stack, so the gate would pass a conflict it can no longer
    // see. This assertion is the only thing standing between those two.
    expect({ ...STACK_PARENT }).toEqual({ ...PROJECT_TYPE_HIERARCHY });
  });

  it("DELIVERY_LANES covers every copy strategy", () => {
    expect(sorted(DELIVERY_LANES)).toEqual(sorted(COPY_STRATEGIES));
  });
});

describe("ancestryChain", () => {
  it("walks a child stack up to the implicit root", () => {
    expect(ancestryChain(CDK)).toEqual([CDK, TYPESCRIPT, "all"]);
  });

  it("gives a rootless stack just itself and all", () => {
    expect(ancestryChain("rails")).toEqual(["rails", "all"]);
  });

  it("does not append all to all", () => {
    expect(ancestryChain("all")).toEqual(["all"]);
  });
});

describe("classifyRelation", () => {
  it("calls a stack deleting its own shipped path self", () => {
    expect(classifyRelation(TYPESCRIPT, TYPESCRIPT)).toBe("self");
  });

  it("calls a parent deleting a child's path ancestor-deletes", () => {
    expect(classifyRelation(EXPO, TYPESCRIPT)).toBe(ANCESTOR_DELETES);
  });

  it("treats all as an ancestor of every stack", () => {
    expect(classifyRelation("rails", "all")).toBe(ANCESTOR_DELETES);
  });

  it("calls a child deleting a parent's path descendant-deletes", () => {
    expect(classifyRelation(TYPESCRIPT, CDK)).toBe("descendant-deletes");
  });

  it("calls two siblings unrelated", () => {
    expect(classifyRelation(EXPO, CDK)).toBe("unrelated");
  });
});

describe("effectiveDeletions", () => {
  it("is paths minus keep", () => {
    const result = effectiveDeletions(
      { keep: ["b.txt"], paths: ["a.txt", "b.txt", "c.txt"] },
      MANIFEST_LABEL
    );
    expect(sorted([...result])).toEqual(["a.txt", "c.txt"]);
  });

  it("treats a missing keep as empty", () => {
    const result = effectiveDeletions({ paths: ["a.txt"] }, MANIFEST_LABEL);
    expect([...result]).toEqual(["a.txt"]);
  });

  it("throws rather than returning an empty set for a non-object", () => {
    // The runtime parser answers [] here, which is right for apply — a bad
    // manifest must not block a strategy. It is wrong for a GATE: an empty set
    // is indistinguishable from "no conflicts" and the check would pass by
    // having looked at nothing.
    expect(() => effectiveDeletions(null, MANIFEST_LABEL)).toThrow(
      "expected a JSON object"
    );
  });

  it("throws when paths is not an array of strings", () => {
    expect(() =>
      effectiveDeletions({ paths: ["a.txt", 7] }, MANIFEST_LABEL)
    ).toThrow('"paths" must be an array of strings');
  });

  it("throws when keep is not an array of strings", () => {
    expect(() =>
      effectiveDeletions({ keep: "a.txt", paths: [] }, MANIFEST_LABEL)
    ).toThrow('"keep" must be an array of strings');
  });
});

describe("matchDeletion", () => {
  it("matches an exact entry", () => {
    expect(matchDeletion("a/b.txt", new Set(["a/b.txt"]))).toEqual({
      kind: "exact",
    });
  });

  it("matches a file nested under a deleted directory", () => {
    // The runtime's pre-pass compares by exact string, so it does NOT suppress
    // delivery here — but processDeletions still removes the whole directory
    // afterwards. Same create-then-destroy defect, different spelling.
    expect(
      matchDeletion(`${DELETED_DIR}/SKILL.md`, new Set([DELETED_DIR]))
    ).toEqual({ entry: DELETED_DIR, kind: "under-dir" });
  });

  it("does not match a sibling with a shared prefix", () => {
    expect(matchDeletion("a/bc.txt", new Set(["a/b"]))).toBeNull();
  });

  it("returns null when the path survives", () => {
    expect(matchDeletion("a/b.txt", new Set(["c/d.txt"]))).toBeNull();
  });
});

describe("destinationPath", () => {
  it("translates package.lisa.json to package.json", () => {
    expect(destinationPath(PACKAGE_LISA_STRATEGY, "package.lisa.json")).toBe(
      "package.json"
    );
  });

  it("is the identity for every other lane", () => {
    expect(destinationPath(CREATE_ONLY, INHERITED_JEST_LOCAL)).toBe(
      INHERITED_JEST_LOCAL
    );
  });
});

describe("findConflicts", () => {
  it("reports the relation for each delivered-and-deleted path", () => {
    const rows = findConflicts({
      deletions: new Map([[TYPESCRIPT, new Set(["a.txt"])]]),
      delivered: new Map([[TYPESCRIPT, new Map([["a.txt", CREATE_ONLY]])]]),
    });
    expect(rows).toEqual([
      {
        deleter: TYPESCRIPT,
        destination: "a.txt",
        lane: CREATE_ONLY,
        match: "exact",
        relation: "self",
        shipper: TYPESCRIPT,
      },
    ]);
  });

  it("reports nothing when no delivered path is deleted", () => {
    const rows = findConflicts({
      deletions: new Map([[TYPESCRIPT, new Set(["b.txt"])]]),
      delivered: new Map([[TYPESCRIPT, new Map([["a.txt", CREATE_ONLY]])]]),
    });
    expect(rows).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("defaults to the repository root and human output", () => {
    expect(parseArgs([])).toEqual({ json: false, root: REPO_ROOT });
  });

  it("accepts --json and --root", () => {
    const relative = "some/where";
    expect(parseArgs(["--json", "--root", relative])).toEqual({
      json: true,
      root: path.resolve(relative),
    });
  });

  it("rejects --root without a value", () => {
    expect(() => parseArgs(["--root", "--json"])).toThrow(
      "--root requires a value"
    );
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown argument: --nope");
  });
});

describe("the CLI", () => {
  it("exits 1 when one stack ships and deletes the same path", () => {
    const root = tempRepo({
      [`typescript/${CREATE_ONLY}/.github/workflows/claude.yml`]: "name: x\n",
      "typescript/deletions.json": manifest([".github/workflows/claude.yml"]),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `typescript/${CREATE_ONLY}/.github/workflows/claude.yml`
    );
    expect(result.stdout).toContain("typescript/deletions.json");
    expect(result.stdout).toContain("self");
  });

  it("exits 1 when an ancestor stack deletes what a descendant ships", () => {
    const root = tempRepo({
      "all/deletions.json": manifest([PROBE]),
      [`expo/${CREATE_ONLY}/${PROBE}`]: BODY,
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(ANCESTOR_DELETES);
  });

  it("exits 0 when a descendant stack deletes what an ancestor ships", () => {
    const root = tempRepo({
      "cdk/deletions.json": manifest([INHERITED_JEST_LOCAL]),
      [`typescript/${CREATE_ONLY}/${INHERITED_JEST_LOCAL}`]: BODY,
    });
    expect(run(["--root", root]).code).toBe(0);
  });

  it("exits 0 when a kept path is delivered", () => {
    const root = tempRepo({
      [`typescript/${CREATE_ONLY}/${PROBE}`]: BODY,
      "typescript/deletions.json": manifest([PROBE], [PROBE]),
    });
    expect(run(["--root", root]).code).toBe(0);
  });

  it("exits 1 for a file nested under a deleted directory", () => {
    const root = tempRepo({
      [`all/${CREATE_ONLY}/${DELETED_DIR}/SKILL.md`]: BODY,
      "all/deletions.json": manifest([DELETED_DIR]),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`under-dir(${DELETED_DIR})`);
  });

  it("exits 2 rather than passing a scan that found no stacks", () => {
    const root = tempRepo({ "README.md": "# empty\n" });
    const result = run(["--root", root]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Refusing to");
  });

  it("exits 2 rather than passing a manifest it cannot parse", () => {
    const root = tempRepo({
      [`typescript/${CREATE_ONLY}/${PROBE}`]: BODY,
      "typescript/deletions.json": "{ not json\n",
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("could not parse");
  });

  it("exits 2 when --root is not a git repository", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-2714-bare-"));
    roots.push(root);
    expect(run(["--root", root]).code).toBe(2);
  });
});

describe("the gate is wired, not merely present", () => {
  it("has an npm script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );
    expect(pkg.scripts["check:delivery-deletion-conflicts"]).toBe(
      "node scripts/check-delivery-deletion-conflicts.mjs"
    );
  });

  it("runs in CI, where a local hook cannot be skipped", () => {
    // A gate enforced only by a git hook is enforced only for whoever chose to
    // run it. A cloud agent, or any hookless clone, pushes straight past it.
    const workflow = readFileSync(
      path.join(REPO_ROOT, ".github/workflows/plugins-sync.yml"),
      "utf8"
    );
    expect(workflow).toContain("bun run check:delivery-deletion-conflicts");
  });
});
