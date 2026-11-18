/**
 * A fixture repository in the state the enforce step leaves it in, with the
 * three results saved the way the skill saves them, for the suites about
 * `lisa controls enforce-report` (CodySwannGT/lisa#4994).
 *
 * The results are written by hand here, not by running the commands that
 * print them, so a case can hand over any result, right or wrong. The
 * commands themselves are run for real by
 * `tests/integration/controls-enforce.test.ts`.
 * @module tests/unit/controls/support/enforce-run
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach } from "vitest";

import { loadAuditReport } from "../../../../src/controls/audit-report-file.js";
import { listControlGaps } from "../../../../src/controls/commands/gaps.js";
import type {
  EnforceInputPaths,
  HandedTicket,
} from "../../../../src/controls/enforce-inputs.js";
import {
  buildEnforceReport,
  type EnforceReportRun,
} from "../../../../src/controls/enforce-report.js";
import type {
  CurrentlyFailing,
  EnforceReport,
} from "../../../../src/controls/enforce-types.js";
import { isProtectedEntry } from "../../../../src/controls/protect-derive.js";
import { generateControlRegister } from "../../../../src/controls/register.js";
import { CONTROL_REGISTER_PATH } from "../../../../src/controls/register-types.js";
import {
  foundAt,
  reportWith,
} from "../../../helpers/control-audit-findings.js";
import {
  writeAuditReport,
  type SampleReport,
} from "../../../helpers/control-audit-report.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import {
  CLEAN,
  buildLintedRepository,
  lintGates,
  scratchFolder,
} from "./enforce-repository.js";

/** The file each result is saved in, inside the results folder. */
export const RESULT_FILES = {
  carriers: "carriers.json",
  tickets: "tickets.json",
  protect: "protect.json",
} as const;

/** The audit of the fixture: its one check was found, everything else is missing. */
export const FOUND_STYLE: SampleReport = reportWith(
  ["."],
  [foundAt("SI7", ".", "ruff.toml")]
);

/** A measurement that ran nothing, for the cases that are not about it. */
export const NOT_MEASURED: CurrentlyFailing = {
  measured: false,
  reason: "Not measured in this case.",
  head: null,
  checked: 0,
  gates: [],
  not_measured: [],
};

/** What a case may set up differently. */
export interface EnforceCaseOptions {
  /** The declaration; the fixture's one commit-time check by default. */
  readonly gates?: GatesBlock;
  /** The audit report; {@link FOUND_STYLE} by default. */
  readonly report?: SampleReport;
  /** The `tracker` setting of `.lisa.config.json`, when there is one. */
  readonly tracker?: string;
}

/** A repository ready for the report, and where its results are saved. */
export interface EnforceCase {
  readonly repoPath: string;
  /** The folder the results are saved in, outside the repository. */
  readonly results: string;
  readonly paths: Readonly<Record<keyof typeof RESULT_FILES, string>>;
}

const cleanups: (() => void)[] = [];

/**
 * Remove every repository and results folder a case built, after it.
 */
export function useEnforceCases(): void {
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => {
      cleanup();
    });
  });
}

/**
 * Save one result the way the skill does.
 * @param prepared - The case
 * @param result - Which result
 * @param document - What the file holds; a string is written as it is
 */
export function saveResult(
  prepared: EnforceCase,
  result: keyof typeof RESULT_FILES,
  document: unknown
): void {
  writeFileSync(
    prepared.paths[result],
    typeof document === "string" ? document : JSON.stringify(document, null, 2)
  );
}

/**
 * The carriers result of a run that installed the commit and push carriers.
 * @param changes - What the run said it wrote
 * @returns The document
 */
export function carriersResult(
  changes: readonly { readonly path: string; readonly action: string }[] = [
    { path: ".lisa/hooks/pre-commit", action: "create" },
    { path: "core.hooksPath", action: "set" },
  ]
): Readonly<Record<string, unknown>> {
  return {
    schema_version: 1,
    mode: "install",
    enforcement_points: ["commit", "push"].map(moment => ({
      kind: "git-hook",
      location: "local-checkout",
      moment,
      outcome: changes.length === 0 ? "already-wired" : "installed",
      reason: null,
      wired_through: "none",
    })),
    changes,
  };
}

/**
 * The merge-protection result of a read-only run for a fixture's register.
 * @param repoPath - The repository
 * @param outcome - What it says of every entry it lists
 * @returns The document
 */
export async function protectResult(
  repoPath: string,
  outcome: "wired" | "blocked" = "blocked"
): Promise<Readonly<Record<string, unknown>>> {
  const generated = await generateControlRegister(repoPath);
  if (generated.problems !== null) {
    throw new Error(generated.problems.join("\n"));
  }
  return {
    schema_version: 1,
    mode: "read-only",
    branch: null,
    platform: { name: "unknown" },
    entries: generated.register.entries
      .filter(entry => isProtectedEntry(entry))
      .map(entry => ({
        id: entry.id,
        outcome,
        reason: `The hosting platform is ${outcome} for ${entry.id}.`,
      })),
    handover: {
      path: ".lisa/controls/merge-protection-change.md",
      action: "none",
    },
    requests: [],
  };
}

/**
 * The results a ticket flow hands back when it filed every missing
 * requirement of a fixture.
 * @param repoPath - The repository
 * @param state - Whether each ticket was created now or already existed
 * @returns One result per requirement the audit report lists as missing
 */
export async function filedTickets(
  repoPath: string,
  state: HandedTicket["ticket_state"] = "created"
): Promise<readonly HandedTicket[]> {
  const loaded = await loadAuditReport(repoPath, new Date());
  if (loaded.problems !== null) throw new Error(loaded.problems.join("\n"));
  return listControlGaps(loaded.report, loaded.criteria).map((gap, index) => ({
    criterion: gap.criterion,
    scope: gap.scope,
    key: gap.key,
    outcome: "ticketed",
    ticket: `tracker#${index + 1}`,
    ticket_state: state,
    reason: null,
    question: null,
  }));
}

/**
 * Write the register a fixture's declaration generates, as the register
 * command would.
 * @param repoPath - The repository
 */
async function writeRegister(repoPath: string): Promise<void> {
  const generated = await generateControlRegister(repoPath);
  if (generated.problems !== null) {
    throw new Error(generated.problems.join("\n"));
  }
  mkdirSync(path.dirname(path.join(repoPath, CONTROL_REGISTER_PATH)), {
    recursive: true,
  });
  writeFileSync(path.join(repoPath, CONTROL_REGISTER_PATH), generated.text);
}

/**
 * Build a repository the enforce step has run in, with its three results
 * saved outside it.
 * @param options - What differs from the plain case
 * @returns The case
 */
export async function prepareEnforce(
  options: EnforceCaseOptions = {}
): Promise<EnforceCase> {
  const gates = options.gates ?? lintGates();
  const fixture = buildLintedRepository(CLEAN, gates);
  const made = scratchFolder();
  const { repoPath } = fixture;
  const prepared: EnforceCase = {
    repoPath,
    results: made.folder,
    paths: {
      carriers: path.join(made.folder, RESULT_FILES.carriers),
      tickets: path.join(made.folder, RESULT_FILES.tickets),
      protect: path.join(made.folder, RESULT_FILES.protect),
    },
  };
  cleanups.push(fixture.cleanup, made.remove);
  if (options.tracker !== undefined) {
    writeFileSync(
      path.join(repoPath, ".lisa.config.json"),
      `${JSON.stringify({ tracker: options.tracker, gates }, null, 2)}\n`
    );
  }
  writeAuditReport(repoPath, options.report ?? FOUND_STYLE);
  await writeRegister(repoPath);
  saveResult(prepared, "carriers", carriersResult());
  saveResult(prepared, "tickets", { schema_version: 1, results: [] });
  saveResult(prepared, "protect", await protectResult(repoPath));
  return prepared;
}

/**
 * Build the report of a case, without running any check.
 * @param prepared - The case
 * @param paths - The result files to name; the case's own by default
 * @returns The report, or the problems
 */
export function reportRun(
  prepared: EnforceCase,
  paths: EnforceInputPaths = prepared.paths
): Promise<EnforceReportRun> {
  return buildEnforceReport(prepared.repoPath, paths, {
    measure: () => Promise.resolve(NOT_MEASURED),
  });
}

/**
 * Build the report of a case that must have one.
 * @param prepared - The case
 * @returns The report
 * @throws {Error} When the command would have refused
 */
export async function reportOfCase(
  prepared: EnforceCase
): Promise<EnforceReport> {
  const run = await reportRun(prepared);
  if (run.problems !== null) throw new Error(run.problems.join("\n"));
  return run.report;
}
