/**
 * Mechanism classification for the context-routing readiness producer (B6,
 * PRD #1739, #1896).
 *
 * B6 may only be stood up on a documented guarantee whose named mechanism
 * provably does not exist. Deciding whether a backticked token even IS a
 * checkable repository path is therefore the whole precision budget of the
 * blocker, and a standing blocker flips the entire repository to `NOT_READY` —
 * so every ambiguity here resolves to `unmappable`, never to `missing`.
 *
 * The three false-positive classes this module exists to kill, all of which look
 * exactly like repository paths:
 *
 * - **Package names.** `@codyswann/lisa` is a dependency, not a file.
 * - **Slugs and refs.** `CodySwannGT/lisa` and `origin/main` name a repository
 *   and a git ref; neither is a path in the working tree.
 * - **Generated artifacts.** `dist/cli.js` is absent from a clean checkout by
 *   design, so faulting it would fault every repository that builds anything.
 * @module cli/doctor-readiness-context-mechanisms
 */
import {
  directoryExists,
  pathExists,
  readFileOrNull,
  trimSlashes,
} from "./doctor-readiness-shared.js";

/** File extensions a named mechanism plausibly ends in. */
const MECHANISM_EXTENSION =
  /\.(ya?ml|sh|bash|zsh|ts|tsx|js|mjs|cjs|json|jsonc|md|toml|cfg|ini)$/;

/**
 * Generated paths treated as ignored even when a repository ships no
 * `.gitignore`. Their absence is a property of a clean checkout, never of
 * documentation that lies.
 */
const ALWAYS_GENERATED: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  ".next",
  ".turbo",
  ".cache",
];

/** What a named mechanism turned out to be. */
export type MechanismVerdict =
  /** The named path exists — the documented guarantee is backed. */
  | "present"
  /** The named path provably does not exist — this is what B6 stands on. */
  | "missing"
  /** Not a checkable in-repository path, so it establishes nothing. */
  | "unmappable";

/** Decides whether a repository path is ignored/generated. */
export type IgnoreMatcher = (relativePath: string) => boolean;

/**
 * Whether an inline-code span is even shaped like an in-repository path.
 *
 * Every exclusion is a false-positive guard: a URL is not a repo path, a glob
 * names a set rather than a file, an `@` marks a scoped package or a versioned
 * action reference rather than a path, and a placeholder names nothing.
 * @param token - The inline-code text
 * @returns True when the token is shaped like a repository path
 */
export function isMechanismPath(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed === "" || /\s/.test(trimmed)) {
    return false;
  }
  if (
    trimmed.includes("://") ||
    trimmed.includes("*") ||
    trimmed.includes("<") ||
    trimmed.includes("$") ||
    // A scoped package (`@acme/pkg`) or a pinned action (`actions/checkout@v4`)
    // is a dependency coordinate, not a file this repository owns.
    trimmed.includes("@") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("-")
  ) {
    return false;
  }
  return trimmed.includes("/") || MECHANISM_EXTENSION.test(trimmed);
}

/**
 * Build the ignore matcher for a repository from its `.gitignore` plus the
 * always-generated defaults. The matcher is deliberately coarse — it compares
 * path segments and directory prefixes rather than implementing gitignore's full
 * grammar — because its only job is to move a doubtful path OUT of the violation
 * set, where being over-inclusive is the safe direction.
 * @param root - Repository root
 * @returns A matcher that answers "is this path generated or ignored?"
 */
export async function loadIgnoreMatcher(root: string): Promise<IgnoreMatcher> {
  const source = (await readFileOrNull(root, ".gitignore")) ?? "";
  const declared = source
    .split("\n")
    .map(line => line.trim())
    .filter(
      line => line !== "" && !line.startsWith("#") && !line.startsWith("!")
    )
    .map(trimSlashes)
    .filter(line => line !== "" && !line.includes("*"));
  const patterns = new Set([...ALWAYS_GENERATED, ...declared]);
  return relativePath =>
    relativePath
      .split("/")
      .some(
        (segment, index, segments) =>
          patterns.has(segments.slice(0, index + 1).join("/")) ||
          patterns.has(segment)
      );
}

/**
 * Classify one named mechanism.
 *
 * A token only becomes checkable when the repository itself vouches for the
 * shape: it carries a known file extension, it lives under a dot-directory the
 * repository conventionally keeps machinery in, or its first segment is a real
 * directory in this repository. `acme/release-gate` in a repository with no
 * `acme/` directory is an `org/repo` slug as far as anything here can tell, so
 * it is unmappable — not missing.
 * @param root - Repository root
 * @param token - The named mechanism path
 * @param isIgnored - The repository's ignore matcher
 * @returns What the mechanism turned out to be
 */
export async function classifyMechanism(
  root: string,
  token: string,
  isIgnored: IgnoreMatcher
): Promise<MechanismVerdict> {
  if (isIgnored(token)) {
    return "unmappable";
  }
  if (await pathExists(root, token)) {
    return "present";
  }
  const [firstSegment = ""] = token.split("/");
  const checkable =
    MECHANISM_EXTENSION.test(token) ||
    firstSegment.startsWith(".") ||
    (token.includes("/") && (await directoryExists(root, firstSegment)));
  return checkable ? "missing" : "unmappable";
}
