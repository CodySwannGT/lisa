/** Safe local project/doctor-derived deterministic health probes. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- typed doctor projections are self-describing */
import path from "node:path";

import { CLAUDE_MD_AGENTS_IMPORT } from "../claude/claude-md-installer.js";
import {
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
} from "../codex/hooks-installer.js";
import { LISA_SKILLS_SUBDIR } from "../codex/skills-installer.js";
import {
  LISA_RULES_END_MARKER,
  LISA_RULES_START_MARKER,
} from "../core/instruction-files-migration.js";
import type { SyncReport } from "../sync/config-sync.js";
import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import { projectPathKind, readProjectText } from "./read-only-fs.js";
import type { HealthProjectShape } from "./template-inspection.js";

const PROJECT_STATE_CHECK = "project.state";
const PROJECT_WIKI_CHECK = "project.wiki";

/** Result of safely loading committed project configuration. */
export interface HealthConfigState {
  readonly config: Readonly<Record<string, unknown>>;
  readonly present: boolean;
  readonly readable: boolean;
}

/**
 * Project and legacy overlay check derived from doctor without mutation.
 * @param projectRoot
 * @param configState
 * @param shape
 */
export async function projectStateFinding(
  projectRoot: string,
  configState: HealthConfigState,
  shape: HealthProjectShape | undefined
): Promise<HealthFinding> {
  if (!configState.present || !configState.readable || shape === undefined) {
    return deterministicFinding(
      PROJECT_STATE_CHECK,
      "fail",
      "Project config or project shape is missing, malformed, or unsafe."
    );
  }
  if (shape.types.length === 0) {
    return deterministicFinding(
      PROJECT_STATE_CHECK,
      "warn",
      "No supported Lisa project type was safely detected."
    );
  }
  const legacy = await Promise.all(
    [LISA_HOOKS_SUBDIR, LISA_RULES_SUBDIR, LISA_SKILLS_SUBDIR].map(
      async subdir => {
        const relative = path.join(".codex", subdir);
        return (await projectPathKind(projectRoot, relative)) === "directory"
          ? relative.split(path.sep).join("/")
          : undefined;
      }
    )
  );
  const present = legacy.filter((item): item is string => item !== undefined);
  return present.length === 0
    ? deterministicFinding(
        PROJECT_STATE_CHECK,
        "pass",
        "Project config, type, and local doctor state are readable."
      )
    : deterministicFinding(
        PROJECT_STATE_CHECK,
        "warn",
        namedReason("Legacy Codex overlay paths", present)
      );
}

/**
 * Local wiki contract check derived from doctor without network or writes.
 * @param projectRoot
 */
export async function wikiFinding(projectRoot: string): Promise<HealthFinding> {
  const wiki = await projectPathKind(projectRoot, "wiki");
  if (wiki === "missing") {
    return deterministicFinding(
      PROJECT_WIKI_CHECK,
      "pass",
      "No local wiki contract is present."
    );
  }
  if (wiki !== "directory") {
    return deterministicFinding(
      PROJECT_WIKI_CHECK,
      "fail",
      "The local wiki path is unsafe or not a directory."
    );
  }
  const required = [
    "wiki/lisa-wiki.config.json",
    "wiki/schema/llm-wiki-contract.md",
    "wiki/index.md",
  ];
  const missing = (
    await Promise.all(
      required.map(async relative =>
        (await projectPathKind(projectRoot, relative)) === "file"
          ? undefined
          : relative
      )
    )
  ).filter((item): item is string => item !== undefined);
  return missing.length === 0
    ? deterministicFinding(
        PROJECT_WIKI_CHECK,
        "pass",
        "Local wiki contract files are present."
      )
    : deterministicFinding(
        PROJECT_WIKI_CHECK,
        "fail",
        namedReason("Missing wiki contract files", missing)
      );
}

/** Offline representation of doctor's network-only starter check. */
export function starterFinding(): HealthFinding {
  return deterministicFinding(
    "starters.remote",
    "warn",
    "Starter repository reachability is unavailable in the offline deterministic path."
  );
}

/**
 * Read-only canonical instruction check.
 * @param projectRoot
 */
export async function instructionFinding(
  projectRoot: string
): Promise<HealthFinding> {
  const [agents, claude] = await Promise.all([
    readProjectText(projectRoot, "AGENTS.md"),
    readProjectText(projectRoot, "CLAUDE.md"),
  ]);
  const drift = [
    ...(agents === undefined ? ["AGENTS.md"] : []),
    ...(agents?.includes(LISA_RULES_START_MARKER) === true ||
    agents?.includes(LISA_RULES_END_MARKER) === true
      ? ["AGENTS.md legacy managed block"]
      : []),
    ...(claude === undefined || !claude.includes(CLAUDE_MD_AGENTS_IMPORT)
      ? ["CLAUDE.md"]
      : []),
  ];
  return drift.length === 0
    ? deterministicFinding(
        "instructions.canonical",
        "pass",
        "Instruction files are canonical."
      )
    : deterministicFinding(
        "instructions.canonical",
        "fail",
        namedReason("Instruction file drift", drift)
      );
}

/**
 * Convert one dry-run sync report into required-key and sync findings.
 * @param report
 */
export function configFindings(
  report: SyncReport
): readonly [HealthFinding, HealthFinding] {
  const keys = report.missingRequired.map(item => item.key);
  const actions = report.actions.map(action => action.key);
  return [
    keys.length === 0
      ? deterministicFinding(
          "config.required",
          "pass",
          "Required config keys are populated."
        )
      : deterministicFinding(
          "config.required",
          "fail",
          namedReason("Missing required config keys", keys)
        ),
    actions.length === 0
      ? deterministicFinding(
          "config.sync",
          "pass",
          "Config and mirrored artifacts are synchronized."
        )
      : deterministicFinding(
          "config.sync",
          "fail",
          namedReason("Config sync drift", actions)
        ),
  ];
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns -- restore repository documentation defaults */
