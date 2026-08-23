/**
 * One row of the report's matrix, and the cells that make it up.
 *
 * Two of the three render gaps this module closes were not data limitations.
 * The emitter computed both and the renderer threw them away.
 *
 * **Provenance.** Every cell already names which of four sources supplied its
 * command, and the report printed one command string. That matters more in a
 * consumer than it does upstream, which is the reverse of the intuition: a
 * reader who does not recognise a command needs to know whether it came from
 * Lisa or from their own settings file, because that is the difference between
 * "this is how Lisa ships" and "someone here changed this", and it decides who
 * fixes it. So the default sits on top and the override beneath it — `here:`
 * for a project override, `everyone:` for a registry swap that ships to all
 * consumers.
 *
 * **The blank command chip.** `representativeCell` picks one cell to stand for
 * a row, and when it found none the chip was silently omitted. Every legal
 * cell has an answer, so a blank is never "we could not tell" — it is the
 * renderer having nothing to say and saying nothing, which reads as fine. A
 * row with no representative cell now says so.
 * @module cli/gate-report-rows
 */
import { chip, code, escapeHtml, unknownChip } from "./gate-report-html.js";
import type {
  Finding,
  GateMomentCell,
  GateReportRow,
  MergeVerdict,
  TaskProvenance,
} from "./gate-report-types.js";

/** The state of a fact that does not exist here at all. */
const NOT_APPLICABLE = "not-applicable";

/** How each declaration state is written. */
const DECLARATION_LABELS: Readonly<Record<string, string>> = {
  required: "must",
  optional: "tells",
  off: "off",
  "not-declared": "not declared",
};

/** What each bucket means, in one line. */
const BUCKET_TITLES: Readonly<Record<string, string>> = {
  A: "declared, and an executor resolves the declaration",
  B: "an executor exists, but no declaration reaches it",
  C: "a declaration exists that nothing can execute",
  D: "nothing declares it and nothing runs it",
};

/** The provenances worth a line of their own, and the word each is written with. */
const OVERRIDE_WORDS: Readonly<Partial<Record<TaskProvenance, string>>> = {
  "moment-run": "here",
  "gate-run": "here",
  "registry-task-at": "everyone",
  // Nobody declared this one. The concern-named default resolves to no script
  // in this project and the template's own prover does, so that is what runs —
  // and a command column showing only the default would name a script the
  // reader could not find and the runner never calls.
  "registry-shipped-as": "installed",
};

/**
 * The bucket chip for one cell, or the honest refusal to classify it.
 * @param bucket - The cell's bucket finding
 * @returns One chip of HTML
 */
function bucketChip(bucket: Finding<string>): string {
  if (bucket.state === NOT_APPLICABLE) return "";
  if (bucket.state === "unknown") return unknownChip(bucket);
  return chip(
    `b-${bucket.value}`,
    bucket.value,
    BUCKET_TITLES[bucket.value] ?? ""
  );
}

/**
 * One matrix cell.
 * @param cell - The (gate, moment) pair
 * @returns A table cell
 */
export function momentCell(cell: GateMomentCell): string {
  if (!cell.legal) {
    return '<td class="lgr-m lgr-illegal" title="the registry does not permit declaring this gate here"></td>';
  }
  const label = DECLARATION_LABELS[cell.declaration] ?? cell.declaration;
  const state =
    cell.declaration === "not-declared" ? "undeclared" : cell.declaration;
  return `<td class="lgr-m"><span class="lgr-state lgr-${escapeHtml(state)}">${escapeHtml(label)}</span>${bucketChip(cell.bucket)}</td>`;
}

/**
 * Whether `package.json` has the command, said in three states and never none.
 * @param cell - The cell carrying the command
 * @returns One chip of HTML
 */
export function commandChip(cell: GateMomentCell): string {
  if (cell.commandExists.state === "unknown") {
    return unknownChip(cell.commandExists, "command not checked");
  }
  if (cell.commandExists.state === NOT_APPLICABLE) {
    return chip("none", "no task here", cell.commandExists.message);
  }
  return cell.commandExists.value
    ? chip("ok", "script exists")
    : chip("bad", "no such script");
}

/**
 * The first cell of a row that carries a resolved command.
 * @param row - One gate's row
 * @returns The most informative cell, or undefined
 */
export function representativeCell(
  row: GateReportRow
): GateMomentCell | undefined {
  return (
    row.moments.find(
      cell => cell.legal && cell.declaration !== "not-declared"
    ) ?? row.moments.find(cell => cell.legal)
  );
}

/**
 * Why the command beneath the default is the one that runs.
 * @param provenance - The winning task source
 * @returns The tooltip text for the provenance line
 */
function provenanceTitle(provenance: TaskProvenance): string {
  if (provenance === "moment-run" || provenance === "gate-run") {
    return "this project's settings file names its own task for this gate";
  }
  if (provenance === "registry-shipped-as") {
    return (
      "this project has no script by the default's name, and does have the " +
      "one a Lisa template installs for this property, so that is what runs"
    );
  }
  return "Lisa swaps the task at this moment, for every project";
}

/**
 * The override line beneath the default, when one of the sources won.
 * @param cell - The representative cell
 * @returns One line of HTML, or an empty string when Lisa's default runs
 */
function provenanceLine(cell: GateMomentCell): string {
  const word = OVERRIDE_WORDS[cell.provenance];
  if (word === undefined || cell.task === null) return "";
  const scope =
    cell.provenance === "moment-run" ? ` (at ${cell.moment} only)` : "";
  const title = provenanceTitle(cell.provenance);
  return `<div class="lgr-prov" title="${escapeHtml(title)}"><span class="lgr-provword">${word}:</span> ${code(cell.task)}${escapeHtml(scope)}</div>`;
}

/**
 * The command column: Lisa's default on top, any override beneath it.
 * @param row - One gate's row
 * @returns A table cell
 */
export function commandCell(row: GateReportRow): string {
  const cell = representativeCell(row);
  if (cell === undefined) {
    // Never silence. A row reaches here only when every moment the registry
    // permits is off this project's axis, which is a fact worth stating rather
    // than an empty box the reader will read as "fine".
    return `<td>${code(row.defaultTask ?? "—")}${chip("unknown", "no column here", "This gate is only legal at moments this project has no column for, so no cell on this row could be shown.")}</td>`;
  }
  return `<td>${code(row.defaultTask ?? cell.task ?? "—")}${commandChip(cell)}${provenanceLine(cell)}</td>`;
}

/**
 * The merge column: yes, yes under another job's name, or no.
 * @param merge - The row's merge finding
 * @returns A table cell
 */
export function mergeCell(merge: Finding<MergeVerdict>): string {
  if (merge.state !== "verified") {
    return `<td class="lgr-m">${unknownChip(merge)}</td>`;
  }
  if (merge.value.verdict === "no") {
    return `<td class="lgr-m">${chip("no-merge", "no", "No required status context stands between this gate and a merge.")}</td>`;
  }
  const context = merge.value.context ?? "";
  if (merge.value.verdict === "yes") {
    return `<td class="lgr-m">${chip("yes-merge", "yes", context)}</td>`;
  }
  return `<td class="lgr-m">${chip("other-merge", "yes, other name", context)}<div class="lgr-under">under ${code(merge.value.underJob ?? context)}</div></td>`;
}

/**
 * Legal moments the project's own axis has no column for.
 * @param row - One gate's row
 * @param axis - The report's moment axis
 * @returns Human text, or an empty string
 */
function offAxisMoments(row: GateReportRow, axis: readonly string[]): string {
  const families = row.legalMoments.filter(
    moment =>
      !axis.includes(moment) && !axis.some(one => one.startsWith(`${moment}:`))
  );
  return families.length === 0
    ? ""
    : `<div class="lgr-offaxis">also legal at ${escapeHtml(families.join(", "))}</div>`;
}

/**
 * The cloud job a gate maps to, and whether that job reads the declaration.
 * @param row - One gate's row
 * @returns A table cell
 */
function jobCell(row: GateReportRow): string {
  const job =
    row.qualityJob === null ? chip("none", "no job") : code(row.qualityJob);
  const facade = representativeCell(row)?.facadeReadsDeclaration;
  return `<td>${job}<div class="lgr-tier3">${facadeText(facade)}</div></td>`;
}

/**
 * How the "reads the declaration" line reads for one cell.
 *
 * Four inputs, four sentences. A row with no mapped job is not an unanswered
 * question — there is no job whose wiring could be read — and labelling it
 * "not checked here" would file Lisa's unknowable Tier 3 and a plain
 * not-applicable under one word.
 * @param facade - The Tier 3 finding, when the row has one
 * @returns One line of text as HTML
 */
function facadeText(facade: Finding<boolean> | undefined): string {
  if (facade === undefined) return "no cell on this row to read";
  if (facade.state === NOT_APPLICABLE) {
    return `<span title="${escapeHtml(facade.message)}">no cloud job maps to this check</span>`;
  }
  if (facade.state === "verified") {
    return facade.value
      ? `reads the declaration: ${chip("ok", "yes")}`
      : `reads the declaration: ${chip("bad", "no — hardcoded")}`;
  }
  return `reads the declaration: ${unknownChip(facade)}`;
}

/**
 * One gate row.
 * @param row - The gate
 * @param axis - The report's moment axis
 * @returns A table row
 */
export function gateRow(row: GateReportRow, axis: readonly string[]): string {
  return [
    "<tr>",
    `<td><span class="lgr-gid">${escapeHtml(row.id)}</span><span class="lgr-glabel">${escapeHtml(row.label)}</span>`,
    offAxisMoments(row, axis),
    "</td>",
    `<td class="lgr-proves">${escapeHtml(row.summary)}</td>`,
    commandCell(row),
    row.moments.map(momentCell).join(""),
    mergeCell(row.merge),
    jobCell(row),
    "</tr>",
  ].join("");
}
