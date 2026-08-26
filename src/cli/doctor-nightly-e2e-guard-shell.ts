/**
 * @file doctor-nightly-e2e-guard-shell.ts
 * @description Static interpreter for the intentionally small guard run grammar
 * @module cli/doctor-nightly-e2e-guard-shell
 */
import { normalizeNightlyGuardTarget } from "./doctor-nightly-e2e-guard-contract.js";
import {
  inspectNightlyGuardCommandFileWrites,
  type NightlyGuardCommandFileWrite,
} from "./doctor-nightly-e2e-guard-command-files.js";
import {
  lexNightlyGuardRun,
  type ShellToken,
  type ShellWord,
} from "./doctor-nightly-e2e-guard-shell-lexer.js";
import {
  isExecutionChangingEnvironmentName,
  nightlyGuardEnvironmentFailure,
  nightlyGuardPosixContextFailure,
  type NightlyGuardRuntimeContext,
} from "./doctor-nightly-e2e-guard-runtime.js";

const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*$/u;
const ENVIRONMENT_TARGET = /^\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))$/u;
const BYPASS_ENVIRONMENT_NAMES = new Set([
  "GATE_BYPASS",
  "NIGHTLY_BYPASS",
  "NIGHTLY_BYPASS_LABEL",
  "NIGHTLY_BYPASS_MAX_HOURS",
  "NIGHTLY_BYPASS_REASON_PATTERN",
]);
const EXACT_BYPASS_REFERENCE =
  /(?:^|[^A-Z0-9_])(?:GATE_BYPASS|NIGHTLY_BYPASS)(?=$|[^A-Z0-9_])/iu;

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
  /** Comment-stripped executable evidence that this step controls bypass. */
  readonly bypassEvidence: boolean;
  /** Ordered command-file effects retained for later guard-step attribution. */
  readonly commandFileWrites?: readonly NightlyGuardCommandFileWrite[];
}

/**
 * Compare bypass vocabulary independently of label case and punctuation.
 * @param value - Executable expression or literal environment value
 * @returns Whether the normalized text can denote nightly bypass state
 */
export const hasNightlyBypassReference = (value: string): boolean => {
  const terms = value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  const candidates = value
    .split(/['"`()$,{}[\]]+/u)
    .map(candidate => candidate.toLowerCase().replace(/[^a-z0-9]/gu, ""));
  const constructedExpression =
    /\$\{\{[\s\S]*\}\}/u.test(value) &&
    ["nightly", "e2e", "bypass"].every(term => terms.includes(term)) &&
    !terms.includes("cache");
  return (
    EXACT_BYPASS_REFERENCE.test(value) ||
    candidates.includes("nightlye2ebypass") ||
    constructedExpression
  );
};

/**
 * Match the exact environment names implemented by the shipped guard.
 * @param value - YAML or shell environment name
 * @returns Whether the name is part of the bounded-waiver contract
 */
export const isNightlyBypassEnvironmentName = (value: string): boolean =>
  ENVIRONMENT_NAME.test(value) && BYPASS_ENVIRONMENT_NAMES.has(value);

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
  return isNightlyBypassEnvironmentName(name);
};

const safeEnvironmentFileName = (name: string): boolean =>
  !isNightlyBypassEnvironmentName(name) &&
  !hasNightlyBypassReference(name) &&
  !isExecutionChangingEnvironmentName(name);

/** Derived facts shared by the supported-command checks. */
interface RunMetadata {
  readonly commandWords: readonly ShellWord[];
  readonly node: number;
  readonly containsNode: boolean;
  readonly bypassEvidence: boolean;
  readonly bypassWiring?: "inline environment" | "GITHUB_ENV";
  readonly commandFileWrites?: readonly NightlyGuardCommandFileWrite[];
}

const runMetadata = (tokens: readonly ShellToken[]): RunMetadata => {
  const commandWords = words(tokens);
  const node = commandWords.findIndex(word => word.value === "node");
  const containsNode = node >= 0;
  const fileWrites = inspectNightlyGuardCommandFileWrites(
    tokens,
    safeEnvironmentFileName
  );
  const bypassEvidence = commandWords.some(
    word => bypassAssignment(word) || hasNightlyBypassReference(word.value)
  );
  const normalizedRun = commandWords.map(word => word.value).join(" ");
  const inlineEnvironment =
    containsNode &&
    (commandWords.slice(0, node).some(bypassAssignment) ||
      (commandWords[0]?.value === "env" &&
        hasNightlyBypassReference(normalizedRun)));
  const bypassWiring = fileWrites.some(
    write => write.file === "GITHUB_ENV" && write.safety !== "safe"
  )
    ? "GITHUB_ENV"
    : inlineEnvironment
      ? "inline environment"
      : undefined;
  return {
    commandWords,
    node,
    containsNode,
    bypassEvidence,
    ...(bypassWiring ? { bypassWiring } : {}),
    ...(fileWrites.length > 0 ? { commandFileWrites: fileWrites } : {}),
  };
};

const resultBase = (
  metadata: RunMetadata
): Pick<
  NightlyGuardRunInspection,
  | "reportingOnly"
  | "containsNode"
  | "bypassEvidence"
  | "bypassWiring"
  | "commandFileWrites"
> => ({
  reportingOnly: false,
  containsNode: metadata.containsNode,
  bypassEvidence: metadata.bypassEvidence,
  ...(metadata.bypassWiring ? { bypassWiring: metadata.bypassWiring } : {}),
  ...(metadata.commandFileWrites
    ? { commandFileWrites: metadata.commandFileWrites }
    : {}),
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

const nodePrefixFailure = (
  commandWords: readonly ShellWord[],
  node: number
): string | undefined => {
  const prefix = commandWords.slice(0, node);
  if (
    prefix.length === 0 ||
    (prefix.length === 1 && prefix[0]?.value === "env")
  ) {
    return undefined;
  }
  const assignments = prefix.filter(word => word.value.includes("="));
  const dangerous = assignments.find(word =>
    isExecutionChangingEnvironmentName(
      word.value.slice(0, word.value.indexOf("="))
    )
  );
  if (dangerous) {
    return `${dangerous.value.slice(0, dangerous.value.indexOf("="))} pre-node assignment is unsafe`;
  }
  return assignments.length > 0
    ? "pre-node environment assignments are unsupported because they can change certified handler behavior"
    : "Node command does not match the supported literal grammar";
};

const inspectNodeCommand = (
  metadata: RunMetadata,
  env: Readonly<Record<string, string>>,
  environmentFailure: string | undefined
): NightlyGuardRunInspection => {
  const base = resultBase(metadata);
  const afterNode = metadata.commandWords.slice(metadata.node + 1);
  const prefixFailure = nodePrefixFailure(metadata.commandWords, metadata.node);
  const refusal = environmentFailure ?? prefixFailure;
  if (refusal || (afterNode.length !== 1 && afterNode.length !== 2)) {
    return {
      ...base,
      reason:
        refusal ?? "Node command does not match the supported literal grammar",
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
 * @param context - Runner and effective shell metadata proving POSIX semantics
 * @returns Static target/reporting/refusal and bypass-wiring evidence
 */
export function inspectNightlyGuardRun(
  run: string,
  env: Readonly<Record<string, string>>,
  context: NightlyGuardRuntimeContext
): NightlyGuardRunInspection {
  const lexical = lexNightlyGuardRun(run);
  if (!lexical.tokens) {
    return {
      reportingOnly: false,
      containsNode: /(?:^|[ \t])node(?:[ \t]|$)/u.test(run),
      bypassEvidence: hasNightlyBypassReference(run),
      ...(lexical.reason ? { reason: lexical.reason } : {}),
    };
  }
  const tokens = lexical.tokens;
  const metadata = runMetadata(tokens);
  const contextFailure = nightlyGuardPosixContextFailure(run, context);
  if (contextFailure) {
    return { ...resultBase(metadata), reason: contextFailure };
  }
  if (!metadata.containsNode) return resultBase(metadata);
  if (unsupportedCommandShape(tokens)) {
    return {
      ...resultBase(metadata),
      reason:
        "multiple commands, pipelines, and shell operators are unsupported",
    };
  }
  return inspectNodeCommand(
    metadata,
    env,
    nightlyGuardEnvironmentFailure(context.environment)
  );
}
