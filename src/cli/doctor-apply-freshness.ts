/**
 * Doctor check: has `lisa apply` ever actually succeeded here, and did it
 * succeed on the Lisa version this project now has installed?
 *
 * This is the arm that would have caught acmeorgb/frontend-v2
 * (CodySwannGT/lisa#2467). That repo's `lisa apply` had been failing outright
 * for months — an incompatible js-yaml pin killed the CLI before it could print
 * anything — while the postinstall bootstrap discarded the error. Nothing
 * anywhere said the repo had stopped receiving templates, guardrails, or
 * security floors. The only way to find out was for a human to run apply by
 * hand and read the crash.
 *
 * The signal is the apply receipt (`core/apply-receipt`), written only by a
 * completed apply. Missing receipt means no apply has ever finished; an older
 * version stamp means none has finished since that version. Both are reported
 * with the version and date, and with the command that reproduces the failure.
 *
 * A third silence lives in the same subsystem: postinstall-safe mode (what a
 * package manager's install declares, via `--postinstall-safe` /
 * `LISA_POSTINSTALL=1`) skips every agent emit. That is deliberate — those emits rewrite host-owned files — but it
 * means no `bun install` at any version can reconcile `.codex/config.toml`, so
 * repos on the newest Lisa still carry a deprecated `codex_hooks` key and an
 * audit reasonably but wrongly concluded "apply just hasn't re-run". Same shape
 * as #2436: postinstall-safe mode skipping work callers assume a bump performs.
 * A receipt whose only recorded apply was postinstall-safe warns for that too.
 *
 * A fourth silence, and the quietest of them, is a bump that leaves managed
 * root configs behind. The apply detects those and refuses to replace them,
 * which is right — nobody is there to ask, and #3026 is what happens when a
 * missing terminal is read as consent. But it says so once, into install
 * output, and then the repository carries a fork that has silently stopped
 * receiving upstream fixes. A consumer bumped two dozen versions that way and
 * the only surface that ever noticed was a fork-drift guard it happened to run
 * itself; doctor called the repo current. So the apply now records the paths in
 * the receipt and this check names them, with a per-path `--refresh-templates`
 * remedy (CodySwannGT/lisa#3033).
 *
 * Warn, not fail: the remedy is one command, and a project mid-upgrade — or one
 * freshly cloned and not yet installed — is legitimately in this state for a
 * few minutes. Reddening doctor's exit code there would train operators to
 * ignore it, which is how the original silence took hold.
 * @module cli/doctor-apply-freshness
 */
import * as path from "node:path";
import { lt, valid } from "semver";
import type { ApplyReceipt } from "../core/apply-receipt.js";
import {
  APPLY_RECEIPT_DISPLAY_PATH,
  readApplyReceipt,
} from "../core/apply-receipt.js";
import { LISA_PACKAGE_NAME, isLisaSourceRepo } from "../core/self-apply.js";
import { readJsonOrNull } from "../utils/json-utils.js";
import { probeYamlRuntime } from "../utils/yaml.js";
import { getPackageVersion } from "./version.js";

const CHECK_NAME = "Templates applied by this Lisa version?";
const YAML_CHECK_NAME = "YAML runtime usable?";
const REAPPLY_COMMAND =
  "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check .";
/**
 * A plain operator apply, which performs the agent emits.
 *
 * `REAPPLY_COMMAND` above performs them too now — since
 * CodySwannGT/lisa#3066 `--skip-git-check` waives only the clean-tree check —
 * but this is the form to hand someone whose tree is already clean.
 */
const FULL_APPLY_COMMAND = "node node_modules/@codyswann/lisa/dist/index.js .";
/**
 * How many stale paths to name inline before deferring to the receipt.
 *
 * Naming them is the whole point, so the cap is generous; a doctor line that
 * runs to two hundred filenames is one an operator scrolls past, which is the
 * failure mode this check exists to end.
 */
const MAX_NAMED_STALE_PATHS = 10;
/** What a postinstall-safe apply never performs, whatever version ran it. */
const SKIPPED_AGENT_EMITS =
  "The only apply recorded here ran in postinstall-safe mode, which skips every agent " +
  "emit — Codex, Claude, agy, Copilot, OpenCode — and the Sonar integration. No package " +
  "install at any version performs that work, so artifacts like `.codex/config.toml` " +
  `are still unreconciled. Run \`${FULL_APPLY_COMMAND}\` to complete it.`;

/** One doctor check result, structurally identical to `DoctorCheck`. */
interface FreshnessCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** Dependency sections that can declare Lisa. */
interface ManifestShape {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * Resolve Lisa's version without throwing when package metadata is unreadable.
 * @returns Version string, or null when it cannot be determined
 */
function installedLisaVersion(): string | null {
  try {
    return getPackageVersion();
  } catch {
    return null;
  }
}

/**
 * Decide whether this project is one Lisa is supposed to be applying to.
 *
 * Deliberately based on the manifest rather than on `.lisa.config.json`: a
 * project that has *never* applied successfully may not have a config yet, and
 * that is exactly the case this check exists to report.
 * @param targetPath - Project path
 * @returns True when the project declares Lisa as a dependency
 */
async function declaresLisa(targetPath: string): Promise<boolean> {
  const manifest = await readJsonOrNull<ManifestShape>(
    path.join(targetPath, "package.json")
  );
  if (!manifest) return false;
  return (
    manifest.dependencies?.[LISA_PACKAGE_NAME] !== undefined ||
    manifest.devDependencies?.[LISA_PACKAGE_NAME] !== undefined
  );
}

/**
 * Render an ISO timestamp as a plain calendar date, degrading to the raw value.
 * @param isoTimestamp - Timestamp from the receipt
 * @returns `YYYY-MM-DD`, or the input when it is not a real date
 */
function toCalendarDate(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime())
    ? isoTimestamp
    : parsed.toISOString().slice(0, 10);
}

/**
 * Build the "never applied" warning.
 * @param installed - Installed Lisa version
 * @returns Doctor check result
 */
function neverApplied(installed: string): FreshnessCheck {
  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `No successful Lisa apply has ever been recorded here (installed Lisa ${installed}; ` +
      `no ${APPLY_RECEIPT_DISPLAY_PATH}). This repo is not receiving template, guardrail, ` +
      `or dependency-floor updates. Run \`${REAPPLY_COMMAND}\` and read the output — ` +
      "the postinstall bootstrap is non-fatal, so an apply that crashes every time " +
      "will not stop an install.",
  };
}

/**
 * Describe the managed files the last apply deliberately left out of date.
 *
 * This is the arm that closes CodySwannGT/lisa#3033. The apply itself already
 * detects these and names them — correctly, and without overwriting anything,
 * because an unattended run has nobody to ask and a hand-edited
 * `eslint.config.ts` is not Lisa's to replace (#3026). What was missing is that
 * the report died with the install output. A consumer bumped two dozen versions,
 * three `copy-overwrite` assets stopped tracking upstream, and the only surface
 * that ever said so was a fork-drift guard the repo happened to run on its own.
 * Doctor — the tool README nominates as the durable signal — reported the repo
 * as current.
 *
 * The remedy names ONE PATH AT A TIME on purpose. Bare `--refresh-templates` is
 * repo-wide: handing that to an operator who wants one guard back would revert
 * every deliberate fork in the project in the same command.
 * @param stalePaths - Managed files the recorded apply left alone
 * @returns A sentence naming the files and the per-path remedy
 */
function describeStalePaths(stalePaths: readonly string[]): string {
  const shown = stalePaths.slice(0, MAX_NAMED_STALE_PATHS);
  const remainder = stalePaths.length - shown.length;
  const overflow =
    remainder > 0
      ? ` (+${remainder} more in ${APPLY_RECEIPT_DISPLAY_PATH})`
      : "";
  return (
    `${stalePaths.length} managed file(s) changed upstream and were NOT updated here: ` +
    `${shown.join(", ")}${overflow}. Each one has stopped receiving upstream fixes, ` +
    "security fixes included. Nothing was overwritten, which is correct — an unattended " +
    "apply must not replace a file this project may have customised. Decide per file: take " +
    "upstream's with `lisa apply . --refresh-templates=<path>`, naming ONE path at a time " +
    "(the bare flag is repo-wide and reverts every deliberate fork), or keep yours by adding " +
    "the path to .lisaignore."
  );
}

/**
 * Describe a receipt whose version stamp is current.
 *
 * "Current version" and "current templates" are not the same claim, and
 * reporting the first as if it were the second is what let a fork sit
 * undetected. Two independent things can still be outstanding — files the apply
 * left stale, and the agent emits postinstall-safe never performs — so both are
 * reported when both apply, rather than one shadowing the other.
 * @param receipt - The receipt read from the project
 * @param recorded - Version the receipt stamps
 * @param appliedOn - Calendar date of that apply
 * @returns Doctor check result
 */
function describeCurrentReceipt(
  receipt: ApplyReceipt,
  recorded: string,
  appliedOn: string
): FreshnessCheck {
  const concerns = [
    receipt.stale_paths.length > 0
      ? describeStalePaths(receipt.stale_paths)
      : "",
    receipt.apply_mode === "postinstall-safe" ? SKIPPED_AGENT_EMITS : "",
  ].filter(concern => concern !== "");

  if (concerns.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `Last successful apply: Lisa ${recorded} on ${appliedOn}`,
    };
  }
  return {
    name: CHECK_NAME,
    status: "warn",
    detail: `Lisa ${recorded} applied on ${appliedOn}. ${concerns.join(" ")}`,
  };
}

/**
 * Compare the receipt against the installed version.
 * @param targetPath - Project path
 * @param installed - Installed Lisa version
 * @returns Doctor check result
 */
async function compareReceipt(
  targetPath: string,
  installed: string
): Promise<FreshnessCheck> {
  const receipt = await readApplyReceipt(targetPath);
  if (receipt === null) {
    return neverApplied(installed);
  }

  const recorded = receipt.lisa_version;
  const appliedOn = toCalendarDate(receipt.applied_at);
  const bothParse = valid(recorded) !== null && valid(installed) !== null;
  const isStale = bothParse ? lt(recorded, installed) : recorded !== installed;

  if (!isStale) {
    return describeCurrentReceipt(receipt, recorded, appliedOn);
  }

  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `This repo has not successfully applied templates since Lisa ${recorded} ` +
      `(${appliedOn}); installed Lisa is ${installed}. Everything shipped between ` +
      `those versions is missing here. Run \`${REAPPLY_COMMAND}\` and read the output.`,
  };
}

/**
 * Report whether template application is current for this checkout.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkApplyFreshness(
  targetPath: string
): Promise<FreshnessCheck> {
  if (await isLisaSourceRepo(targetPath)) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail:
        "Lisa source repo; apply is self-restricted and records no receipt",
    };
  }
  if (!(await declaresLisa(targetPath))) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `${LISA_PACKAGE_NAME} is not a dependency here; skipped`,
    };
  }

  const installed = installedLisaVersion();
  if (installed === null) {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail:
        "Could not determine the installed Lisa version to compare against",
    };
  }
  return compareReceipt(targetPath, installed);
}

/**
 * Report whether the js-yaml this install resolved can actually be driven.
 *
 * Separate from the freshness check because it answers the follow-up question:
 * *why* has nothing applied? A host `overrides`/`resolutions` entry collapses
 * Lisa's own js-yaml onto the host's pin, and an incompatible pin used to kill
 * the CLI at module-load time with a bare stack trace. Lisa now links against
 * any js-yaml shape and reports the incompatibility in plain language here.
 *
 * `fail`, not `warn`: nothing that parses YAML works in this state — Codex and
 * OpenCode artifact generation, CI workflow readiness, and the console's deploy
 * pipeline all stop — and the remedy is a one-line manifest edit.
 * @returns Doctor check result
 */
export function checkYamlRuntime(): FreshnessCheck {
  const problem = probeYamlRuntime();
  return problem === null
    ? {
        name: YAML_CHECK_NAME,
        status: "ok",
        detail: "Resolved js-yaml exposes a usable load()",
      }
    : { name: YAML_CHECK_NAME, status: "fail", detail: problem };
}
