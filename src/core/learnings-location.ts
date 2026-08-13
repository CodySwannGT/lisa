/**
 * Where the machine-managed learnings ledger may and may not live.
 *
 * Extracted from `project-config.ts` so the two layers that must agree —
 * `learnings.file` config validation and the write-time containment check in
 * `learnings-file-safety.ts` — share one definition of "eagerly injected"
 * without the second importing the whole config module (and without pushing
 * `project-config.ts` past its 300-line cap).
 * @module core/learnings-location
 */
import * as path from "node:path";

/** Fixed filename for the machine-managed project-learnings ledger. */
export const PROJECT_LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";

/**
 * Default location for the machine-managed learnings ledger.
 *
 * The ledger lives beside other machine-managed state under `.lisa/`, NOT in an
 * auto-loaded rules tree. Anything under `.claude/rules/` (and the equivalents
 * other runtimes inject) is read raw into every session — placing the ledger
 * there double-loads it and bypasses the executable contract's budget and
 * validation. `.lisa/` is cold: the ledger is consumed only through the
 * contract's bounded projection.
 */
export const DEFAULT_PROJECT_LEARNINGS_FILE = path.posix.join(
  ".lisa",
  PROJECT_LEARNINGS_FILENAME
);

/**
 * Directory prefixes that one or more runtimes inject raw at session start. The
 * learnings ledger must never resolve inside any of them, or the relocation's
 * whole point — keeping the raw file out of eager context — is defeated. Kept
 * conservative and explicit rather than agent-exhaustive; extend it as new
 * eager rule trees are added.
 */
export const AUTO_LOADED_RULES_DIR_PREFIXES = [
  ".claude/rules",
  ".cursor/rules",
  ".github/instructions",
  ".agents/rules",
] as const;

/**
 * Repo-root instruction files that runtimes auto-load whole at session start
 * (AGENTS.md for Codex/Cursor/Copilot/agy/OpenCode; CLAUDE.md for Claude). A
 * `learnings.file` override must never resolve to one of these, or the ledger
 * would again be injected raw.
 */
const ROOT_EAGER_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/**
 * Non-root instruction files the generators maintain and runtimes auto-load
 * (Copilot reads `.github/copilot-instructions.md`). Matched by exact path.
 */
const EAGER_INSTRUCTION_FILE_PATHS = [
  ".github/copilot-instructions.md",
] as const;

/**
 * Identify the eager-context surface a project-relative path falls inside, if
 * any. One matcher shared by config validation and the write-time containment
 * check, so "is this path eagerly injected?" can never be answered two
 * different ways by two layers.
 *
 * Accepts platform separators and unnormalized segments — the caller may be
 * handing over a path derived from `path.relative`, not a config literal.
 * @param relativePath - Project-relative candidate path
 * @returns The matched eager surface, or undefined when the path is cold
 */
export function findEagerContextSurface(
  relativePath: string
): string | undefined {
  const normalized = path.posix.normalize(
    relativePath.split(path.sep).join("/")
  );
  const lowered = normalized.toLowerCase();
  const treePrefix = AUTO_LOADED_RULES_DIR_PREFIXES.find(
    prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
  if (treePrefix !== undefined) {
    return treePrefix;
  }
  const rootFile =
    path.posix.dirname(normalized) === "."
      ? ROOT_EAGER_INSTRUCTION_FILES.find(
          name => name.toLowerCase() === lowered
        )
      : undefined;
  return (
    rootFile ??
    EAGER_INSTRUCTION_FILE_PATHS.find(
      filePath => filePath.toLowerCase() === lowered
    )
  );
}

/**
 * Build the shared operator-readable reason a learnings path was rejected.
 * @param surface - The eager surface the path landed in
 * @returns Sentence naming the surface, the full surface list, and the default
 */
export function eagerContextRejection(surface: string): string {
  const surfaces = [
    ...AUTO_LOADED_RULES_DIR_PREFIXES,
    ...ROOT_EAGER_INSTRUCTION_FILES,
    ...EAGER_INSTRUCTION_FILE_PATHS,
  ].join(", ");
  return `the ledger must not live in an auto-loaded rules tree or instruction file — this one resolves inside ${surface} (auto-loaded surfaces: ${surfaces}); the default ${DEFAULT_PROJECT_LEARNINGS_FILE} is the recommended location`;
}
