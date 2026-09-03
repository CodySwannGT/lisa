/**
 * Unit tests for scripts/check-template-workflow-refs.mjs (issue #2702).
 *
 * The headline case: `expo/create-only/.github/workflows/nightly-e2e-report.yml`
 * shipped pinned at `@v2.345.1`, a Lisa version that predates the reusable it
 * calls. A consumer receiving it gets a workflow that cannot LOAD — GitHub runs
 * zero jobs and reports a workflow file issue — so there is no test output and
 * nothing reads as red. It never succeeded once in three scheduled runs across
 * two repos, and stayed byte-identical to the broken template in both, because
 * a workflow that never runs gives nobody a reason to edit it.
 *
 * The two exit-2 cases carry as much weight as the exit-1 case. A gate that
 * scans nothing, or that cannot resolve the ref it was asked about, must say so
 * rather than report a clean run — reproducing the very defect it exists to
 * catch would be the worst possible outcome for this file.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-template-workflow-refs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyRef,
  findWorkflowRefs,
  violatesRefPolicy,
} from "../../../scripts/check-template-workflow-refs.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve("scripts/check-template-workflow-refs.mjs");
const GIT = resolveGit();
const ADD_ALL = ["add", "-A"] as const;

/** A template path the gate recognises: `<lane>/<mode>/.github/workflows/…`. */
const TEMPLATE = "expo/create-only/.github/workflows/nightly-e2e-report.yml";

/** The reusable the template above calls, as it lives in this repository. */
const REUSABLE = ".github/workflows/nightly-e2e-report.yml";

/** Stand-in body for the reusable, so its presence at a ref is what varies. */
const REUSABLE_BODY = "name: reusable\n";

/** A second reusable path, for the multi-reference and folded-scalar cases. */
const REUSABLE_A = ".github/workflows/a.yml";

/** A tag that resolves in the fixture repo, used for the policy cases. */
const PIN_TAG = "v1.0.0";

/**
 * A caller template referencing the reusable at `ref`.
 *
 * @param ref - the git ref to pin in the `uses:` line.
 * @returns The template's YAML text.
 */
function callerTemplate(ref: string): string {
  return [
    "name: 🌙 Nightly E2E Report",
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    "  report:",
    `    uses: CodySwannGT/lisa/${REUSABLE}@${ref}`,
    "",
  ].join("\n");
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Create a temporary git repository with `files` written and committed.
 *
 * @param files - relative path to file contents.
 * @returns The absolute repository root.
 */
function tempRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2702-"));
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
    git(...ADD_ALL);
    git("commit", "-q", "-m", "seed");
  }
  return root;
}

/**
 * Run the CLI and capture its exit code plus combined output.
 *
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
      label: "check-template-workflow-refs.mjs",
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

describe("findWorkflowRefs", () => {
  it("extracts the target and ref with a 1-based line number", () => {
    const refs = findWorkflowRefs(callerTemplate("v2.345.1"));
    expect(refs).toEqual([{ line: 6, ref: "v2.345.1", target: REUSABLE }]);
  });

  it("ignores uses: lines that point at other repositories", () => {
    // Both negative cases stay inside orgs Lisa is allowed to name: a third
    // party (actions/) and this org's OTHER repositories. The gate verifies
    // paths in THIS repository, so a same-org different-repo reference is out
    // of scope in exactly the way a third-party one is.
    const yaml = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: CodySwannGT/not-lisa/.github/workflows/x.yml@main",
    ].join("\n");
    expect(findWorkflowRefs(yaml)).toEqual([]);
  });

  it("finds every reference when one template calls several reusables", () => {
    const yaml = [
      "    uses: CodySwannGT/lisa/.github/workflows/a.yml@main",
      "    uses: CodySwannGT/lisa/.github/workflows/b.yml@v3.1.0",
    ].join("\n");
    expect(findWorkflowRefs(yaml)).toEqual([
      { line: 1, ref: "main", target: REUSABLE_A },
      { line: 2, ref: "v3.1.0", target: ".github/workflows/b.yml" },
    ]);
  });

  it("finds a reference written as a FOLDED scalar, on its own line", () => {
    // A shipped template pinned to a SHA was written this way and was
    // invisible to this gate for its whole life: the per-line scan looked for
    // `uses: CodySwannGT/...` and a folded `uses:` has nothing after the colon,
    // so the file reported ZERO references and passed. A parser that quietly
    // sees nothing is the same false green the gate exists to prevent.
    const yaml = [
      "jobs:",
      "  track:",
      "    uses: >-",
      "      CodySwannGT/lisa/.github/workflows/nightly-e2e-tracking.yml@main",
      "    secrets: inherit",
    ].join("\n");
    expect(findWorkflowRefs(yaml)).toEqual([
      {
        line: 4,
        ref: "main",
        target: ".github/workflows/nightly-e2e-tracking.yml",
      },
    ]);
  });

  it("finds a reference under every block-scalar spelling", () => {
    for (const marker of [">", ">-", ">+", "|", "|-", "|+"]) {
      const yaml = [
        `    uses: ${marker}`,
        "      CodySwannGT/lisa/.github/workflows/a.yml@main",
      ].join("\n");
      expect(findWorkflowRefs(yaml), `spelling ${marker}`).toEqual([
        { line: 2, ref: "main", target: REUSABLE_A },
      ]);
    }
  });

  it("stops a folded scan at the next key rather than reading the whole file", () => {
    // Over-scanning would attribute a LATER job's reference to this one, and
    // report a line number pointing at the wrong job.
    const yaml = [
      "  a:",
      "    uses: >-",
      "      CodySwannGT/lisa/.github/workflows/a.yml@main",
      "  b:",
      "    uses: CodySwannGT/lisa/.github/workflows/b.yml@main",
    ].join("\n");
    expect(findWorkflowRefs(yaml)).toEqual([
      { line: 3, ref: "main", target: REUSABLE_A },
      { line: 5, ref: "main", target: ".github/workflows/b.yml" },
    ]);
  });
});

describe("violatesRefPolicy", () => {
  it("accepts the moving ref", () => {
    expect(violatesRefPolicy({ ref: "main" })).toBe(false);
  });

  it("rejects a tag, which goes stale without ever failing", () => {
    expect(violatesRefPolicy({ ref: "v3.35.0" })).toBe(true);
  });

  it("rejects a SHA, which a history rewrite makes unreachable", () => {
    expect(
      violatesRefPolicy({
        ref: "08628ca0d2db045d3b0d87fcad8e444565836ff9",
      })
    ).toBe(true);
  });

  it("rejects any other branch, so only `main` passes", () => {
    expect(violatesRefPolicy({ ref: "develop" })).toBe(true);
  });
});

describe("classifyRef", () => {
  it("resolves @main against the working tree, needing no history", () => {
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: callerTemplate("main"),
    });
    expect(classifyRef(root, { ref: "main", target: REUSABLE })).toBe("ok");
  });

  it("reports missing when @main names a file that is not there", () => {
    const root = tempRepo({ [TEMPLATE]: callerTemplate("main") });
    expect(classifyRef(root, { ref: "main", target: REUSABLE })).toBe(
      "missing"
    );
  });

  it("reports unverifiable — never ok — for a ref absent from the clone", () => {
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: callerTemplate("v99.99.99"),
    });
    expect(classifyRef(root, { ref: "v99.99.99", target: REUSABLE })).toBe(
      "unverifiable"
    );
  });
});

describe("check-template-workflow-refs CLI", () => {
  it("exits 0 when every reference resolves", () => {
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: callerTemplate("main"),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("all resolve");
  });

  it("exits 1 on the #2702 defect: a pin predating the reusable", () => {
    // The tag exists, and the reusable does not exist at it — the exact shape
    // that ships a workflow which cannot load.
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: callerTemplate("v0.1.0"),
    });
    const env = cleanGitEnv(process.env);
    // Tag a commit that predates the reusable, so the ref resolves but the
    // path does not exist in its tree.
    boundedExecFileSync({
      label: "git rm --cached",
      command: GIT,
      args: ["rm", "-q", "--cached", REUSABLE],
      cwd: root,
      env,
    });
    boundedExecFileSync({
      label: "git commit",
      command: GIT,
      args: ["commit", "-q", "-m", "before the reusable existed"],
      cwd: root,
      env,
    });
    boundedExecFileSync({
      label: "git tag",
      command: GIT,
      args: ["tag", "v0.1.0"],
      cwd: root,
      env,
    });
    boundedExecFileSync({
      label: "git add -A",
      command: GIT,
      args: ADD_ALL,
      cwd: root,
      env,
    });
    boundedExecFileSync({
      label: "git commit",
      command: GIT,
      args: ["commit", "-q", "-m", "restore"],
      cwd: root,
      env,
    });

    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("does not exist at that ref");
  });

  it("exits 1 on a pin that resolves perfectly but does not track @main", () => {
    // The case the gate used to call clean, and the one that matters most: the
    // tag exists, the reusable exists in its tree, so every resolution check
    // passes. It is healthy today and will go stale in silence — which is why
    // resolvability alone was never enough to judge a reference by.
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: callerTemplate(PIN_TAG),
    });
    boundedExecFileSync({
      label: "git tag",
      command: GIT,
      args: ["tag", PIN_TAG],
      cwd: root,
      env: cleanGitEnv(process.env),
    });

    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("must track @main");
    expect(result.stdout).not.toContain("does not exist at that ref");
  });

  it("exits 1 on a folded-scalar pin the line-based scan could not see", () => {
    // Regression guard for the two defects together: the reference is written
    // as a folded scalar AND pinned. Before the parser fix this template
    // reported zero references and the run exited 0.
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: [
        "jobs:",
        "  report:",
        "    uses: >-",
        `      CodySwannGT/lisa/${REUSABLE}@${PIN_TAG}`,
        "",
      ].join("\n"),
    });
    boundedExecFileSync({
      label: "git tag",
      command: GIT,
      args: ["tag", PIN_TAG],
      cwd: root,
      env: cleanGitEnv(process.env),
    });

    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("must track @main");
  });

  it("exits 2 rather than 0 when it discovers no templates at all", () => {
    // The absent-case rule. A scan that examined nothing is a broken
    // invocation, not conformance.
    const root = tempRepo({ "readme.md": "nothing to see\n" });
    const result = run(["--root", root]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no caller templates found");
  });

  it("exits 2 rather than 0 when a pinned ref cannot be resolved", () => {
    // A gate that cannot look must not claim it saw.
    const root = tempRepo({
      [REUSABLE]: REUSABLE_BODY,
      [TEMPLATE]: callerTemplate("v99.99.99"),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("cannot verify");
  });

  it("exits 2 on an unknown flag", () => {
    expect(run(["--nope"]).code).toBe(2);
  });
});
