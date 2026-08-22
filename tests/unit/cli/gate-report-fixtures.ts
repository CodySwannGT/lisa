/**
 * Temporary consumer projects for the gate-report tests.
 *
 * Every fixture is a project WITHOUT `.github/workflows/quality.yml`, because
 * that is what a consumer is: it calls the reusable workflow by ref and holds
 * no copy. A fixture that shipped one would let a Tier 3 answer look derivable
 * in a test and be unavailable in the field.
 * @module tests/unit/cli/gate-report-fixtures
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { EnforcedContext } from "../../../src/core/gate-declaration-drift.js";
import { buildGateReport } from "../../../src/cli/gate-report.js";
import type {
  GateMomentCell,
  GateReport,
  GateReportRow,
} from "../../../src/cli/gate-report-types.js";

/** Moments named often enough that a typo would be invisible. */
export const PUSH = "push";
export const PULL_REQUEST = "pull-request";

/** Gates and tasks named often enough for the same reason. */
export const DEPENDENCY_VULNERABILITY = "dependency-vulnerability";
export const COVERAGE_TASK = "test:cov:unit";
export const TYPE_CORRECTNESS = "type-correctness";
export const TEST_CORRECTNESS = "test-correctness";
export const TYPECHECK = "typecheck";
export const TYPECHECK_SCRIPT = "tsc --noEmit";

/** What a fixture project contains. */
export interface FixtureSpec {
  /** The `.lisa.config.json` body, or undefined to omit the file. */
  readonly config?: unknown;
  /** `package.json` scripts. */
  readonly scripts?: Readonly<Record<string, string>>;
  /** Hook file name -> contents, written under `.husky/`. */
  readonly hooks?: Readonly<Record<string, string>>;
  /**
   * Workflow file name -> contents, written under `.github/workflows/`.
   *
   * A fixture that writes `quality.yml` is deliberately NOT a consumer: it is
   * the upstream case, where Tier 3 is answerable. Consumers stay the default.
   */
  readonly workflows?: Readonly<Record<string, string>>;
  /** The `.claude/settings.json` body, or undefined to omit the file. */
  readonly agentSettings?: unknown;
  /**
   * Installed plugin manifests, keyed marketplace -> plugin -> manifest.
   *
   * Written under the fixture's OWN home directory, which `reportFor` injects,
   * so a test never reads the machine's real plugin installation and a report
   * built on one developer's laptop matches one built on another's.
   */
  readonly installedPlugins?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

/**
 * The home directory a fixture's plugin installation lives under.
 * @param root - The fixture project root
 * @returns Absolute path to the fixture's home directory
 */
export function homeFor(root: string): string {
  return path.join(root, "home");
}

/** Overrides for one report build. */
export interface ReportOverrides {
  /** Whether the run may reach the network. Defaults to offline. */
  readonly offline?: boolean;
  /** Injected Tier 2 reader. */
  readonly readRequiredContexts?: () => Promise<readonly string[]>;
  /** Injected Tier 1 template reader. */
  readonly readTemplateContexts?: () => Promise<readonly EnforcedContext[]>;
}

/**
 * Create a temporary consumer project.
 * @param spec - What the project contains
 * @returns Absolute path to the project root
 */
export async function makeProject(spec: FixtureSpec = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-gate-report-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: spec.scripts ?? {} }, null, 2),
    "utf8"
  );
  if (spec.config !== undefined) {
    await writeFile(
      path.join(root, ".lisa.config.json"),
      JSON.stringify(spec.config, null, 2),
      "utf8"
    );
  }
  if (spec.hooks !== undefined) {
    const dir = path.join(root, ".husky");
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(spec.hooks)) {
      await writeFile(path.join(dir, name), body, "utf8");
    }
  }
  if (spec.workflows !== undefined) {
    const dir = path.join(root, ".github", "workflows");
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(spec.workflows)) {
      await writeFile(path.join(dir, name), body, "utf8");
    }
  }
  if (spec.agentSettings !== undefined) {
    const dir = path.join(root, ".claude");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify(spec.agentSettings, null, 2),
      "utf8"
    );
  }
  await writeInstalledPlugins(root, spec.installedPlugins);
  return root;
}

/**
 * Write a fixture's installed plugin marketplaces under its own home.
 * @param root - The fixture project root
 * @param installed - Marketplace -> plugin -> manifest
 */
async function writeInstalledPlugins(
  root: string,
  installed: FixtureSpec["installedPlugins"]
): Promise<void> {
  if (installed === undefined) return;
  const pluginsDir = path.join(homeFor(root), ".claude", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  const marketplaces = Object.entries(installed).map(
    ([marketplace, plugins]) => ({
      marketplace,
      plugins,
      location: path.join(pluginsDir, "marketplaces", marketplace),
    })
  );
  const known = Object.fromEntries(
    marketplaces.map(entry => [
      entry.marketplace,
      { installLocation: entry.location },
    ])
  );
  for (const entry of marketplaces) {
    for (const [name, manifest] of Object.entries(entry.plugins)) {
      const dir = path.join(entry.location, "plugins", name, ".claude-plugin");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "plugin.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
      );
    }
  }
  await writeFile(
    path.join(pluginsDir, "known_marketplaces.json"),
    JSON.stringify(known, null, 2),
    "utf8"
  );
}

/**
 * A pre-push hook shaped like the one Lisa ships: the runner path is assigned
 * to a shell variable well above the call site that passes `--moment`.
 * @param builtins - Gate ids the hook carries a `lisa_gate_covers` step for
 * @returns Hook body
 */
export function shippedPrePush(builtins: readonly string[] = []): string {
  const steps = builtins
    .map(gate => `if lisa_gate_covers ${gate}; then\n  echo covered\nfi`)
    .join("\n");
  return [
    'GATE_RUNNER="scripts/lisa-run-gates.mjs"',
    'if [ ! -f "$GATE_RUNNER" ]; then',
    '  GATE_RUNNER="all/copy-overwrite/scripts/lisa-run-gates.mjs"',
    "fi",
    'node "$GATE_RUNNER" --moment=push --coverage="$COVERAGE"',
    steps,
    "",
  ].join("\n");
}

/** Never call the network from a unit test. */
function refuseNetwork(): Promise<readonly string[]> {
  throw new Error("the ruleset reader must be injected in tests");
}

/** A project that forwards no `skip_jobs` tokens. */
function refuseSkipJobs(): Promise<readonly string[]> {
  throw new Error("no ci.yml");
}

/**
 * Build a report against a fresh fixture, with both readers injected.
 * @param spec - Fixture contents
 * @param overrides - Report options to override
 * @returns The report
 */
export async function reportFor(
  spec: FixtureSpec = {},
  overrides: ReportOverrides = {}
): Promise<GateReport> {
  const projectRoot = await makeProject(spec);
  return await buildGateReport({
    projectRoot,
    offline: overrides.offline ?? true,
    readRequiredContexts: overrides.readRequiredContexts ?? refuseNetwork,
    readSkipJobTokens: refuseSkipJobs,
    homedir: () => homeFor(projectRoot),
    ...(overrides.readTemplateContexts === undefined
      ? {}
      : { readTemplateContexts: overrides.readTemplateContexts }),
  });
}

/**
 * One gate's row.
 * @param built - The report
 * @param id - Gate id
 * @returns The row
 */
export function row(built: GateReport, id: string): GateReportRow {
  const found = built.gates.find(entry => entry.id === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

/**
 * One (gate, moment) cell.
 * @param built - The report
 * @param id - Gate id
 * @param moment - Moment
 * @returns The cell
 */
export function cell(
  built: GateReport,
  id: string,
  moment: string
): GateMomentCell {
  const found = row(built, id).moments.find(entry => entry.moment === moment);
  if (found === undefined) throw new Error(`no ${id} cell at ${moment}`);
  return found;
}
