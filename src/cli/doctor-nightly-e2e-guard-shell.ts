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
}

/** Shell provenance required before POSIX tokens can be interpreted. */
export interface NightlyGuardRunContext {
  /** Highest-precedence workflow/job/step shell declaration, when present. */
  readonly shell: unknown;
  /** Job runner labels used only when no shell is explicitly declared. */
  readonly runsOn: unknown;
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
  return (
    EXACT_BYPASS_REFERENCE.test(value) ||
    (terms.includes("nightly") &&
      terms.includes("e2e") &&
      terms.includes("bypass"))
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

const writesGithubEnvironment = (tokens: readonly ShellToken[]): boolean => {
  const shellWords = words(tokens);
  const operators = tokens.flatMap(token =>
    token.kind === "operator" ? [token.value] : []
  );
  const hasTarget = shellWords.some(
    word =>
      actualEnvironmentTarget(word) !== undefined &&
      environmentName(word) === "GITHUB_ENV"
  );
  const redirects = operators.some(operator => [">", ">>"].includes(operator));
  const teeAppend = shellWords.some(
    (word, index) =>
      word.value === "tee" && shellWords[index + 1]?.value === "-a"
  );
  return (
    hasTarget && shellWords.some(bypassAssignment) && (redirects || teeAppend)
  );
};

const explicitPosixShell = (value: string): boolean =>
  /^(?:\/(?:[A-Za-z0-9._-]+\/)*?)?(?:bash|sh)(?:\s+(?:-[A-Za-z0-9-]+|pipefail|\{0\}))*$/u.test(
    value.trim()
  );

const runnerLabels = (runsOn: unknown): readonly string[] | undefined => {
  if (typeof runsOn === "string") return [runsOn];
  if (!Array.isArray(runsOn)) return undefined;
  return runsOn.every(label => typeof label === "string") ? runsOn : undefined;
};

const posixContextFailure = (
  run: string,
  context: NightlyGuardRunContext
): string | undefined => {
  if (run.trim().length === 0) return undefined;
  if (context.shell !== undefined) {
    return typeof context.shell === "string" &&
      explicitPosixShell(context.shell)
      ? undefined
      : "step shell is unknown or non-POSIX; static POSIX interpretation is unavailable";
  }
  const labels = runnerLabels(context.runsOn);
  if (!labels) {
    return "runner is dynamic or unknown, so its default shell cannot be proven POSIX";
  }
  const normalized = labels.map(label => label.toLowerCase());
  if (normalized.some(label => label.includes("windows"))) {
    return "runner default shell is non-POSIX";
  }
  return normalized.some(label =>
    ["ubuntu", "linux", "macos"].some(platform => label.includes(platform))
  )
    ? undefined
    : "runner labels do not prove a POSIX default shell";
};

/** Derived facts shared by the supported-command checks. */
interface RunMetadata {
  readonly commandWords: readonly ShellWord[];
  readonly node: number;
  readonly containsNode: boolean;
  readonly bypassEvidence: boolean;
  readonly bypassWiring?: "inline environment" | "GITHUB_ENV";
}

const runMetadata = (tokens: readonly ShellToken[]): RunMetadata => {
  const commandWords = words(tokens);
  const node = commandWords.findIndex(word => word.value === "node");
  const containsNode = node >= 0;
  const githubEnvironment = writesGithubEnvironment(tokens);
  const bypassEvidence = commandWords.some(
    word => bypassAssignment(word) || hasNightlyBypassReference(word.value)
  );
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
    bypassEvidence,
    ...(bypassWiring ? { bypassWiring } : {}),
  };
};

const resultBase = (
  metadata: RunMetadata
): Pick<
  NightlyGuardRunInspection,
  "reportingOnly" | "containsNode" | "bypassEvidence" | "bypassWiring"
> => ({
  reportingOnly: false,
  containsNode: metadata.containsNode,
  bypassEvidence: metadata.bypassEvidence,
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
    ["NODE_OPTIONS", "PATH"].includes(
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
  env: Readonly<Record<string, string>>
): NightlyGuardRunInspection => {
  const base = resultBase(metadata);
  const afterNode = metadata.commandWords.slice(metadata.node + 1);
  const prefixFailure = nodePrefixFailure(metadata.commandWords, metadata.node);
  if (prefixFailure || (afterNode.length !== 1 && afterNode.length !== 2)) {
    return {
      ...base,
      reason:
        prefixFailure ??
        "Node command does not match the supported literal grammar",
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
  context: NightlyGuardRunContext
): NightlyGuardRunInspection {
  const contextFailure = posixContextFailure(run, context);
  if (contextFailure) {
    return {
      reportingOnly: false,
      containsNode: /(?:^|[ \t])node(?:[ \t]|$)/u.test(run),
      bypassEvidence: hasNightlyBypassReference(run),
      reason: contextFailure,
    };
  }
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
