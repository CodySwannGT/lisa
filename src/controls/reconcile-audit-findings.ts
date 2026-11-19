/**
 * The findings of a reconcile run in the audit report's own finding shape.
 *
 * ## Why they are offered and not written
 *
 * The audit report holds exactly one finding for each requirement in each
 * place it is answered, and every part of it is checked: its states, its
 * pointers, its questions, the answers people typed. A reconcile finding is
 * about an enforcement point or a hook command, not about a requirement, so
 * writing it into the report would mean replacing findings the audit made,
 * behind the audit's back, and could leave the report in a state its own
 * check refuses. So this command writes nothing there. It prints findings
 * that are already in the report's shape and already placed the way the
 * report places them, for the step that owns the report to take up.
 *
 * ## Which requirements a finding bears on
 *
 * - A claimed enforcement point that nothing runs bears on every requirement
 *   its register entry serves: the rule is listed, and it is not run.
 * - Every finding of either kind bears on the requirement the register
 *   itself answers: one list of every rule, kept in step with what actually
 *   runs. A command no entry declares has no other requirement to go under,
 *   because which requirement it serves is exactly what nothing declares.
 *
 * Each offered finding is in state `exists-not-enforced`: something is there,
 * and it does not hold. A requirement answered once for the repository is
 * placed at `.`; one answered per part is placed at the entry's folder.
 *
 * ## The pointers
 *
 * That state needs a pointer to a line that shows the thing exists. A rule
 * is pointed at where the record lists it: its entry in the committed
 * register, else its gate in the declaration, else the places the audit
 * found it. A hook command is pointed at its own line.
 * @module controls/reconcile-audit-findings
 */
import path from "node:path";

import {
  NO_MOMENT,
  type AuditFinding,
  type AuditLocator,
  type AuditMechanism,
} from "./audit-report-types.js";
import { compareCodeUnits } from "./canonical-json.js";
import type { InScopeCriterion } from "./catalogue.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { declaredWords } from "./reconcile-declared.js";
import {
  CONTROL_REGISTER_CRITERION,
  type CommandFinding,
  type PointFinding,
  type ReconcileFinding,
  type ReconciledPoint,
} from "./reconcile-types.js";
import {
  CONTROL_REGISTER_PATH,
  WHOLE_REPOSITORY_SCOPE,
  type ControlRegister,
  type ControlRegisterEntry,
} from "./register-types.js";

/** The state every offered finding is in. */
const STATE = "exists-not-enforced";

/** Why a listed rule that is not run matters. */
const RULE_WHY =
  "The register is the record of what this repository enforces. While a rule it lists is not actually run, a change that breaks the rule can get through, and the record says otherwise.";

/** Why a register that is out of step matters. */
const REGISTER_WHY =
  "The register is the one list of what governs this repository. While it and what actually runs differ, nobody reading it knows what is really enforced.";

/** The text of the two committed files a rule can be pointed at in. */
export interface PointerSources {
  /** The committed register, or `null` when there is none. */
  readonly register: string | null;
  /** The declaration, or `null` when there is none. */
  readonly declaration: string | null;
}

/** Everything the offered findings are built from. */
export interface AuditOfferInputs {
  readonly register: ControlRegister;
  /** Every enforcement point, as it was reconciled. */
  readonly points: readonly ReconciledPoint[];
  /** Every finding of the run. */
  readonly findings: readonly ReconcileFinding[];
  /** The in-scope requirements, in catalogue order. */
  readonly criteria: readonly InScopeCriterion[];
  readonly sources: PointerSources;
}

/**
 * Find the first line of a text that starts with some words.
 * @param text - A file's content, or `null`
 * @param start - What the line starts with, after its indentation
 * @returns The line's number counted from 1, or `null`
 */
export function lineStarting(
  text: string | null,
  start: string
): number | null {
  const index =
    text === null
      ? -1
      : text.split("\n").findIndex(line => line.trim().startsWith(start));
  return index === -1 ? null : index + 1;
}

/**
 * Point at where the record lists a rule.
 * @param entry - The register entry
 * @param sources - The committed register and the declaration
 * @returns The pointers; empty only when no committed file names the rule
 */
function rulePointers(
  entry: ControlRegisterEntry,
  sources: PointerSources
): readonly AuditLocator[] {
  const listed = lineStarting(
    sources.register,
    `"id": ${JSON.stringify(entry.id)}`
  );
  if (listed !== null) return [{ line: listed, path: CONTROL_REGISTER_PATH }];
  const declared = lineStarting(
    sources.declaration,
    `${JSON.stringify(entry.gate)}:`
  );
  return declared === null
    ? (entry.evidence?.locators ?? [])
    : [{ line: declared, path: GATES_DECLARATION_PATH }];
}

/**
 * Describe a rule as the audit describes a mechanism: once for each place it
 * was found to run, or once as present and run nowhere.
 * @param entry - The register entry
 * @param inputs - What the offered findings are built from
 * @returns The rule's mechanisms
 */
function ruleMechanisms(
  entry: ControlRegisterEntry,
  inputs: AuditOfferInputs
): readonly AuditMechanism[] {
  const [program] =
    entry.measuring_mechanism.kind === "command"
      ? entry.measuring_mechanism.argv
      : [];
  const tool = program === undefined ? entry.gate : path.basename(program);
  const locators = rulePointers(entry, inputs.sources);
  const running = entry.enforcement_points.flatMap(point => {
    const words = declaredWords(entry, point);
    const wired = inputs.points.some(
      each =>
        each.entry_id === entry.id &&
        each.moment === point.moment &&
        each.state === "wired"
    );
    return wired && words !== null
      ? [{ command: words.join(" "), locators, moment: point.moment, tool }]
      : [];
  });
  return running.length > 0
    ? running
    : [{ command: null, locators, moment: NO_MOMENT, tool }];
}

/**
 * Join sentences that say different things, each once, in order.
 * @param sentences - The sentences
 * @returns One text
 */
function once(sentences: readonly string[]): string {
  return [...new Set(sentences)].join(" ");
}

/**
 * Offer one finding for a requirement in one place, from the points that
 * bear on it.
 * @param criterion - The requirement's id
 * @param scope - The place it is answered
 * @param bearing - The findings that bear on it, at least one
 * @param inputs - What the offered findings are built from
 * @returns The finding
 */
function ruleFinding(
  criterion: string,
  scope: string,
  bearing: readonly PointFinding[],
  inputs: AuditOfferInputs
): AuditFinding {
  const entries = inputs.register.entries.filter(entry =>
    bearing.some(finding => finding.entry_id === entry.id)
  );
  return {
    criterion,
    mechanisms: entries.flatMap(entry => ruleMechanisms(entry, inputs)),
    next: once(bearing.map(finding => finding.next)),
    scope,
    state: STATE,
    what: once(bearing.map(finding => finding.message)),
    why: RULE_WHY,
  };
}

/**
 * Offer a finding for every requirement a rule that is not run serves.
 * @param inputs - What the offered findings are built from
 * @returns The findings, in catalogue order and then by folder
 */
function ruleFindings(inputs: AuditOfferInputs): readonly AuditFinding[] {
  const points = inputs.findings.filter(
    (finding): finding is PointFinding =>
      finding.kind === "enforcement-point-not-wired"
  );
  return inputs.criteria
    .filter(criterion => criterion.id !== CONTROL_REGISTER_CRITERION)
    .flatMap(criterion => {
      const placed = (finding: PointFinding): string =>
        criterion.answered === "part" ? finding.scope : WHOLE_REPOSITORY_SCOPE;
      const bearing = points.filter(finding =>
        finding.criteria.includes(criterion.id)
      );
      return [...new Set(bearing.map(placed))]
        .sort(compareCodeUnits)
        .map(scope =>
          ruleFinding(
            criterion.id,
            scope,
            bearing.filter(finding => placed(finding) === scope),
            inputs
          )
        );
    });
}

/**
 * Describe the register itself as a mechanism that is there.
 * @param sources - The committed register and the declaration
 * @returns The mechanism; none when neither file is committed
 */
function registerMechanism(sources: PointerSources): readonly AuditMechanism[] {
  const file =
    sources.register === null
      ? sources.declaration === null
        ? null
        : GATES_DECLARATION_PATH
      : CONTROL_REGISTER_PATH;
  return file === null
    ? []
    : [
        {
          command: null,
          locators: [{ line: 1, path: file }],
          moment: NO_MOMENT,
          tool: "lisa controls register",
        },
      ];
}

/**
 * Describe a command no entry declares as the audit describes a mechanism.
 * @param finding - The finding about the command
 * @returns The mechanism, pointed at the command's line when the file is in
 *   the repository
 */
function commandMechanism(finding: CommandFinding): AuditMechanism {
  const [program = finding.command] = finding.command.split(/\s+/u);
  return {
    command: finding.command,
    locators: path.isAbsolute(finding.path)
      ? []
      : [{ line: finding.line, path: finding.path }],
    moment: finding.moment,
    tool: path.basename(program),
  };
}

/**
 * Offer the one finding every distance bears on: the register is not in
 * step with what runs.
 * @param inputs - What the offered findings are built from
 * @returns The finding, or none when nothing differs or the catalogue this
 *   copy of Lisa ships does not list the requirement
 */
function registerFinding(inputs: AuditOfferInputs): readonly AuditFinding[] {
  const listed = inputs.criteria.some(
    criterion => criterion.id === CONTROL_REGISTER_CRITERION
  );
  if (!listed || inputs.findings.length === 0) return [];
  const undeclared = inputs.findings.filter(
    (finding): finding is CommandFinding =>
      finding.kind === "undeclared-command"
  );
  return [
    {
      criterion: CONTROL_REGISTER_CRITERION,
      mechanisms: [
        ...registerMechanism(inputs.sources),
        ...undeclared.map(finding => commandMechanism(finding)),
      ],
      next: once(inputs.findings.map(finding => finding.next)),
      scope: WHOLE_REPOSITORY_SCOPE,
      state: STATE,
      what: once([
        "The control register is not in step with what is installed.",
        ...inputs.findings.map(finding => finding.message),
      ]),
      why: REGISTER_WHY,
    },
  ];
}

/**
 * Offer the findings of a run in the audit report's finding shape.
 * @param inputs - What the offered findings are built from
 * @returns One finding per requirement and placement, in catalogue order
 */
export function auditFindings(
  inputs: AuditOfferInputs
): readonly AuditFinding[] {
  const offered = [...ruleFindings(inputs), ...registerFinding(inputs)];
  const order = new Map(
    inputs.criteria.map((criterion, index) => [criterion.id, index] as const)
  );
  return offered
    .map((finding, index) => ({ finding, index }))
    .sort(
      (left, right) =>
        (order.get(left.finding.criterion) ?? 0) -
          (order.get(right.finding.criterion) ?? 0) || left.index - right.index
    )
    .map(({ finding }) => finding);
}
