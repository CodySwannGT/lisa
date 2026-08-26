/**
 * @file doctor-nightly-e2e-guard-shell-lexer.ts
 * @description Bounded comment-aware lexer for the supported guard run grammar
 * @module cli/doctor-nightly-e2e-guard-shell-lexer
 */

const MAX_SHELL_TOKENS = 64;
const QUOTE_CHARACTERS = ["'", '"'];
const HORIZONTAL_WHITESPACE = [" ", "\t", "\r"];
const COMMAND_BOUNDARIES = ["\n", ";"];
const SHELL_OPERATORS = [">", "<", "&", "|", "(", ")"];

/** How a shell word acquired its bytes. */
type QuoteKind = "unquoted" | "single" | "double" | "mixed";

/** One decoded shell word retained by the supported grammar. */
export interface ShellWord {
  readonly kind: "word";
  readonly value: string;
  readonly quote: QuoteKind;
  /** Shell expansion or unquoted glob syntax prevents exact byte proof. */
  readonly dynamic: boolean;
}

/** One command separator or unsupported shell operator. */
interface ShellOperator {
  readonly kind: "operator";
  readonly value: string;
}

/** Bounded lexical token used only by the static interpreter. */
export type ShellToken = ShellWord | ShellOperator;

/** Immutable accumulator for one bounded shell scan. */
interface ShellLexerState {
  readonly tokens: readonly ShellToken[];
  readonly word: string;
  readonly quote?: "single" | "double";
  readonly quoteMask: number;
  readonly dynamic: boolean;
  readonly comment: boolean;
  readonly skipNext: boolean;
  readonly error?: string;
}

/** Result of lexing one YAML-decoded run scalar. */
export interface ShellLexResult {
  readonly tokens?: readonly ShellToken[];
  readonly reason?: string;
}

const quoteFor = (mask: number): QuoteKind => {
  if (mask === 2) return "single";
  if (mask === 4) return "double";
  if (mask === 0 || mask === 1) return "unquoted";
  return "mixed";
};

const withToken = (
  state: ShellLexerState,
  token: ShellToken
): ShellLexerState =>
  state.tokens.length >= MAX_SHELL_TOKENS
    ? {
        ...state,
        error: `shell token limit ${MAX_SHELL_TOKENS} exceeded`,
      }
    : { ...state, tokens: [...state.tokens, token] };

const flushWord = (state: ShellLexerState): ShellLexerState =>
  state.word.length === 0
    ? state
    : withToken(
        { ...state, word: "", quoteMask: 0, dynamic: false },
        {
          kind: "word",
          value: state.word,
          quote: quoteFor(state.quoteMask),
          dynamic: state.dynamic,
        }
      );

const withOperator = (state: ShellLexerState, value: string): ShellLexerState =>
  withToken(flushWord(state), { kind: "operator", value });

const withoutQuote = (state: ShellLexerState): ShellLexerState => ({
  tokens: state.tokens,
  word: state.word,
  quoteMask: state.quoteMask,
  dynamic: state.dynamic,
  comment: state.comment,
  skipNext: state.skipNext,
  ...(state.error ? { error: state.error } : {}),
});

const quotedCharacter = (
  state: ShellLexerState,
  source: string,
  character: string,
  index: number
): ShellLexerState => {
  if (
    (character === "'" && state.quote === "single") ||
    (character === '"' && state.quote === "double")
  ) {
    return withoutQuote(state);
  }
  if (character !== "\\" || state.quote !== "double") {
    return {
      ...state,
      word: `${state.word}${character}`,
      dynamic:
        state.dynamic ||
        (state.quote === "double" && ["$", "`"].includes(character)),
    };
  }
  const next = source[index + 1];
  if (next === undefined) {
    return { ...state, error: "unterminated shell escape" };
  }
  if (next === "\n") return { ...state, skipNext: true };
  return ["$", "`", '"', "\\"].includes(next)
    ? { ...state, word: `${state.word}${next}`, skipNext: true }
    : { ...state, word: `${state.word}\\` };
};

const escapedCharacter = (
  state: ShellLexerState,
  source: string,
  index: number
): ShellLexerState => {
  const next = source[index + 1];
  if (next === undefined) {
    return { ...state, error: "unterminated shell escape" };
  }
  if (next === "\n") return { ...state, skipNext: true };
  return {
    ...state,
    word: `${state.word}${next}`,
    quoteMask: state.quoteMask | 1,
    skipNext: true,
  };
};

const quotedStart = (
  state: ShellLexerState,
  character: string
): ShellLexerState => {
  const single = character === "'";
  return {
    ...state,
    quote: single ? "single" : "double",
    quoteMask: state.quoteMask | (single ? 2 : 4),
  };
};

const ordinaryCharacter = (
  state: ShellLexerState,
  character: string
): ShellLexerState => ({
  ...state,
  word: `${state.word}${character}`,
  quoteMask: state.quoteMask | 1,
  dynamic:
    state.dynamic || ["$", "`", "*", "?", "[", "~", "{"].includes(character),
});

const operatorCharacter = (
  state: ShellLexerState,
  source: string,
  character: string,
  index: number
): ShellLexerState => {
  const doubled = source[index + 1] === character;
  return {
    ...withOperator(state, doubled ? `${character}${character}` : character),
    skipNext: doubled,
  };
};

const unquotedCharacter = (
  state: ShellLexerState,
  source: string,
  character: string,
  index: number
): ShellLexerState => {
  if (QUOTE_CHARACTERS.includes(character)) {
    return quotedStart(state, character);
  }
  if (character === "\\") return escapedCharacter(state, source, index);
  if (character === "#" && state.word.length === 0) {
    return { ...state, comment: true };
  }
  if (HORIZONTAL_WHITESPACE.includes(character)) return flushWord(state);
  if (COMMAND_BOUNDARIES.includes(character)) {
    return withOperator(state, character);
  }
  return SHELL_OPERATORS.includes(character)
    ? operatorCharacter(state, source, character, index)
    : ordinaryCharacter(state, character);
};

const lexCharacter = (
  state: ShellLexerState,
  source: string,
  character: string,
  index: number
): ShellLexerState => {
  if (state.error) return state;
  if (state.skipNext) return { ...state, skipNext: false };
  if (state.comment) {
    return character === "\n"
      ? { ...withOperator(state, "\n"), comment: false }
      : state;
  }
  return state.quote
    ? quotedCharacter(state, source, character, index)
    : unquotedCharacter(state, source, character, index);
};

/**
 * Lex shell words/operators while applying POSIX comment boundaries.
 *
 * `#` begins a comment only outside quotes at the start of a word. The scan is
 * bounded by the 1 MiB workflow read and a 64-token grammar ceiling.
 * @param source - YAML-decoded run scalar
 * @returns Tokens or one fail-closed grammar reason
 */
export function lexNightlyGuardRun(source: string): ShellLexResult {
  const scanned = source
    .split("")
    .reduce<ShellLexerState>(
      (state, character, index) =>
        lexCharacter(state, source, character, index),
      {
        tokens: [],
        word: "",
        quoteMask: 0,
        dynamic: false,
        comment: false,
        skipNext: false,
      }
    );
  const completed = flushWord(scanned);
  if (completed.error) return { reason: completed.error };
  return completed.quote
    ? { reason: "unterminated shell quote" }
    : { tokens: completed.tokens };
}
