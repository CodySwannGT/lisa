/**
 * Unit tests for scripts/check-third-party-action-pins.mjs (issue #3585).
 *
 * The headline case: every third-party action this repository used was
 * referenced by a mutable ref — `@master`, `@main`, `@v1` — so the bytes that
 * executed were chosen, at job start, by asking a repository we do not control
 * what its branch or tag points at right now. Thirteen of those selections
 * happened in jobs holding a credential, and five of them were in the reusable
 * workflows the fleet calls live, so a compromised upstream would have run
 * inside every consumer's quality gate on their next run.
 *
 * Two properties carry as much weight as the positive case:
 *
 *   - **The first-party exemption.** A reference to this organisation's own
 *     reusable workflows at `@main` is a deliberate policy with its own
 *     separate argument. A gate that reddens it is the wrong gate and will be
 *     turned off, so "first-party is never flagged, and never even named in
 *     the output" is tested directly, both on a synthetic tree and on this
 *     repository's real one. It is the negative control: it passed before the
 *     pins were applied and it passes after.
 *
 *   - **The empty scan.** A gate that examined nothing must say so rather than
 *     print a tick, because an empty scan and a clean tree otherwise look
 *     identical.
 *
 * `the tree carries no mutable third-party action ref` is the regression test
 * proper. Against the pre-fix tree it failed with 89 findings, naming
 * `.github/workflows/quality.yml:7702` (`snyk/actions/node@master`, holding the
 * Snyk token) among them. A check written after the pins were applied, and only
 * ever seen green, would be evidence of nothing.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-third-party-action-pins
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyOwner,
  evaluateReference,
  findActionRefs,
  isFixtureWorkflow,
  isGovernedWorkflow,
} from "../../../scripts/check-third-party-action-pins.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve("scripts/check-third-party-action-pins.mjs");
const GIT = resolveGit();

/** A workflow path in this repository's own tree. */
const OWN_WORKFLOW = ".github/workflows/quality.yml";

/** A seeded template path: a `create-only` tree lands in a consumer verbatim. */
const TEMPLATE_WORKFLOW = "nestjs/create-only/.github/workflows/deploy.yml";

/** A stand-in 40-hex commit SHA, distinct per fixture so misreads are visible. */
const PINNED_SHA = "0123456789abcdef0123456789abcdef01234567";

/** A stand-in third-party action, and the owner and version it decomposes to. */
const VENDOR = "some-vendor";
const ACTION = `${VENDOR}/some-action`;
const VERSION = "v1.2.3";

/** Owner classifications, spelled once so a typo cannot pass as a pass. */
const FIRST_PARTY = "first-party";
const THIRD_PARTY = "third-party";
const GITHUB_OWNED_KIND = "github-owned";

/** Verdicts the gate returns, spelled once for the same reason. */
const MUTABLE = "mutable-ref";

/** The two `uses:` shapes the CLI cases are built from. */
const PINNED_USES = `${ACTION}@${PINNED_SHA}  # ${VERSION}`;
const BRANCH_USES = `${ACTION}@master`;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * A minimal workflow whose only step is the given `uses:` line.
 *
 * @param usesLine - the reference text after `uses: `, comment included.
 * @returns The workflow's YAML text.
 */
function workflow(usesLine: string): string {
  return [
    "name: Example",
    "on: [pull_request]",
    "jobs:",
    "  example:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: ${usesLine}`,
    "",
  ].join("\n");
}

/**
 * Create a temporary git repository with `files` written and committed.
 *
 * @param files - relative path to file contents.
 * @returns The absolute repository root.
 */
function tempRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3585-"));
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
 * Run the CLI and capture its exit code plus output streams.
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
      label: "check-third-party-action-pins.mjs",
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

describe("classifyOwner", () => {
  it("treats this organisation as first-party", () => {
    expect(classifyOwner("CodySwannGT")).toBe(FIRST_PARTY);
  });

  it("matches the first-party owner case-insensitively", () => {
    // GitHub owners are case-insensitive, so a `uses:` line may spell one
    // either way and the exemption must not depend on the spelling.
    expect(classifyOwner("codyswanngt")).toBe(FIRST_PARTY);
  });

  it("treats GitHub's own namespaces as github-owned", () => {
    expect(classifyOwner("actions")).toBe(GITHUB_OWNED_KIND);
    expect(classifyOwner("github")).toBe(GITHUB_OWNED_KIND);
  });

  it("treats an owner merely containing an exempt name as third-party", () => {
    // The exemption is an owner allowlist, not a substring match: an attacker
    // registering `actions-inc` must not inherit GitHub's exemption.
    expect(classifyOwner("actions-inc")).toBe(THIRD_PARTY);
    expect(classifyOwner("not-actions")).toBe(THIRD_PARTY);
  });

  it("treats anyone else as third-party", () => {
    expect(classifyOwner(VENDOR)).toBe(THIRD_PARTY);
  });
});

describe("findActionRefs", () => {
  it("extracts owner, action, ref and version with a 1-based line number", () => {
    const refs = findActionRefs(
      workflow(`${ACTION}@${PINNED_SHA}  # ${VERSION}`)
    );
    expect(refs).toEqual([
      {
        action: ACTION,
        kind: THIRD_PARTY,
        line: 7,
        owner: VENDOR,
        ref: PINNED_SHA,
        version: VERSION,
      },
    ]);
  });

  it("reports a missing version comment as null, not as empty text", () => {
    const refs = findActionRefs(workflow(`${ACTION}@v1`));
    expect(refs).toEqual([
      {
        action: ACTION,
        kind: THIRD_PARTY,
        line: 7,
        owner: VENDOR,
        ref: "v1",
        version: null,
      },
    ]);
  });

  it("keeps the subpath of an action published in a subdirectory", () => {
    // `snyk/actions/node` is one such: the repository is `snyk/actions` and
    // the action lives under `node/`, so a naive owner/repo split loses it.
    const refs = findActionRefs(workflow("snyk/actions/node@master"));
    expect(refs).toEqual([
      {
        action: "snyk/actions/node",
        kind: THIRD_PARTY,
        line: 7,
        owner: "snyk",
        ref: "master",
        version: null,
      },
    ]);
  });

  it("ignores local and container references, which have no upstream owner", () => {
    const yaml = [
      "    steps:",
      "      - uses: ./.github/actions/local",
      "      - uses: docker://alpine:3.20",
    ].join("\n");
    expect(findActionRefs(yaml)).toEqual([]);
  });
});

describe("evaluateReference", () => {
  it("passes a third-party SHA pin carrying a version comment", () => {
    expect(
      evaluateReference({
        kind: THIRD_PARTY,
        ref: PINNED_SHA,
        version: VERSION,
      })
    ).toBe("ok");
  });

  it("flags a branch ref", () => {
    expect(
      evaluateReference({ kind: THIRD_PARTY, ref: "master", version: null })
    ).toBe(MUTABLE);
  });

  it("flags a floating major tag", () => {
    expect(
      evaluateReference({ kind: THIRD_PARTY, ref: "v1", version: null })
    ).toBe(MUTABLE);
  });

  it("flags a full-version tag, which is force-movable like any other", () => {
    expect(
      evaluateReference({ kind: THIRD_PARTY, ref: "v0.9.0", version: null })
    ).toBe(MUTABLE);
  });

  it("flags an abbreviated SHA, which is not an unambiguous object name", () => {
    expect(
      evaluateReference({
        kind: THIRD_PARTY,
        ref: PINNED_SHA.slice(0, 12),
        version: VERSION,
      })
    ).toBe(MUTABLE);
  });

  it("flags a SHA pinned with no version comment as unmaintainable", () => {
    expect(
      evaluateReference({ kind: THIRD_PARTY, ref: PINNED_SHA, version: null })
    ).toBe("missing-version-comment");
  });

  it("passes a first-party reference on a mutable ref", () => {
    // The negative control at unit granularity. First-party `@main` tracking is
    // a deliberate policy with its own separate argument.
    expect(
      evaluateReference({ kind: FIRST_PARTY, ref: "main", version: null })
    ).toBe("ok");
  });

  it("passes a github-owned reference on a floating major", () => {
    expect(
      evaluateReference({ kind: GITHUB_OWNED_KIND, ref: "v4", version: null })
    ).toBe("ok");
  });
});

describe("workflow file scoping", () => {
  it("governs this repository's own workflows", () => {
    expect(isGovernedWorkflow(OWN_WORKFLOW)).toBe(true);
  });

  it("governs seeded create-only templates, so seeding cannot smuggle one in", () => {
    expect(isGovernedWorkflow(TEMPLATE_WORKFLOW)).toBe(true);
  });

  it("does not govern fixture workflows, which no runner ever executes", () => {
    const fixture =
      "tests/fixtures/duplicate-versions/violation/.github/workflows/quality.yml";
    expect(isGovernedWorkflow(fixture)).toBe(false);
    expect(isFixtureWorkflow(fixture)).toBe(true);
  });

  it("does not govern files outside a .github/workflows directory", () => {
    expect(isGovernedWorkflow("docs/example.yml")).toBe(false);
  });
});

describe("check-third-party-action-pins CLI", () => {
  it("exits 0 when every third-party reference is a SHA with a version", () => {
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(PINNED_USES),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("all pinned to a full commit SHA");
  });

  it("exits 1 and names the file, line and ref of a branch reference", () => {
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(BRANCH_USES),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`${OWN_WORKFLOW}:7`);
    expect(result.stdout).toContain(BRANCH_USES);
    expect(result.stdout).toContain("mutable ref, not a commit SHA");
  });

  it("teaches the fix in its failure output instead of only reddening", () => {
    // A guard that reddens without saying how to comply gets bypassed.
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(`${ACTION}@v1`),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "Pin every third-party action to a full 40-character commit SHA"
    );
    expect(result.stdout).toContain(
      "gh api repos/<owner>/<repo>/commits/<ref> --jq .sha"
    );
  });

  it("bites inside create-only templates, not only .github/workflows", () => {
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(PINNED_USES),
      [TEMPLATE_WORKFLOW]: workflow("other-vendor/other-action@master"),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`${TEMPLATE_WORKFLOW}:7`);
  });

  it("never flags — or names — a first-party reference at @main", () => {
    // The negative control. This assertion held before the pins were applied
    // and holds after; if it ever fails, the gate has grown into #3488's
    // territory and would be switched off rather than obeyed.
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(
        "CodySwannGT/lisa/.github/workflows/quality.yml@main"
      ),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("CodySwannGT");
  });

  it("never flags GitHub's own actions on a floating major", () => {
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow("actions/checkout@v4"),
    });
    expect(run(["--root", root]).code).toBe(0);
  });

  it("reports how many fixture workflows it skipped rather than hiding them", () => {
    // The exclusion is a boundary, so it is visible in the output; a silent
    // skip is indistinguishable from a file the scan never found.
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(PINNED_USES),
      "tests/fixtures/example/.github/workflows/quality.yml":
        workflow(BRANCH_USES),
    });
    const result = run(["--root", root]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 fixture workflow(s) skipped");
  });

  it("exits 2 rather than 0 when it discovers no workflows at all", () => {
    // The absent-case rule. A scan that examined nothing is a broken
    // invocation, not conformance.
    const root = tempRepo({ "readme.md": "nothing to see\n" });
    const result = run(["--root", root]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no workflow files found");
  });

  it("exits 2 on an unknown flag", () => {
    expect(run(["--nope"]).code).toBe(2);
  });

  it("exits 2 when --root is given without a value", () => {
    expect(run(["--root"]).code).toBe(2);
  });

  it("emits a machine-readable report under --json", () => {
    const root = tempRepo({
      [OWN_WORKFLOW]: workflow(BRANCH_USES),
    });
    const result = run(["--root", root, "--json"]);
    const report = JSON.parse(result.stdout) as {
      findings: readonly { file: string; line: number; verdict: string }[];
      summary: { mutable: number; thirdParty: number };
    };
    expect(report.summary).toMatchObject({ mutable: 1, thirdParty: 1 });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      file: OWN_WORKFLOW,
      line: 7,
      verdict: MUTABLE,
    });
  });
});

describe("this repository's own tree", () => {
  it("carries no mutable third-party action ref", () => {
    // The regression test proper (#3585). Against the pre-fix tree this failed
    // with exit 1 and 89 findings, among them
    // `.github/workflows/quality.yml:7702  snyk/actions/node@master`, a branch
    // ref in a step holding the Snyk token, and
    // `.github/workflows/release.yml:1481  noliran/branch-based-secrets@v1`,
    // an action whose entire function is to place a secret in the environment.
    const result = run([]);
    expect(result.stdout).not.toContain("mutable ref, not a commit SHA");
    expect(result.code).toBe(0);
  });

  it("names no first-party reference in its output", () => {
    // The negative control against the real tree, where dozens of first-party
    // `@main` references genuinely exist. Passes before and after the pins.
    expect(run([]).stdout).not.toContain("CodySwannGT");
  });
});
