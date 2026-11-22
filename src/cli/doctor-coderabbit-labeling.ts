/**
 * `lisa doctor` check: is CodeRabbit kept off Lisa's lifecycle labels?
 *
 * From 2026-02-11 to 2026-03-01 Lisa wrote a `.coderabbit.yml` into every host
 * that turned `issue_enrichment.labeling.auto_apply_labels` on with no
 * allowlist, so the bot may apply any label the repository has — `status:*`,
 * `human-needed`, `type:*`, `points:*` included. `deletions.json` has kept that
 * copy ever since, and nothing read it again; a downstream host watched the
 * bot put `status:ready` back onto claimed issues within minutes of each claim
 * (CodySwannGT/lisa#4633). `lisa apply` now corrects an unedited Lisa copy
 * (`migrations/correct-lisa-coderabbit-labeling`); this check is how every
 * other affected host — an edited copy, or one the host wrote itself — finds
 * itself.
 *
 * It reports and names the remedy; it edits nothing. Only `ENOENT` and
 * `ENOTDIR` mean the file is absent. A file that exists but could not be read
 * or parsed fails with "Could not determine", because a config this check
 * could not read is not one with nothing in it.
 * @module cli/doctor-coderabbit-labeling
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  DEFAULT_HUMAN_ONLY_LABELS,
  evaluateCoderabbitLabeling,
  SHIPPED_CODERABBIT_CONFIG_DIGESTS,
} from "../core/coderabbit-labeling.js";
import { isShippedVersion } from "../core/retire-unmodified.js";
import { getAtPath } from "../sync/json-path.js";
import { loadYaml } from "../utils/yaml.js";
import type { DoctorCheck } from "./doctor.js";
import { readConfinedMergedConfig } from "./confined-project-read.js";

/** Name of the labeling check as doctor reports it. */
export const CODERABBIT_LABELING_CHECK_NAME =
  "CodeRabbit kept off Lisa's lifecycle labels?";

/** The repository config file names CodeRabbit reads, in lookup order. */
const CONFIG_FILES = [".coderabbit.yml", ".coderabbit.yaml"] as const;

/** Config path of the project's human-needed label. */
const HUMAN_NEEDED_PATH = "github.labels.build.human_needed";

/** A located config file: its name and bytes. */
interface FoundConfig {
  readonly name: string;
  readonly bytes: Buffer;
}

/**
 * Whether a filesystem error means the path is simply not there.
 * @param error - Value thrown by a filesystem call
 * @returns True for ENOENT / ENOTDIR
 */
function isAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Read every CodeRabbit config present, REJECTING when one exists but cannot
 * be read. Both spellings are read because a repository can carry both, and
 * which one CodeRabbit honours is not something this check can see — so
 * either one being unsafe is a finding.
 * @param projectRoot - Absolute project root
 * @returns The configs present, in lookup order (empty when none)
 * @throws {Error} When a config file exists but could not be read
 */
async function findConfigs(
  projectRoot: string
): Promise<readonly FoundConfig[]> {
  const found = await Promise.all(
    CONFIG_FILES.map(async name => await readConfig(projectRoot, name))
  );
  return found.filter((config): config is FoundConfig => config !== null);
}

/**
 * Read one CodeRabbit config, REJECTING when it exists but cannot be read.
 * @param projectRoot - Absolute project root
 * @param name - Config file name
 * @returns The config, or null when the file is absent
 * @throws {Error} When the file exists but could not be read
 */
async function readConfig(
  projectRoot: string,
  name: string
): Promise<FoundConfig | null> {
  try {
    return { name, bytes: await readFile(path.join(projectRoot, name)) };
  } catch (error) {
    if (isAbsence(error)) return null;
    const code = (error as { code?: unknown } | null)?.code;
    throw new Error(`could not read ${name}: ${String(code ?? error)}`, {
      cause: error,
    });
  }
}

/**
 * Every human-only label this project uses: Lisa's default plus whatever the
 * project configured. A config that cannot be read still protects the default.
 * @param projectRoot - Absolute project root
 * @returns Human-only labels
 */
async function humanOnlyLabels(projectRoot: string): Promise<string[]> {
  const configured = await readConfinedMergedConfig(projectRoot)
    .then(config => getAtPath(config, HUMAN_NEEDED_PATH))
    .catch(() => undefined);
  return typeof configured === "string" && configured.trim() !== ""
    ? [...new Set([...DEFAULT_HUMAN_ONLY_LABELS, configured])]
    : [...DEFAULT_HUMAN_ONLY_LABELS];
}

/**
 * The two remedies, stated with the project's own human-needed label.
 * @param humanOnly - Human-only labels
 * @returns Remedy sentence
 */
function remedies(humanOnly: readonly string[]): string {
  const reserved = humanOnly.map(quote).join(" or ");
  return (
    "Either set `issue_enrichment.labeling.auto_apply_labels: false`, or add " +
    "`labeling_instructions` listing only the labels the bot may apply, " +
    `naming no \`status:\`, \`type:\` or \`points:\` label and not ${reserved}`
  );
}

/**
 * Wrap a label in backticks for the report.
 * @param label - Label name
 * @returns Quoted label
 */
function quote(label: string): string {
  return `\`${label}\``;
}

/**
 * Report whether this repository's CodeRabbit config can make the bot write
 * Lisa's lifecycle, human-only, or writer-owned labels.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkCoderabbitLabeling(
  targetPath: string
): Promise<DoctorCheck> {
  try {
    const found = await findConfigs(targetPath);
    if (found.length === 0) {
      return ok(
        "No .coderabbit.yml in this repository. CodeRabbit's organisation " +
          "settings are not visible to this check; make sure they do not " +
          "auto-apply labels either"
      );
    }
    const humanOnly = await humanOnlyLabels(targetPath);
    return verdictCheck(
      found.map(config => judgeFile(config, humanOnly)),
      humanOnly
    );
  } catch (error) {
    return {
      name: CODERABBIT_LABELING_CHECK_NAME,
      status: "fail",
      detail:
        "Could not determine whether this repository's CodeRabbit config " +
        `lets the bot apply Lisa's lifecycle labels: ${
          error instanceof Error ? error.message : String(error)
        }. Treated as a failure rather than a pass: a config that could not ` +
        "be read is not one with nothing in it",
    };
  }
}

/** What one config file earns: safe or not, and the sentence saying why. */
interface FileVerdict {
  readonly safe: boolean;
  readonly detail: string;
}

/**
 * Judge one located config.
 * @param found - The located config
 * @param humanOnly - Human-only labels
 * @returns The file's verdict
 * @throws {Error} When the config does not parse, or sets `auto_apply_labels`
 *   to something that is neither true nor false
 */
function judgeFile(
  found: FoundConfig,
  humanOnly: readonly string[]
): FileVerdict {
  const verdict = evaluateCoderabbitLabeling(
    loadYaml(found.bytes.toString("utf8")),
    humanOnly
  );
  if (verdict.reason === "undeterminable") {
    throw new Error(
      `${found.name} sets \`auto_apply_labels\` to ${JSON.stringify(
        verdict.value
      )}, which is neither true nor false`
    );
  }
  if (verdict.safe) {
    return {
      safe: true,
      detail:
        verdict.reason === "auto-apply-off"
          ? `${found.name} does not auto-apply labels`
          : `${found.name} allowlists no lifecycle, human-only, type or points label`,
    };
  }
  const cause =
    verdict.reason === "no-allowlist"
      ? `${found.name} turns on \`auto_apply_labels\` with no ` +
        "`labeling_instructions` allowlist, so CodeRabbit may apply any " +
        "label, including Lisa's `status:` lifecycle labels"
      : `${found.name} lets CodeRabbit auto-apply ${verdict.offending
          .map(quote)
          .join(", ")}, which only Lisa or a human may set`;
  const authorship = isShippedVersion(
    found.bytes,
    SHIPPED_CODERABBIT_CONFIG_DIGESTS
  )
    ? " Lisa wrote this file (the template it shipped from 2026-02-11 to " +
      "2026-03-01) and it is unedited; `npx @codyswann/lisa@latest .` " +
      "rewrites it with auto-apply off."
    : "";
  return { safe: false, detail: `${cause}.${authorship}` };
}

/**
 * Turn every file's verdict into the one check line they earn together:
 * a failure if any file is unsafe, naming each unsafe file.
 * @param verdicts - One verdict per config file present
 * @param humanOnly - Human-only labels
 * @returns Doctor check result
 */
function verdictCheck(
  verdicts: readonly FileVerdict[],
  humanOnly: readonly string[]
): DoctorCheck {
  const unsafe = verdicts.filter(verdict => !verdict.safe);
  if (unsafe.length === 0) {
    return ok(verdicts.map(verdict => verdict.detail).join("; "));
  }
  const causes = unsafe.map(verdict => verdict.detail).join(" ");
  return {
    name: CODERABBIT_LABELING_CHECK_NAME,
    status: "fail",
    detail: `${causes} ${remedies(humanOnly)}`,
  };
}

/**
 * A passing line for this check.
 * @param detail - What was found
 * @returns Doctor check result
 */
function ok(detail: string): DoctorCheck {
  return { name: CODERABBIT_LABELING_CHECK_NAME, status: "ok", detail };
}
