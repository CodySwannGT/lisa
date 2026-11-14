/**
 * A throwaway Rails-shaped host for the push-time spec-selection suite
 * (CodySwannGT/lisa#4612): a branch off `origin/main` with two models and
 * their specs, an always-run system spec, a recorded crystalball map, the
 * real Lisa-managed scripts, and stand-ins for `bundle` and `gh`.
 *
 * The stand-in `bundle` records the command it was given. When the partial
 * coverage hand-off is required it plays SimpleCov's part: it writes the
 * hand-off's `status.json` and a `.resultset.json` from `coverage.json` (when
 * present). It fails when a spec named `failing` is among its arguments. The
 * stand-in `gh` serves `gh-artifacts.ndjson` to `gh api` and `gh-map.json` to
 * `gh run download`, and records every call.
 *
 * No Ruby runs here: what Ruby does is pinned in rails-crystalball-ruby.test.ts.
 * @module tests/integration/rails-rspec-select-fixture
 */
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";
import { FAKE_BUNDLE, FAKE_GH } from "./rails-rspec-select-stand-ins.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** This repository's root. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Files the fixture borrows from this repository, and where they land. */
const BORROWED: ReadonlyArray<readonly [string, string]> = [
  [
    "all/copy-overwrite/scripts/lisa-rspec-select.mjs",
    "scripts/lisa-rspec-select.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lib/rspec-selection.mjs",
    "scripts/lib/rspec-selection.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lib/affected-tests.mjs",
    "scripts/lib/affected-tests.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lib/invoked-as-script.mjs",
    "scripts/lib/invoked-as-script.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lisa-clean-git-env.sh",
    "scripts/lisa-clean-git-env.sh",
  ],
  [
    "rails/copy-overwrite/scripts/lisa_rspec_partial_coverage.rb",
    "scripts/lisa_rspec_partial_coverage.rb",
  ],
];

/** The full command the pre-push runs. */
export const FULL: readonly string[] = ["exec", "rspec"];

/** The model the map links to `spec/models/user_spec.rb` and a request spec. */
export const USER = "app/models/user.rb";

/** The model the map links to `spec/models/post_spec.rb` alone. */
export const POST = "app/models/post.rb";

/** The spec tagged `:js`. */
const JS_SPEC = "spec/requests/js_spec.rb";

/** The system spec, always run by its folder. */
const SYSTEM_SPEC = "spec/system/login_spec.rb";

/** The always-run groups the fixture holds. */
export const ALWAYS = [JS_SPEC, SYSTEM_SPEC];

/** One parent folder per test file, so cleanup is a single removal. */
const PARENT = mkdtempSync(path.join(tmpdir(), "lisa-rspec-select-"));

/** Remove every fixture this test file made. */
export function removeFixtures(): void {
  rmSync(PARENT, { recursive: true, force: true });
}

/**
 * Run git in the fixture and return its output.
 * @param cwd - Fixture root
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
export function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (rspec-select fixture)`,
    command: GIT_BIN,
    args,
    cwd,
    env: cleanGitEnv(),
  }).trim();
}

/**
 * Write a file, creating its folder.
 * @param root - Fixture root
 * @param file - Relative path
 * @param body - Content
 */
export function write(root: string, file: string, body: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), body);
}

/** The shape of one fixture. */
export interface FixtureOptions {
  readonly pushGate?: Record<string, unknown>;
  readonly map?: "fresh" | "none";
}

/**
 * Write the host: models, specs, scripts, stand-ins and config.
 * @param root - Fixture root
 * @param options - Fixture shape
 */
function writeProject(root: string, options: FixtureOptions): void {
  for (const [from, to] of BORROWED) {
    mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, from), path.join(root, to));
  }
  write(root, "bin/bundle", FAKE_BUNDLE);
  write(root, "bin/gh", FAKE_GH);
  chmodSync(path.join(root, "bin/bundle"), 0o755);
  chmodSync(path.join(root, "bin/gh"), 0o755);
  write(
    root,
    ".gitignore",
    ".lisa/\n.bundle-calls\n.gh-calls\ncoverage.json\ngh-artifacts.ndjson\ngh-map.json\n"
  );
  write(root, "bin/rails", "#!/usr/bin/env ruby\n");
  write(root, "config/application.rb", "module Fixture; end\n");
  write(root, "Gemfile.lock", "GEM\n");
  write(root, USER, "class User\n  def name\n    'u'\n  end\nend\n");
  write(root, POST, "class Post\n  def title\n    'p'\n  end\nend\n");
  write(root, "spec/models/user_spec.rb", "RSpec.describe User do\nend\n");
  write(root, "spec/models/post_spec.rb", "RSpec.describe Post do\nend\n");
  write(
    root,
    "spec/requests/users_spec.rb",
    "RSpec.describe 'users' do\nend\n"
  );
  write(root, JS_SPEC, "RSpec.describe 'ui', :js do\nend\n");
  write(root, SYSTEM_SPEC, "RSpec.describe 'login' do\nend\n");
  write(
    root,
    "spec/models/failing_spec.rb",
    "RSpec.describe 'fails' do\nend\n"
  );
  write(root, "docs/notes.md", "notes\n");
  write(
    root,
    "simplecov.thresholds.json",
    `${JSON.stringify({ line: 80, branch: 70 })}\n`
  );
  write(
    root,
    ".lisa.config.json",
    `${JSON.stringify(options.pushGate ? { pushGate: options.pushGate } : {})}\n`
  );
}

/**
 * The map CI's full run recorded, as `lisa_crystalball_recorder.rb` writes it.
 * @param baseSha - The base it was recorded for
 * @param createdAt - When
 * @returns The document
 */
export function mapDocument(
  baseSha: string,
  createdAt = new Date(Date.now() - 3_600_000).toISOString()
): Record<string, unknown> {
  return {
    meta: {
      version: 1,
      tool: "gitlab-crystalball",
      baseSha,
      createdAt,
      runId: "77",
      job: "unsharded",
    },
    map: {
      "spec/models/user_spec.rb": [USER],
      "spec/models/post_spec.rb": [POST],
      "spec/models/failing_spec.rb": ["app/models/flaky.rb"],
      "spec/requests/users_spec.rb": [USER],
      [JS_SPEC]: [],
      [SYSTEM_SPEC]: [USER],
    },
    alwaysRun: [JS_SPEC],
  };
}

/**
 * Write a map on disk, recorded for `baseSha` and downloaded for `requested`.
 * @param root - Fixture root
 * @param requested - The merge-base it was downloaded for
 * @param baseSha - The base it was recorded for
 * @param createdAt - When it was recorded
 */
export function writeMap(
  root: string,
  requested: string,
  baseSha: string,
  createdAt?: string
): void {
  const document = mapDocument(baseSha, createdAt);
  write(
    root,
    ".lisa/crystalball-map/map.json",
    JSON.stringify({ map: document.map, alwaysRun: document.alwaysRun })
  );
  write(
    root,
    ".lisa/crystalball-map/meta.json",
    JSON.stringify({ ...(document.meta as object), requestedBase: requested })
  );
}

/**
 * Commit everything as `origin/main` and branch off it.
 * @param root - Fixture root
 * @returns The base commit
 */
function branchOffMain(root: string): string {
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "-b", "feature");
  return git(root, "rev-parse", "HEAD");
}

/**
 * Write the host and branch off its first commit.
 * @param root - Fixture root
 * @param options - Fixture shape
 * @returns The base commit
 */
function initialise(root: string, options: FixtureOptions): string {
  writeProject(root, options);
  return branchOffMain(root);
}

/**
 * A Rails-shaped host on a branch off `origin/main`, with a map for its base.
 * @param options - Fixture shape
 * @returns Fixture root and its base commit
 */
export function fixture(options: FixtureOptions = {}): {
  root: string;
  base: string;
} {
  const root = mkdtempSync(path.join(PARENT, "repo-"));
  const base = initialise(root, options);
  if (options.map !== "none") writeMap(root, base, base);
  return { root, base };
}

/**
 * Commit a change on the branch.
 * @param root - Fixture root
 * @param files - Files to write
 */
export function change(
  root: string,
  files: Readonly<Record<string, string>>
): void {
  for (const [file, body] of Object.entries(files)) write(root, file, body);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
}

/**
 * The environment a push sees: the stand-ins first on PATH, no CI, no
 * inherited git or selection state.
 * @param root - Fixture root
 * @param extra - Additional variables
 * @returns Environment
 */
export function pushEnv(
  root: string,
  extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const {
    CI: _ci,
    GITHUB_ACTIONS: _actions,
    LISA_SELECTION_REPORT: _report,
    LISA_ACCESS_MAP_MAX_AGE_DAYS: _age,
    LISA_AFFECTED_BASE_REF: _ref,
    ...rest
  } = cleanGitEnv();
  return {
    ...rest,
    ...sweepAlreadyRanEnv(),
    PATH: `${path.join(root, "bin")}${path.delimiter}${rest.PATH ?? ""}`,
    ...extra,
  };
}

/**
 * Every argv a stand-in received.
 * @param root - Fixture root
 * @param file - `.bundle-calls` or `.gh-calls`
 * @returns Argument lists
 */
export function calls(root: string, file = ".bundle-calls"): string[][] {
  try {
    return readFileSync(path.join(root, file), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

/** The outcome of one pre-push run. */
export interface Run {
  readonly status: number | null;
  readonly output: string;
  readonly calls: string[][];
}

/**
 * Run the selector as the lefthook `rspec` pre-push command does.
 * @param root - Fixture root
 * @param extra - Additional environment
 * @returns Exit status, output, and the commands `bundle` saw
 */
export function select(root: string, extra: Record<string, string> = {}): Run {
  const child = boundedSpawnSync({
    label: "lisa-rspec-select (fixture)",
    command: process.execPath,
    args: ["scripts/lisa-rspec-select.mjs", "--", "bundle", "exec", "rspec"],
    cwd: root,
    env: pushEnv(root, extra),
  });
  return {
    status: child.status,
    output: `${child.stdout}${child.stderr}`,
    calls: calls(root),
  };
}

/**
 * Run the shipped lefthook `pre-push` `rspec` command's own shell line.
 * @param root - Fixture root
 * @returns Exit status, output, and the commands `bundle` saw
 */
export function lefthookRspec(root: string): Run {
  const config = yaml.load(
    readFileSync(
      path.join(REPO_ROOT, "rails/copy-overwrite/lefthook.yml"),
      "utf8"
    )
  ) as { "pre-push": { commands: { rspec: { run: string } } } };
  const child = boundedSpawnSync({
    label: "lefthook rspec (fixture)",
    command: "sh",
    args: ["-c", config["pre-push"].commands.rspec.run],
    cwd: root,
    env: pushEnv(root),
  });
  return {
    status: child.status,
    output: `${child.stdout}${child.stderr}`,
    calls: calls(root),
  };
}

/**
 * The partial command `bundle` sees for a set of spec files.
 * @param specs - Spec files, in selection order
 * @returns Arguments after `bundle`
 */
export function partial(specs: readonly string[]): string[] {
  return [
    ...FULL,
    "--require",
    "./scripts/lisa_rspec_partial_coverage.rb",
    ...specs,
  ];
}
