/**
 * What else gates my merges, and where does it come from?
 *
 * The rest of this report describes Lisa's own jobs. A reader can reasonably
 * take that for the whole picture of what stands between their work and a
 * merge, and it is not: a project's CI almost always carries jobs Lisa neither
 * ships nor governs — a third-party app, or a workflow the project wrote — and
 * some of them are required.
 *
 * Four origins, because collapsing them loses the attribution. A context Lisa
 * ships AND a declaration governs is working as intended. A context Lisa ships
 * that nothing declares is the project's own settings gap. A context from the
 * project's own workflow is the project's, and Lisa has no opinion about it. A
 * context from something else entirely is neither the project's
 * misconfiguration nor Lisa's defect, and reporting it as a gap in either is
 * how a report manufactures a problem that does not exist.
 * @module cli/gate-report-contexts
 */
import type {
  ContextOrigin,
  Finding,
  RequiredContextRow,
} from "./gate-report-types.js";

/** Everything the classification needs. */
export interface ContextOriginInputs {
  /** Contexts the settings file's `required` declarations imply. */
  readonly declared: readonly string[];
  /** Every context Lisa could produce if every gate were declared required. */
  readonly lisaUniverse: readonly string[];
  /** Contexts the project's own workflows could post. */
  readonly projectContexts: ReadonlySet<string>;
}

/** What each origin means, in one operator-readable sentence. */
const DETAILS: Readonly<Record<ContextOrigin, string>> = {
  "lisa-governed":
    "Lisa ships the job and a declaration in this project's settings governs it. Changing the declaration changes what runs.",
  "lisa-undeclared":
    "Lisa ships the job and it blocks merges, but nothing in this project's settings governs it — changing the settings file cannot turn it on, off, or into something else.",
  "project-workflow":
    "This project's own workflow posts this context. Lisa neither ships nor governs it, and nothing here is a finding against it.",
  "third-party":
    "Neither Lisa nor a workflow in this repository posts this context — it comes from an app installed on the repository. It gates merges and is outside both.",
};

/**
 * Which of the four origins a required context has.
 * @param context - The context string
 * @param inputs - Everything the classification needs
 * @returns The origin
 */
export function originOf(
  context: string,
  inputs: ContextOriginInputs
): ContextOrigin {
  if (inputs.declared.includes(context)) return "lisa-governed";
  if (inputs.lisaUniverse.includes(context)) return "lisa-undeclared";
  return inputs.projectContexts.has(context)
    ? "project-workflow"
    : "third-party";
}

/**
 * Classify every context a merge is actually blocked on.
 *
 * Carries the unknown through unchanged. A run that could not read branch
 * protection has no list to classify, and inventing an empty one would report
 * "nothing else gates your merges" on the strength of not having looked.
 * @param required - The live required contexts, or an unknown
 * @param inputs - Everything the classification needs
 * @returns One row per required context, sorted, or the same unknown
 */
export function classifyRequiredContexts(
  required: Finding<readonly string[]>,
  inputs: ContextOriginInputs
): Finding<readonly RequiredContextRow[]> {
  if (required.state !== "verified") return required;
  return {
    state: "verified",
    value: [...required.value]
      .sort((left, right) => left.localeCompare(right))
      .map(context => {
        const origin = originOf(context, inputs);
        return { context, origin, detail: DETAILS[origin] };
      }),
  };
}

/**
 * Every context Lisa could produce, if every gate were declared required.
 *
 * Derived by asking the registry rather than by rebuilding its format string:
 * an `await` gate posts under the awaited signal's own name and a `run` gate
 * under the calling workflow's, and a second transcription of that rule is a
 * second thing to keep true.
 * @param options - Derivation inputs
 * @param options.gateIds - Gate ids legal at the merge moment
 * @param options.moment - The merge moment
 * @param options.workflowName - The calling workflow's name
 * @param options.contextsFor - The registry's own context derivation
 * @returns Every context Lisa ships a job for, sorted
 */
export function lisaContextUniverse(options: {
  gateIds: readonly string[];
  moment: string;
  workflowName: string;
  contextsFor: (
    gates: Record<string, unknown>,
    options?: { moment?: string; workflowName?: string }
  ) => string[];
}): string[] {
  const everything = Object.fromEntries(
    options.gateIds.map(id => [id, { [options.moment]: "required" }])
  );
  try {
    return options.contextsFor(everything, {
      moment: options.moment,
      workflowName: options.workflowName,
    });
  } catch {
    return [];
  }
}
