/**
 * The findings of a before-enforce run in the audit report's own finding
 * shape.
 *
 * ## Why they are offered and not written
 *
 * The audit report holds exactly one finding for each requirement in each
 * place it is answered, and all of it is checked by `lisa controls
 * report-check`. `lisa controls reconcile` met the same question and
 * answered it the same way (`./reconcile-audit-findings.ts`): a command that
 * rewrote the report behind the audit's back could leave it in a state its
 * own check refuses. So this run writes nothing. It prints findings that are
 * already in the report's shape and already placed the way the report places
 * them, and the attest skill takes them up: it replaces the report's finding
 * at the same `criterion` and `scope`, then has the report checked.
 *
 * ## Which requirements a finding bears on
 *
 * An entry that came out `not-enforced` bears on every requirement it
 * serves. A requirement answered once for the repository is placed at `.`;
 * one answered per part is placed at the entry's folder. Entries that bear
 * on the same requirement in the same place share one finding.
 *
 * ## The state and the evidence
 *
 * Every offered finding is in state `exists-not-enforced`: the tool is
 * there, and nothing makes it run. Its `what` says, in plain words, what the
 * accepted canary was: the git command, its exit status, and that the change
 * went through. The full record of it (command, exit status, times, output)
 * is the entry's `canary` in the printed result.
 *
 * ## The pointers
 *
 * That state needs a pointer to a line that shows the tool exists. Each
 * mechanism points at the gate in the declaration, which is where the check
 * and its command are written down, and at every place the entry itself
 * cites. Keeping the entry's own pointers matters: the declaration check
 * holds each part's evidence against the report, and a finding that dropped
 * them would make a declaration the audit supported look unsupported.
 * @module controls/before-enforce-findings
 */
import path from "node:path";

import {
  NO_MOMENT,
  type AuditFinding,
  type AuditLocator,
  type AuditMechanism,
} from "./audit-report-types.js";
import type { BeforeEnforceEntry } from "./before-enforce-types.js";
import { compareCodeUnits } from "./canonical-json.js";
import type { InScopeCriterion } from "./catalogue.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { lineStarting } from "./reconcile-audit-findings.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  type ControlRegister,
  type ControlRegisterEntry,
} from "./register-types.js";

/** The state every offered finding is in. */
export const OFFERED_STATE = "exists-not-enforced";

/** Why a tool that nothing runs matters. */
const WHY =
  "A tool that nothing runs stops nothing. Until this check runs by itself when code is committed or pushed, a change that breaks its rule gets through whenever somebody forgets to run the tool by hand, and in every new checkout nobody has set up.";

/** Everything the offered findings are built from. */
export interface BeforeEnforceOfferInputs {
  /** Every entry's result. */
  readonly entries: readonly BeforeEnforceEntry[];
  readonly register: ControlRegister;
  /** The in-scope requirements, in catalogue order. */
  readonly criteria: readonly InScopeCriterion[];
  /** The declaration's text, or `null` when it cannot be read. */
  readonly declaration: string | null;
}

/** A `not-enforced` result beside the register entry it is about. */
interface Bearing {
  readonly result: BeforeEnforceEntry;
  readonly entry: ControlRegisterEntry;
}

/**
 * Say where an entry applies, in words.
 * @param scope - The entry's folder
 * @returns For example `for the whole repository` or `in the folder "api"`
 */
function where(scope: string): string {
  return scope === WHOLE_REPOSITORY_SCOPE
    ? "for the whole repository"
    : `in the folder ${JSON.stringify(scope)}`;
}

/**
 * Name the program an entry's command starts.
 * @param entry - The register entry
 * @returns The program's file name, or the gate when there is no command
 */
function toolOf(entry: ControlRegisterEntry): string {
  const [program] =
    entry.measuring_mechanism.kind === "command"
      ? entry.measuring_mechanism.argv
      : [];
  return program === undefined ? entry.gate : path.basename(program);
}

/**
 * Point at where an entry's check is written down, and at what it cites.
 * @param entry - The register entry
 * @param declaration - The declaration's text, or `null`
 * @returns The pointers, each once
 */
function pointers(
  entry: ControlRegisterEntry,
  declaration: string | null
): readonly AuditLocator[] {
  const declared =
    declaration === null
      ? []
      : [
          {
            line:
              lineStarting(declaration, `${JSON.stringify(entry.gate)}:`) ?? 1,
            path: GATES_DECLARATION_PATH,
          },
        ];
  const all = [...declared, ...(entry.evidence?.locators ?? [])];
  return all.filter(
    (locator, index) =>
      all.findIndex(
        other => other.path === locator.path && other.line === locator.line
      ) === index
  );
}

/**
 * Describe an entry's tool as the audit describes a mechanism that is
 * present and that nothing runs.
 * @param entry - The register entry
 * @param declaration - The declaration's text, or `null`
 * @returns The mechanism
 */
function mechanismOf(
  entry: ControlRegisterEntry,
  declaration: string | null
): AuditMechanism {
  return {
    command:
      entry.measuring_mechanism.kind === "command"
        ? entry.measuring_mechanism.argv.join(" ")
        : null,
    locators: pointers(entry, declaration),
    moment: NO_MOMENT,
    tool: toolOf(entry),
  };
}

/**
 * Say what was found about one entry, quoting its accepted canary.
 * @param bearing - The result and its register entry
 * @returns The sentences
 */
function whatOf(bearing: Bearing): string {
  const { result, entry } = bearing;
  const moment = result.moment ?? "commit";
  const canary = result.canary;
  const went =
    canary === null
      ? "the change went through"
      : `git ${moment} exited ${String(canary.exit_status)} and the change went through`;
  const tool = result.tool;
  const said =
    tool?.outcome === "rejected"
      ? `Run by hand on the same change, the tool (${toolOf(entry)}) reported the problem, so it works.`
      : tool?.outcome === "accepted"
        ? `Run by hand on the same change, the tool (${toolOf(entry)}) passed it, so the test change or what the tool looks for needs correcting before the check can be shown to work.`
        : `Run by hand on the same change, the tool (${toolOf(entry)}) ran and exited ${String(tool?.exit_status ?? "with no status")}.`;
  return `The check ${JSON.stringify(entry.gate)} ${where(entry.scope)} exists and is not enforced. A test change that breaks its rule was put through a real ${moment} in a fresh clone of this repository and nothing stopped it: ${went}. ${said}`;
}

/**
 * Say what to do about the entries that bear on one finding.
 * @param bearing - The results and their register entries
 * @returns The sentence
 */
function nextOf(bearing: readonly Bearing[]): string {
  const moments = [
    ...new Set(bearing.map(each => each.result.moment ?? "commit")),
  ].sort(compareCodeUnits);
  return `Run the enforce step. It installs what makes ${bearing.length === 1 ? "this check" : "these checks"} run by ${bearing.length === 1 ? "itself" : "themselves"} at ${moments.join(" and ")} in every checkout. The attest step then proves a change like this one is stopped.`;
}

/**
 * Offer the findings of a before-enforce run in the audit report's finding
 * shape.
 * @param inputs - What the offered findings are built from
 * @returns One finding per requirement and placement, in catalogue order and
 *   then by folder; none when no entry came out `not-enforced`
 */
export function beforeEnforceFindings(
  inputs: BeforeEnforceOfferInputs
): readonly AuditFinding[] {
  const bearing: readonly Bearing[] = inputs.entries.flatMap(result => {
    const entry = inputs.register.entries.find(
      candidate => candidate.id === result.entry_id
    );
    return result.result === "not-enforced" && entry !== undefined
      ? [{ entry, result }]
      : [];
  });
  return inputs.criteria.flatMap(criterion => {
    const placed = (each: Bearing): string =>
      criterion.answered === "part" ? each.entry.scope : WHOLE_REPOSITORY_SCOPE;
    const serving = bearing.filter(each =>
      each.result.criteria.includes(criterion.id)
    );
    return [...new Set(serving.map(placed))]
      .sort(compareCodeUnits)
      .map((scope): AuditFinding => {
        const here = serving.filter(each => placed(each) === scope);
        return {
          criterion: criterion.id,
          mechanisms: here.map(each =>
            mechanismOf(each.entry, inputs.declaration)
          ),
          next: nextOf(here),
          scope,
          state: OFFERED_STATE,
          what: here.map(each => whatOf(each)).join(" "),
          why: WHY,
        };
      });
  });
}
