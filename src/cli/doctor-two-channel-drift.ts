/**
 * Doctor check: tell a consumer which caller-tree artifacts the `@main`
 * workflows they already run need, and their checkout does not have.
 *
 * The consumer is the only party who can act. A workflow body reaches them at
 * `@main` on their next run, needing nothing from them; the script that body
 * invokes reaches them only when somebody applies, and for a `create-only`
 * artifact never at all. So when the two halves are out of step it is the
 * consumer's tree that is behind, and Lisa's own CI — where every path
 * resolves — is the last place that will notice. Precedent: #3169 states the
 * same limitation honestly and answers it with a doctor advisory, and #3070
 * shows what silence costs when a consumer cannot tell they are the one who
 * has to move.
 *
 * ## Why this reads a shipped ledger rather than deriving the answer
 *
 * `.github/` is NOT in the npm `files` allowlist, so the reusable workflow
 * bodies are not on the consumer's disk in any form. The fast half exists only
 * on `CodySwannGT/lisa@main`, which is precisely the mechanism that makes the
 * gap silent — there is nothing local to compare against. What Lisa can ship is
 * the derived ledger (`scripts/two-channel-couplings.json`, inside the
 * allowlist), which records what each reusable reads from a caller's tree.
 *
 * That ledger is the INSTALLED version's, so this check sees a requirement
 * introduced up to one release before the consumer's package. It is therefore
 * exact for the population the ticket is about — a consumer whose apply is
 * behind — and blind to a requirement added to `main` after their last bump.
 * Reading the ledger from `main` rather than from the package is the next
 * stage, and needs network access `lisa doctor` deliberately does not have.
 *
 * ## Absent, empty, and satisfied are three different answers
 *
 * A consumer running a Lisa old enough to predate the ledger gets a WARN
 * saying the measurement did not run — never a pass. A ledger that is present
 * and unreadable, or that carries no couplings at all while the consumer runs
 * `@main` callers, is a FAIL: Lisa shipped it, so it cannot be empty, and an
 * empty comparison must not look like a converged one. A consumer whose tree
 * satisfies every coupling gets an OK that states how many were inspected, so
 * "nothing to report" is always distinguishable from "nothing was looked at".
 * @module cli/doctor-two-channel-drift
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { DoctorCheck } from "./doctor.js";

/** Name rendered in the doctor report. */
const CHECK_NAME = "Two-channel delivery drift";

/** The ledger's location relative to the package root, in either tree layout. */
const LEDGER_RELATIVE = path.join("scripts", "two-channel-couplings.json");

/** A caller job pointing at a Lisa reusable, capturing the file and the ref. */
const LISA_CALLER =
  /uses:\s*["']?CodySwannGT\/lisa\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)@([^\s"']+)/g;

/** The ref that makes a caller receive a change without acting. */
const LIVE_REF = "main";

/** One coupling as the shipped ledger records it. */
interface LedgerCoupling {
  readonly key: string;
  readonly workflow: string;
  readonly path: string;
  readonly verdict: string;
  readonly remedy: string;
  readonly detail: string;
}

/** The shipped ledger. */
interface Ledger {
  readonly couplings?: readonly LedgerCoupling[];
}

/** What the ledger read produced. */
type LedgerRead =
  | { readonly state: "absent" }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "read"; readonly couplings: readonly LedgerCoupling[] };

/** Verdicts no apply and no dependency bump ever closes. */
const UNRESTORABLE: ReadonlySet<string> = new Set([
  "never-delivered",
  "undelivered",
]);

/**
 * Where the ledger sits for the running Lisa, source tree or published package.
 * @returns Absolute path to the ledger
 */
function defaultLedgerPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "..", "..", LEDGER_RELATIVE);
}

/**
 * Read the shipped ledger, reporting the failure rather than throwing.
 * @param ledgerPath - Absolute path to the ledger
 * @returns What the read produced
 */
async function readLedger(ledgerPath: string): Promise<LedgerRead> {
  if (!existsSync(ledgerPath)) return { state: "absent" };
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf-8")) as Ledger;
    return { state: "read", couplings: parsed.couplings ?? [] };
  } catch (error) {
    return {
      state: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Which Lisa reusables this project receives on the live channel.
 *
 * A caller pinned to a tag or a SHA is excluded on purpose: it does not
 * receive a change until somebody repoints it, so its halves cannot fall out
 * of step the way this check is about. Whether it SHOULD be pinned is a
 * different question, and `doctor-reusable-workflow-refs` already asks it.
 * @param targetPath - Project root
 * @returns Reusable workflow file names called at `@main`, sorted
 */
export async function liveCallers(
  targetPath: string
): Promise<readonly string[]> {
  const directory = path.join(targetPath, ".github", "workflows");
  const names = await readdir(directory).catch(() => undefined);
  if (names === undefined) return [];
  const texts = await Promise.all(
    names
      .filter(name => /\.ya?ml$/.test(name))
      .map(name =>
        readFile(path.join(directory, name), "utf-8").catch(() => "")
      )
  );
  const found = texts.flatMap(text =>
    [...text.matchAll(LISA_CALLER)]
      .filter(match => match[2] === LIVE_REF)
      .map(match => match[1] ?? "")
  );
  return [...new Set(found)]
    .filter(name => name !== "")
    .sort((left, right) => left.localeCompare(right));
}

/**
 * One sentence naming a coupling, what it costs, and how to adopt it.
 * @param coupling - The coupling the tree does not satisfy
 * @returns The advisory line
 */
function advisoryFor(coupling: LedgerCoupling): string {
  const step =
    coupling.remedy === "run-lisa-apply"
      ? "Run `lisa apply` — the artifact is delivered on that channel and your tree is behind it."
      : coupling.remedy === "adopt-the-artifact"
        ? "Lisa writes this artifact ONCE, at scaffold time, and never refreshes it — no version bump brings it. Copy it in from the Lisa package's delivery lane and commit it."
        : "Lisa ships no such artifact. Author it in your own tree, or decline the gate deliberately via `skip_jobs` so the decision is recorded in the caller.";
  return `  - \`${coupling.workflow}\` reads \`${coupling.path}\`, which your tree does not have. ${coupling.detail} ${step}`;
}

/**
 * Report caller-tree artifacts the project's live `@main` callers need.
 * @param targetPath - Project path to inspect
 * @param ledgerPath - Optional ledger location, for tests
 * @returns The doctor check result
 */
export async function checkTwoChannelDrift(
  targetPath: string,
  ledgerPath: string = defaultLedgerPath()
): Promise<DoctorCheck> {
  const callers = await liveCallers(targetPath);
  if (callers.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail:
        "this project calls no Lisa reusable workflow at `@main`, so nothing " +
        "reaches it on the fast channel and no half can be ahead of the other. " +
        "A determinate zero, not an unread one.",
    };
  }

  const ledger = await readLedger(ledgerPath);
  if (ledger.state === "absent") {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail:
        `this project calls ${callers.length} Lisa reusable(s) at \`@main\`, but ` +
        `the installed Lisa predates ${LEDGER_RELATIVE}, so the measurement DID ` +
        "NOT RUN. This is not a clean result — upgrade `@codyswann/lisa` to " +
        "measure it.",
    };
  }
  if (ledger.state === "unreadable") {
    return {
      name: CHECK_NAME,
      status: "fail",
      detail:
        `${LEDGER_RELATIVE} could not be read (${ledger.reason}), so nothing ` +
        `was compared for the ${callers.length} reusable(s) this project calls ` +
        "at `@main`. Reported as a failure rather than a pass: an unreadable " +
        "manifest and a converged checkout must not look the same.",
    };
  }
  if (ledger.couplings.length === 0) {
    return {
      name: CHECK_NAME,
      status: "fail",
      detail:
        `${LEDGER_RELATIVE} carries no couplings, so the ${callers.length} ` +
        "reusable(s) this project calls at `@main` were compared against " +
        "nothing. Lisa ships that ledger derived from its own workflows and it " +
        "cannot legitimately be empty.",
    };
  }

  const relevant = ledger.couplings.filter(coupling =>
    callers.includes(coupling.workflow)
  );
  const missing = relevant.filter(
    coupling => !existsSync(path.join(targetPath, coupling.path))
  );
  const inspected =
    `Inspected ${relevant.length} coupling(s) across ${callers.length} live ` +
    `caller(s) (${callers.join(", ")}).`;

  if (missing.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `${inspected} Every caller-tree artifact those workflows read is present, so both halves are in step.`,
    };
  }
  const unrestorable = missing.filter(coupling =>
    UNRESTORABLE.has(coupling.verdict)
  );
  return {
    name: CHECK_NAME,
    status: unrestorable.length > 0 ? "fail" : "warn",
    detail: `${inspected} ${missing.length} of them read a caller-tree artifact this checkout does not have — the workflow half arrived at \`@main\` and the artifact half did not:\n${missing.map(advisoryFor).join("\n")}`,
  };
}
