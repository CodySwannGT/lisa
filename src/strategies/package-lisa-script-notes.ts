/**
 * @file package-lisa-script-notes.ts
 * @description Phase 6 of the package-lisa apply: operator notes naming every
 * host script the apply replaced or removed, and every Lisa gate nothing runs.
 * @module strategies
 */
import { asRecord } from "../core/override-floors.js";
import type { ResolvedPackageLisaTemplate } from "./package-lisa-types.js";

/** The package.json section whose overwrites are reported to the operator. */
const SCRIPTS_SECTION = "scripts";

/**
 * Suffix naming the Lisa-owned half of a split script.
 *
 * A governed gate is shipped as a PAIR: `lint:lisa` carries Lisa's own command
 * and stays in `force`, so a host can neither delete nor weaken it; `lint` is
 * only a `defaults` entry invoking it, so the host owns the composition point
 * and anything chained onto it survives every apply.
 */
const RESERVED_BASE_SUFFIX = ":lisa";

/** How much of a script value an operator note quotes before eliding. */
const NOTE_VALUE_BUDGET = 140;

/**
 * Quote a script value for an operator note without flooding the terminal.
 * @param value - The script value being quoted
 * @returns The value, elided past the note budget
 */
function quoteScript(value: string): string {
  return value.length <= NOTE_VALUE_BUDGET
    ? `"${value}"`
    : `"${value.slice(0, NOTE_VALUE_BUDGET)}…"`;
}

/**
 * Report what an apply did to the host's scripts, and what it left inert.
 * @remarks
 * The defect this answers was invisible rather than wrong-looking. One script
 * value changed inside a `package.json` diff dominated by key reordering, and
 * nothing said so, so five chained CI gates became dead code while the Lint
 * check kept reporting green.
 *
 * Every key of the host's `scripts` is walked. Deliberately not a curated list
 * of interesting names: the review that nearly shipped this defect compared a
 * GUESSED subset and concluded "ordering only". A subset is not a method.
 * @param projectJson - The host manifest as it was before the apply
 * @param packageJson - The manifest the apply is about to write
 * @param template - Resolved template, for the reserved-base pairing
 * @returns Operator-readable lines, empty when nothing was lost
 */
export function describeScriptChanges(
  projectJson: Record<string, unknown>,
  packageJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate
): readonly string[] {
  const before = asRecord(projectJson[SCRIPTS_SECTION]);
  const after = asRecord(packageJson[SCRIPTS_SECTION]);
  const adopted = asRecord(template.adopt[SCRIPTS_SECTION]);
  return [
    ...describeOverwrittenScripts(before, after, adopted),
    ...describeUnrunGates(after, template),
  ];
}

/**
 * Was this host value one Lisa itself wrote into that key?
 * @param adopted - The resolved adopt list for the scripts section
 * @param name - Script name being reported on
 * @param hostValue - The value the host carried before the apply
 * @returns True when the value is Lisa's own rather than the host's work
 */
function isLisaAuthored(
  adopted: Record<string, unknown>,
  name: string,
  hostValue: string
): boolean {
  const recognised = adopted[name];
  return Array.isArray(recognised) && recognised.includes(hostValue);
}

/**
 * Name every host script value this apply replaced or deleted.
 * @remarks
 * A value on the `adopt` list is Lisa's own, so replacing it discards nothing
 * of the host's and must not be reported as a loss. That is not cosmetic: the
 * split hands six gate names back at once, so loss-shaped wording there puts
 * six false alarms in front of every operator on their first upgrade and a
 * REAL loss stops standing out — the precise failure this change exists to
 * end. Those keys get a handover line instead, because the operator does need
 * to learn that the composition point is now theirs to extend.
 * @param before - The host's scripts before the apply
 * @param after - The scripts the apply is about to write
 * @param adopted - Resolved adopt list, naming the values Lisa authored
 * @returns One line per script whose host value did not survive
 */
function describeOverwrittenScripts(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  adopted: Record<string, unknown>
): readonly string[] {
  return Object.entries(before).flatMap(([name, hostValue]) => {
    if (typeof hostValue !== "string") return [];
    const applied = after[name];
    if (applied === hostValue) return [];
    if (applied === undefined) {
      return [
        `Removed scripts.${name}; it ran ${quoteScript(hostValue)}. Nothing in your project runs that any more.`,
      ];
    }
    if (typeof applied !== "string") return [];
    const base = `${name}${RESERVED_BASE_SUFFIX}`;
    // The handover wording names the reserved base, so it is only truthful
    // when the value being written actually invokes one.
    if (isLisaAuthored(adopted, name, hostValue) && applied.includes(base)) {
      return [
        `Moved Lisa's ${name} checks into scripts.${base}; scripts.${name} now calls it, so anything you add there survives the next apply.`,
      ];
    }
    return [
      `Replaced scripts.${name}: it ran ${quoteScript(hostValue)} and now runs ${quoteScript(applied)}.`,
    ];
  });
}

/**
 * Name every Lisa gate the host's own composition point does not run.
 * @remarks
 * `lint:lisa` being force-installed proves the gate EXISTS; it proves nothing
 * about whether anything invokes it, and CI invokes `lint`. A host is free to
 * decline a gate, but declining it silently is the failure mode this whole
 * change is about, so the apply says which gate went unrun.
 *
 * A composition point that inlines Lisa's current base verbatim — the shape
 * every host was left in before the split existed — does run the gate, so it is
 * not warned about. It is nudged instead: an inlined copy stops tracking the
 * template the next time the base changes.
 * @param after - The scripts the apply is about to write
 * @param template - Resolved template carrying the forced reserved bases
 * @returns One line per gate nothing invokes, plus migration nudges
 */
function describeUnrunGates(
  after: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate
): readonly string[] {
  const forcedScripts = asRecord(
    asRecord(template.force)[SCRIPTS_SECTION] as unknown
  );
  return Object.keys(forcedScripts).flatMap(base => {
    if (!base.endsWith(RESERVED_BASE_SUFFIX)) return [];
    const composed = base.slice(0, -RESERVED_BASE_SUFFIX.length);
    const hostValue = after[composed];
    if (typeof hostValue !== "string" || hostValue.includes(base)) return [];
    const baseValue = forcedScripts[base];
    if (typeof baseValue === "string" && hostValue.includes(baseValue)) {
      return [
        `Kept your scripts.${composed}. It spells out Lisa's ${composed} checks instead of calling ${base}, so it will not pick up changes to them; run ${base} from it to stay current.`,
      ];
    }
    return [
      `Kept your scripts.${composed}, but nothing invokes ${base}, so Lisa's ${composed} checks do not run. Add ${base} to scripts.${composed} to turn them back on.`,
    ];
  });
}
