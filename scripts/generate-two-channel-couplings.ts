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

/**
 * The only part of a report these two functions read.
 *
 * Narrower than the full report on purpose: they need a key and a verdict per
 * entry and nothing else, and a parameter that asked for the whole measurement
 * would force every caller — including a test — to build one it does not use.
 */
interface CouplingKeySource {
  readonly entries: readonly {
    readonly key: string;
    readonly verdict: string;
  }[];
}

/** One coupling's answer to "can this notice a STALE artifact?" (#3687). */
export interface StalenessClassification {
  /**
   * What the coupling CAN detect today — an observation, not a decision.
   *
   * `version-handshake` asks the artifact for a contract version and compares
   * it. `capability-probe` asks for one subcommand or flag and infers age from
   * whether it answers, which sees staleness at exactly one point and is blind
   * above that floor — the CodySwannGT/lisa#3477 defect. `existence-only`
   * cannot see age at all.
   */
  readonly detects: "version-handshake" | "capability-probe" | "existence-only";
  /**
   * Why the current level is acceptable. Required unless a handshake exists.
   *
   * This is the DECISION half, kept separate from `detects` on purpose: a
   * coupling that cannot see age and is fine that way (an advisory read, an
   * artifact carrying no verdict-bearing logic) is a different fact from one
   * that cannot see age and should. Collapsing them into a single
   * "not-needed" token would lose exactly the distinction the sweep exists to
   * record, and would let an unexamined default wear the same word as a
   * considered exemption.
   */
  readonly reason?: string;
}

/** The ledger's hand-authored half plus its derived half. */
interface Ledger {
  readonly ratified: Readonly<Record<string, string>>;
  readonly staleness: Readonly<Record<string, StalenessClassification>>;
  readonly inspected: TwoChannelReport["inspected"];
  readonly counts: TwoChannelReport["counts"];
  readonly couplings: readonly {
    readonly key: string;
    readonly workflow: string;
    readonly path: string;
    readonly channel: string;
    readonly verdict: string;
    readonly remedy: string;
    readonly guarded: boolean;
    readonly lanes: readonly string[];
    readonly detail: string;
  }[];
}

/**
 * Read the ratifications already recorded, so regenerating never drops them.
 * @param ledgerPath - Absolute path to the ledger
 * @returns The ratification reasons, keyed `<workflow>::<path>`
 */
function readRatified(ledgerPath: string): Readonly<Record<string, string>> {
  if (!existsSync(ledgerPath)) return {};
  const parsed = JSON.parse(readFileSync(ledgerPath, "utf8")) as
    | Partial<Ledger>
    | undefined;
  return parsed?.ratified ?? {};
}

/**
 * Read the staleness classifications already recorded (#3687).
 *
 * Exactly the shape `readRatified` uses, and for the same reason: the ledger is
 * a DERIVED artifact regenerated in-commit, so a hand-authored field survives
 * only if the generator reads the previous version before rewriting it. This is
 * the established local precedent for persisting a human decision inside a
 * generated file, which is why the classification lives here rather than in a
 * new sidecar nobody would remember to update.
 * @param ledgerPath - Absolute path to the ledger
 * @returns The classifications, keyed `<workflow>::<path>`
 */
function readStaleness(
  ledgerPath: string
): Readonly<Record<string, StalenessClassification>> {
  if (!existsSync(ledgerPath)) return {};
  const parsed = JSON.parse(readFileSync(ledgerPath, "utf8")) as
    | Partial<Ledger>
    | undefined;
  return parsed?.staleness ?? {};
}

/**
 * The verdict for a coupling the package channel already covers.
 *
 * Those are omitted from the ledger, so every question this file asks about a
 * live coupling has to exclude them — named once so the three sites cannot
 * disagree about which verdict that is.
 */
const PACKAGE_BACKED = "package-backed";

/** The `detects` value meaning the coupling asks for a contract version. */
const VERSION_HANDSHAKE = "version-handshake";

/** The `detects` value meaning it infers age from one subcommand or flag. */
const CAPABILITY_PROBE = "capability-probe";

/** The `detects` value meaning it can see presence and nothing else. */
const EXISTENCE_ONLY = "existence-only";

/** The `detects` values a classification may carry. */
const DETECTS = new Set([VERSION_HANDSHAKE, CAPABILITY_PROBE, EXISTENCE_ONLY]);

/**
 * The floor a stated reason must clear to be a reason rather than a label.
 *
 * A floor, not a proof — no check tells a real argument from filler. What it
 * buys is that "n/a", "ok" and an empty string cannot stand in for the decision
 * this field exists to record.
 */
const MIN_REASON_CHARACTERS = 40;

/**
 * Every problem with the staleness half, as operator-readable paragraphs.
 *
 * THREE refusals, and the first is the one that makes this a standing property
 * rather than a one-time sweep: a coupling with no classification fails, so
 * entry 25 cannot silently inherit "nobody looked". A sweep decays the moment
 * somebody adds an entry; a required field does not.
 * @param report - The measurement
 * @param staleness - The recorded classifications
 * @returns Problem paragraphs, empty when the staleness half is sound
 */
export function stalenessProblems(
  report: CouplingKeySource,
  staleness: Readonly<Record<string, StalenessClassification>>
): readonly string[] {
  const live = new Set(
    report.entries
      .filter(entry => entry.verdict !== PACKAGE_BACKED)
      .map(entry => entry.key)
  );
  const missing = [...live]
    .filter(key => staleness[key] === undefined)
    .map(
      key =>
        `\nUNCLASSIFIED COUPLING ${key}\n  No staleness classification. Every ` +
        `coupling must record whether it can detect a STALE artifact, not only ` +
        `an absent one — absence skips and posts nothing, while present-and-old ` +
        `posts a verdict from superseded logic that every reader believes. Add ` +
        `a "staleness" entry with "detects" (version-handshake | ` +
        `capability-probe | existence-only) and, unless it is a handshake, a ` +
        `"reason" saying why that is acceptable here.`
    );
  const orphaned = Object.keys(staleness)
    .filter(key => !live.has(key))
    .map(
      key =>
        `\nSTALE CLASSIFICATION ${key}\n  Nothing reads this path any more, so ` +
        `the classification is an unexamined judgement the next matching path ` +
        `would inherit. Delete it from ${LEDGER_PATH}.`
    );
  const malformed = Object.entries(staleness)
    .filter(([key]) => live.has(key))
    .flatMap(([key, value]) => describeMalformed(key, value));
  return [...missing, ...orphaned, ...malformed];
}

/**
 * Why one recorded classification is not usable, if it is not.
 * @param key - The coupling key
 * @param value - The recorded classification
 * @returns Problem paragraphs for this entry
 */
function describeMalformed(
  key: string,
  value: StalenessClassification
): readonly string[] {
  if (!DETECTS.has(value?.detects)) {
    return [
      `\nMALFORMED CLASSIFICATION ${key}\n  "detects" is ` +
        `${JSON.stringify(value?.detects)}; expected one of ` +
        `${[...DETECTS].join(", ")}.`,
    ];
  }
  if (value.detects === VERSION_HANDSHAKE) return [];
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  return reason.length >= MIN_REASON_CHARACTERS
    ? []
    : [
        `\nUNREASONED CLASSIFICATION ${key}\n  "detects" is ` +
          `"${value.detects}", which cannot see how old the artifact is, and no ` +
          `"reason" of at least ${MIN_REASON_CHARACTERS} characters says why ` +
          `that is acceptable here. A recorded decision and an unexamined ` +
          `default must not look the same.`,
      ];
}

/**
 * The one-line fleet coverage sentence (#3687).
 * @param report - The measurement
 * @param staleness - The recorded classifications
 * @returns A sentence naming how much of the fleet can see age
 */
export function stalenessCoverage(
  report: CouplingKeySource,
  staleness: Readonly<Record<string, StalenessClassification>>
): string {
  const live = report.entries.filter(entry => entry.verdict !== PACKAGE_BACKED);
  const tally = (kind: string): number =>
    live.filter(entry => staleness[entry.key]?.detects === kind).length;
  const handshake = tally(VERSION_HANDSHAKE);
  return (
    `  staleness detection: ${handshake} of ${live.length} coupling(s) can see ` +
    `how old the artifact is (${VERSION_HANDSHAKE}); ${tally(CAPABILITY_PROBE)} ` +
    `detect it at one floor only (${CAPABILITY_PROBE}); ${tally(EXISTENCE_ONLY)} ` +
    `detect absence only (${EXISTENCE_ONLY}).`
  );
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
  staleness: Readonly<Record<string, StalenessClassification>>
): Ledger {
  return {
    ratified,
    staleness,
    inspected: report.inspected,
    counts: report.counts,
    couplings: report.entries
      .filter(entry => entry.verdict !== PACKAGE_BACKED)
      .map(entry => ({
        key: entry.key,
        workflow: entry.workflow,
        path: entry.path,
        channel: entry.channel,
        verdict: entry.verdict,
        remedy: entry.remedy,
        guarded: entry.guarded,
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
  readonly staleness: Readonly<Record<string, StalenessClassification>>;
} {
  const workflowsDir = path.join(root, WORKFLOWS_DIR);
  const inventory = buildDeliveryInventory(root);
  const lanesFor = (callerPath: string): readonly string[] =>
    inventory.get(callerPath) ?? [];
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
    }),
    ratified: readRatified(path.join(root, LEDGER_PATH)),
    staleness: readStaleness(path.join(root, LEDGER_PATH)),
  };
}

/**
 * One human-readable paragraph per finding, plus the inspection counts.
 * @param report - The measurement
 * @returns The report text
 */
function humanReport(
  report: TwoChannelReport,
  staleness: Readonly<Record<string, StalenessClassification>>
): string {
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
  // The coverage line answers the question the registry could not answer at
  // all before this: "how many of our couplings can detect staleness?" — in one
  // line, without opening 24 workflows.
  const coverage = stalenessCoverage(report, staleness);
  const unclassified = stalenessProblems(report, staleness).join("");
  return `${header}\n${verdicts}\n${coverage}${findings}${stale}${unclassified}`;
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
  const { report, ratified, staleness } = measure(options.root);
  process.stdout.write(
    `${options.json ? JSON.stringify(report, null, 2) : humanReport(report, staleness)}\n`
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
  const rendered = `${JSON.stringify(toLedger(report, ratified, staleness), null, 2)}\n`;
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
  // The staleness half fails in BOTH modes, exactly as findings do. A gate you
  // can regenerate your way past is not a gate: regenerating records a coupling,
  // it does not classify one, and `toLedger` carries the map through untouched
  // rather than inventing a default for a new entry (#3687).
  const failed =
    report.findings.length > 0 ||
    report.staleRatifications.length > 0 ||
    stalenessProblems(report, staleness).length > 0 ||
    ledgerStale;
  return failed ? 1 : 0;
}

if (import.meta.main) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
