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
import type { GateRegistryModule } from "./gate-report-registry.js";
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

/** The moments agent hooks fire at, before and after the write. */
export const PRE_TOOL = "pre-tool";
export const POST_TOOL = "post-tool";

/**
 * Gates the registry permits declaring at either agent-edit moment.
 *
 * Both moments, deliberately. The boundary is `pre-tool` before the write and
 * `post-tool` after it, and five of the seven shipped edit scripts fire at the
 * latter — so counting only `pre-tool` would report the whole boundary as
 * undeclarable while most of it had just become declarable.
 *
 * It lives beside the two constants rather than with its caller because they
 * are the only thing it reads, and the caller is at its line ceiling.
 * @param registry - The shipped registry
 * @returns How many registry entries list either tool moment
 */
export function toolMomentLegalGates(registry: GateRegistryModule): number {
  return Object.values(registry.REGISTRY).filter(
    gate => gate.moments.includes(PRE_TOOL) || gate.moments.includes(POST_TOOL)
  ).length;
}

/** The synthetic reason filed when no gate may be declared at those moments. */
export const PRE_TOOL_REASON = "pre-tool-not-declarable";

/**
 * The synthetic reason filed once they ARE declarable and still unread.
 *
 * The two are deliberately separate rather than one entry with softer wording.
 * When the registry gained `pre-tool` and `post-tool` gates the first reason
 * stopped being true, and an entry keyed only on that would have vanished —
 * leaving the report silent about enforcement that still consults nothing. A
 * control that stops reporting when half its cause is fixed is the failure this
 * whole report exists to surface, so the remaining half gets its own name.
 */
export const PRE_TOOL_UNWIRED_REASON = "tool-moment-not-wired";

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
  [PRE_TOOL_UNWIRED_REASON]: {
    ticket: "CodySwannGT/lisa#2839",
    headline:
      "Scripts run on every file an agent edits. You can now name those checks in your settings, but the scripts do not read them yet.",
    detail:
      "Lisa's registry now has gates for what these scripts prove, so the vocabulary exists and a declaration validates. What has not shipped is the other half: each script still runs a fixed command and consults no configuration, so declaring one of these gates does not yet change what happens when an agent edits a file. Nothing about your project causes this, and turning the gate off will not stop the script.",
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
 * The script count for a tool-moment reason, or undefined for any other.
 * @param reason - The catalogue reason being counted
 * @param counts - The two tool-moment script counts
 * @param counts.undeclarable - Scripts running with no declarable gate
 * @param counts.unwired - Scripts running that ignore a declarable gate
 * @returns The count, or undefined when the reason is counted from rows
 */
function preToolCountFor(
  reason: string,
  counts: { undeclarable: number; unwired: number }
): number | undefined {
  if (reason === PRE_TOOL_REASON) return counts.undeclarable;
  if (reason === PRE_TOOL_UNWIRED_REASON) return counts.unwired;
  return undefined;
}

/**
 * Build the upstream section for one report.
 *
 * Empty is the goal state, and an entry only appears when this report actually
 * hit it — a limitation affecting nothing here is not reported here.
 * @param options - Report inputs
 * @param options.rows - Every gate row
 * @param options.agentHooks - Edit-time hooks proved active
 * @param options.toolMomentLegalGates - Gates the registry permits at either
 *   tool moment. Counting only `pre-tool` would read the boundary as
 *   undeclarable while five of the seven shipped scripts fire at `post-tool`.
 * @returns The limitations, sorted by ticket for a stable payload
 */
export function collectUpstream(options: {
  rows: readonly GateReportRow[];
  agentHooks: Finding<readonly AgentHookEvidence[]>;
  toolMomentLegalGates: number;
}): UpstreamLimitation[] {
  const { rows, agentHooks, toolMomentLegalGates } = options;
  // Counted in scripts rather than in rows, because the rows are all "not legal
  // here" — precisely the reading that makes ungoverned enforcement look like
  // nothing happening.
  //
  // Which of the two reasons applies depends on the registry this run read, not
  // on the project: before gates existed at these moments the gap was that
  // nothing could be declared; now it is that the scripts do not read what you
  // declare. Exactly one is ever reported, so the count never double-counts a
  // script.
  const active = agentHooks.state === "verified" ? agentHooks.value.length : 0;
  const undeclarable = toolMomentLegalGates === 0 ? active : 0;
  const unwired = toolMomentLegalGates > 0 ? active : 0;
  const counts = Object.keys(UPSTREAM_LIMITATIONS).map(
    (reason): [string, number] => [
      reason,
      preToolCountFor(reason, { undeclarable, unwired }) ??
        cellsCarrying(rows, reason),
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
