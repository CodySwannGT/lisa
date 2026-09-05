/**
 * The conflict-residue fallback must find the prover in a CONSUMER tree
 * (CodySwannGT/lisa#2951).
 *
 * The reusable workflow is consumed at `@main`; the package is version-pinned.
 * When the prover moved from `scripts/` to `all/copy-overwrite/scripts/` 72
 * minutes after a release, every consumer on that release began running a
 * post-move workflow against a pre-move package, and the fallback's candidate
 * list did not contain the one path where the file actually sat:
 * `node_modules/@codyswann/lisa/scripts/check-conflict-markers.mjs`.
 *
 * Lisa's own CI structurally cannot catch this, which is why this file builds
 * consumer-shaped trees instead of asserting anything about this repository.
 * Lisa is the single repository where the HOST-relative candidate
 * `all/copy-overwrite/scripts/check-conflict-markers.mjs` resolves, so a test
 * that ran the gate here would pass against the broken list. Each fixture below
 * therefore places the prover under `node_modules/@codyswann/lisa/` ONLY, and
 * asserts up front that no host-relative candidate exists in the tree — without
 * that assertion the fixture could silently degrade into another Lisa-shaped
 * pass.
 *
 * The step's shell is not restated here. It is extracted from
 * `.github/workflows/quality.yml` and executed verbatim, so the thing under
 * test is the workflow itself rather than a paraphrase of it that can drift.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/config/conflict-prover-consumer-layouts
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { load as loadYaml } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

import { applyRewrites } from "../../../src/core/anchored-rewrite.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const REPO_ROOT = process.cwd();
const GIT = resolveGit();

/**
 * The shell the runner gives a `run:` step, by absolute path.
 *
 * Absolute rather than `"bash"` so the interpreter cannot be picked up off a
 * writable `PATH` entry — the same reason `resolveGit` exists.
 */
const BASH = "/bin/bash";

/** Where the workflow lives. */
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** The job carrying the fallback under test. */
const JOB = "conflict_markers";

/** The step whose shell resolves the prover with no `gates` block present. */
const STEP_NAME = "🩹 Check for leftover conflict markers";

/** The prover, as it sits in this repository today. */
const PROVER_SOURCE = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "check-conflict-markers.mjs"
);

/** The directory holding every module the prover imports relative to itself. */
const PROVER_LIB_DIR = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lib"
);

/**
 * Every sibling module the packaged prover needs, DERIVED from the lane.
 *
 * Named a directory rather than a file deliberately. This was one hardcoded
 * entry — `invoked-as-script.mjs` — and the fixture silently stopped being
 * consumer-shaped the moment the prover imported a second sibling
 * (`bounded-spawn.mjs`, CodySwannGT/lisa#2980): the vendored package was
 * missing a module the real package ships, so the prover failed to resolve for
 * a reason no consumer would ever hit.
 *
 * That is a roster narrower than the property it stands for, which is the
 * defect this whole area is about. A directory read cannot fall behind the
 * imports the way a list can.
 * @returns Basenames of every `.mjs` module in the prover's lane `lib/`
 */
const proverLibModules = (): readonly string[] =>
  readdirSync(PROVER_LIB_DIR).filter(name => name.endsWith(".mjs"));

/** The packaged path a release predating the move installs the prover at. */
const PACKAGED_OLD_LAYOUT =
  "node_modules/@codyswann/lisa/scripts/check-conflict-markers.mjs";

/** The packaged path a release carrying the move installs the prover at. */
const PACKAGED_NEW_LAYOUT =
  "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/check-conflict-markers.mjs";

/** Candidates that resolve from the HOST tree rather than from the package. */
const HOST_RELATIVE_CANDIDATES = [
  "scripts/check-conflict-markers.mjs",
  "all/copy-overwrite/scripts/check-conflict-markers.mjs",
] as const;

/** What the prover prints when it has actually walked the tracked files. */
const SCAN_RAN = "no leftover conflict markers in";

/** What it prints when it walked the WRONG directory and found it empty. */
const SCANNED_NOTHING = "no leftover conflict markers in 0 tracked files";

/** A tracked file the scan must reach, planted at the project root. */
const CONFLICTED_FILE = "residue.md";

/**
 * A complete, ordered conflict triple — what git actually writes.
 *
 * Assembled from repeated characters so this very file is not flagged by the
 * gate it tests, the same way the prover's own suite does it.
 */
const CONFLICT_BLOCK = [
  `${"<".repeat(7)} HEAD`,
  "ours",
  "=".repeat(7),
  "theirs",
  `${">".repeat(7)} branch`,
  "",
].join("\n");

/** A minimal step shape, enough to find the one under test. */
interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * The `run:` shell of the fallback step, read out of the workflow.
 * @returns The step's shell script, verbatim
 */
function fallbackShell(): string {
  const workflow = loadYaml(readFileSync(QUALITY_YML, "utf8")) as {
    jobs?: Record<string, { steps?: readonly WorkflowStep[] }>;
  };
  const steps = workflow.jobs?.[JOB]?.steps ?? [];
  const step = steps.find(entry => entry.name === STEP_NAME);
  if (step?.run === undefined) {
    throw new Error(`no \`run:\` on step "${STEP_NAME}" of job "${JOB}"`);
  }
  return step.run;
}

/**
 * The prover's source, rewritten to anchor the way a PRE-MOVE release does.
 *
 * The whole functional delta between the released pre-move prover and today's
 * is the default root: it was derived from the script's own location, and is
 * now the current working directory. Reversing that one expression reproduces
 * the shipped artifact without vendoring three hundred lines of it, and
 * `assertLocationAnchored` below is the positive control that the reversal
 * actually took — a fixture that silently stopped being pre-move would make
 * every case using it vacuous.
 * @returns The pre-move prover's source text
 */
function preMoveProverSource(): string {
  // EACH rewrite asserts its own anchor, and `applyRewrites` names the one that
  // did not. The guard this replaced compared the finished text to the original
  // and threw only when NOTHING changed, which passes as soon as any one
  // rewrite still lands — so when CodySwannGT/lisa#2980 removed the
  // `execFileSync` import the first rewrite anchored on, the import insertion
  // silently no-opped, the second rewrite still matched, and the fixture
  // shipped a prover referencing an identifier it never imported. A guard that
  // asks "did something change" cannot answer "did everything I asked for
  // happen" (CodySwannGT/lisa#3081).
  return applyRewrites(
    readFileSync(PROVER_SOURCE, "utf8"),
    [
      {
        anchor: 'import path from "node:path";',
        label: "the fileURLToPath import a pre-move prover carries",
        replacement:
          'import path from "node:path";\nimport { fileURLToPath } from "node:url";',
      },
      {
        anchor: "path.resolve(root ?? process.cwd())",
        label: "the default root, reversed to the script's own location",
        replacement:
          'path.resolve(root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."))',
      },
    ],
    `the pre-move prover fixture built from ${PROVER_SOURCE}`
  );
}

/** How a release lays the prover out, and how that release's prover anchors. */
interface Layout {
  readonly label: string;
  readonly candidate: string;
  readonly source: () => string;
}

/** The layout a release predating the move ships. */
const OLD_RELEASE: Layout = {
  candidate: PACKAGED_OLD_LAYOUT,
  label: "a release predating the layout move",
  source: preMoveProverSource,
};

/** The layout a release carrying the move ships. */
const NEW_RELEASE: Layout = {
  candidate: PACKAGED_NEW_LAYOUT,
  label: "a release carrying the layout move",
  source: () => readFileSync(PROVER_SOURCE, "utf8"),
};

/** Both released package layouts a consumer can be sitting on today. */
const RELEASES = [OLD_RELEASE, NEW_RELEASE] as const;

/**
 * Write a prover (and the one module it imports) at a path in a tree.
 * @param root - Absolute tree root
 * @param relative - Where the prover goes, relative to the root
 * @param source - The prover source to write
 */
function installProver(root: string, relative: string, source: string): void {
  const target = path.join(root, relative);
  const libDir = path.join(path.dirname(target), "lib");
  const modules = proverLibModules();
  // The absent case: an empty lib directory would vendor nothing and every
  // resolution case below would fail for a reason that has nothing to do with
  // the layout they exist to test.
  if (modules.length === 0) {
    throw new Error(`no sibling modules found in ${PROVER_LIB_DIR}`);
  }
  mkdirSync(libDir, { recursive: true });
  writeFileSync(target, source, "utf8");
  for (const name of modules) {
    copyFileSync(path.join(PROVER_LIB_DIR, name), path.join(libDir, name));
  }
}

/**
 * A clean, committed git tree shaped like a CONSUMER: the prover exists only
 * inside `node_modules/@codyswann/lisa`, never at a host-relative candidate.
 *
 * `node_modules` is deliberately left untracked, exactly as a consumer has it,
 * which also keeps the prover's own `git ls-files` walk honest.
 * @param layout - The released layout to install, or undefined for none
 * @param conflicted - Whether to commit a file carrying a real conflict block
 * @returns The absolute tree root
 */
function consumerTree(layout?: Layout, conflicted = false): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2951-"));
  const env = cleanGitEnv(process.env);
  const git = (...args: readonly string[]): void => {
    boundedExecFileSync({
      label: `git ${args.join(" ")}`,
      command: GIT,
      args,
      cwd: root,
      env,
      stdio: "ignore",
    });
  };
  roots.push(root);
  writeFileSync(path.join(root, "README.md"), "# a consumer\n", "utf8");
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  if (conflicted) {
    writeFileSync(path.join(root, CONFLICTED_FILE), CONFLICT_BLOCK, "utf8");
  }
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  if (layout !== undefined) {
    installProver(root, layout.candidate, layout.source());
  }
  return root;
}

/**
 * Drop the workflow step's shell into a tree as an executable script.
 * @param root - Absolute tree root
 * @returns Absolute path to the written script
 */
function writeStepScript(root: string): string {
  const script = path.join(root, "step.sh");
  writeFileSync(script, fallbackShell(), "utf8");
  return script;
}

/**
 * Run the workflow step's shell in a tree, the way the runner would.
 * @param root - Working directory for the step
 * @returns Exit status and combined output
 */
function runStep(root: string): { code: number; output: string } {
  const script = writeStepScript(root);
  const result = spawnSync(BASH, [script], {
    cwd: root,
    encoding: "utf8",
    env: cleanGitEnv(process.env),
    timeout: 60_000,
  });
  expect(
    result.signal,
    "the step was killed rather than finishing; its exit status proves nothing"
  ).toBeNull();
  return {
    code: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("the fixtures are consumer-shaped, not Lisa-shaped", () => {
  it.each(HOST_RELATIVE_CANDIDATES)(
    "leaves %s absent, so a host-relative candidate cannot carry the pass",
    (candidate: string) => {
      const root = consumerTree(OLD_RELEASE);
      expect(existsSync(path.join(root, candidate))).toBe(false);
    }
  );

  it("builds a genuinely PRE-MOVE prover, which anchors on its own location", () => {
    // The positive control for `preMoveProverSource`. Without it, a fixture
    // that quietly reverted to today's cwd-anchored prover would make the
    // root-anchoring cases below pass while proving nothing — the exact
    // vacuous-pass shape this file exists to avoid.
    //
    // The resolved root is read out of the REFUSAL rather than out of a JSON
    // report, because `#3888` changed what a scan of nothing produces. The
    // pre-move prover walks the package directory, `git ls-files` there lists
    // nothing, and the prover now exits 2 naming the directory it looked in
    // instead of printing `✓ … 0 tracked files` and exit 0. The control is
    // unchanged in substance — it still asserts which directory the fixture
    // anchored on — and it gets stronger evidence, since a cwd-anchored prover
    // would find the fixture's tracked files and not refuse at all.
    const root = consumerTree(OLD_RELEASE, true);
    const prover = path.join(root, OLD_RELEASE.candidate);
    const result = spawnSync(process.execPath, [prover, "--json"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(2);
    const named = /named no tracked file under (\S+);/.exec(result.stderr);
    expect(named?.[1], result.stderr).toBeDefined();
    expect(path.basename(named?.[1] ?? "")).toBe("lisa");
  });

  it("resolves the host-relative candidate in THIS repository, which is why Lisa never caught it", () => {
    // Stated as an assertion rather than a comment: it is the reason the tests
    // above have to build a tree at all. Lisa passes the broken list.
    expect(
      existsSync(
        path.join(
          REPO_ROOT,
          "all/copy-overwrite/scripts/check-conflict-markers.mjs"
        )
      )
    ).toBe(true);
  });
});

describe("conflict-residue fallback resolves the prover in a consumer tree", () => {
  it.each(RELEASES)("finds the packaged prover of $label", (layout: Layout) => {
    const { code, output } = runStep(consumerTree(layout));
    expect(output).toContain(SCAN_RAN);
    expect(code).toBe(0);
  });

  it("still fails closed when no candidate resolves, naming every path searched", () => {
    const { code, output } = runStep(consumerTree());
    expect(code).toBe(1);
    expect(output).not.toContain(SCAN_RAN);
    for (const candidate of [
      PACKAGED_NEW_LAYOUT,
      PACKAGED_OLD_LAYOUT,
      ...HOST_RELATIVE_CANDIDATES,
    ]) {
      expect(output, `the failure never names ${candidate}`).toContain(
        candidate
      );
    }
  });
});

describe("the resolved prover scans the PROJECT, not the package directory", () => {
  // Resolving the file is half the job. A released prover that anchors on its
  // own location, invoked from `node_modules/@codyswann/lisa/`, walks THAT
  // directory: `git ls-files` there succeeds and lists nothing, because
  // node_modules is ignored. The gate then exits 0 saying "0 tracked files" —
  // a clean report from a scan that never ran, which is the precise thing the
  // absent-prover branch above refuses to do. The prover's own header predicts
  // this failure mode in as many words.
  it.each(RELEASES)(
    "catches a conflict block in the project under $label",
    (layout: Layout) => {
      const { code, output } = runStep(consumerTree(layout, true));
      expect(output).toContain(CONFLICTED_FILE);
      expect(code).toBe(1);
    }
  );

  it.each(RELEASES)(
    "reports a non-empty scan on a clean project under $label",
    (layout: Layout) => {
      const { code, output } = runStep(consumerTree(layout));
      expect(output).not.toContain(SCANNED_NOTHING);
      expect(code).toBe(0);
    }
  );
});

describe("the workflow's candidate list covers both packaged layouts", () => {
  it("searches the packaged prover of both the pre- and post-move layout", () => {
    const shell = fallbackShell();
    expect(shell).toContain(PACKAGED_OLD_LAYOUT);
    expect(shell).toContain(PACKAGED_NEW_LAYOUT);
  });

  it("tells the prover which tree to scan instead of trusting its default", () => {
    // The default differs BETWEEN released layouts, so there is no single
    // default the step can rely on. Naming the root is what makes one
    // invocation correct on both.
    expect(fallbackShell()).toContain('node "$PROVER" --root .');
  });
});
