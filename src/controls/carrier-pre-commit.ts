/**
 * Adding the carriers to a pre-commit framework configuration, as local
 * hooks.
 *
 * The framework owns git's hook files, so the carriers are declared where it
 * reads its hooks: one `repo: local` entry at the end of `repos`, holding a
 * hook for the commit stage and one for the push stage. The framework runs
 * hooks in the order the file lists them, so everything the repository
 * already runs comes first, and any hook that fails still fails the
 * operation.
 *
 * The framework does not hand a hook git's standard input. At push it puts
 * what is being pushed in the environment instead (`PRE_COMMIT_FROM_REF`,
 * `PRE_COMMIT_TO_REF`, `PRE_COMMIT_REMOTE_NAME`), and the carrier passes its
 * environment on unchanged. The gate runner does not read those, and the
 * standard input the carrier is started with holds nothing, which the runner
 * reads as "not known": under the framework every part runs at every push.
 *
 * ## Which names the stages are written with
 *
 * The framework renamed its stages in 3.2.0: `commit` became `pre-commit`
 * and `push` became `pre-push`. A version before that knows only the old
 * names and refuses a whole configuration that names a stage it does not
 * know, which would break every hook the repository already has. Which
 * version each person runs cannot be seen from the file, so nothing is
 * guessed: the carriers are written in the names the file itself uses.
 *
 * The old names are written when the file says it must work with a version
 * before 3.2.0 (`minimum_pre_commit_version`), or when it already uses an old
 * name (`commit` or `push` in `default_stages` or in any hook's `stages`).
 * Such a file works today with whatever version its people run, so the
 * carriers are added in the names it already works with. In every other
 * file the new names are written. Neither case was measured against an old
 * version of the framework: the rule only keeps the carriers from being the
 * first entry in a file to use a name the rest of it does not.
 * @module controls/carrier-pre-commit
 */
import { isDeepStrictEqual } from "node:util";

import { carrierMarkers, carrierScriptPath } from "./carrier-script.js";
import {
  CARRIER_HOOKS,
  CARRIER_MOMENTS,
  type CarrierMoment,
} from "./carrier-types.js";
import {
  afterLastContent,
  blockEnd,
  firstContent,
  indented,
  indentOf,
  insertedAt,
  keyLine,
  parseMapping,
  verifiedEdit,
  withoutMarkedBlock,
  type ManagerFileEdit,
} from "./carrier-yaml-lines.js";

/** What the marked block in the file is called. */
const BLOCK_NAME = "hooks";

/** The key the framework reads its hook sources from. */
const REPOS = "repos";

/** What every hook id this command writes starts with. */
const HOOK_ID_PREFIX = "lisa-gates-";

/** How far a nested block is indented. */
const STEP = 2;

/** The names the framework's stages have, by the version that reads them. */
const STAGE_NAMES = {
  /** Since 3.2.0: the stage is named after the git hook. */
  current: CARRIER_HOOKS,
  /** Before 3.2.0, and still read by every version since. */
  legacy: { commit: "commit", push: "push" },
} as const satisfies Record<string, Readonly<Record<CarrierMoment, string>>>;

/** Which set of stage names a configuration is written in. */
type StageNaming = keyof typeof STAGE_NAMES;

/** The first version of the framework that knows the current stage names. */
const CURRENT_NAMES_SINCE = [3, 2, 0] as const;

/**
 * One hook as the framework reads it.
 * @param moment - The moment
 * @param naming - Which names the file's stages are written in
 * @returns The hook's settings, in the order they are written
 */
function hookSettings(
  moment: CarrierMoment,
  naming: StageNaming
): Readonly<Record<string, unknown>> {
  return {
    id: `${HOOK_ID_PREFIX}${moment}`,
    name: `Checks this repository requires before a ${moment}`,
    entry: `sh ${carrierScriptPath(moment)}`,
    language: "system",
    pass_filenames: false,
    always_run: true,
    stages: [STAGE_NAMES[naming][moment]],
  };
}

/**
 * The `repo: local` entry as the framework reads it.
 * @param naming - Which names the file's stages are written in
 * @returns The entry
 */
function preCommitEntry(
  naming: StageNaming
): Readonly<Record<string, unknown>> {
  return {
    repo: "local",
    hooks: CARRIER_MOMENTS.map(moment => hookSettings(moment, naming)),
  };
}

/** The entry in the current stage names, as most files get it. */
export const PRE_COMMIT_ENTRY = preCommitEntry("current");

/**
 * Write one setting the way the file spells it.
 * @param key - The setting
 * @param value - Its value
 * @returns One line
 */
function settingLine(key: string, value: unknown): string {
  const written = Array.isArray(value)
    ? `[${value.join(", ")}]`
    : String(value);
  return `${key}: ${written}`;
}

/**
 * The entry as it is written in the file.
 * @param naming - Which names the file's stages are written in
 * @returns Its lines, the `- repo: local` line first
 */
function entryLines(naming: StageNaming): readonly string[] {
  const hooks = CARRIER_MOMENTS.flatMap(moment => {
    const [first = "", ...rest] = Object.entries(
      hookSettings(moment, naming)
    ).map(([key, value]) => settingLine(key, value));
    return [`- ${first}`, ...indented(rest, STEP)];
  });
  return [
    "- repo: local",
    ...indented(["hooks:", ...indented(hooks, STEP)], STEP),
  ];
}

/**
 * Read the list of hook sources out of a parsed configuration.
 * @param document - The parsed configuration
 * @returns The list, or `null` when there is none
 */
function reposOf(
  document: Readonly<Record<string, unknown>> | null
): readonly unknown[] | null {
  const repos = document?.[REPOS];
  return Array.isArray(repos) ? (repos as readonly unknown[]) : null;
}

/**
 * Every hook a parsed configuration declares.
 * @param repos - The list of hook sources
 * @returns The hooks, in order
 */
function hooksOf(repos: readonly unknown[]): readonly unknown[] {
  return repos.flatMap(repo => {
    const hooks = (repo as { readonly hooks?: unknown } | null)?.hooks;
    return Array.isArray(hooks) ? (hooks as readonly unknown[]) : [];
  });
}

/**
 * Tell whether a hook carries an id only this command writes.
 * @param hook - A parsed hook
 * @returns Whether its id starts the way this command's ids do
 */
function isOwnHookId(hook: unknown): boolean {
  const id = (hook as { readonly id?: unknown } | null)?.id;
  return typeof id === "string" && id.startsWith(HOOK_ID_PREFIX);
}

/**
 * Tell whether a version the file asks for is older than the first one that
 * knows the current stage names.
 * @param version - The file's `minimum_pre_commit_version`, as parsed
 * @returns Whether it names a version before 3.2.0; `false` for anything
 *   that is not a version
 */
function isBeforeCurrentNames(version: unknown): boolean {
  if (typeof version !== "string" && typeof version !== "number") return false;
  const parts = String(version).trim().split(".");
  const numbers = parts.map(part => (/^\d+$/u.test(part) ? Number(part) : NaN));
  if (numbers.length === 0 || numbers.some(Number.isNaN)) return false;
  const differs = CURRENT_NAMES_SINCE.map(
    (since, index) => (numbers[index] ?? 0) - since
  ).find(difference => difference !== 0);
  return differs !== undefined && differs < 0;
}

/**
 * Work out which stage names a configuration is written in.
 * @param document - The parsed configuration
 * @returns `legacy` when the file asks for a version before 3.2.0 or uses
 *   an old stage name in a hook of its own; otherwise `current`
 */
function stageNamingOf(
  document: Readonly<Record<string, unknown>> | null
): StageNaming {
  const old: readonly unknown[] = Object.values(STAGE_NAMES.legacy);
  const named = (stages: unknown): boolean =>
    Array.isArray(stages) &&
    (stages as readonly unknown[]).some(stage => old.includes(stage));
  const hooks = hooksOf(reposOf(document) ?? []).filter(
    hook => !isOwnHookId(hook)
  );
  return isBeforeCurrentNames(document?.minimum_pre_commit_version) ||
    named(document?.default_stages) ||
    hooks.some(hook => named((hook as { readonly stages?: unknown }).stages))
    ? "legacy"
    : "current";
}

/**
 * Add the marked entry at the end of the list of hook sources.
 * @param lines - The file's lines, without any earlier marked block
 * @param naming - Which names the file's stages are written in
 * @returns The new lines, or `null` when the place cannot be found
 */
function withEntry(
  lines: readonly string[],
  naming: StageNaming
): readonly string[] | null {
  const { begin, end } = carrierMarkers(BLOCK_NAME);
  const repos = keyLine(lines, REPOS, 0);
  if (typeof repos !== "number") return null;
  const listEnd = blockEnd(
    lines,
    repos,
    0,
    line => !line.trimStart().startsWith("-")
  );
  const first = firstContent(lines, repos + 1, listEnd);
  const item = first === -1 ? "" : (lines[first] ?? "");
  return item.trimStart().startsWith("-")
    ? insertedAt(
        lines,
        afterLastContent(lines, repos + 1, listEnd),
        indented([begin, ...entryLines(naming), end], indentOf(item))
      )
    : null;
}

/**
 * Add the carriers to a pre-commit framework configuration.
 *
 * One entry holds both moments, so the first moment asked for writes it and
 * the second finds it there.
 * @param text - The file's content
 * @param moment - The moment asked for
 * @returns The new content, or why the file was left alone
 */
export function preCommitWith(
  text: string,
  moment: CarrierMoment
): ManagerFileEdit {
  const document = parseMapping(text);
  const naming = stageNamingOf(document);
  const entry = preCommitEntry(naming);
  const byHand = `Add this entry to "${REPOS}" by hand: ${JSON.stringify(entry)}`;
  const wanted = hookSettings(moment, naming);
  const already = hooksOf(reposOf(document) ?? []);
  if (already.some(hook => isDeepStrictEqual(hook, wanted))) {
    return { problem: null, state: "present", text };
  }
  const bare = withoutMarkedBlock(text, BLOCK_NAME);
  if (bare.problem !== null) return { problem: `${bare.problem}. ${byHand}` };
  const repos = reposOf(bare.document);
  if (repos === null) {
    return {
      problem: `it has no "${REPOS}" list this command can add to. ${byHand}`,
    };
  }
  if (hooksOf(repos).some(hook => isOwnHookId(hook))) {
    return {
      problem: `it already has a hook whose id starts with "${HOOK_ID_PREFIX}" that this command did not write. Rename or remove it, then run this again.`,
    };
  }
  return verifiedEdit(
    bare,
    withEntry(bare.lines, naming),
    { ...bare.document, [REPOS]: [...repos, entry] },
    `the end of its "${REPOS}" list could not be found safely. ${byHand}`
  );
}
