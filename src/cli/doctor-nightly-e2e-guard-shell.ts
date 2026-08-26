/**
 * @file doctor-nightly-e2e-guard-shell.ts
 * @description Static interpreter for the intentionally small guard run grammar
 * @module cli/doctor-nightly-e2e-guard-shell
 */
import { normalizeNightlyGuardTarget } from "./doctor-nightly-e2e-guard-contract.js";
import {
  lexNightlyGuardRun,
  type ShellToken,
  type ShellWord,
} from "./doctor-nightly-e2e-guard-shell-lexer.js";

const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*$/u;
const ENVIRONMENT_TARGET = /^\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))$/u;

/** Supported interpretation of one `run` scalar. */
export interface NightlyGuardRunInspection {
  /** Literal target or an environment-resolution refusal. */
  readonly target?: string;
  /** Any Node token whose command did not fit the supported grammar. */
  readonly reason?: string;
  /** The command is the non-gating contract/report operation. */
  readonly reportingOnly: boolean;
  /** A Node command occurred after comment removal. */
  readonly containsNode: boolean;
  /** Executable shell construction of bypass state. */
  readonly bypassWiring?: "inline environment" | "GITHUB_ENV";
}

const compact = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/gu, "");

/**
 * Compare bypass vocabulary independently of label case and punctuation.
 * @param value - Executable expression or literal environment value
 * @returns Whether the normalized text can denote nightly bypass state
 */
export const hasNightlyBypassReference = (value: string): boolean => {
  const normalized = compact(value);
  return normalized.includes("bypass");
};

const words = (tokens: readonly ShellToken[]): readonly ShellWord[] =>
  tokens.filter((token): token is ShellWord => token.kind === "word");

const actualEnvironmentTarget = (word: ShellWord): string | undefined =>
  word.quote === "single"
    ? undefined
    : ENVIRONMENT_TARGET.exec(word.value)?.[0];

const environmentName = (word: ShellWord): string | undefined => {
  const match = ENVIRONMENT_TARGET.exec(word.value);
  return match?.[1] ?? match?.[2];
};

const targetFromWord = (
  word: ShellWord,
  env: Readonly<Record<string, string>>
): { readonly target?: string; readonly reason?: string } => {
  if (word.quote === "single" && ENVIRONMENT_TARGET.test(word.value)) {
    return {
      reason:
        "single-quoted environment target is a literal shell string and cannot resolve a guard",
    };
  }
  const variable = actualEnvironmentTarget(word);
  const candidate = variable ? env[environmentName(word) ?? ""] : word.value;
  if (candidate === undefined) {
    return {
      reason:
        "could not resolve the Node target from one unquoted or double-quoted literal environment level",
    };
  }
  const target = normalizeNightlyGuardTarget(candidate);
  return target
    ? { target }
    : {
        reason:
          "Node target must be one literal contained relative ASCII .js/.mjs/.cjs path; expressions, substitutions, absolute/escaping paths, and multiple commands are unsupported",
      };
};

const bypassAssignment = (word: ShellWord): boolean => {
  const equals = word.value.indexOf("=");
  if (equals <= 0) return false;
  const name = word.value.slice(0, equals);
  return (
    (name === "GATE_BYPASS" || name.startsWith("NIGHTLY_BYPASS_")) &&
    ENVIRONMENT_NAME.test(name)
  );
};

const writesGithubEnvironment = (tokens: readonly ShellToken[]): boolean => {
  const redirect = tokens.findIndex(
    token => token.kind === "operator" && token.value === ">>"
  );
  if (redirect <= 0) return false;
  const before = words(tokens.slice(0, redirect));
  const after = words(tokens.slice(redirect + 1));
  return (
    ["echo", "printf"].includes(before[0]?.value ?? "") &&
    before.some(bypassAssignment) &&
    after.length === 1 &&
    actualEnvironmentTarget(after[0] as ShellWord) !== undefined &&
    environmentName(after[0] as ShellWord) === "GITHUB_ENV"
  );
};

/** Derived facts shared by the supported-command checks. */
interface RunMetadata {
  readonly commandWords: readonly ShellWord[];
  readonly node: number;
  readonly containsNode: boolean;
  readonly bypassWiring?: "inline environment" | "GITHUB_ENV";
}

const runMetadata = (tokens: readonly ShellToken[]): RunMetadata => {
  const commandWords = words(tokens);
  const node = commandWords.findIndex(word => word.value === "node");
  const containsNode = node >= 0;
  const githubEnvironment = writesGithubEnvironment(tokens);
  const normalizedRun = commandWords.map(word => word.value).join(" ");
  const inlineEnvironment =
    containsNode &&
    (commandWords.slice(0, node).some(bypassAssignment) ||
      (commandWords[0]?.value === "env" &&
        hasNightlyBypassReference(normalizedRun)));
  const bypassWiring = githubEnvironment
    ? "GITHUB_ENV"
    : inlineEnvironment
      ? "inline environment"
      : undefined;
  return {
    commandWords,
    node,
    containsNode,
    ...(bypassWiring ? { bypassWiring } : {}),
  };
};

const resultBase = (
  metadata: RunMetadata
): Pick<
  NightlyGuardRunInspection,
  "reportingOnly" | "containsNode" | "bypassWiring"
> => ({
  reportingOnly: false,
  containsNode: metadata.containsNode,
  ...(metadata.bypassWiring ? { bypassWiring: metadata.bypassWiring } : {}),
});

const commandGroups = (
  tokens: readonly ShellToken[]
): readonly (readonly ShellToken[])[] =>
  tokens
    .reduce<readonly ShellToken[][]>(
      (groups, token) => {
        if (
          token.kind === "operator" &&
          (token.value === "\n" || token.value === ";")
        ) {
          return groups.at(-1)?.length === 0 ? groups : [...groups, []];
        }
        const prior = groups.slice(0, -1);
        const last = groups.at(-1) ?? [];
        return [...prior, [...last, token]];
      },
      [[]]
    )
    .filter(group => group.length > 0);

const unsupportedCommandShape = (tokens: readonly ShellToken[]): boolean =>
  tokens.some(
    token =>
      token.kind === "operator" && token.value !== "\n" && token.value !== ";"
  ) || commandGroups(tokens).length !== 1;

const supportedNodePrefix = (
  commandWords: readonly ShellWord[],
  node: number
): boolean => {
  const prefix = commandWords.slice(0, node);
  return (
    prefix.length === 0 ||
    (prefix[0]?.value === "env" &&
      prefix.slice(1).every(word => word.value.includes("="))) ||
    prefix.every(word => word.value.includes("="))
  );
};

const inspectNodeCommand = (
  metadata: RunMetadata,
  env: Readonly<Record<string, string>>
): NightlyGuardRunInspection => {
  const base = resultBase(metadata);
  const afterNode = metadata.commandWords.slice(metadata.node + 1);
  if (
    !supportedNodePrefix(metadata.commandWords, metadata.node) ||
    (afterNode.length !== 1 && afterNode.length !== 2)
  ) {
    return {
      ...base,
      reason: "Node command does not match the supported literal grammar",
    };
  }
  const option = afterNode[1]?.value;
  if (option === "--contract-version" || option === "--report-issues") {
    return { ...base, reportingOnly: true };
  }
  if (afterNode.length !== 1) {
    return { ...base, reason: "Node target has unsupported arguments" };
  }
  return {
    ...base,
    ...targetFromWord(afterNode[0] as ShellWord, env),
  };
};

/**
 * Interpret the supported Node grammar after bounded comment-aware lexing.
 * @param run - YAML-decoded shell scalar
 * @param env - Literal YAML environment levels available to this step
 * @returns Static target/reporting/refusal and bypass-wiring evidence
 */
export function inspectNightlyGuardRun(
  run: string,
  env: Readonly<Record<string, string>>
): NightlyGuardRunInspection {
  const lexical = lexNightlyGuardRun(run);
  if (!lexical.tokens) {
    return {
      reportingOnly: false,
      containsNode: /(?:^|[ \t])node(?:[ \t]|$)/u.test(run),
      ...(lexical.reason ? { reason: lexical.reason } : {}),
    };
  }
  const tokens = lexical.tokens;
  const metadata = runMetadata(tokens);
  if (!metadata.containsNode) return resultBase(metadata);
  if (unsupportedCommandShape(tokens)) {
    return {
      ...resultBase(metadata),
      reason:
        "multiple commands, pipelines, and shell operators are unsupported",
    };
  }
  return inspectNodeCommand(metadata, env);
}
