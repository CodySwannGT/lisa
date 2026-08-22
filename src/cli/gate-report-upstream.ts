/**
 * Findings this report cannot answer that are not the project's doing.
 *
 * The report has two audiences and they are not the same person. A consumer
 * project is asking "what is wrong with MY project, that I can fix". Rendering
 * one unfixed Lisa defect as fifty-two blanks in their report tells them their
 * project is largely unverified when nothing about it is at fault, and the
 * next thing they do is go looking for a problem they do not have.
 *
 * "Fifty-two not checked here" is the wrong unit. It is ONE upstream
 * limitation affecting fifty-two cells, and it has a ticket number. So the
 * cells stay exactly as unknown as they were — the three-state rule is
 * untouched, and nothing here turns a row green — and the report additionally
 * says who owns them.
 *
 * Attribution, never suppression. Only a reason listed here is reattributed,
 * and every reason listed here is provably Lisa's. A project's own missing
 * script, absent declaration or unreadable settings file carries a reason that
 * is NOT in this table and stays firmly in the project's view, however
 * unflattering.
 * @module cli/gate-report-upstream
 */
import type {
  AgentHookEvidence,
  Finding,
  GateReportRow,
  UpstreamLimitation,
} from "./gate-report-types.js";

/** One limitation, before this report's counts are attached. */
interface UpstreamCatalogEntry {
  /** The upstream issue that closes it. */
  readonly ticket: string;
  /** One sentence naming the limitation. */
  readonly headline: string;
  /** Why the report cannot answer, and what closing it would change. */
  readonly detail: string;
  /** What the count counts. */
  readonly unit: string;
}

/** The moment agent hooks fire at, which no gate can be declared at. */
export const PRE_TOOL = "pre-tool";

/** The synthetic reason the `pre-tool` limitation is filed under. */
export const PRE_TOOL_REASON = "pre-tool-not-declarable";

/**
 * Every machine reason that belongs to Lisa rather than to the project.
 *
 * Keyed by the exact `reason` string the findings carry, so a reason has to be
 * added here deliberately. A typo attributes nothing, which is the safe
 * direction: an unattributed finding stays in the project's view.
 */
export const UPSTREAM_LIMITATIONS: Readonly<
  Record<string, UpstreamCatalogEntry>
> = {
  "determined-by-quality-yml": {
    ticket: "CodySwannGT/lisa#2830",
    headline:
      "Lisa has not yet shipped, as data, whether each of its CI jobs reads your settings or runs a fixed command.",
    detail:
      "That answer is written inside the workflow file Lisa hosts and your project calls by reference, so it cannot be read from here. It is Lisa's contract to keep and Lisa's tests to prove — not something every project re-derives at runtime. When the upstream fix lands the answer ships with the version and these rows fill themselves in. Nothing about your project causes this and nothing you can change here fixes it.",
    unit: "checks",
  },
  [PRE_TOOL_REASON]: {
    ticket: "CodySwannGT/lisa#2839",
    headline:
      "Scripts run on every file an agent edits, and Lisa provides no way to declare, tune, or switch them off.",
    detail:
      "Formatting, linting, structural scanning and suppression blocking all fire at this moment. They are real enforcement and they are working — but no gate in Lisa's registry may be declared at this moment, so your settings file has no say over any of them. That is an upstream gap in Lisa's vocabulary, not a misconfiguration here.",
    unit: "active scripts",
  },
};

/**
 * Whether a finding's unknown is one Lisa owns.
 * @param finding - Any finding
 * @returns True when it carries an upstream-owned reason
 */
export function isUpstreamFinding(finding: Finding<unknown>): boolean {
  return (
    finding.state === "unknown" &&
    Object.hasOwn(UPSTREAM_LIMITATIONS, finding.reason)
  );
}

/**
 * How many legal cells carry one upstream reason.
 *
 * A cell is counted once however many of its findings carry the reason: the
 * operator-facing unit is the row they are looking at, not the number of
 * internal facts behind it.
 * @param rows - Every gate row
 * @param reason - The upstream reason
 * @returns The number of legal cells carrying it
 */
function cellsCarrying(rows: readonly GateReportRow[], reason: string): number {
  return (
    rows
      .flatMap(row => row.moments)
      .filter(
        cell =>
          cell.legal &&
          [cell.bucket, cell.facadeReadsDeclaration, cell.commandExists].some(
            finding => finding.state === "unknown" && finding.reason === reason
          )
      ).length +
    rows.filter(
      row => row.merge.state === "unknown" && row.merge.reason === reason
    ).length
  );
}

/**
 * Build the upstream section for one report.
 *
 * Empty is the goal state, and an entry only appears when this report actually
 * hit it — a limitation affecting nothing here is not reported here.
 * @param options - Report inputs
 * @param options.rows - Every gate row
 * @param options.agentHooks - Edit-time hooks proved active
 * @param options.preToolLegalGates - Gates the registry permits at `pre-tool`
 * @returns The limitations, sorted by ticket for a stable payload
 */
export function collectUpstream(options: {
  rows: readonly GateReportRow[];
  agentHooks: Finding<readonly AgentHookEvidence[]>;
  preToolLegalGates: number;
}): UpstreamLimitation[] {
  const { rows, agentHooks, preToolLegalGates } = options;
  // The `pre-tool` limitation is counted in scripts rather than in rows,
  // because the rows are all "not legal here" — which is precisely the reading
  // that makes ungoverned enforcement look like nothing happening.
  const preToolCount =
    agentHooks.state === "verified" && preToolLegalGates === 0
      ? agentHooks.value.length
      : 0;
  const counts = Object.keys(UPSTREAM_LIMITATIONS).map(
    (reason): [string, number] => [
      reason,
      reason === PRE_TOOL_REASON ? preToolCount : cellsCarrying(rows, reason),
    ]
  );
  return counts
    .filter(([, affected]) => affected > 0)
    .map(([reason, affected]) => {
      const entry = UPSTREAM_LIMITATIONS[reason];
      return {
        reason,
        ticket: entry?.ticket ?? "",
        headline: entry?.headline ?? "",
        detail: entry?.detail ?? "",
        affected,
        unit: entry?.unit ?? "checks",
      };
    })
    .sort((left, right) => left.ticket.localeCompare(right.ticket));
}
