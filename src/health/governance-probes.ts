/** Template, package, hook, plugin, and CI deterministic health probes. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- typed probe adapters are self-describing */
import type { ProjectType } from "../core/config.js";
import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import {
  inspectHookInstallation,
  type HooksPathReader,
} from "./hook-inspection.js";
import {
  inspectPlugins,
  type InstalledPluginReader,
} from "./plugin-inspection.js";
import {
  inspectCreateOnlyWorkflows,
  inspectManagedTemplates,
  inspectWorkflowInputs,
  packageJsonConforms,
  type HealthProjectShape,
} from "./template-inspection.js";

const HOOK_CHECK = "hooks.managed";
const PLUGIN_CHECK = "plugins.current";
const PLUGIN_REMEDY =
  "Run `lisa apply .` in this project to register Lisa's Claude Code plugins for this folder.";
const WORKFLOW_CHECK = "ci.workflows";

/**
 * Managed template finding.
 * @param lisaRoot
 * @param projectRoot
 * @param shape
 * @param config
 */
export async function managedTemplateFinding(
  lisaRoot: string,
  projectRoot: string,
  shape: HealthProjectShape,
  config: Readonly<Record<string, unknown>>
): Promise<HealthFinding> {
  const drift = await inspectManagedTemplates(
    lisaRoot,
    projectRoot,
    shape.types,
    "managed",
    config
  );
  return drift.length === 0
    ? deterministicFinding(
        "templates.managed",
        "pass",
        "Managed files match their ownership-aware templates."
      )
    : deterministicFinding(
        "templates.managed",
        "fail",
        namedReason("Managed files do not match templates", drift)
      );
}

/**
 * Package governance finding.
 * @param lisaRoot
 * @param projectRoot
 * @param shape
 */
export async function packageFinding(
  lisaRoot: string,
  projectRoot: string,
  shape: HealthProjectShape
): Promise<HealthFinding> {
  const conforms = await packageJsonConforms(
    lisaRoot,
    projectRoot,
    shape.types,
    shape.packageJson
  );
  return conforms
    ? deterministicFinding(
        "package.conformance",
        "pass",
        "package.json conforms to Lisa governance."
      )
    : deterministicFinding(
        "package.conformance",
        "fail",
        "Package drift: package.json"
      );
}
/**
 * Hook bytes, mode, and installed-state finding.
 * @param lisaRoot
 * @param projectRoot
 * @param types
 * @param config
 * @param reader
 * @param timeoutMs
 * @param signal
 */
export async function hookFinding(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>,
  reader: HooksPathReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HealthFinding> {
  const [templateDrift, installed] = await Promise.all([
    inspectManagedTemplates(lisaRoot, projectRoot, types, "hooks", config),
    inspectHookInstallation(projectRoot, types, reader, timeoutMs, signal),
  ]);
  const drift = [...templateDrift, ...installed.drift];
  if (templateDrift.length > 0 || installed.status === "fail") {
    return deterministicFinding(
      HOOK_CHECK,
      "fail",
      namedReason("Git hook drift", drift)
    );
  }
  return installed.status === "warn"
    ? deterministicFinding(
        HOOK_CHECK,
        "warn",
        namedReason("Git hook state unavailable", installed.drift)
      )
    : deterministicFinding(
        HOOK_CHECK,
        "pass",
        "Git hook bytes, modes, and installation are current."
      );
}
/**
 * Actual enabled and installed plugin finding.
 * @param projectRoot
 * @param config
 * @param types
 * @param reader
 * @param timeoutMs
 * @param signal
 */
export async function pluginFinding(
  projectRoot: string,
  config: Readonly<Record<string, unknown>>,
  types: readonly ProjectType[],
  reader: InstalledPluginReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HealthFinding> {
  const inspected = await inspectPlugins(
    projectRoot,
    config,
    types,
    reader,
    timeoutMs,
    signal
  );
  if (inspected.status === "pass") {
    return deterministicFinding(
      PLUGIN_CHECK,
      "pass",
      "Lisa plugins are enabled, installed, and version-current."
    );
  }
  if (inspected.status === "warn") {
    return deterministicFinding(
      PLUGIN_CHECK,
      "warn",
      namedReason("Plugin state unavailable", inspected.drift)
    );
  }
  // Every failure here is something `lisa apply .` repairs, and dependency
  // install deliberately never registers plugins (#4135) — so a fresh clone
  // lands here. Name the fix, not only the drift (#4504).
  return deterministicFinding(
    PLUGIN_CHECK,
    "fail",
    `${namedReason("Plugin drift", inspected.drift)}. ${PLUGIN_REMEDY}`
  );
}

/**
 * Workflow presence, managed bytes, and reusable-input contract finding.
 * @param lisaRoot
 * @param projectRoot
 * @param types
 * @param config
 */
export async function workflowFinding(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<HealthFinding> {
  const [managed, missing, inputs] = await Promise.all([
    inspectManagedTemplates(lisaRoot, projectRoot, types, "workflows", config),
    inspectCreateOnlyWorkflows(lisaRoot, projectRoot, types, config),
    inspectWorkflowInputs(lisaRoot, projectRoot, types, config),
  ]);
  const drift = [...managed, ...missing, ...inputs.stale];
  if (drift.length > 0) {
    return deterministicFinding(
      WORKFLOW_CHECK,
      "fail",
      namedReason("CI workflow drift", drift)
    );
  }
  return inputs.unknown.length > 0
    ? deterministicFinding(
        WORKFLOW_CHECK,
        "warn",
        namedReason("Workflow callers Lisa could not check", inputs.unknown)
      )
    : deterministicFinding(
        WORKFLOW_CHECK,
        "pass",
        "CI workflows are present and caller inputs match shipped contracts."
      );
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns -- restore repository documentation defaults */
