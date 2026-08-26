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
const POSIX_IDENTIFIER = "[A-Za-z_]\\w*";
const POSIX_ASSIGNMENT = /^([A-Za-z_]\w*)=/u;
const ENVIRONMENT_TARGET = new RegExp(
  `^\\$(?:\\{(${POSIX_IDENTIFIER})\\}|(${POSIX_IDENTIFIER}))$`,
  "u"
);
const INDIRECT_ENVIRONMENT_TARGET = new RegExp(
  `^\\$\\{!(${POSIX_IDENTIFIER})\\}$`,
  "u"
);

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
  !word.dynamic || word.quote === "single"
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

const indirectTargetName = (word: ShellWord): string | undefined =>
  word.quote === "single"
    ? undefined
    : INDIRECT_ENVIRONMENT_TARGET.exec(word.value)?.[1];

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
  word.dynamic || word.quote === "mixed" || /[\n\r\\`$]/u.test(word.value)
    ? undefined
    : /^([A-Z][A-Z0-9_]*)=[\x20-\x7e]*$/u.exec(word.value)?.[1];

const literalPrintfAssignment = (word: ShellWord): string | undefined => {
  if (word.dynamic || word.quote !== "single" || !word.value.endsWith("\\n")) {
    return undefined;
  }
  const line = word.value.slice(0, -2);
  if (/[\\%]/u.test(line)) return undefined;
  return assignmentName({ ...word, value: line });
};

const emittedAssignmentName = (
  tokens: readonly ShellToken[]
): string | undefined => {
  if (tokens.some(token => token.kind === "operator")) return undefined;
  const emitted = words(tokens);
  const format = emitted[1];
  const payload =
    emitted.length === 2 && emitted[0]?.value === "echo"
      ? emitted[1]
      : emitted.length === 3 &&
          emitted[0]?.value === "printf" &&
          format?.dynamic === false &&
          format.quote !== "mixed" &&
          ["%s", "%s\\n"].includes(format.value)
        ? emitted[2]
        : undefined;
  if (payload) return assignmentName(payload);
  return emitted.length === 2 && emitted[0]?.value === "printf"
    ? literalPrintfAssignment(emitted[1] as ShellWord)
    : undefined;
};

/** One direct variable expansion that may identify a command-file sink. */
interface CommandFileAlias {
  /** GitHub command file referenced by the assignment's right-hand side. */
  readonly file: NightlyGuardCommandFileWrite["file"];
  /** Exact means the right-hand side is only that command-file variable. */
  readonly exact: boolean;
}

const aliasName = (word: ShellWord): string | undefined =>
  word.quote === "single" || word.quote === "double"
    ? undefined
    : POSIX_ASSIGNMENT.exec(word.value)?.[1];

const literalCommandFileAssignment = (
  word: ShellWord
): NightlyGuardCommandFileWrite["file"] | undefined => {
  if (word.dynamic) return undefined;
  const name = aliasName(word);
  if (!name) return undefined;
  const value = word.value.slice(word.value.indexOf("=") + 1);
  return GITHUB_COMMAND_FILES.find(file => value === file);
};

const aliasBefore = (
  tokens: readonly ShellToken[],
  targetName: string,
  target: number
): CommandFileAlias | undefined =>
  tokens
    .slice(0, target)
    .reduce<CommandFileAlias | undefined>((latest, token) => {
      if (token.kind !== "word" || aliasName(token) !== targetName) {
        return latest;
      }
      const file = commandFileReference(token);
      if (!file) return undefined;
      const value = token.value.slice(token.value.indexOf("=") + 1);
      const match = ENVIRONMENT_TARGET.exec(value);
      return {
        file,
        exact: (match?.[1] ?? match?.[2]) === file,
      };
    }, undefined);

const priorCommandFile = (
  tokens: readonly ShellToken[],
  target: number
): NightlyGuardCommandFileWrite["file"] | undefined =>
  tokens
    .slice(0, target)
    .reduce<
      NightlyGuardCommandFileWrite["file"] | undefined
    >((latest, token) => (token.kind === "word" ? (commandFileReference(token) ?? latest) : latest), undefined);

const indirectCommandFileBefore = (
  tokens: readonly ShellToken[],
  targetName: string,
  target: number
): NightlyGuardCommandFileWrite["file"] | undefined => {
  const prior = tokens.slice(0, target);
  const assigned = prior.reduce<
    NightlyGuardCommandFileWrite["file"] | undefined
  >((latest, token) => {
    if (token.kind !== "word" || aliasName(token) !== targetName) {
      return latest;
    }
    return commandFileReference(token) ?? literalCommandFileAssignment(token);
  }, undefined);
  if (assigned) return assigned;
  return prior.reduce<NightlyGuardCommandFileWrite["file"] | undefined>(
    (latest, token) =>
      token.kind === "word"
        ? (commandFileReference(token) ??
          literalCommandFileAssignment(token) ??
          latest)
        : latest,
    undefined
  );
};

const redirectBefore = (
  tokens: readonly ShellToken[],
  target: number
): number | undefined => {
  const prior = tokens[target - 1];
  if (
    prior?.kind === "operator" &&
    (prior.value === ">" || prior.value === ">>")
  ) {
    return target - 1;
  }
  const clobber = tokens[target - 2];
  return clobber?.kind === "operator" &&
    clobber.value === ">" &&
    prior?.kind === "operator" &&
    prior.value === "|"
    ? target - 2
    : undefined;
};

const teePipeBefore = (
  tokens: readonly ShellToken[],
  target: number
): number | undefined => {
  const append = tokens[target - 1];
  const teeIndex =
    append?.kind === "word" && append.value === "-a" ? target - 2 : target - 1;
  const tee = tokens[teeIndex];
  const pipe = tokens[teeIndex - 1];
  return tee?.kind === "word" &&
    tee.value === "tee" &&
    pipe?.kind === "operator" &&
    pipe.value === "|"
    ? teeIndex - 1
    : undefined;
};

const emittedNameForSink = (
  tokens: readonly ShellToken[],
  target: number
): string | undefined => {
  const redirect = redirectBefore(tokens, target);
  if (redirect !== undefined) {
    return emittedAssignmentName(commandSegment(tokens, redirect));
  }
  const teePipe = teePipeBefore(tokens, target);
  return teePipe === undefined
    ? undefined
    : emittedAssignmentName(commandSegment(tokens, teePipe));
};

const isSinkTarget = (
  tokens: readonly ShellToken[],
  target: number
): boolean => {
  return (
    redirectBefore(tokens, target) !== undefined ||
    teePipeBefore(tokens, target) !== undefined
  );
};

const resolvedCommandFileTarget = (
  tokens: readonly ShellToken[],
  token: ShellWord,
  index: number
): CommandFileAlias | undefined => {
  const targetName = exactTargetName(token);
  const indirectName = indirectTargetName(token);
  const direct = commandFileReference(token);
  if (direct) return { file: direct, exact: targetName === direct };
  const alias = targetName ? aliasBefore(tokens, targetName, index) : undefined;
  if (alias) return alias;
  const indirectAlias = indirectName
    ? indirectCommandFileBefore(tokens, indirectName, index)
    : undefined;
  if (indirectAlias) return { file: indirectAlias, exact: false };
  const indirect = targetName ? priorCommandFile(tokens, index) : undefined;
  return indirect ? { file: indirect, exact: false } : undefined;
};

const writeForToken = (
  tokens: readonly ShellToken[],
  token: ShellWord,
  index: number,
  safeEnvironmentName: (name: string) => boolean
): NightlyGuardCommandFileWrite | undefined => {
  if (!isSinkTarget(tokens, index)) return undefined;
  const target = resolvedCommandFileTarget(tokens, token, index);
  if (!target) return undefined;
  if (!target.exact) return { file: target.file, safety: "unknown" };
  if (target.file === "GITHUB_PATH") {
    return { file: target.file, safety: "unsafe" };
  }
  const emittedName = emittedNameForSink(tokens, index);
  return {
    file: target.file,
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
