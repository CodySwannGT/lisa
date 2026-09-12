/**
 * Deterministic gate and ledger for Lisa's two-channel delivery gap (#3050).
 *
 * Lisa reaches a consumer down two channels at two speeds. Reusable workflow
 * bodies travel at `@main` and are live on the consumer's next run, needing no
 * action from them. Scripts and declarations travel by `lisa apply` and are
 * live only where somebody applied. A change that REMOVES a built-in from a
 * workflow and replaces it with something the consumer's tree must provide
 * therefore lands in the wrong order, and nothing measured the gap: the
 * replacement never runs, so it posts no context, and an absent required
 * context is not a red one.
 *
 * This script measures it, for Lisa's own tree, before such a change ships.
 * The reasoning about verdicts lives in `src/core/two-channel-delivery.ts`;
 * the reasoning about how a workflow spells a path lives in
 * `src/core/two-channel-delivery-scan.ts`. This file is the I/O around them.
 *
 * ## The ledger is the deliverable, not the exit code
 *
 * Fourteen of Lisa's fifteen host-only couplings are `apply-lagged`, and every
 * one is deliberate. Failing on them would mean ratifying fourteen entries on
 * day one, which turns an allowlist into a bypass. So they are RECORDED in
 * `scripts/two-channel-couplings.json`, regenerated in-commit like Lisa's
 * other derived artifacts, and a change that adds one shows up as a diff a
 * reviewer must look at. That is the check the issue asked to be reachable
 * before a change of this shape ships.
 *
 * The ledger also ships in the package — `scripts/` is in the npm `files`
 * allowlist — which is what lets `lisa doctor` tell a consumer, on their own
 * machine, which of the couplings their tree does not satisfy. The workflow
 * bodies themselves are NOT in that allowlist, so a consumer cannot derive
 * this locally; the ledger is the only way the fast half's requirements reach
 * them at all.
 *
 * ## What fails
 *
 *   - a `never-delivered` or `undelivered` coupling nobody ratified — the
 *     shape no apply and no bump ever closes;
 *   - a ratification matching no live coupling, because a permission left
 *     behind after its subject is gone is inherited for free by the next path
 *     that happens to match;
 *   - a ledgered coupling with no recorded STALENESS decision (#3687) — the
 *     one field a new coupling cannot be added without, because its detection
 *     is derived and therefore free while the decision costs a sentence;
 *   - a staleness decision the tree refuses to support, in either direction:
 *     a claimed handshake nothing shows, or an exemption on a coupling that
 *     already has one;
 *   - a staleness decision matching no live coupling, for the same reason a
 *     stale ratification fails;
 *   - `--check` against a stale ledger;
 *   - and any run that measured nothing.
 *
 * Findings fail in BOTH modes. Regenerating the ledger records a coupling; it
 * does not ratify one, and a gate you can regenerate your way past is not a
 * gate.
 *
 * ## Refusing to pass on nothing
 *
 * Zero reusable workflows, zero steps, zero couplings, or an empty delivery
 * inventory is exit 2 and never a clean pass. Every run prints what it
 * inspected, so an empty sweep and a converged tree cannot produce the same
 * output.
 *
 * CLI:
 *   bun scripts/generate-two-channel-couplings.ts [--root <dir>] [--check] [--json]
 *
 * Exit codes:
 *   0 — every unrestorable coupling is ratified, and the ledger is current.
 *   1 — an unratified finding, a stale ratification, or a stale ledger.
 *   2 — operational: unknown flag, a flag missing its value, `--root` absent,
 *       or a run that measured nothing.
 * @module scripts/generate-two-channel-couplings
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import process from "node:process";

import {
  classifyTwoChannelDelivery,
  type CouplingInput,
  type TwoChannelReport,
} from "../src/core/two-channel-delivery.js";
import {
  isReusable,
  scanWorkflow,
} from "../src/core/two-channel-delivery-scan.js";
import {
  artifactStalenessSignals,
  STALENESS_DECISIONS,
  STALENESS_DETECTIONS,
  type StalenessRecord,
  type StalenessSignal,
} from "../src/core/two-channel-staleness.js";

/** Where the fast channel's bodies live in this repository. */
const WORKFLOWS_DIR = path.join(".github", "workflows");

/** Where the ledger is written, inside the npm `files` allowlist. */
const LEDGER_PATH = path.join("scripts", "two-channel-couplings.json");

/** Every delivery lane a stack directory may carry. */
const LANES = [
  "copy-overwrite",
  "copy-contents",
  "merge",
  "tagged-merge",
  "package-lisa",
  "create-only",
] as const;

/** Directories a consumer keeps its own executable artifacts in. */
const CALLER_DIRECTORIES = ["scripts", "bin", "tools"] as const;

/** Exit code for an operational failure — including "I could not look". */
const EXIT_OPERATIONAL = 2;

/** Parsed command line. */
interface Options {
  readonly root: string;
  readonly check: boolean;
  readonly json: boolean;
}

/**
 * Print usage guidance and exit.
 * @param message - Why the invocation was rejected
 * @returns Never; the process exits
 */
function usage(message: string): never {
  process.stderr.write(
    `${message}\n\nUsage: bun scripts/generate-two-channel-couplings.ts [--root <dir>] [--check] [--json]\n`
  );
  process.exit(EXIT_OPERATIONAL);
}

/**
 * Parse argv into options.
 * @param argv - Arguments after the script name
 * @returns The parsed options
 */
function parseArgs(argv: readonly string[]): Options {
  return argv.reduce<Options>(
    (options, flag, index) => {
      if (flag === "--check") return { ...options, check: true };
      if (flag === "--json") return { ...options, json: true };
      if (flag === "--root") {
        const value = argv[index + 1];
        if (value === undefined) usage("--root needs a value");
        return { ...options, root: path.resolve(value) };
      }
      if (argv[index - 1] === "--root") return options;
      return usage(`Unknown flag: ${flag}`);
    },
    { root: process.cwd(), check: false, json: false }
  );
}

/**
 * Every file under one directory, as paths relative to it.
 * @param directory - Absolute directory path
 * @returns POSIX-style relative paths, empty when the directory is absent
 */
function filesUnder(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(directory, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

/** One delivered caller-tree path and the lane delivering it. */
interface DeliveredPath {
  readonly callerPath: string;
  readonly lane: string;
}

/**
 * Every caller-tree path one `<stack>/<lane>` pair delivers.
 * @param root - Repository root
 * @param stack - Stack directory name
 * @param lane - Delivery lane name
 * @returns One entry per delivered file
 */
function deliveredBy(
  root: string,
  stack: string,
  lane: string
): readonly DeliveredPath[] {
  return CALLER_DIRECTORIES.flatMap(directory =>
    filesUnder(path.join(root, stack, lane, directory)).map(relative => ({
      callerPath: `${directory}/${relative}`,
      lane: `${stack}/${lane}`,
    }))
  );
}

/**
 * Index every caller-tree path Lisa delivers, and the lanes delivering it.
 *
 * Only the caller directories are indexed. The question this script asks is
 * "does a workflow's caller-tree read arrive", and a path outside `scripts/`,
 * `bin/`, or `tools/` is never one of those reads — indexing the whole
 * template estate would make the inventory count large and meaningless.
 *
 * Stacks are sorted, and each path's lanes are sorted again below.
 * `readdirSync` order is the filesystem's, and it differs between the two
 * runtimes that invoke this file — the ledger rendered under bun and under
 * vitest disagreed about the order of `check-threshold-ratchet.mjs`'s two
 * lanes, and a derived artifact whose bytes depend on who generated it cannot
 * be checked for staleness.
 * @param root - Repository root
 * @returns Caller path to the `<stack>/<lane>` lanes shipping it
 */
export function buildDeliveryInventory(
  root: string
): ReadonlyMap<string, readonly string[]> {
  const stacks = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const delivered = stacks.flatMap(stack =>
    LANES.flatMap(lane => deliveredBy(root, stack, lane))
  );
  return delivered.reduce(
    (inventory, entry) =>
      new Map(inventory).set(
        entry.callerPath,
        [...(inventory.get(entry.callerPath) ?? []), entry.lane].sort(
          (left, right) => left.localeCompare(right)
        )
      ),
    new Map<string, readonly string[]>()
  );
}

/** The ledger's hand-authored half plus its derived half. */
interface Ledger {
  readonly ratified: Readonly<Record<string, string>>;
  /**
   * The staleness decision recorded for each ledgered coupling.
   *
   * Hand-authored, and required. The DETECTION beside each coupling below is
   * derived from the tree on every run; this is the half a person has to
   * answer, which is what stops entry 24 from inheriting "nobody looked".
   */
  readonly staleness: Readonly<Record<string, StalenessRecord>>;
  readonly inspected: TwoChannelReport["inspected"];
  readonly counts: TwoChannelReport["counts"];
  readonly detectionCounts: TwoChannelReport["detectionCounts"];
  readonly decisionCounts: TwoChannelReport["decisionCounts"];
  readonly couplings: readonly {
    readonly key: string;
    readonly workflow: string;
    readonly path: string;
    readonly channel: string;
    readonly verdict: string;
    readonly remedy: string;
    readonly guarded: boolean;
    readonly handling: readonly string[];
    readonly detection: string;
    readonly stalenessSignals: readonly string[];
    readonly decision: string | null;
    readonly reason: string | null;
    readonly lanes: readonly string[];
    readonly detail: string;
  }[];
}

/**
 * The ledger as it currently stands, or an empty one when there is none.
 * @param ledgerPath - Absolute path to the ledger
 * @returns Whatever the file holds, unvalidated
 */
function readLedger(ledgerPath: string): Partial<Ledger> {
  if (!existsSync(ledgerPath)) return {};
  return (
    (JSON.parse(readFileSync(ledgerPath, "utf8")) as Partial<Ledger> | null) ??
    {}
  );
}

/**
 * Read the ratifications already recorded, so regenerating never drops them.
 * @param ledgerPath - Absolute path to the ledger
 * @returns The ratification reasons, keyed `<workflow>::<path>`
 */
function readRatified(ledgerPath: string): Readonly<Record<string, string>> {
  return readLedger(ledgerPath).ratified ?? {};
}

/**
 * Read the staleness decisions already recorded.
 * @param ledgerPath - Absolute path to the ledger
 * @returns The decisions, keyed `<workflow>::<path>`
 */
function readClassified(
  ledgerPath: string
): Readonly<Record<string, StalenessRecord>> {
  return readLedger(ledgerPath).staleness ?? {};
}

/**
 * Render the ledger a report implies.
 *
 * `package-backed` couplings are omitted: they are covered by the package
 * channel, they outnumber the interesting ones several times over, and a
 * consumer reading this ledger can do nothing about them. Their COUNT is kept,
 * so the ledger still says how many were inspected.
 * @param report - The measurement
 * @param ratified - The ratifications to carry forward
 * @returns The ledger, ready to serialise
 */
function toLedger(
  report: TwoChannelReport,
  ratified: Readonly<Record<string, string>>,
  classified: Readonly<Record<string, StalenessRecord>>
): Ledger {
  return {
    ratified,
    staleness: classified,
    inspected: report.inspected,
    counts: report.counts,
    detectionCounts: report.detectionCounts,
    decisionCounts: report.decisionCounts,
    couplings: report.entries
      .filter(entry => entry.verdict !== "package-backed")
      .map(entry => ({
        key: entry.key,
        workflow: entry.workflow,
        path: entry.path,
        channel: entry.channel,
        verdict: entry.verdict,
        remedy: entry.remedy,
        guarded: entry.guarded,
        handling: entry.handling,
        detection: entry.detection,
        stalenessSignals: entry.staleness,
        decision: entry.decision,
        reason: entry.reason,
        lanes: entry.lanes,
        detail: entry.detail,
      })),
  };
}

/**
 * Measure this repository's fast channel against its delivery lanes.
 * @param root - Repository root
 * @returns The measurement, plus the ratifications it was judged against
 */
export function measure(root: string): {
  readonly report: TwoChannelReport;
  readonly ratified: Readonly<Record<string, string>>;
  readonly classified: Readonly<Record<string, StalenessRecord>>;
} {
  const workflowsDir = path.join(root, WORKFLOWS_DIR);
  const inventory = buildDeliveryInventory(root);
  const lanesFor = (callerPath: string): readonly string[] =>
    inventory.get(callerPath) ?? [];
  const artifactSignalsFor = (
    callerPath: string
  ): readonly StalenessSignal[] | null => {
    const lanes = lanesFor(callerPath);
    // No lane ships this path, so there is no artifact to ask. Returning [] —
    // "it carries no version tokens" — would be the same bytes as a measured
    // negative, which is the exact collapse this ledger exists to refuse.
    if (lanes.length === 0) return null;
    const signals = lanes.flatMap(lane =>
      artifactStalenessSignals(
        readFileSync(path.join(root, lane, callerPath), "utf8")
      )
    );
    return [...new Set(signals)];
  };
  const names = existsSync(workflowsDir)
    ? readdirSync(workflowsDir)
        .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
        .sort((left, right) => left.localeCompare(right))
    : [];
  const reusables = names
    .map(name => ({
      name,
      text: readFileSync(path.join(workflowsDir, name), "utf8"),
    }))
    .filter(entry => isReusable(entry.text));
  const scanned = reusables.map(entry => ({
    steps: entry.text.split("\n").filter(line => /^\s*-\s+name:/.test(line))
      .length,
    couplings: scanWorkflow({
      workflow: entry.name,
      text: entry.text,
      lanesFor,
      artifactSignalsFor,
    }),
  }));
  const couplings: readonly CouplingInput[] = scanned.flatMap(
    entry => entry.couplings
  );
  return {
    report: classifyTwoChannelDelivery({
      couplings,
      inspected: {
        workflows: reusables.length,
        steps: scanned.reduce((total, entry) => total + entry.steps, 0),
        couplings: couplings.length,
        inventory: inventory.size,
      },
      ratified: readRatified(path.join(root, LEDGER_PATH)),
      classified: readClassified(path.join(root, LEDGER_PATH)),
    }),
    ratified: readRatified(path.join(root, LEDGER_PATH)),
    classified: readClassified(path.join(root, LEDGER_PATH)),
  };
}

/**
 * One human-readable paragraph per finding, plus the inspection counts.
 * @param report - The measurement
 * @returns The report text
 */
function humanReport(report: TwoChannelReport): string {
  const counts = report.inspected;
  const header =
    `two-channel delivery: inspected ${counts.workflows} reusable workflow(s), ` +
    `${counts.steps} step(s), ${counts.couplings} caller-tree read(s) against ` +
    `${counts.inventory} delivered path(s).`;
  const verdicts = Object.entries(report.counts)
    .map(([verdict, total]) => `  ${verdict}: ${total}`)
    .join("\n");
  const findings = report.findings
    .map(entry => `\nFINDING ${entry.key}\n  ${entry.detail}`)
    .join("");
  const stale = report.staleRatifications
    .map(
      key =>
        `\nSTALE RATIFICATION ${key}\n  Nothing reads this path any more, so the ` +
        `ratification is an unexamined permission the next matching path would ` +
        `inherit. Delete it from ${LEDGER_PATH}.`
    )
    .join("");
  return `${header}\n${verdicts}\n${stalenessReport(report)}${findings}${stale}`;
}

/**
 * The staleness half of the report: the fleet tally and anything unanswered.
 *
 * Every line carries its denominator. "10 can detect staleness" is a number
 * somebody can believe without knowing whether it is out of 12 or out of 700,
 * and a coverage figure nobody can size is the shape of report this repository
 * has been burned by before.
 * @param report - The measurement
 * @returns The staleness section
 */
function stalenessReport(report: TwoChannelReport): string {
  const total = report.classifiable;
  const handshakes = report.detectionCounts["version-handshake"];
  const probes = report.detectionCounts["capability-probe"];
  const blind =
    report.detectionCounts["existence-only"] +
    report.detectionCounts["no-probe"];
  const unchecked = report.detectionCounts.unchecked;
  const headline =
    `staleness detection: ${handshakes}/${total} coupling(s) can detect a stale ` +
    `artifact (version handshake); ${probes}/${total} detect it at one capability ` +
    `floor only; ${blind}/${total} detect absence at most and never age; ` +
    `${unchecked}/${total} could not be checked (nothing is delivered at the path, ` +
    `so there is no artifact to ask).`;
  const detections = STALENESS_DETECTIONS.map(
    detection => `  ${detection}: ${report.detectionCounts[detection]}`
  ).join("\n");
  const decisions = STALENESS_DECISIONS.map(
    decision => `  decision ${decision}: ${report.decisionCounts[decision]}`
  ).join("\n");
  const unclassified = report.unclassified
    .map(
      key =>
        `\nUNCLASSIFIED ${key}\n  No staleness decision is recorded for this ` +
        `coupling. Its detection is derived on every run and costs nobody ` +
        `anything; the decision is the half a person has to make. Add an entry ` +
        `under "staleness" in ${LEDGER_PATH} with a decision of ` +
        `${STALENESS_DECISIONS.join(" | ")} and, unless it is \`handshake\`, a reason.`
    )
    .join("");
  const contradictions = report.contradictions
    .map(sentence => `\nCONTRADICTED DECISION ${sentence}`)
    .join("");
  const malformed = report.malformed
    .map(sentence => `\nMALFORMED DECISION ${sentence}`)
    .join("");
  const staleDecisions = report.staleClassifications
    .map(
      key =>
        `\nSTALE STALENESS DECISION ${key}\n  Nothing reads this path any more, ` +
        `so the decision is an unexamined exemption the next matching path would ` +
        `inherit. Delete it from ${LEDGER_PATH}.`
    )
    .join("");
  return `${headline}\n${detections}\n${decisions}${unclassified}${contradictions}${malformed}${staleDecisions}`;
}

/**
 * Run the gate.
 * @param argv - Arguments after the script name
 * @returns The process exit code
 */
export function main(argv: readonly string[]): number {
  const options = parseArgs(argv);
  if (!existsSync(options.root)) {
    process.stderr.write(`error: --root does not exist: ${options.root}\n`);
    return EXIT_OPERATIONAL;
  }
  const { report, ratified, classified } = measure(options.root);
  process.stdout.write(
    `${options.json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
  if (!report.measured) {
    process.stderr.write(
      `error: the measurement did not happen — ${String(report.unmeasuredReason)}. ` +
        "Reporting a clean sweep here would be the exact failure this gate exists " +
        "to detect, so it fails instead.\n"
    );
    return EXIT_OPERATIONAL;
  }
  const ledgerPath = path.join(options.root, LEDGER_PATH);
  const rendered = `${JSON.stringify(toLedger(report, ratified, classified), null, 2)}\n`;
  const current = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, "utf8")
    : "";
  const ledgerStale = options.check && rendered !== current;
  if (options.check) {
    if (ledgerStale) {
      process.stderr.write(
        `error: ${LEDGER_PATH} is stale. Regenerate it with ` +
          "`bun run generate:two-channel-couplings` and commit the result.\n"
      );
    }
  } else {
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, rendered);
  }
  const failed =
    report.findings.length > 0 ||
    report.staleRatifications.length > 0 ||
    report.unclassified.length > 0 ||
    report.contradictions.length > 0 ||
    report.malformed.length > 0 ||
    report.staleClassifications.length > 0 ||
    ledgerStale;
  return failed ? 1 : 0;
}

if (import.meta.main) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
