/**
 * Verify the three-part `serialize_platform_legs` opt-in is complete.
 * @module cli/doctor-serialize-legs-contract
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { loadYaml } from "../utils/yaml.js";
import type { DoctorCheck } from "./doctor.js";

const CHECK_NAME = "Maestro leg serialization wired?";

/**
 * Whether the REUSABLE workflow's own `permissions:` block grants `actions`.
 *
 * This is the part no caller can supply. A called workflow's `permissions:`
 * block is a ceiling that zeroes everything unlisted, so a caller's grant is
 * discarded at the reusable-workflow boundary no matter where it is placed.
 * While this is false, `serialize_platform_legs` cannot order anything in ANY
 * repository, and reporting a fully configured caller as `ok` would certify a
 * configuration measured to fail. It is now TRUE: the reusable workflow
 * declares `actions: read` for itself, so a fully configured caller can
 * genuinely order its legs and `ok` is an honest verdict again.
 *
 * Measured 2026-08-17 against a caller granting `actions: read` at BOTH job and
 * workflow level: the job's own token grant showed `Contents: read` and
 * `Metadata: read` with no Actions scope, the jobs API answered 403, and the
 * two platform legs started two seconds apart.
 *
 * A constant rather than a read of the workflow file, because consumers
 * reference the reusable workflow at `@main` and do not have a copy of it to
 * read. `serialize-legs-callee-grant.test.ts` pins this to the actual
 * `permissions:` block in `.github/workflows/maestro-native-e2e.yml`, so it
 * cannot drift from what Lisa ships — flipping it and forgetting the workflow,
 * or the reverse, fails that test.
 *
 * Residual limit worth naming: a consumer's `lisa doctor` comes from its
 * installed package while the workflow it runs comes from `@main`, so a stale
 * install can disagree with what actually runs. That is a property of `@main`
 * refs, not of this check.
 */
export const CALLEE_GRANTS_ACTIONS_READ = true;

/** Which of the three required parts a caller declares. */
export interface SerializeContract {
  /** `serialize_platform_legs: true` in the `with:` block. */
  readonly optedIn: boolean;
  /** `LEG_ORDER_TOKEN` forwarded in the `secrets:` block. */
  readonly forwardsToken: boolean;
  /** `actions: read` on the WORKFLOW's own top-level `permissions:` block. */
  readonly grantsActionsRead: boolean;
}

/**
 * Which required parts are missing from a declared opt-in.
 *
 * Order matters for the report: the token is named first because its absence is
 * the one the ordering job can detect and annotate at runtime, while a missing
 * or mis-scoped `actions: read` surfaces only as an HTTP 403 inside that same
 * degrade path.
 * @param contract - What the caller declares
 * @returns Human-readable names of the missing parts
 */
export function missingParts(contract: SerializeContract): readonly string[] {
  if (!contract.optedIn) {
    return [];
  }
  return [
    contract.forwardsToken ? "" : "LEG_ORDER_TOKEN (secrets:)",
    contract.grantsActionsRead ? "" : "actions: read (permissions:)",
  ].filter(part => part !== "");
}

/**
 * Whether a caller has opted in without completing the contract.
 * @param contract - What the caller declares
 * @returns True when the opt-in is declared but cannot take effect
 */
export function isIncompleteOptIn(contract: SerializeContract): boolean {
  return missingParts(contract).length > 0;
}

/**
 * Report an incomplete `serialize_platform_legs` opt-in.
 *
 * The opt-in is a THREE-part contract — the input, a forwarded
 * `LEG_ORDER_TOKEN`, and `actions: read` on the calling workflow — and getting
 * any part wrong **fails open with a green job**. Measured by a fleet session on
 * 2026-08-17: `actions: read` declared at job level instead of workflow level
 * produced HTTP 403 → warning annotation → job concluded `success` → both
 * platform legs still started within the same second.
 *
 * The runtime behaviour is deliberate and is NOT what this check changes. The
 * ordering job releases Android rather than failing, because failing turns a
 * night when both legs were green into a blocked merge gate, and releasing is
 * strictly the smaller harm. That reasoning is sound. What it leaves is the gap
 * this check closes: an operator who has opted in has no way to learn the opt-in
 * is inert except by reading a warning annotation on a green nightly run, which
 * is to say no way at all.
 *
 * So this reports at CONFIG time what the workflow can only annotate at 2am.
 *
 * Deliberately silent for a caller that has not opted in. Serialization is off
 * by default on purpose — a project whose legs authenticate as separate personas
 * gets its whole suite in the length of its slowest leg and should keep that.
 * Reporting every non-adopter would be advocacy, not a health check, and a check
 * that fires on correct configuration is one nobody reads.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkSerializeLegsContract(
  targetPath: string
): Promise<DoctorCheck> {
  const workflow = path.join(
    targetPath,
    ".github",
    "workflows",
    "maestro-e2e.yml"
  );
  const source = await readFile(workflow, "utf8").catch(() => undefined);

  if (source === undefined) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No maestro-e2e.yml caller in this project",
    };
  }

  const contract = readContract(source);
  if (!contract.optedIn) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail:
        "serialize_platform_legs is not enabled here, which is the default — " +
        "both platform legs run at once",
    };
  }

  const missing = missingParts(contract);
  if (missing.length === 0) {
    if (!CALLEE_GRANTS_ACTIONS_READ) {
      return {
        name: CHECK_NAME,
        status: "warn",
        detail:
          "serialize_platform_legs is enabled and this repository's side is " +
          "complete, but the ordering CANNOT work in this version of Lisa and " +
          "nothing here will change that. The reusable workflow's own " +
          "`permissions:` block omits `actions`, and a called workflow's " +
          "permissions are a ceiling that zeroes everything unlisted — so the " +
          "grant is discarded at the boundary wherever it is declared. The " +
          "jobs API answers 403, the ordering job logs a warning, concludes " +
          "`success`, and both legs start together. Nothing to fix here; " +
          "tracked upstream on CodySwannGT/lisa#2662",
      };
    }
    return {
      name: CHECK_NAME,
      status: "ok",
      detail:
        "serialize_platform_legs is enabled and both supporting parts are " +
        "present (LEG_ORDER_TOKEN, actions: read)",
    };
  }

  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `serialize_platform_legs is enabled but ${missing.join(" and ")} ` +
      `${missing.length === 1 ? "is" : "are"} missing from ` +
      "`.github/workflows/maestro-e2e.yml`. The opt-in is a three-part " +
      "contract and an incomplete one FAILS OPEN: the ordering job logs a " +
      "warning, concludes `success`, and both legs start together anyway — so " +
      "the suite behaves exactly as it did before the opt-in while reporting " +
      "green. `actions: read` must sit on the CALLING workflow's own " +
      "`permissions:`, not on the job: a called workflow requesting a scope " +
      "its caller never held is a startup_failure for the entire run. " +
      "The reusable workflow now declares `actions: read` for itself " +
      "(CodySwannGT/lisa#2662), so completing these parts is what makes " +
      "ordering work — and a caller that has NOT granted the scope gets a " +
      "startup_failure for its whole run, opted in or not",
  };
}

/**
 * Read which parts of the contract a caller workflow declares.
 *
 * Text matching rather than YAML parsing, deliberately. The check must work on
 * a workflow it cannot fully parse — a caller with a syntax error elsewhere, or
 * one using an anchor form the parser rejects, still deserves this answer. The
 * three markers are distinctive enough that a false positive would require
 * someone to write the exact strings in a comment.
 * @param source - Raw workflow YAML
 * @returns Declared parts of the contract
 */
export function readContract(source: string): SerializeContract {
  const uncommented = source
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
  return {
    optedIn: /serialize_platform_legs:\s*true/u.test(uncommented),
    forwardsToken: /LEG_ORDER_TOKEN:/u.test(uncommented),
    grantsActionsRead: hasWorkflowActionsRead(source, uncommented),
  };
}

/**
 * Whether `actions: read` sits on the WORKFLOW's own permissions, not a job's.
 *
 * Placement is the whole point, and a text match cannot tell the two apart. The
 * measured failure on 2026-08-17 was `actions: read` declared at JOB level: the
 * scope is not inherited by the reusable workflow's ordering job, so the API
 * call returned HTTP 403, the degrade path logged a warning, the job concluded
 * `success`, and both legs started together. A check keyed on the string alone
 * would have called that configuration complete — missing the exact defect it
 * exists to catch.
 *
 * Falls back to the text match only when the YAML will not parse, and that
 * fallback is deliberately permissive: a workflow this check cannot read is not
 * one it should accuse.
 * @param source - Raw workflow YAML
 * @param uncommented - The same source with comment lines removed
 * @returns True when the top-level permissions block grants actions: read
 */
function hasWorkflowActionsRead(source: string, uncommented: string): boolean {
  try {
    const doc = loadYaml(source) as {
      readonly permissions?: Record<string, string> | string;
    } | null;
    const permissions = doc?.permissions;
    if (typeof permissions === "string") {
      return permissions === "read-all" || permissions === "write-all";
    }
    return permissions?.actions === "read" || permissions?.actions === "write";
  } catch {
    return /actions:\s*read/u.test(uncommented);
  }
}
