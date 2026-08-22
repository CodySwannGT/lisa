/**
 * Shared fixtures for the BDD behavior-contract gate tests.
 *
 * Every case runs against a disposable project laid down in a temp directory,
 * so no test can be influenced by the Lisa repo's own state.
 *
 * @module tests/unit/scripts/bdd/support
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll } from "vitest";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
export const SCRIPT_REL = "expo/copy-overwrite/scripts/check-bdd-coverage.mjs";
export const MATRIX_REL = "expo/copy-overwrite/scripts/bdd-matrix.mjs";
export const SEED_MAP_REL = "expo/create-only/bdd/coverage-map.json";
export const QUALITY_REL = ".github/workflows/quality.yml";
export const SCRIPT_ABS = path.join(REPO_ROOT, SCRIPT_REL);

/** Adoption states, as strings, so no test repeats the literal. */
export const ENFORCED = "enforced";
export const BOOTSTRAP = "bootstrap";
export const NOT_ADOPTED = "not-adopted";

/** Fixed evaluation date, so expiry behavior is deterministic. */
export const TODAY = "2026-08-12";

/** The maintainer-applied authorization label. */
export const BASELINE_LABEL = "bdd-floor-baseline";

/** Fixture identifiers reused across cases. */
export const HOME_ID = "BDD-HOME-001";
export const WEB = "web";
export const PLAYWRIGHT = "playwright";
export const HOME_SPEC = "e2e/home.spec.ts";
export const HOME_EVIDENCE = "renders the home page";
export const RATIFIED = "ratified-shipped-behavior";
export const HOME_FEATURE_FILE = "home.feature";
export const MAP_REL = "bdd/coverage-map.json";

/** Discovery vocabulary, so no test repeats a runner or root literal. */
export const MAESTRO = "maestro";
export const E2E_ROOT = "e2e";
export const SPEC_EXTENSION = ".spec.ts";

/**
 * The playwright discovery block used by every healthy fixture.
 *
 * Declared per runner in the map, never hardcoded in the gate — that is the
 * whole point of making roots configuration rather than a source constant.
 */
export const PLAYWRIGHT_DISCOVERY: Record<string, unknown> = {
  roots: [E2E_ROOT],
  extensions: [SPEC_EXTENSION],
  evidence: { kind: "call-title", functions: ["test"] },
};

/** Defect codes asserted across more than one case. */
export const COVERAGE_REGRESSION = "coverage-regression";
export const OBLIGATION_UNCOVERED = "obligation-uncovered";
export const SCENARIO_DELETED = "scenario-deleted";
export const BASELINE = "baseline";
export const FLOOR_INVALID = "floor-invalid";
export const FLOOR_MISSING = "floor-missing";
export const FLOOR_REGRESSION = "floor-regression";
export const MAPPING_FILE = "mapping-file";

/**
 * Absolute git locations, in preference order.
 *
 * Fixed system locations rather than a PATH lookup, so a writable directory on
 * PATH cannot inject a different binary. Within that constraint the order is
 * chosen by measurement: on macOS `/usr/bin/git` is not git at all, it is
 * Apple's `xcrun` shim, and going through it costs a **median 13,853 ms per
 * invocation against 23-31 ms** for any real binary — randomized call order,
 * fixed inter-call gaps, n=12 each (lisa#2887). `/usr/bin/git --version`,
 * which does no work whatsoever, reached 33,699 ms through the shim.
 *
 * The two locations promoted ahead of it are the developer-directory gits the
 * shim itself dispatches to. Both are `root:wheel` files in system locations,
 * so this is the same trust class as `/usr/bin/git` and NOT a relaxation —
 * the user-writable Homebrew and `/usr/local` entries stay last, where they
 * already were. On Linux neither promoted path exists, so CI resolves
 * `/usr/bin/git` exactly as before.
 */
export const GIT_CANDIDATES: readonly string[] = Object.freeze([
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
]);

/** The shim this list exists to step around; exported so a test can pin it. */
export const XCRUN_SHIM = "/usr/bin/git";

/** Absolute git path: the first candidate that exists. */
export const GIT_BIN =
  GIT_CANDIDATES.find(candidate => fs.existsSync(candidate)) ?? XCRUN_SHIM;

/**
 * A fully explicit subprocess environment.
 *
 * Nothing is inherited from the developer's or the runner's shell. That is
 * both hermeticity and a safety property: a hook-set `GIT_DIR` /
 * `GIT_WORK_TREE` would otherwise redirect these fixtures' git commands at the
 * host repository and commit into it.
 * @param root - Fixture root, used as HOME so git cannot read a real ~/.gitconfig.
 * @returns The base environment for every spawned process.
 */
export function hermeticEnv(root: string): Record<string, string> {
  return {
    PATH: path.dirname(GIT_BIN),
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/** Envelope statuses this gate emits. */
export const COMPLETED = "completed";
export const FAILED = "failed";
export const INVALID = "invalid";

/** One finding in the standard command envelope. */
export interface Finding {
  readonly code: string;
  readonly subject: string;
  readonly message: string;
  readonly severity: string;
}

/** Lisa's standard command envelope, as this gate emits it. */
export interface Envelope {
  readonly schemaVersion: string;
  readonly capability: string;
  readonly mode: string;
  readonly operation: string;
  readonly environment: string;
  readonly contractVersion: string;
  readonly dryRun: boolean;
  readonly status: string;
  readonly correlationId: string;
  readonly reason?: string;
  readonly summary: Record<string, unknown> & { readonly headline: string };
  readonly findings: readonly Finding[];
}

/** The detailed report, emitted only by `--report`. */
export interface Report {
  readonly scenarios: Record<string, number>;
  readonly traceability: {
    readonly overall: { covered: number; total: number; percentage: number };
    readonly byPlatform: Record<string, { percentage: number }>;
    readonly note: string;
  };
  readonly execution: Record<string, unknown>;
  readonly waived: {
    count: number;
    entries: readonly Record<string, unknown>[];
  };
  readonly floor: { ok: boolean; unset: readonly string[] };
  readonly trackers: { tags: readonly { tag: string; url: string | null }[] };
  readonly gaps: readonly Record<string, unknown>[];
  readonly testInventory: {
    readonly runners: readonly string[];
    readonly discovered: number;
    readonly disclosed: number;
    readonly dynamicTitles: number;
    readonly undisclosed: readonly Record<string, unknown>[];
    readonly exclusions: readonly Record<string, unknown>[];
  };
}

/**
 * Read a file from inside a fixture project.
 * @param root - Project root.
 * @param relativePath - Project-relative path.
 * @returns File contents.
 */
export function readProjectFile(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path.
 * @returns File contents.
 */
export function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/** A scenario fixture with sane defaults. */
export interface ScenarioSpec {
  readonly id: string;
  readonly tags?: readonly string[];
  readonly name?: string;
}

/**
 * Render a `.feature` file body from scenario specs.
 * @param feature - Feature title.
 * @param scenarios - Scenario specs.
 * @returns Gherkin source.
 */
export function featureSource(
  feature: string,
  scenarios: readonly ScenarioSpec[]
): string {
  const body = scenarios
    .map(
      spec =>
        `  @${spec.id} @${(spec.tags ?? [WEB, RATIFIED]).join(" @")}\n` +
        `  Scenario: ${spec.name ?? spec.id}\n` +
        `    Given a visitor\n    When they act\n    Then something is true\n`
    )
    .join("\n");
  return `Feature: ${feature}\n\n${body}`;
}

/** Everything needed to lay down a throwaway project. */
export interface ProjectSpec {
  readonly map?: Record<string, unknown> | string;
  readonly features?: Record<string, string>;
  readonly files?: Record<string, string>;
}

/**
 * One temp directory per worker process, holding every fixture that process
 * lays down, removed when the file that created it finishes.
 *
 * Two reasons it is not a `mkdtemp` per fixture. The family creates roughly 95
 * of them per run and previously removed **none**, so every run added ~95
 * permanent entries to the shared system temp directory — a direct contributor
 * to the saturation measured in lisa#2883, where a single `mkdtemp` call in
 * that directory cost 23,349 ms against 0.2 ms in a fresh one. And a fixture
 * created as a plain `mkdir` inside a directory this process owns cannot pay
 * that lookup cost at all, whatever the ambient `$TMPDIR` happens to contain.
 */
let fixtureBase: string | undefined;

/** Monotonic suffix, so fixture names never collide inside the base. */
let fixtureSequence = 0;

/** A committed fixture and the revision to compare it against. */
export interface CommittedProject {
  readonly root: string;
  readonly base: string;
}

/** Committed prototypes, keyed by the content they committed. */
const prototypes = new Map<string, CommittedProject>();

/** Count of git processes spawned by the fixtures, for the cost regression. */
let gitSpawns = 0;

/**
 * How many git processes the fixtures have spawned in this process.
 *
 * Exported so the cost of a fixture is an assertable fact rather than a
 * wall-clock measurement: a timing assertion on a shared machine measures the
 * machine, and this family already lost a day to that (lisa#2867).
 * @returns The running count.
 */
export function gitSpawnCount(): number {
  return gitSpawns;
}

/**
 * Allocate a fresh, empty fixture directory owned by this process.
 * @param prefix - Short label, so a directory left behind names its origin.
 * @returns Absolute path to the new directory.
 */
export function fixtureDir(prefix: string): string {
  if (fixtureBase === undefined) {
    fixtureBase = fs.mkdtempSync(path.join(os.tmpdir(), "bdd-fixtures-"));
  }
  fixtureSequence += 1;
  const root = path.join(fixtureBase, `${prefix}${fixtureSequence}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * The directory every fixture of this process lives under, or null when none
 * has been created yet. Exported so a test can assert the containment rather
 * than take it on trust.
 * @returns The base directory, or null.
 */
export function fixtureBaseDir(): string | null {
  return fixtureBase ?? null;
}

afterAll(() => {
  if (fixtureBase !== undefined) {
    fs.rmSync(fixtureBase, { recursive: true, force: true });
    fixtureBase = undefined;
    prototypes.clear();
  }
});

/**
 * Create a temp project with a coverage map, features, and evidence files.
 * @param spec - What to lay down.
 * @returns Absolute project root.
 */
export function makeProject(spec: ProjectSpec): string {
  const root = fixtureDir("gate-");
  fs.mkdirSync(path.join(root, "bdd", "features"), { recursive: true });
  if (spec.map !== undefined) {
    fs.writeFileSync(
      path.join(root, MAP_REL),
      typeof spec.map === "string"
        ? spec.map
        : JSON.stringify(spec.map, null, 2)
    );
  }
  for (const [name, body] of Object.entries(spec.features ?? {})) {
    fs.writeFileSync(path.join(root, "bdd", "features", name), body);
  }
  for (const [name, body] of Object.entries(spec.files ?? {})) {
    fs.mkdirSync(path.join(root, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  return root;
}

/** Result of one gate invocation. */
export interface GateRun {
  readonly envelope: Envelope;
  readonly status: number;
  readonly stderr: string;
}

/**
 * Run the gate against a project.
 * @param root - Project root.
 * @param env - Extra environment.
 * @returns Parsed envelope plus the exit status.
 */
export function runGate(
  root: string,
  env: Record<string, string> = {}
): GateRun {
  const result = spawnSync(process.execPath, [SCRIPT_ABS, "--json"], {
    encoding: "utf-8",
    env: {
      ...hermeticEnv(root),
      BDD_COVERAGE_ROOT: root,
      BDD_TODAY: TODAY,
      BDD_MODE: "",
      BDD_BASE_SHA: "",
      BDD_PR_LABELS: "",
      BDD_EXECUTION_RESULTS: "",
      ...env,
    },
  });
  const stdout = result.stdout.trim();
  return {
    envelope: stdout.startsWith("{")
      ? (JSON.parse(stdout) as Envelope)
      : ({} as Envelope),
    status: result.status ?? 0,
    stderr: result.stderr,
  };
}

/**
 * Run the gate with `--report`, which swaps the envelope for the detailed
 * report. Used only where a case asserts on the report's interior.
 * @param root - Project root.
 * @param env - Extra environment.
 * @returns The parsed report.
 */
export function runReport(
  root: string,
  env: Record<string, string> = {}
): Report {
  const result = spawnSync(process.execPath, [SCRIPT_ABS, "--report"], {
    encoding: "utf-8",
    env: {
      ...hermeticEnv(root),
      BDD_COVERAGE_ROOT: root,
      BDD_TODAY: TODAY,
      BDD_MODE: "",
      BDD_BASE_SHA: "",
      BDD_PR_LABELS: "",
      BDD_EXECUTION_RESULTS: "",
      ...env,
    },
  });
  return JSON.parse(result.stdout.trim()) as Report;
}

/**
 * Run the gate with `--write` and return the regenerated burndown.
 * @param root - Project root.
 * @param env - Extra environment.
 * @returns The burndown Markdown.
 */
export function runGateWrite(
  root: string,
  env: Record<string, string> = {}
): string {
  spawnSync(process.execPath, [SCRIPT_ABS, "--write"], {
    encoding: "utf-8",
    env: {
      ...hermeticEnv(root),
      BDD_COVERAGE_ROOT: root,
      BDD_TODAY: TODAY,
      BDD_MODE: "",
      BDD_BASE_SHA: "",
      BDD_PR_LABELS: "",
      BDD_EXECUTION_RESULTS: "",
      ...env,
    },
  });
  return fs.readFileSync(
    path.join(root, "docs", "e2e-bdd-coverage.md"),
    "utf-8"
  );
}

/**
 * Collect the defect codes an envelope reported.
 * @param run - A gate run.
 * @returns The codes, in order.
 */
export function codes(run: GateRun): string[] {
  return run.envelope.findings.map(item => item.code);
}

/**
 * Collect the messages an envelope reported for one defect code.
 * @param run - A gate run.
 * @param code - The defect code to filter on.
 * @returns The matching messages.
 */
export function messages(run: GateRun, code: string): string[] {
  return run.envelope.findings
    .filter(item => item.code === code)
    .map(item => item.message);
}

/** A coverage map that passes cleanly in enforced mode. */
export const HEALTHY_MAP: Record<string, unknown> = {
  schemaVersion: 2,
  asOf: TODAY,
  adoption: { state: ENFORCED },
  runnerPlatforms: { [PLAYWRIGHT]: [WEB] },
  testDiscovery: { [PLAYWRIGHT]: PLAYWRIGHT_DISCOVERY },
  coverageFloor: { [WEB]: 100 },
  trackers: {
    keys: ["TUN"],
    github: {
      org: "AcmeOrgD",
      defaultRepo: "frontend",
      repos: ["frontend", "wiki"],
    },
  },
  mappings: [
    {
      scenario: HOME_ID,
      runner: PLAYWRIGHT,
      platforms: [WEB],
      file: HOME_SPEC,
      evidence: HOME_EVIDENCE,
      level: "behavioral",
    },
  ],
  platformWaivers: [],
  exclusions: [],
};

/**
 * The healthy map's single mapping, for cases that patch one field.
 * @returns A fresh copy of the mapping.
 */
export function healthyMapping(): Record<string, unknown> {
  return { ...(HEALTHY_MAP.mappings as Record<string, unknown>[])[0] };
}

/** The healthy feature set. */
export const HEALTHY_FEATURES: Record<string, string> = {
  [HOME_FEATURE_FILE]: featureSource("Home", [
    { id: HOME_ID, tags: [WEB, RATIFIED, "TUN-123"] },
  ]),
};

/** The healthy evidence files. */
export const HEALTHY_FILES: Record<string, string> = {
  [HOME_SPEC]: `test("${HOME_EVIDENCE}", async () => {});\n`,
};

/**
 * Lay down the healthy project, optionally patching the map and files.
 * @param patch - Partial map overrides.
 * @param extra - Extra features and evidence files.
 * @returns Project root.
 */
export function healthyProject(
  patch: Record<string, unknown> = {},
  extra: ProjectSpec = {}
): string {
  return makeProject({
    map: { ...HEALTHY_MAP, ...patch },
    features: { ...HEALTHY_FEATURES, ...extra.features },
    files: { ...HEALTHY_FILES, ...extra.files },
  });
}

/**
 * Initialize a git repo and commit everything, returning the commit SHA.
 *
 * The committer identity travels as environment rather than as three separate
 * `git config` invocations, and signing is refused by flag rather than by a
 * fourth: seven spawned processes become four with no change to what is
 * committed. `--no-gpg-sign` is the same refusal `commit.gpgsign=false` was
 * making, stated at the one command that could act on it.
 * @param root - Project root.
 * @returns The commit SHA.
 */
export function commitAll(root: string): string {
  const env = {
    ...hermeticEnv(root),
    GIT_AUTHOR_NAME: "Gate Test",
    GIT_AUTHOR_EMAIL: "gate@example.test",
    GIT_COMMITTER_NAME: "Gate Test",
    GIT_COMMITTER_EMAIL: "gate@example.test",
  };
  const git = (...args: string[]): string => {
    gitSpawns += 1;
    return spawnSync(GIT_BIN, args, {
      cwd: root,
      encoding: "utf-8",
      env,
    }).stdout.trim();
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "base", "--no-verify", "--no-gpg-sign");
  return git("rev-parse", "HEAD");
}

/**
 * Build a committed fixture once per process and hand out copies of it.
 *
 * Every case in a spec that patches a HEAD working tree commits the *same*
 * base content and then edits what is checked out, so building the repository
 * per case pays repeatedly for an identical result. One spec was creating nine
 * of them; another twelve.
 *
 * The prototype itself is never handed out — a case that mutated it would
 * silently change every later case's base revision — so the first caller gets
 * a copy too. A git repository is self-contained and holds no absolute paths
 * at this point, so copying the directory copies the revision with it.
 * @param key - Identifies the committed content; callers with the same key must commit the same thing.
 * @param build - Lays down the content to commit, and returns its root.
 * @returns A private copy of the fixture, and its base revision.
 */
export function committedFixture(
  key: string,
  build: () => string
): CommittedProject {
  let prototype = prototypes.get(key);
  if (prototype === undefined) {
    const root = build();
    prototype = { root, base: commitAll(root) };
    prototypes.set(key, prototype);
  }
  const copy = fixtureDir("committed-");
  fs.cpSync(prototype.root, copy, { recursive: true });
  return { root: copy, base: prototype.base };
}

/**
 * A fixture directory with nothing at all in it.
 *
 * The cases that want one were reaching for `mkdtemp` in the ambient system
 * temp directory, which is the leak this module's fixture base exists to stop.
 * @param prefix - Short label for the directory name.
 * @returns Absolute path to an empty directory.
 */
export function emptyProject(prefix: string): string {
  return fixtureDir(prefix);
}

/**
 * Read a project's coverage map.
 * @param root - Project root.
 * @returns The parsed map.
 */
export function readMap(root: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(root, MAP_REL), "utf-8")
  ) as Record<string, unknown>;
}

/**
 * Write a project's coverage map.
 * @param root - Project root.
 * @param map - The map to write.
 * @returns Nothing.
 */
export function writeMap(root: string, map: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, MAP_REL), JSON.stringify(map, null, 2));
}
