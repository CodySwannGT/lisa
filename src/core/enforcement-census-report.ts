/**
 * Rendering for the enforcement fleet census.
 *
 * The report is written for whoever is standing at the gate, not for whoever
 * wrote the guards, so the classes are named in plain language and the serious
 * one comes first. **Not enforcing** is printed above **enforcing but old**
 * deliberately: a stale guard still refuses things and announces its vintage in
 * every refusal, while a checkout that resolves nothing produces no output at
 * all. The quieter failure gets the louder position (CodySwannGT/lisa#3490).
 *
 * Every line ends in something an operator can do. A census that reports a
 * number with no remedy attached is a number people learn to scroll past, which
 * is the same fate as a banner that fires on every tool call.
 * @module core/enforcement-census-report
 */
import type { CheckoutCoverage, GuardTree } from "./enforcement-coverage.js";
import type { FleetCensus } from "./enforcement-census.js";
import {
  isInstallBehindDeclared,
  redactedLabel,
} from "./enforcement-census.js";

/** Where a host tree lives inside a checkout. */
const HOST_TREE = "scripts/lisa-hooks";
/** Where the monorepo's own tree lives inside a checkout. */
const PLUGIN_TREE = "plugins/lisa/hooks";
/** What dates a host tree. */
const HOST_DATED_BY = ".lisa/apply-receipt.json";
/** What dates a plugin tree. */
const PLUGIN_DATED_BY = "plugins/lisa/.claude-plugin/plugin.json";
/** What a redacted field says instead of a real path. */
const REDACTED = "redacted";

/**
 * Replace every real path in a census with a stable anonymous label.
 *
 * The paths this census reads name real local checkouts, and they embed client
 * and product names that must never reach a public issue, PR, or commit. The
 * counts and the per-checkout rows survive redaction intact, so a fleet finding
 * loses nothing by being quoted safely.
 * @param census - A measured fleet
 * @returns The same fleet with paths replaced by derived labels
 */
export function redactCensus(census: FleetCensus): FleetCensus {
  const scrubTree = <T extends { readonly tree: GuardTree }>(
    tree: T,
    label: string
  ): T => ({
    ...tree,
    root: `${label}/${tree.tree === "host" ? HOST_TREE : PLUGIN_TREE}`,
    datedBy: `${label}/${tree.tree === "host" ? HOST_DATED_BY : PLUGIN_DATED_BY}`,
  });
  const scrub = (coverage: CheckoutCoverage): CheckoutCoverage => {
    const label = redactedLabel(coverage.checkoutPath);
    return {
      ...coverage,
      label,
      checkoutPath: label,
      guards: coverage.guards.map(guard => ({ ...guard, script: null })),
      trees: coverage.trees.map(tree => scrubTree(tree, label)),
      governing:
        coverage.governing === null
          ? null
          : scrubTree(coverage.governing, label),
    };
  };
  return {
    ...census,
    rosterOrigin: REDACTED,
    referenceSource: REDACTED,
    checkouts: census.checkouts.map(scrub),
  };
}

/**
 * Describe which copy governs a checkout and how old it is.
 * @param coverage - One record
 * @param reference - Newest Lisa the run could point at
 * @returns One operator-readable clause
 */
function describeGoverning(
  coverage: CheckoutCoverage,
  reference: string | null
): string {
  const governing = coverage.governing;
  if (governing === null) return "no copy in force";
  const where = governing.tree === "host" ? HOST_TREE : PLUGIN_TREE;
  if (governing.version === null) {
    return `governed by ${where} — vintage unknown, so it cannot be shown current`;
  }
  if (coverage.vintage === "behind") {
    return `governed by ${where} — lisa ${governing.version}, behind ${reference ?? "the newest on this disk"}`;
  }
  return `governed by ${where} — lisa ${governing.version}`;
}

/**
 * Say what a checkout has installed against what it declares.
 * @param coverage - One record
 * @returns One operator-readable clause
 */
function describeInstallDrift(coverage: CheckoutCoverage): string {
  return `installed ${coverage.install.installed ?? "?"}, declares ${coverage.install.declared ?? "?"}`;
}

/**
 * One row for a checkout that resolves at least one guard.
 * @param coverage - One record
 * @param reference - Newest Lisa the run could point at
 * @returns The row
 */
function resolvingRow(
  coverage: CheckoutCoverage,
  reference: string | null
): string {
  const parts = [
    describeGoverning(coverage, reference),
    coverage.receipt.present ? null : "no apply receipt",
    coverage.resolution === "partial"
      ? `unresolved: ${coverage.unresolvedGuards.join(", ")}`
      : null,
    isInstallBehindDeclared(coverage) ? describeInstallDrift(coverage) : null,
  ].filter((part): part is string => part !== null);
  return `  - ${coverage.label} — ${parts.join("; ")}`;
}

/** One named section of the report. */
interface Section {
  readonly heading: string;
  readonly note: string;
  readonly rows: readonly string[];
}

/**
 * Build the section for checkouts that resolve nothing.
 *
 * First in the report, and never merged into the stale section below it. These
 * are not behind — they are unenforced, and the remedy is different.
 * @param census - A measured fleet
 * @returns The section
 */
function unguardedSection(census: FleetCensus): Section {
  const rows = census.checkouts
    .filter(entry => entry.resolution === "none")
    .map(entry => `  - ${entry.label}`);
  return {
    heading: `NOT ENFORCING — ${rows.length} of ${census.summary.total} resolve no guard at all`,
    note: "An agent working in one of these is checked by nothing, and nothing in the session says so. Repair: run `npx @codyswann/lisa apply` in that checkout.",
    rows,
  };
}

/**
 * Build the section for checkouts the census could not read.
 * @param census - A measured fleet
 * @returns The section
 */
function unreadableSection(census: FleetCensus): Section {
  const rows = census.checkouts
    .filter(entry => entry.resolution === "unreadable")
    .map(
      entry => `  - ${entry.label} — ${entry.unreadableReason ?? "unknown"}`
    );
  return {
    heading: `COULD NOT LOOK — ${rows.length} of ${census.summary.total}`,
    note: "Not counted as covered and not counted as unenforced: the census does not know. Repair: fix the path on the roster, or remove it.",
    rows,
  };
}

/**
 * Build the section for checkouts that resolve at least one guard.
 * @param census - A measured fleet
 * @returns The section
 */
function resolvingSection(census: FleetCensus): Section {
  const { summary } = census;
  const rows = census.checkouts
    .filter(
      entry => entry.resolution === "partial" || entry.resolution === "full"
    )
    .map(entry => resolvingRow(entry, census.reference));
  return {
    heading: `ENFORCING — ${summary.resolving} of ${summary.total} (${summary.partial} of them only partly)`,
    note: `behind: ${summary.behind} · vintage unknown: ${summary.undateable} · current: ${summary.current} · no apply receipt: ${summary.withoutReceipt}`,
    rows,
  };
}

/**
 * Build the section for checkouts whose installed Lisa is behind their own
 * manifest.
 *
 * Its own section because it fails in the affirmative: these checkouts resolve
 * guards, run them, and answer confidently about a version nobody is using.
 * @param census - A measured fleet
 * @returns The section
 */
function installDriftSection(census: FleetCensus): Section {
  const rows = census.checkouts
    .filter(entry => isInstallBehindDeclared(entry))
    .map(entry => `  - ${entry.label} — ${describeInstallDrift(entry)}`);
  return {
    heading: `INSTALLED BEHIND DECLARED — ${rows.length} of ${census.summary.total}`,
    note: "These answer every question confidently about a Lisa version nobody is running. Repair: reinstall dependencies in that checkout.",
    rows,
  };
}

/**
 * Render one section, or nothing when it is empty and uninteresting.
 * @param section - The section
 * @param always - Whether to print it even when empty
 * @returns The rendered lines
 */
function renderSection(section: Section, always: boolean): readonly string[] {
  if (section.rows.length === 0 && !always) return [];
  return [
    "",
    section.heading,
    `  ${section.note}`,
    ...(section.rows.length === 0 ? ["  (none)"] : section.rows),
  ];
}

/**
 * Render the whole census for a terminal.
 * @param census - A measured fleet
 * @returns The report
 */
export function renderFleetCensusReport(census: FleetCensus): string {
  const { summary } = census;
  const lines = [
    `Lisa enforcement fleet census — ${census.measuredAt}`,
    `Roster: ${census.rosterOrigin} (${summary.total} checkout${summary.total === 1 ? "" : "s"})`,
    `Newest Lisa found: ${census.reference ?? "none"} (${census.referenceSource})`,
    ...renderSection(unguardedSection(census), true),
    ...renderSection(unreadableSection(census), true),
    ...renderSection(resolvingSection(census), true),
    ...renderSection(installDriftSection(census), false),
    "",
    `Covered — all six guards, a current copy, and an apply receipt: ${summary.covered} of ${summary.total}.`,
    "This census reports and never gates: its exit status is 0 whatever it finds.",
    "A checkout not on the roster was not measured, which is not the same as covered.",
  ];
  return `${lines.join("\n")}\n`;
}
