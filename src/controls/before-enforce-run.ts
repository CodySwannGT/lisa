/**
 * The before-enforce run: does a bad change still get through, before
 * anything has been installed?
 *
 * For each entry of the control register that can be exercised, two things
 * are done with its violating change, one after the other, in a fresh clone
 * that has no carrier in it:
 *
 * 1. It is really committed, or committed and really pushed. If git lets it
 *    through, nothing enforces the entry in a new checkout.
 * 2. The entry's own command is started on it. If the command runs to an
 *    end, the tool is there.
 *
 * Both together are the finding this run exists for: a tool is present, and
 * a change that breaks its rule still goes through.
 *
 * ## What is and is not concluded
 *
 * - The change went through and the tool's command ran: `not-enforced`.
 * - The change was refused: `enforced`, and the tool's command is not run.
 * - The change went through and the tool's command could not be run to an
 *   end here: `unknown`. A tool that cannot be started on this machine is
 *   not shown to be present.
 *
 * Which entries can be exercised at all is decided in
 * `./before-enforce-plan.ts`; one planted change is acted on and written
 * down in `./before-enforce-observe.ts`. This module only does things in
 * order and says what they show together.
 *
 * None of this is a proof of a control and none of it is written down. The
 * results are plain data (`./before-enforce-types.ts`) and the only clock
 * read is the one handed in.
 * @module controls/before-enforce-run
 */
import {
  attemptOutcome,
  commandFields,
  measureChange,
  observe,
  type BeforeEnforceContext,
} from "./before-enforce-observe.js";
import {
  namedEntry,
  type BeforeEnforcePlan,
  type NamedEntry,
} from "./before-enforce-plan.js";
import type {
  BeforeEnforceCanary,
  BeforeEnforceEntry,
  BeforeEnforceReason,
} from "./before-enforce-types.js";
import {
  acceptedSentence,
  notPlantedDetail,
  notRestoredDetail,
  rejectedDetail,
  toolNotRunDetail,
  toolSentence,
  unclearAttemptDetail,
} from "./before-enforce-wording.js";
import type { RunnableProof } from "./proof-plan.js";

/** The reason of an entry whose tool gave no answer after its change went through. */
const TOOL_NOT_RUN = "tool-not-run";

/** The tool reasons that mean its command never ran to an end. */
const TOOL_SILENT: readonly string[] = ["not-started", "timed-out", "killed"];

/** Why a commit or push gave no answer, in words, by reason. */
const UNCLEAR: Readonly<Record<string, string>> = {
  "timed-out": "it was still running at the time limit and was stopped",
  killed: "it was stopped before it finished",
};

/** One entry's result, and whether the clone is still fit to use. */
interface Exercised {
  readonly entry: BeforeEnforceEntry;
  /** Why the clone can no longer be vouched for, or `null` when it can. */
  readonly spoiled: string | null;
}

/** What the commit or push of an entry's violating change came to. */
type Attempted =
  | (Exercised & { readonly accepted: false })
  | {
      readonly accepted: true;
      readonly canary: BeforeEnforceCanary;
      readonly spoiled: string | null;
    };

/**
 * The result of an entry that was tried and gave no answer.
 * @param named - Which entry, and its moment
 * @param reason - Why there is no answer
 * @param detail - The same as a sentence
 * @param canary - The commit or push, when one was made
 * @returns The result
 */
function unanswered(
  named: NamedEntry,
  reason: BeforeEnforceReason,
  detail: string,
  canary: BeforeEnforceCanary | null = null
): BeforeEnforceEntry {
  return { ...named, result: "unknown", reason, detail, canary, tool: null };
}

/**
 * Commit or push an entry's violating change for real, and say what git did.
 * @param proof - The entry and its violating change
 * @param context - The clone and the clock
 * @returns The accepted canary, or the entry's result when the change was
 *   refused or gave no answer
 */
async function attemptChange(
  proof: RunnableProof,
  context: BeforeEnforceContext
): Promise<Attempted> {
  const named = namedEntry(proof.entry, proof.moment);
  const { file } = proof.patches.violation;
  const seen = await observe(proof, context, request =>
    context.workspace.attempt(request)
  );
  if (!seen.planted) {
    return {
      accepted: false,
      entry: unanswered(
        named,
        "patch-not-applied",
        notPlantedDetail(file, seen.problem)
      ),
      spoiled: null,
    };
  }
  const { outcome, reason } = attemptOutcome(seen.answer);
  const shown = {
    ...commandFields(seen, context.workspace.root),
    patch: file,
    moment: proof.moment,
    outcome,
  };
  const { spoiled } = seen;
  if (reason !== null) {
    const detail = unclearAttemptDetail(
      proof.moment,
      seen.answer.notStarted ?? UNCLEAR[reason] ?? "it gave no answer"
    );
    return {
      accepted: false,
      entry: unanswered(named, reason, detail, { ...shown, detail }),
      spoiled,
    };
  }
  if (outcome === "accepted") {
    return {
      accepted: true,
      canary: { ...shown, detail: acceptedSentence({ ...shown, detail: "" }) },
      spoiled,
    };
  }
  const detail = rejectedDetail({ ...shown, detail: "" });
  return {
    accepted: false,
    entry: {
      ...named,
      result: "enforced",
      reason: "violation-rejected",
      detail,
      canary: { ...shown, detail },
      tool: null,
    },
    spoiled,
  };
}

/**
 * Start the entry's own command on the violating change, once the change is
 * known to have gone through, and say what the two together show.
 * @param proof - The entry and its violating change
 * @param canary - The commit or push that went through
 * @param context - The clone, the judge and the clock
 * @returns The entry's result, and whether the clone is still fit to use
 */
async function measureTool(
  proof: RunnableProof,
  canary: BeforeEnforceCanary,
  context: BeforeEnforceContext
): Promise<Exercised> {
  const named = namedEntry(proof.entry, proof.moment);
  const measured = await measureChange(proof, context);
  if (!measured.planted) {
    return {
      entry: unanswered(
        named,
        TOOL_NOT_RUN,
        toolNotRunDetail(canary, measured.problem),
        canary
      ),
      spoiled: null,
    };
  }
  const { tool } = measured;
  return {
    entry: TOOL_SILENT.includes(tool.reason)
      ? {
          ...unanswered(
            named,
            TOOL_NOT_RUN,
            toolNotRunDetail(canary, tool.detail),
            canary
          ),
          tool,
        }
      : {
          ...named,
          result: "not-enforced",
          reason: "violation-accepted",
          detail: `${acceptedSentence(canary)} ${toolSentence(tool, proof.moment)}`,
          canary,
          tool,
        },
    spoiled: measured.spoiled,
  };
}

/**
 * Exercise one entry: commit or push its violating change for real, and when
 * that goes through, run the entry's own command on the same change.
 * @param proof - The entry and its violating change
 * @param context - The clone, the judge and the clock
 * @param spoiled - Why the clone can no longer be vouched for, if it cannot
 * @returns The entry's result, and whether the clone is still fit to use
 */
async function exercise(
  proof: RunnableProof,
  context: BeforeEnforceContext,
  spoiled: string | null
): Promise<Exercised> {
  const named = namedEntry(proof.entry, proof.moment);
  if (spoiled !== null) {
    return {
      entry: unanswered(
        named,
        "workspace-not-restored",
        notRestoredDetail(spoiled)
      ),
      spoiled,
    };
  }
  const attempted = await attemptChange(proof, context);
  if (!attempted.accepted) return attempted;
  const { canary } = attempted;
  return attempted.spoiled === null
    ? measureTool(proof, canary, context)
    : {
        entry: unanswered(
          named,
          TOOL_NOT_RUN,
          toolNotRunDetail(canary, notRestoredDetail(attempted.spoiled)),
          canary
        ),
        spoiled: attempted.spoiled,
      };
}

/**
 * Exercise every planned entry, one at a time and in order.
 *
 * Nothing is written anywhere but the clone, and the clone is put back to
 * its starting commit after every change. A change that cannot be taken back
 * out leaves the clone unfit for anything after it: every later entry is
 * then reported `unknown` without being tried.
 * @param plans - One plan per register entry, in register order
 * @param context - The clone, the judge and the clock
 * @returns One result per entry, in the same order
 */
export async function runBeforeEnforce(
  plans: readonly BeforeEnforcePlan[],
  context: BeforeEnforceContext
): Promise<readonly BeforeEnforceEntry[]> {
  const done = await plans.reduce<
    Promise<{
      readonly entries: readonly BeforeEnforceEntry[];
      readonly spoiled: string | null;
    }>
  >(
    async (earlier, plan) => {
      const { entries, spoiled } = await earlier;
      if (!plan.exercise) return { entries: [...entries, plan.entry], spoiled };
      const exercised = await exercise(plan.proof, context, spoiled);
      return {
        entries: [...entries, exercised.entry],
        spoiled: exercised.spoiled,
      };
    },
    Promise.resolve({ entries: [], spoiled: null })
  );
  return done.entries;
}
