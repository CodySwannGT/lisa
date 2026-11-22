/**
 * The fixed-order deterministic Health probe registry.
 *
 * Kept apart from the runner so the registry — which check runs, in what
 * order, against which reader — stays one reviewable list while the runner
 * owns only deadlines, setup, and result assembly.
 * @module health/deterministic-probes
 */
import { runConfigSync } from "../sync/config-sync.js";
import type { HealthFinding, HealthStatus } from "./contract.js";
import type { HealthDeadline } from "./deadline.js";
import { declaredChecksDriftFinding } from "./declared-checks-inspection.js";
import { safeSyncReads, shareRulesetReader } from "./deterministic-inputs.js";
import { splashExitFinding } from "./expo-splash-inspection.js";
import {
  hookFinding,
  managedTemplateFinding,
  packageFinding,
  pluginFinding,
  workflowFinding,
} from "./governance-probes.js";
import { readCoreHooksPath, type HooksPathReader } from "./hook-inspection.js";
import {
  readInstalledClaudePlugins,
  type InstalledPluginReader,
} from "./plugin-inspection.js";
import {
  configFindings,
  instructionFinding,
  projectStateFinding,
  starterFinding,
  wikiFinding,
  type HealthConfigState,
} from "./project-probes.js";
import {
  readGithubRulesets,
  rulesetFinding,
  type RulesetReader,
} from "./ruleset-inspection.js";
import {
  readGithubBranches,
  rulesetReachFinding,
  type BranchReader,
} from "./ruleset-reach-inspection.js";
import type { HealthProjectShape } from "./template-inspection.js";

/**
 * Injectable deterministic-health collaborators. Reader overrides must honor
 * their AbortSignal and release owned handles; the runner bounds its own return
 * but cannot reclaim arbitrary handles created by caller-supplied JavaScript.
 */
export interface DeterministicHealthOptions {
  /** Lisa package root containing stack templates. */
  readonly lisaRoot?: string;
  /** Total wall-clock deadline, including root/config/type setup. */
  readonly deadlineMs?: number;
  /** Injectable timestamp clock for contract tests. */
  readonly now?: () => Date;
  /** Injectable bounded detailed ruleset reader. */
  readonly readRulesets?: RulesetReader;
  /** Injectable bounded actual installed-plugin reader. */
  readonly readInstalledPlugins?: InstalledPluginReader;
  /** Injectable bounded repository hooks-path reader. */
  readonly readHooksPath?: HooksPathReader;
  /** Injectable bounded repository branch reader. */
  readonly readBranches?: BranchReader;
}

/** One fixed-order check and its unavailable fallback status. */
export interface Probe {
  readonly check: string;
  readonly unavailable: HealthStatus;
  readonly run: () => Promise<HealthFinding>;
}

export const CHECKS: readonly Pick<Probe, "check" | "unavailable">[] = [
  { check: "project.state", unavailable: "fail" },
  { check: "project.wiki", unavailable: "fail" },
  { check: "starters.remote", unavailable: "warn" },
  { check: "config.required", unavailable: "fail" },
  { check: "config.sync", unavailable: "fail" },
  { check: "templates.managed", unavailable: "fail" },
  { check: "package.conformance", unavailable: "fail" },
  { check: "instructions.canonical", unavailable: "fail" },
  { check: "hooks.managed", unavailable: "fail" },
  { check: "plugins.current", unavailable: "warn" },
  { check: "ci.workflows", unavailable: "fail" },
  { check: "github.rulesets", unavailable: "warn" },
  { check: "github.declared-checks", unavailable: "warn" },
  { check: "github.ruleset-reach", unavailable: "warn" },
  { check: "expo.splash-exit", unavailable: "warn" },
];

/** Setup state every probe reads, captured once before the registry is built. */
interface ProbeContext {
  readonly roots: { readonly projectRoot: string; readonly lisaRoot: string };
  readonly configState: HealthConfigState;
  readonly shape: HealthProjectShape | undefined;
  readonly safeShape: HealthProjectShape;
  readonly deadline: HealthDeadline;
  readonly options: DeterministicHealthOptions;
  readonly sync: ReturnType<typeof runConfigSync>;
  readonly rulesets: RulesetReader;
}

/**
 * Probes over local project files: state, wiki, config, templates, package, instructions.
 * @param context - Captured setup state shared by every probe
 * @returns Registry entries for checks 0 through 7, in order
 */
function localProbes(context: ProbeContext): readonly Probe[] {
  const { roots, configState, shape, safeShape, sync } = context;
  return [
    {
      ...CHECKS[0]!,
      run: () => projectStateFinding(roots.projectRoot, configState, shape),
    },
    { ...CHECKS[1]!, run: () => wikiFinding(roots.projectRoot) },
    { ...CHECKS[2]!, run: async () => starterFinding() },
    { ...CHECKS[3]!, run: async () => (await configFindings(await sync))[0] },
    { ...CHECKS[4]!, run: async () => (await configFindings(await sync))[1] },
    {
      ...CHECKS[5]!,
      run: () =>
        managedTemplateFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape,
          configState.config
        ),
    },
    {
      ...CHECKS[6]!,
      run: () => packageFinding(roots.lisaRoot, roots.projectRoot, safeShape),
    },
    { ...CHECKS[7]!, run: () => instructionFinding(roots.projectRoot) },
  ];
}

/**
 * Probes over installed tooling and CI: hooks, plugins, workflows.
 * @param context - Captured setup state shared by every probe
 * @returns Registry entries for checks 8 through 10, in order
 */
function toolingProbes(context: ProbeContext): readonly Probe[] {
  const { roots, configState, safeShape, deadline, options } = context;
  return [
    {
      ...CHECKS[8]!,
      run: () =>
        hookFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape.types,
          configState.config,
          options.readHooksPath ?? readCoreHooksPath,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[9]!,
      run: () =>
        pluginFinding(
          roots.projectRoot,
          configState.config,
          safeShape.types,
          options.readInstalledPlugins ?? readInstalledClaudePlugins,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[10]!,
      run: () =>
        workflowFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape.types,
          configState.config
        ),
    },
  ];
}

/**
 * Probes over GitHub repository settings and the Expo splash contract.
 * @param context - Captured setup state shared by every probe
 * @returns Registry entries for checks 11 through 14, in order
 */
function repositoryProbes(context: ProbeContext): readonly Probe[] {
  const { roots, configState, safeShape, deadline, options, rulesets } =
    context;
  return [
    {
      ...CHECKS[11]!,
      run: () =>
        rulesetFinding(
          roots.lisaRoot,
          roots.projectRoot,
          safeShape.types,
          configState.config,
          rulesets,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[12]!,
      run: () =>
        declaredChecksDriftFinding(
          roots.projectRoot,
          configState.config,
          rulesets,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[13]!,
      run: () =>
        rulesetReachFinding(
          roots.lisaRoot,
          roots.projectRoot,
          configState.config,
          rulesets,
          options.readBranches ?? readGithubBranches,
          deadline.remainingMs(),
          deadline.signal
        ),
    },
    {
      ...CHECKS[14]!,
      run: () => splashExitFinding(roots.projectRoot, safeShape.types),
    },
  ];
}

/**
 * Create the fixed-order probe registry from safely captured setup state.
 * @param roots - Canonical project and Lisa roots
 * @param roots.projectRoot - Canonical host project root
 * @param roots.lisaRoot - Lisa package root holding the shipped templates
 * @param configState - Whether `.lisa.config.json` is present, readable, and its contents
 * @param shape - Detected project types and package.json
 * @param deadline - Shared deadline bounding every probe
 * @param options - Injectable readers that replace the live defaults
 * @returns Every probe in the fixed registry order of {@link CHECKS}
 */
export function probes(
  roots: { readonly projectRoot: string; readonly lisaRoot: string },
  configState: HealthConfigState,
  shape: HealthProjectShape | undefined,
  deadline: HealthDeadline,
  options: DeterministicHealthOptions
): readonly Probe[] {
  const context: ProbeContext = {
    roots,
    configState,
    shape,
    safeShape: shape ?? { types: [], packageJson: undefined },
    deadline,
    options,
    sync: runConfigSync(roots.projectRoot, {
      dryRun: true,
      reads: safeSyncReads(roots.projectRoot),
    }),
    rulesets: shareRulesetReader(options.readRulesets ?? readGithubRulesets),
  };
  return [
    ...localProbes(context),
    ...toolingProbes(context),
    ...repositoryProbes(context),
  ];
}
