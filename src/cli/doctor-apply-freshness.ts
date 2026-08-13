/**
 * Doctor check: has `lisa apply` ever actually succeeded here, and did it
 * succeed on the Lisa version this project now has installed?
 *
 * This is the arm that would have caught geminisportsai/frontend-v2
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
 * A third silence lives in the same subsystem: postinstall-safe mode
 * (`--skip-git-check`, which is what a package manager runs) skips every agent
 * emit. That is deliberate — those emits rewrite host-owned files — but it
 * means no `bun install` at any version can reconcile `.codex/config.toml`, so
 * repos on the newest Lisa still carry a deprecated `codex_hooks` key and an
 * audit reasonably but wrongly concluded "apply just hasn't re-run". Same shape
 * as #2436: postinstall-safe mode skipping work callers assume a bump performs.
 * A receipt whose only recorded apply was postinstall-safe warns for that too.
 *
 * Warn, not fail: the remedy is one command, and a project mid-upgrade — or one
 * freshly cloned and not yet installed — is legitimately in this state for a
 * few minutes. Reddening doctor's exit code there would train operators to
 * ignore it, which is how the original silence took hold.
 * @module cli/doctor-apply-freshness
 */
import * as path from "node:path";
import { lt, valid } from "semver";
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
/** No `--skip-git-check`: the only form that performs the agent emits. */
const FULL_APPLY_COMMAND = "node node_modules/@codyswann/lisa/dist/index.js .";

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
    return receipt.apply_mode === "postinstall-safe"
      ? {
          name: CHECK_NAME,
          status: "warn",
          detail:
            `Templates are current (Lisa ${recorded} on ${appliedOn}), but the only apply ` +
            "recorded here ran in postinstall-safe mode, which skips every agent emit — " +
            "Codex, Claude, agy, Copilot, OpenCode — and the Sonar integration. No package " +
            "install at any version performs that work, so artifacts like `.codex/config.toml` " +
            `are still unreconciled. Run \`${FULL_APPLY_COMMAND}\` to complete it.`,
        }
      : {
          name: CHECK_NAME,
          status: "ok",
          detail: `Last successful apply: Lisa ${recorded} on ${appliedOn}`,
        };
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
