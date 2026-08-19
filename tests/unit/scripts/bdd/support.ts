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
 * Absolute git path, preferring fixed system locations over a PATH lookup so
 * a writable directory on PATH cannot inject a different binary.
 */
export const GIT_BIN =
  ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"].find(
    candidate => fs.existsSync(candidate)
  ) ?? "/usr/bin/git";

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
 * Create a temp project with a coverage map, features, and evidence files.
 * @param spec - What to lay down.
 * @returns Absolute project root.
 */
export function makeProject(spec: ProjectSpec): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bdd-gate-"));
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
 * @param root - Project root.
 * @returns The commit SHA.
 */
export function commitAll(root: string): string {
  const git = (...args: string[]): string =>
    spawnSync(GIT_BIN, args, {
      cwd: root,
      encoding: "utf-8",
      env: hermeticEnv(root),
    }).stdout.trim();
  git("init", "-q");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "Gate Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "base", "--no-verify");
  return git("rev-parse", "HEAD");
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
