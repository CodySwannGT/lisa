/* eslint-disable functional/no-let -- fixture lifecycle retains disposable paths and revisions between setup and assertions */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { boundedExecFileSync } from "../../../helpers/io-latency-budget.js";
import { resolveGit } from "../../../support/git-executable.js";

const GIT = resolveGit();

import { syncStarterTemplates } from "../../../../src/cli/starter-sync.js";
import type { StarterTemplate } from "../../../../src/core/project-config-starter.js";

const CONFIG = ".lisa.config.json";
const OWNED = "scripts/lib/invoked-as-script.mjs";
const SECOND = "scripts/lib/process-tree-runner.mjs";
const PROJECT_OWNED = ".github/workflows/continuous-gates.yml";
const IGNORE = ".gitignore";
const BEGIN = "# BEGIN: AI GUARDRAILS";
const END = "# END: AI GUARDRAILS";
const OLD = "export const version = 'old';\n";
const NEW = "export const version = 'new';\n";
let root: string;
let starter: string;
let project: string;
let baseline: string;
let head: string;
/* eslint-enable functional/no-let -- only lifecycle state above requires reassignment */

/**
 * Execute real Git against only the disposable source repository.
 * @param args - Separate Git arguments.
 * @returns Command output without its final newline.
 */
function git(...args: string[]): string {
  return boundedExecFileSync({
    label: "starter fixture Git",
    command: GIT,
    args,
    cwd: starter,
  }).trim();
}

/**
 * Read exact bytes and executable/link metadata from a real Git tree.
 * @param revision - Pinned fixture commit.
 * @param name - Relative fixture path.
 * @returns File contents and mode, or undefined on the absent side of a diff.
 */
function gitFile(revision: string, name: string) {
  const entry = git("ls-tree", revision, "--", name);
  if (!entry) return undefined;
  const bytes = Buffer.from(
    boundedExecFileSync({
      label: "starter fixture file",
      command: GIT,
      args: ["show", `${revision}:${name}`],
      cwd: starter,
    })
  );
  return { bytes, mode: entry.split(" ")[0]! };
}

/**
 * Persist fixture files without executing their contents.
 * @param directory - Owned fixture root.
 * @param name - Relative file path.
 * @param bytes - Fixture text.
 */
async function put(
  directory: string,
  name: string,
  bytes: string
): Promise<void> {
  await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
  await writeFile(path.join(directory, name), bytes);
}

/**
 * Read real Git file changes instead of mocking the engine's writes or baseline.
 * @param template - Recorded fixture revision.
 * @param accepts - Canonical ownership and configured scope filter.
 * @returns Actual Git file bytes on both sides of each change.
 */
async function readChanges(
  template: StarterTemplate,
  accepts: (name: string) => boolean
) {
  const sha = git("rev-parse", "HEAD");
  const names = git(
    "diff",
    "--no-renames",
    "--name-only",
    template.lastSync.sha,
    sha
  )
    .split("\n")
    .filter(name => name && accepts(name));
  return {
    sha,
    changes: names.map(name => {
      const before = gitFile(template.lastSync.sha, name);
      const after = gitFile(sha, name);
      return {
        path: name,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      };
    }),
  };
}

/**
 * Read the actual consumer configuration after an operation.
 * @returns Persisted fixture configuration.
 */
async function config() {
  return JSON.parse(await readFile(path.join(project, CONFIG), "utf8"));
}

/**
 * Invoke the real engine with a real local Git source and canonical Lisa templates.
 * @returns Per-template outcomes.
 */
function sync() {
  return syncStarterTemplates({
    lisaRoot: process.cwd(),
    projectRoot: project,
    readChanges,
  });
}

/**
 * Add a real baseline and successor for a stack-specific template path.
 * @param name - Canonical template destination.
 * @param before - Previous starter and consumer bytes.
 * @param after - New starter bytes.
 */
async function extendHistory(
  name: string,
  before: string,
  after: string
): Promise<void> {
  await put(starter, name, before);
  await put(project, name, before);
  git("add", ".");
  git("commit", "--quiet", "-m", "Stack baseline");
  await updateBaseline();
  await put(starter, name, after);
  git("add", ".");
  git("commit", "--quiet", "-m", "Stack update");
}

/** Update the consumer baseline after a fixture commit. */
async function updateBaseline(): Promise<void> {
  const initial = await config();
  initial.starter.templates[0].lastSync.sha = git("rev-parse", "HEAD");
  await put(project, CONFIG, JSON.stringify(initial));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lisa-starter-sync-"));
  starter = path.join(root, "source");
  project = path.join(root, "consumer");
  await mkdir(starter);
  await mkdir(project);
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.com");
  for (const directory of [starter, project]) {
    await put(directory, OWNED, OLD);
    await put(directory, SECOND, OLD);
    await put(directory, PROJECT_OWNED, "project workflow\n");
    await put(
      directory,
      IGNORE,
      `project prefix\n${BEGIN}\nold-cache/\n${END}\nproject suffix\n`
    );
  }
  git("add", ".");
  git("commit", "--quiet", "-m", "Initial fixture");
  baseline = git("rev-parse", "HEAD");
  await put(starter, OWNED, NEW);
  await put(starter, SECOND, NEW);
  await put(starter, PROJECT_OWNED, "starter workflow\n");
  await put(
    starter,
    IGNORE,
    `starter prefix\n${BEGIN}\nnew-cache/\n${END}\nstarter suffix\n`
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "Updated fixture");
  head = git("rev-parse", "HEAD");
  await put(
    project,
    CONFIG,
    JSON.stringify({
      extension: "retain me",
      starter: {
        sync: { strategy: "pull-request" },
        templates: [
          {
            repo: "example/first",
            ref: "main",
            lastSync: { sha: baseline, at: "2026-09-15T00:00:00Z" },
          },
        ],
      },
    })
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

export {
  root,
  starter,
  project,
  baseline,
  head,
  CONFIG,
  OWNED,
  SECOND,
  PROJECT_OWNED,
  IGNORE,
  BEGIN,
  END,
  OLD,
  NEW,
  git,
  put,
  config,
  sync,
  extendHistory,
};
