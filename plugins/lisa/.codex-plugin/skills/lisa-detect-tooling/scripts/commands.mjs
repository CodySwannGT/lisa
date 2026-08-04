/**
 * Pull the commands out of a shell body.
 *
 * `lisa-detect-tooling` used to match script bodies against a fixed list of tool
 * names, which meant it could only ever re-find tools someone had already
 * thought of — the set that needs a detector least. An Expo project invoking
 * `eas` from eight npm scripts produced nothing, because `eas` was not in the
 * list.
 *
 * So the question this module answers is the open one: what does this shell text
 * actually RUN? Everything downstream then subtracts what is already provided.
 *
 * ## Only the first word of a command position
 *
 * Naive word-scanning of this repository's own hooks proposed `ltrimstr`, `map`
 * and `select` (jq filter internals), `console.log` and `process.exit` (embedded
 * JavaScript), and `load_audit_cves` (a function the hook defines three lines
 * up). None of those are tools; all of them appear where a word-scanner looks.
 *
 * A command runs at a command POSITION — the start of the text, or just after a
 * separator. Reading only that position removes every one of those false
 * positives without a denylist entry for any of them.
 * @module commands
 */

/**
 * Shell keywords and coreutils: present on any machine, never provisioned.
 *
 * This is a floor, not a policy. Anything genuinely absent from a minimal
 * container belongs in the manifest, and a few of these (`unzip`, `curl`) are
 * already declared there by projects that need them — being listed here only
 * means discovery will not RAISE them, not that they are assumed present.
 */
export const SHELL_VOCABULARY = new Set([
  // Keywords and builtins.
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "return",
  "break",
  "continue",
  "exit",
  "local",
  "readonly",
  "declare",
  "export",
  "unset",
  "shift",
  "eval",
  "exec",
  "source",
  "set",
  "trap",
  "wait",
  "read",
  "echo",
  "printf",
  "cd",
  "pwd",
  "true",
  "false",
  "test",
  "let",
  "alias",
  "shopt",
  "getopts",
  "umask",
  // Coreutils and the usual POSIX furniture.
  "cat",
  "grep",
  "egrep",
  "fgrep",
  "sed",
  "awk",
  "cut",
  "tr",
  "sort",
  "uniq",
  "head",
  "tail",
  "wc",
  "tee",
  "xargs",
  "find",
  "ls",
  "mkdir",
  "rmdir",
  "rm",
  "mv",
  "cp",
  "ln",
  "touch",
  "chmod",
  "chown",
  "stat",
  "du",
  "df",
  "dirname",
  "basename",
  "realpath",
  "readlink",
  "mktemp",
  "date",
  "sleep",
  "seq",
  "env",
  "kill",
  "pgrep",
  "pkill",
  "ps",
  "diff",
  "comm",
  "join",
  "paste",
  "split",
  "tar",
  "gzip",
  "gunzip",
  "zip",
  "unzip",
  "curl",
  "wget",
  "sh",
  "bash",
  "zsh",
  "dash",
  "nohup",
  "timeout",
  "yes",
  "tty",
  "id",
  "whoami",
  "uname",
  "hostname",
]);

/**
 * Runtimes and package managers whose presence is assumed by everything here.
 *
 * Separate from the vocabulary above because these are genuinely provisioned —
 * just not by this detector. `node` is what runs it; proposing it would be
 * circular.
 */
export const RUNTIMES = new Set([
  "node",
  "npm",
  "npx",
  "bun",
  "bunx",
  "yarn",
  "pnpm",
  "pnpx",
  "corepack",
  "git",
  "python",
  "python3",
  "pip",
  "pip3",
  "ruby",
  "bundle",
  "go",
  "cargo",
  "docker",
  "make",
]);

/**
 * Commands that RESOLVE the next word from `node_modules`.
 *
 * `npx playwright test` needs no manifest entry: npm put the binary in
 * `node_modules/.bin` and npx finds it there. Reading the mediated word as a
 * tool would propose pinning something the package manager already provides —
 * the noise that teaches a reader to skim the output.
 */
const MEDIATORS = new Set(["npx", "bunx", "pnpx", "dlx"]);

/** Sub-commands after a package manager that mean "run something local". */
const LOCAL_RUNNERS = new Set(["run", "exec", "x", "dlx", "run-script"]);

/**
 * Commands that TEST for another command rather than running it.
 *
 * `command -v gitleaks` is the single most valuable signal a hook can carry, and
 * a word-scanner reading only the first position would throw it away. It is also
 * the shape of the worst failure mode in this codebase: a hook that guards its
 * own tool with `command -v` SKIPS SILENTLY when the tool is absent. The commit
 * succeeds and nothing was scanned.
 *
 * A guarded tool is therefore stronger evidence than an unguarded one, not
 * weaker — its absence is invisible at the moment it matters.
 */
const PROBES = new Set(["command", "which", "type", "hash"]);

/**
 * Words that stand in FRONT of a command without being one.
 *
 * Control keywords have to be skipped past rather than treated as the command,
 * or the very shape this exists to catch is missed: in
 * `if ! command -v gitleaks; then`, stopping at `if` never reaches the probe.
 */
const PREFIXES = new Set([
  "!",
  "sudo",
  "time",
  "nice",
  "builtin",
  "exec",
  "if",
  "then",
  "elif",
  "else",
  "while",
  "until",
  "do",
]);

/** A name that could plausibly be an executable on PATH. */
const TOOL_NAME = /^[a-z][a-z0-9_-]*$/u;

/**
 * Names the text defines as shell functions, which are never PATH tools.
 *
 * This repository's `pre-push` hook defines `load_audit_cves` and
 * `missing_opencode_metadata` and then calls them, which reads exactly like a
 * command invocation because it is one — just not of anything installable.
 * @param {string} text Shell body.
 * @returns {Set<string>} Locally defined function names.
 */
export function localFunctions(text) {
  const names = new Set();
  const pattern =
    /(?:^|\n)\s*(?:function\s+)?([a-z_][a-z0-9_]*)\s*\(\)\s*\{/giu;
  let match = pattern.exec(text);
  while (match) {
    names.add(match[1].toLowerCase());
    match = pattern.exec(text);
  }
  return names;
}

/**
 * Pull out `sh -c '...'` payloads so their contents are parsed as shell too.
 *
 * Done BEFORE quoted spans are stripped, because the payload is precisely a
 * quoted span — and it is the one kind that really is a command. Frontend's
 * `eas:publish:e2e` script wraps its `eas update` in exactly this shape.
 * @param {string} text Shell body.
 * @returns {{stripped: string, payloads: string[]}} Text and nested bodies.
 */
export function extractShellPayloads(text) {
  const payloads = [];
  const stripped = text.replace(
    /\b(?:sh|bash|zsh)\s+-[a-z]*c\s+('([^']*)'|"([^"]*)")/gu,
    (_all, _quoted, single, double) => {
      payloads.push(single ?? double ?? "");
      return " ";
    }
  );
  return { stripped, payloads };
}

/**
 * Blank out quoted spans and comments, keeping only text at command level.
 *
 * Quoted text is where embedded programs live — the jq filters and `node -e`
 * snippets that produced `ltrimstr` and `console.log`. A command inside quotes
 * is an argument to something else, with one exception, which
 * `extractShellPayloads` has already lifted out by the time this runs.
 *
 * This is a character scanner rather than a chain of regexes because quoting and
 * commenting are MUTUALLY nested and no ordering of independent passes gets it
 * right. This repository's own `pre-push.local` proves it: the comment on line 9
 * ends `...the script's exit code)`, and that lone apostrophe pairs with the
 * next real quote 28 lines later, blanking everything between — including the
 * `node -e` payload, whose JavaScript then leaked out as `try`, `catch`,
 * `const` and `unreadable` proposals.
 *
 * Stripping comments first does not fix it either, since a `#` inside a quoted
 * string is not a comment. One pass that tracks both is the only correct shape.
 *
 * Newlines survive so command positions are preserved; everything else inside a
 * masked span becomes a space.
 * @param {string} text Shell body.
 * @returns {string} Text with non-command spans blanked.
 */
export function stripNonCommandSpans(text) {
  const out = [];
  let state = "normal";
  // `$( )` restarts the quoting context: inside it, quotes pair among
  // themselves rather than continuing the enclosing span. A flat scanner falls
  // out of phase on the very first one — this repository's
  // `"$(printf '%s' "$JSON" | node -e '...')"` left the payload's own string
  // literals exposed at command level, proposing `data`, `end` and `stale`.
  const enclosing = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = index > 0 ? text[index - 1] : "";

    // A substitution opens a fresh context from inside ANY state but a
    // single-quoted one, where shell performs no substitution at all.
    if (
      state !== "single" &&
      state !== "comment" &&
      char === "$" &&
      text[index + 1] === "("
    ) {
      enclosing.push(state);
      state = "normal";
      out.push("\n");
      index += 1;
      continue;
    }
    if (state === "normal" && char === ")" && enclosing.length > 0) {
      state = enclosing.pop();
      out.push("\n");
      continue;
    }

    if (state === "normal") {
      if (char === "\\") {
        // An escaped character is never a delimiter. Skip both.
        out.push(" ");
        index += 1;
        if (text[index] === "\n") out.push("\n");
        else out.push(" ");
        continue;
      }
      if (char === "'") {
        state = "single";
        out.push(" ");
        continue;
      }
      if (char === '"') {
        state = "double";
        out.push(" ");
        continue;
      }
      // A `#` only opens a comment at the start of a word.
      if (char === "#" && (previous === "" || /\s/u.test(previous))) {
        state = "comment";
        out.push(" ");
        continue;
      }
      out.push(char);
      continue;
    }

    if (state === "comment") {
      if (char === "\n") {
        state = "normal";
        out.push("\n");
        continue;
      }
      out.push(" ");
      continue;
    }

    // Inside quotes. A single-quoted span has no escapes at all in shell.
    if (state === "double" && char === "\\") {
      out.push(" ");
      index += 1;
      out.push(text[index] === "\n" ? "\n" : " ");
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"')
    ) {
      state = "normal";
      out.push(" ");
      continue;
    }
    out.push(char === "\n" ? "\n" : " ");
  }

  // Redirections last, on text that is already command-level.
  return out.join("").replace(/\d?[<>]+&?\S*/gu, " ");
}

/**
 * Whether a word can be a tool this detector should raise.
 *
 * One gate, applied to every path into the results. Probed names used to skip
 * it, which is how `command -v bun` — a hook checking its own runtime — became
 * a proposal to pin bun on every repository scanned.
 * @param {string} word Candidate command name.
 * @param {Set<string>} defined Function names the text defines itself.
 * @returns {boolean} Whether to raise it.
 */
function admissible(word, defined) {
  // A path is not a PATH lookup: `./scripts/check.sh` is project code.
  if (word.includes("/") || word.includes("$")) return false;
  if (!TOOL_NAME.test(word)) return false;
  if (SHELL_VOCABULARY.has(word)) return false;
  // `bun run build` resolves locally, and the runtime itself is assumed.
  if (RUNTIMES.has(word)) return false;
  return !defined.has(word);
}

/**
 * Read the tool a probe is testing for.
 * @param {string[]} words Words after the probe.
 * @returns {string|null} The probed name, or null.
 */
function probedTool(words) {
  for (const word of words) {
    if (word.startsWith("-")) continue;
    return TOOL_NAME.test(word) ? word : null;
  }
  return null;
}

/**
 * Every command this shell text runs, at a command position.
 * @param {string} text Shell body.
 * @returns {string[]} Command names, deduplicated, in first-seen order.
 */
export function commandsIn(text) {
  if (typeof text !== "string" || text.trim() === "") return [];

  const { stripped, payloads } = extractShellPayloads(text);
  const defined = localFunctions(text);
  const found = new Set();

  // Nested `sh -c` bodies are shell in their own right, so they get the same
  // treatment rather than a weaker one.
  for (const payload of payloads) {
    for (const command of commandsIn(payload)) found.add(command);
  }

  const segments = stripNonCommandSpans(stripped).split(
    /\|\||&&|\$\(|[;|&\n(){}`]/u
  );

  for (const segment of segments) {
    const words = segment.trim().split(/\s+/u).filter(Boolean);
    let index = 0;
    // Environment assignments and decorations sit in front of the command.
    while (
      index < words.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index]) ||
        PREFIXES.has(words[index]))
    ) {
      index += 1;
    }

    const word = words[index]?.toLowerCase();
    if (!word) continue;

    if (PROBES.has(word)) {
      // `command -v gitleaks` — the probed name is the evidence. It goes
      // through the SAME filters as a directly invoked command: reading it
      // straight into the results proposed `bun` and `yarn` on every repo,
      // because `command -v bun` is how a hook checks its own runtime.
      const probed = probedTool(words.slice(index + 1));
      if (probed && admissible(probed, defined)) found.add(probed);
      continue;
    }
    if (MEDIATORS.has(word)) continue;
    if (LOCAL_RUNNERS.has(word)) continue;
    if (!admissible(word, defined)) continue;

    found.add(word);
  }

  return [...found];
}
