/**
 * Doctor check: does THIS checkout resolve enforcement, and of what vintage?
 *
 * The dispatcher already answers this to an agent session, once per session.
 * Nobody had asked it from outside a session, which is why nothing noticed that
 * most checkouts in a fleet resolve nothing at all (CodySwannGT/lisa#3490).
 * `lisa doctor` is where an operator asks a checkout what state it is in, so
 * this is the local half of the census — the half a host project gets, since
 * the fleet roster the fleet census reads exists only on the machine that
 * manages the fleet.
 *
 * Three findings, kept apart on purpose:
 *
 *   - **Resolves nothing.** Not a stale guard — no guard. An agent working here
 *     is checked by nothing and the session says nothing.
 *   - **Resolves something old, or undateable.** A stale copy still refuses
 *     things and names its vintage in every refusal, so it is the quieter half
 *     of the same question, not the same finding.
 *   - **Installed behind declared.** This one fails in the affirmative: the
 *     guards run, every check answers, and every answer is about a version
 *     nobody is using — which is how a reviewer diffed a branch against
 *     templates from a version majors behind the one being claimed, and got a
 *     confident wrong answer.
 *
 * Warn, never fail, for the same reason `doctor-apply-freshness` warns: the
 * remedy is one command, a checkout mid-upgrade is legitimately in this state
 * for a few minutes, and reddening the exit code trains operators to ignore it.
 * @module cli/doctor-enforcement-coverage
 */
import { getPackageVersion } from "./version.js";
import { collectCheckoutCoverage } from "../core/enforcement-coverage.js";
import { isInstallBehindDeclared } from "../core/enforcement-census.js";

const CHECK_NAME = "Enforcement guards resolve in this checkout?";
const FLEET_HINT =
  "Run `node scripts/lisa-enforcement-census.mjs` from the Lisa monorepo to ask the same question of every checkout on the fleet roster.";
const REPAIR = "npx @codyswann/lisa apply";

/** One doctor check result, structurally identical to `DoctorCheck`. */
interface CoverageCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * Read this build's own version without throwing when metadata is unreadable.
 * @returns The version, or null when it cannot be determined
 */
function referenceVersion(): string | null {
  try {
    return getPackageVersion();
  } catch {
    return null;
  }
}

/**
 * Report what this checkout resolves.
 * @param targetPath - Project path
 * @returns The check result
 */
export async function checkEnforcementCoverage(
  targetPath: string
): Promise<CoverageCheck> {
  const coverage = await collectCheckoutCoverage({
    label: targetPath,
    checkoutPath: targetPath,
    reference: referenceVersion(),
  });

  if (coverage.resolution === "unreadable") {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail: `Could not look: ${coverage.unreadableReason ?? "unknown"}. That is not the same as being unprotected, and it is not the same as being covered.`,
    };
  }

  if (coverage.resolution === "none") {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail: `This checkout resolves NO Lisa enforcement guard. Not a stale guard — none. A tool call here is checked by nothing, and nothing in the session says so. Searched scripts/lisa-hooks/ and plugins/lisa/hooks/. Repair: \`${REPAIR}\`. ${FLEET_HINT}`,
    };
  }

  const notes = [
    coverage.resolution === "partial"
      ? `only ${coverage.guards.length - coverage.unresolvedGuards.length} of ${coverage.guards.length} guards resolve (missing: ${coverage.unresolvedGuards.join(", ")})`
      : null,
    coverage.vintage === "undateable"
      ? "the copy in force carries no Lisa manifest beside it, so it cannot be shown current"
      : null,
    coverage.vintage === "behind"
      ? `the copy in force is lisa ${coverage.governing?.version ?? "?"}, behind ${referenceVersion() ?? "the newest known"}`
      : null,
    coverage.receipt.present
      ? null
      : "no apply receipt records a completed `lisa apply` here",
    isInstallBehindDeclared(coverage)
      ? `installed @codyswann/lisa is ${coverage.install.installed ?? "?"} while this project declares ${coverage.install.declared ?? "?"} — every answer read out of node_modules is about a version nobody is running`
      : null,
  ].filter((note): note is string => note !== null);

  if (notes.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `All ${coverage.guards.length} guards resolve from ${coverage.governing?.tree === "host" ? "scripts/lisa-hooks/" : "plugins/lisa/hooks/"} at lisa ${coverage.governing?.version ?? "?"}, with an apply receipt.`,
    };
  }

  return {
    name: CHECK_NAME,
    status: "warn",
    detail: `${notes.join("; ")}. Repair: \`${REPAIR}\`. ${FLEET_HINT}`,
  };
}
