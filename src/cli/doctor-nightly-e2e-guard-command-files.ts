/**
 * @file doctor-nightly-e2e-guard-command-files.ts
 * @description Bounded payload-aware interpretation of GitHub command-file writes
 * @module cli/doctor-nightly-e2e-guard-command-files
 */
import {
  type ShellToken,
  type ShellWord,
} from "./doctor-nightly-e2e-guard-shell-lexer.js";

const GITHUB_COMMAND_FILES = ["GITHUB_ENV", "GITHUB_PATH"] as const;
const ENVIRONMENT_TARGET = /^\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))$/u;

/** One statically observed write to a GitHub command file. */
export interface NightlyGuardCommandFileWrite {
  /** Command file whose later-step process state can change. */
  readonly file: (typeof GITHUB_COMMAND_FILES)[number];
  /** Whether the exact emitted name is proven harmless to guard execution. */
  readonly safety: "safe" | "unsafe" | "unknown";
}

const words = (tokens: readonly ShellToken[]): readonly ShellWord[] =>
  tokens.filter((token): token is ShellWord => token.kind === "word");

const commandFileReference = (
  word: ShellWord
): NightlyGuardCommandFileWrite["file"] | undefined =>
  word.quote === "single"
    ? undefined
    : GITHUB_COMMAND_FILES.find(file =>
        new RegExp(
          `\\$(?:\\{[^}\\n]*${file}[^}\\n]*\\}|[A-Z0-9_]*${file}[A-Z0-9_]*)`,
          "u"
        ).test(word.value)
      );

const exactTargetName = (word: ShellWord): string | undefined => {
  if (word.quote === "single") return undefined;
  const match = ENVIRONMENT_TARGET.exec(word.value);
  return match?.[1] ?? match?.[2];
};

const commandSegment = (
  tokens: readonly ShellToken[],
  end: number
): readonly ShellToken[] => {
  const boundary = tokens
    .slice(0, end)
    .reduce(
      (latest, token, index) =>
        token.kind === "operator" &&
        (token.value === "\n" || token.value === ";")
          ? index
          : latest,
      -1
    );
  return tokens.slice(boundary + 1, end);
};

const assignmentName = (word: ShellWord): string | undefined =>
  /^([A-Z][A-Z0-9_]*)=[^\n]*$/u.exec(word.value)?.[1];

const emittedAssignmentName = (
  tokens: readonly ShellToken[]
): string | undefined => {
  if (tokens.some(token => token.kind === "operator")) return undefined;
  const emitted = words(tokens);
  const payload =
    emitted.length === 2 && emitted[0]?.value === "echo"
      ? emitted[1]
      : emitted.length === 3 &&
          emitted[0]?.value === "printf" &&
          ["%s", "%s\\n"].includes(emitted[1]?.value ?? "")
        ? emitted[2]
        : undefined;
  return payload ? assignmentName(payload) : undefined;
};

const teeAppendBefore = (
  tokens: readonly ShellToken[],
  target: number
): boolean => {
  const priorWords = words(commandSegment(tokens, target));
  return priorWords.some(
    (word, index) =>
      word.value === "tee" && priorWords[index + 1]?.value === "-a"
  );
};

const emittedNameForSink = (
  tokens: readonly ShellToken[],
  target: number
): string | undefined => {
  const prior = tokens[target - 1];
  if (
    prior?.kind === "operator" &&
    (prior.value === ">" || prior.value === ">>")
  ) {
    return emittedAssignmentName(commandSegment(tokens, target - 1));
  }
  const pipe = tokens[target - 3];
  const tee = tokens[target - 2];
  const append = tokens[target - 1];
  return pipe?.kind === "operator" &&
    pipe.value === "|" &&
    tee?.kind === "word" &&
    tee.value === "tee" &&
    append?.kind === "word" &&
    append.value === "-a"
    ? emittedAssignmentName(commandSegment(tokens, target - 3))
    : undefined;
};

const writeForToken = (
  tokens: readonly ShellToken[],
  token: ShellWord,
  index: number,
  safeEnvironmentName: (name: string) => boolean
): NightlyGuardCommandFileWrite | undefined => {
  const file = commandFileReference(token);
  if (!file) return undefined;
  const prior = tokens[index - 1];
  const redirected =
    prior?.kind === "operator" && (prior.value === ">" || prior.value === ">>");
  if (!redirected && !teeAppendBefore(tokens, index)) return undefined;
  if (exactTargetName(token) !== file) return { file, safety: "unknown" };
  if (file === "GITHUB_PATH") return { file, safety: "unsafe" };
  const emittedName = emittedNameForSink(tokens, index);
  return {
    file,
    safety:
      emittedName === undefined
        ? "unknown"
        : safeEnvironmentName(emittedName)
          ? "safe"
          : "unsafe",
  };
};

/**
 * Retain command-file effects without mistaking unrelated assignments for payload.
 * @param tokens - Comment-stripped bounded shell tokens for one step
 * @param safeEnvironmentName - Guard-aware predicate for one exact emitted name
 * @returns Every recognized command-file sink in source order
 */
export function inspectNightlyGuardCommandFileWrites(
  tokens: readonly ShellToken[],
  safeEnvironmentName: (name: string) => boolean
): readonly NightlyGuardCommandFileWrite[] {
  return tokens.flatMap((token, index) => {
    if (token.kind !== "word") return [];
    const write = writeForToken(tokens, token, index, safeEnvironmentName);
    return write ? [write] : [];
  });
}
