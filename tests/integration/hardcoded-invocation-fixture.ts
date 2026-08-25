/**
 * Shared inputs for the hardcoded-invocation suites.
 *
 * The shipped `.mjs` is imported once here rather than in each suite so both
 * read the same table, and the literals every assertion needs — file paths,
 * step names, the fallback condition — are named once so a rename fails in one
 * place instead of drifting between two spellings of the same string.
 *
 * @module tests/integration/hardcoded-invocation-fixture
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The repository root, from this file. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The shipped gate registry. */
export const GATES_SCRIPT = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** The condition that selects a job's written-in invocation. */
export const NOT_CONFIGURED = "steps.gate.outputs.configured == 'false'";

/** The step every façade job runs when nothing resolves. */
export const REPORT_STEP = "🚨 Report the unconfigured gate";

/** The reusable quality workflow, repository-relative. */
export const QUALITY_YML = ".github/workflows/quality.yml";

/** The reusable browser-suite workflow, repository-relative. */
export const PLAYWRIGHT_YML = ".github/workflows/playwright-e2e.yml";

/** Both workflows carrying façade jobs. */
export const FACADE_WORKFLOWS: readonly string[] = [
  QUALITY_YML,
  PLAYWRIGHT_YML,
];

/** The shipped pre-push hook template, repository-relative. */
export const PRE_PUSH_HOOK = "typescript/copy-contents/.husky/pre-push";

/** The `pre-push-hook` surface name, as the shipped table spells it. */
export const PRE_PUSH_SURFACE = "pre-push-hook";

/** The `on-edit-hook` surface name, as the shipped table spells it. */
export const ON_EDIT_SURFACE = "on-edit-hook";

/**
 * The `pre-tool-refusal-hook` surface name, as the shipped table spells it.
 *
 * The other half of the agent write boundary: same event stream as the on-edit
 * scripts, opposite consequence. These run BEFORE the write and decide whether
 * it happens, which is why they are a surface of their own rather than folded
 * into the one above.
 */
export const PRE_TOOL_REFUSAL_SURFACE = "pre-tool-refusal-hook";

/** One inventory entry, as the shipped table publishes it. */
export interface Invocation {
  gate: string;
  moment: string;
  surface: string;
  artifact: string;
  job: string | null;
  command: string;
  steps: string[];
  seedRun: string[] | null;
  facade: string;
}

/** The slice of the registry these suites read. */
export interface GatesModule {
  HARDCODED_INVOCATIONS: Invocation[];
  FACADE_CLASSES: string[];
  QUALITY_JOB_GATES: Record<string, string>;
  REGISTRY: Record<string, { moments: string[] }>;
  MOMENTS: string[];
  isDeclarableAt: (gate: string, moment: string) => boolean;
  unconfiguredAt: (options: {
    gates: object;
    moment: string;
    surface?: string;
    gate?: string;
  }) => { gate: string; declarable: boolean; reason: string }[];
  seedGates: (options: {
    gates?: object;
    scripts?: Record<string, string>;
    runner?: string;
  }) => {
    gates: Record<string, Record<string, unknown>>;
    seeded: { gate: string; moment: string; run: string | null }[];
    skipped: { gate: string; moment: string; reason: string }[];
  };
  DECLARATION_REQUIRED_JOBS: Record<
    string,
    { gate: string; reason: string; owner: string }
  >;
}

/**
 * Import the shipped gate registry.
 * @returns The registry module.
 */
export async function loadGates(): Promise<GatesModule> {
  return (await import(pathToFileURL(GATES_SCRIPT).href)) as GatesModule;
}

/**
 * One shipped file's contents.
 * @param relative Repository-relative path.
 * @returns The file as text.
 */
export function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Command words whose only effect is to put text on the log.
 *
 * `cat` is here because a heredoc'd banner is narration with extra steps, and
 * `exit`/`set`/`:`/`true` because a step made of nothing but those has decided
 * something without proving anything.
 */
const NARRATION_COMMANDS: ReadonlySet<string> = new Set([
  "echo",
  "printf",
  "cat",
  ":",
  "true",
  "exit",
  "set",
]);

/**
 * Step-name markers Lisa uses, by convention, for a step that exists to say
 * nothing was proved.
 *
 * Read as narration REGARDLESS of what the body runs, and that is the sharp
 * half of this classifier. A skip notice that grew a `node -e` to decide how
 * loudly to complain still proves nothing about the property — classifying by
 * "does it invoke a binary" would read that decision as a proof and hand the
 * control back the blind spot it was written to remove.
 */
const SKIP_MARKERS: readonly string[] = ["⏭️", "Skipped", "skipped"];

/** Shell keywords that begin no command of their own. */
const SHELL_KEYWORD =
  /^(if|then|else|elif|fi|do|done|while|for|case|esac|\{|\}|\|\||&&|;;)\s+/;

/**
 * A line that is only structure.
 *
 * The keyword alternation is anchored to a WORD BOUNDARY, and that is
 * load-bearing rather than tidy. Without it every command whose name merely
 * starts with a keyword — `find`, `file`, `format`, `forge`, `docker`,
 * `done_report`, `casesplit` — matched, so its line was dropped from the
 * command list and a step whose only real work was `find ...` or `docker ...`
 * classified as narration-only. That is the same blind spot this classifier
 * exists to remove, reproduced inside the classifier.
 *
 * The brace and paren forms keep no boundary because they are punctuation and
 * cannot run into a longer word.
 */
const STRUCTURE_ONLY =
  /^(?:(?:if|then|else|elif|fi|do|done|while|for|case|esac)(?:\s|;|$)|\{|\}|;;|\)|\*\))/;

/** A shell variable assignment, which runs nothing on its own. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * One line with its leading shell keywords removed.
 *
 * Recursive rather than a loop: `functional/no-let` forbids the accumulator a
 * loop would need, and the depth is bounded by the number of keywords on one
 * line.
 * @param line One trimmed line of a step body.
 * @returns The line from its first real command word onward.
 */
function stripKeywords(line: string): string {
  const keyword = SHELL_KEYWORD.exec(line);
  return keyword === null ? line : stripKeywords(line.slice(keyword[0].length));
}

/**
 * Whether a workflow step only narrates.
 *
 * The distinction the inventory's original "ran nothing" control missed is
 * exactly one word: it asked whether a step RAN, and the criterion asks
 * whether a PROOF ran. A probe reporting "no token" and a notice saying
 * "skipped" both satisfy the former.
 * @param step One workflow step.
 * @param step.name The step's name, as written.
 * @param step.run The step's shell body, when it has one.
 * @param step.uses The action the step runs, when it uses one.
 * @returns True when the step proves nothing about its job's property.
 */
export function narratesOnly(step: {
  name?: string;
  run?: string;
  uses?: string;
}): boolean {
  if (SKIP_MARKERS.some(marker => String(step.name ?? "").includes(marker))) {
    return true;
  }
  if (step.uses !== undefined) return false;
  const body = String(step.run ?? "");
  if (body.trim() === "") return true;
  const commands = body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"))
    .map(line => stripKeywords(line))
    .filter(line => !STRUCTURE_ONLY.test(line))
    .map(line => line.split(/[\s;|(]/)[0] ?? "")
    .filter(word => word !== "" && !ASSIGNMENT.test(word));
  return commands.every(
    word => NARRATION_COMMANDS.has(word) || word.endsWith(")")
  );
}

/**
 * The shipped stack manifests that register hooks on the agent write boundary.
 *
 * The NestJS manifest joined this list in #3007. It registers exactly one hook
 * — `block-migration-edits.sh`, a `PreToolUse` refusal — and while it was
 * absent here the derivation below could not see that hook at all, so the
 * inventory could be missing an entry for it and this control would still
 * report the population fully covered.
 */
export const EDIT_TIME_MANIFESTS = [
  "plugins/src/typescript/.claude-plugin/plugin.json",
  "plugins/src/rails/.claude-plugin/plugin.json",
  "plugins/src/nestjs/.claude-plugin/plugin.json",
];

/** The two hook events that fire on the agent write boundary. */
const TOOL_EVENTS = ["PreToolUse", "PostToolUse"];

/** One plugin manifest's hook table, as these assertions read it. */
interface PluginManifest {
  hooks?: Record<
    string,
    { matcher?: string; hooks?: { command?: string }[] }[]
  >;
}

/**
 * The last path segment of a value that may be a whole shell command.
 * @param value A path or command string.
 * @returns The final segment, trimmed.
 */
export function basename(value: string): string {
  return value.slice(value.lastIndexOf("/") + 1).trim();
}

/**
 * Every script a shipped manifest registers on the write boundary, by event.
 *
 * Derived rather than written down: the first version of the inventory said
 * these scripts fire BEFORE the edit, and nothing in the repository
 * contradicted it.
 *
 * The selector is the MOMENT — a tool event with a write matcher — and not the
 * `-on-edit.sh` filename it used to be. That suffix is a naming convention, and
 * two shipped hooks fire on this boundary without it: `block-suppress-directives.sh`
 * and `block-migration-edits.sh`. Under the old selector they were invisible to
 * this control, which is how they stayed out of the inventory entirely while it
 * reported the population exhaustive.
 * @returns Script basename to the hook event registering it.
 */
export function registeredEditTimeEvents(): Map<string, string> {
  return new Map(
    EDIT_TIME_MANIFESTS.flatMap(manifest =>
      Object.entries(
        (JSON.parse(read(manifest)) as PluginManifest).hooks ?? {}
      ).flatMap(([event, matchers]) =>
        !TOOL_EVENTS.includes(event)
          ? []
          : matchers
              .filter(matcher => (matcher.matcher ?? "").includes("Write"))
              .flatMap(matcher => matcher.hooks ?? [])
              .map(hook => hook.command ?? "")
              .map(command => [basename(command), event] as const)
      )
    )
  );
}
