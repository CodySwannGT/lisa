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
 * environment on unchanged.
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

/**
 * One hook as the framework reads it.
 * @param moment - The moment
 * @returns The hook's settings, in the order they are written
 */
function hookSettings(
  moment: CarrierMoment
): Readonly<Record<string, unknown>> {
  return {
    id: `${HOOK_ID_PREFIX}${moment}`,
    name: `Checks this repository requires before a ${moment}`,
    entry: `sh ${carrierScriptPath(moment)}`,
    language: "system",
    pass_filenames: false,
    always_run: true,
    stages: [CARRIER_HOOKS[moment]],
  };
}

/** The `repo: local` entry as the framework reads it. */
export const PRE_COMMIT_ENTRY: Readonly<Record<string, unknown>> = {
  repo: "local",
  hooks: CARRIER_MOMENTS.map(moment => hookSettings(moment)),
};

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
 * @returns Its lines, the `- repo: local` line first
 */
function entryLines(): readonly string[] {
  const hooks = CARRIER_MOMENTS.flatMap(moment => {
    const [first = "", ...rest] = Object.entries(hookSettings(moment)).map(
      ([key, value]) => settingLine(key, value)
    );
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
 * Add the marked entry at the end of the list of hook sources.
 * @param lines - The file's lines, without any earlier marked block
 * @returns The new lines, or `null` when the place cannot be found
 */
function withEntry(lines: readonly string[]): readonly string[] | null {
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
        indented([begin, ...entryLines(), end], indentOf(item))
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
  const byHand = `Add this entry to "${REPOS}" by hand: ${JSON.stringify(PRE_COMMIT_ENTRY)}`;
  const wanted = hookSettings(moment);
  const already = hooksOf(reposOf(parseMapping(text)) ?? []);
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
    withEntry(bare.lines),
    { ...bare.document, [REPOS]: [...repos, PRE_COMMIT_ENTRY] },
    `the end of its "${REPOS}" list could not be found safely. ${byHand}`
  );
}
