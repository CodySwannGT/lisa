/**
 * Refuse an outbound tracker write whose title or body names a host project.
 *
 * WHY THIS EXISTS AS A HOOK AND NOT AS MORE PROSE
 *
 * The rule lives in `.claude/rules/PROJECT_RULES.md`, it is repeated in every
 * agent brief, and agents break it anyway. Measured across the full tracker on
 * 2026-09-03 — 193 open issues, 1,461 closed, 1,991 merged pull requests — 513
 * items carried a host identity. The daily rate over the preceding week ran
 * between 1.8% and 28.5% and never reached zero, and the items filed on the day
 * of the count were filed by agents whose briefs carried the rule. Instruction
 * is not reaching the moment of writing, so the check belongs on the write path.
 *
 * This repository is public and `dist/` is in the npm `files` allowlist, so a
 * name written into an issue body is published on github.com AND shipped to
 * every consumer of the package. There is no quiet version of this mistake.
 *
 * WHAT IT IS NOT
 *
 * **This reduces the rate. It does not close the class.** The detector is a
 * curated denylist: a name variant nobody has added — a new spelling, a legal
 * entity, a tracker-site slug, an email domain, an acronym — is invisible to it.
 * One organisation's name in running prose reached three separate issue bodies
 * and was matched by no pattern used during the audit; it is caught today only
 * because a person put that spelling in the list by hand. Read a green result as
 * "none of the known names appeared", never as "this text is clean".
 *
 * WHERE IT LOOKS, AND WHY THAT MATTERS MORE THAN THE MATCHER
 *
 * The convention in this repository is `--body-file <path>`; the text never
 * appears in the command string. A guard that inspects only argv therefore sees
 * nothing and reports clean on every real call — that is #3484's defect, and
 * repeating it here would ship a guard that runs and never bites. So this reads
 * the referenced file, and the title, which is what appears in every listing and
 * notification.
 *
 * WHY THIS IS NOT MATERIALIZED INTO HOST PROJECTS
 *
 * The five sibling PreToolUse guards are copied into host projects through
 * `all/copy-overwrite/scripts/lisa-hooks/`. This one deliberately is not, and
 * the omission is a scope decision rather than an oversight.
 *
 * The denylist holds the names of host projects — the very repositories that
 * install Lisa. Shipped into host project X, this guard would refuse every
 * issue in which X writes its own name, which is normal and correct writing
 * there. The rule it enforces is Lisa's: **this** repository is public and
 * `dist/` ships to npm, so **this** repository may not name its hosts. A host
 * naming itself carries none of that.
 *
 * So the parity obligation is satisfied across every agent surface OF THIS
 * REPOSITORY — Claude, Codex, Cursor, Antigravity, Copilot all register it —
 * and stops at the boundary where the rule itself stops applying. Anyone
 * tempted to add it to `plugins/materialized-artifacts.json` should have a
 * reason why a host project should be refused its own name.
 *
 * FAILING OPEN, LOUDLY
 *
 * When the denylist cannot be loaded this permits the write and says so on
 * stderr. Failing closed would block every tracker write on a machine without a
 * built `dist/`; failing open silently is worse than either, because a guard
 * that is quietly absent is indistinguishable from a guard that passes. Same
 * reasoning as `block-direct-issue-create.sh`'s interpreter probe.
 * @module hooks/block-host-name-leak
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Claude Code's refusal code. Every other non-zero exit is a hook error. */
const EXIT_BLOCKED = 2;
/** Permit the command. */
const EXIT_ALLOWED = 0;

/**
 * Where the compiled detector may live, relative to the governed project.
 *
 * Inside this repository it is the local build; inside a host project it is the
 * installed package. The plugin directory itself is NOT a candidate — it ships
 * `hooks/`, `skills/` and `scripts/` and no `dist/`, so a hook that looked
 * beside itself would find nothing and stand down everywhere.
 */
const DETECTOR_PATHS = [
  "dist/core/downstream-references.js",
  "node_modules/@codyswann/lisa/dist/core/downstream-references.js",
];

/** Sub-commands that publish text people read. */
const WRITE_VERBS = new Set(["create", "comment", "edit"]);
/** The `gh` nouns whose writes carry prose. */
const WRITE_NOUNS = new Set(["issue", "pr"]);
/** HTTP methods that change tracker state. */
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT"]);

/**
 * Flags whose value is a path to read.
 *
 * `-F` is `--body-file`'s short form on `gh issue`/`gh pr`, and on `gh api` it
 * is `--field`, which may itself carry `@path`. Both are handled — reading a
 * file that turns out to be a literal costs nothing, missing one costs the
 * guard.
 */
const FILE_FLAGS = new Set(["--body-file", "-F", "--input"]);
/** Flags whose value is literal text people will read. */
const TEXT_FLAGS = new Set([
  "--title",
  "-t",
  "--body",
  "-b",
  "--message",
  "-m",
]);
/** `gh api` field flags: `key=value`, or `key=@path` to read a file. */
const FIELD_FLAGS = new Set(["-f", "--field", "--raw-field"]);
/** Field names whose value is published prose rather than metadata. */
const PROSE_FIELDS = new Set(["body", "title", "text", "message"]);

/**
 * Vendor endpoints quoted from guard source, which are not host identities.
 *
 * These appear in this repository's own prose when documenting the access
 * layer. Left unguarded they would be a standing false positive, and a guard
 * with false positives is a guard someone turns off.
 */
const ENDPOINT_ALLOWANCES = [
  "api.linear.app",
  "mcp.linear.app",
  "api.github.com",
  "api.atlassian.com",
];

/**
 * Split a command line into argv, honouring single and double quotes.
 *
 * Deliberately not a shell: it does not expand variables, globs or command
 * substitution. Those would let the guard's own reading diverge from what the
 * shell will actually run, and a guard that models the shell imperfectly is
 * worse than one that reads tokens plainly.
 * @param command - The raw command string.
 * @returns The tokens, quotes stripped.
 */
export function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  let started = false;
  for (const char of command) {
    if (quote !== "") {
      if (char === quote) quote = "";
      else current += char;
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * Whether these tokens are a `gh` call that publishes tracker text.
 *
 * Reads (`view`, `list`, `status`) and non-tracker writes (`gh label create`)
 * are not writes of prose and do not fire.
 * @param tokens - Command tokens.
 * @returns True when the command publishes text.
 */
export function isOutboundTrackerWrite(tokens) {
  const gh = tokens.indexOf("gh");
  if (gh === -1) return false;
  const rest = tokens.slice(gh + 1).filter(token => !token.startsWith("-"));
  const [noun, verb] = rest;
  if (noun === "api") return isMutatingApiCall(tokens);
  return WRITE_NOUNS.has(noun ?? "") && WRITE_VERBS.has(verb ?? "");
}

/**
 * Whether a `gh api` call mutates.
 *
 * `gh api` defaults to GET, and to POST when any field flag is present — so a
 * field flag alone makes it a write even with no explicit method.
 * @param tokens - Command tokens.
 * @returns True when the call changes state.
 */
function isMutatingApiCall(tokens) {
  const method = tokens.findIndex(
    token => token === "-X" || token === "--method"
  );
  if (method !== -1) {
    return MUTATING_METHODS.has((tokens[method + 1] ?? "").toUpperCase());
  }
  return tokens.some(token => FIELD_FLAGS.has(token));
}

/**
 * The value a flag carries, in either `--flag value` or `--flag=value` form.
 * @param tokens - Command tokens.
 * @param index - Index of the flag token.
 * @returns The value, or an empty string.
 */
function valueAt(tokens, index) {
  const token = tokens[index] ?? "";
  const equals = token.indexOf("=");
  if (equals !== -1 && token.startsWith("-")) return token.slice(equals + 1);
  return tokens[index + 1] ?? "";
}

/**
 * Read a file the command names, if it is readable.
 * @param candidate - Path as written on the command line.
 * @param cwd - Directory the command runs in.
 * @returns The contents, or an empty string.
 */
function readIfPresent(candidate, cwd) {
  if (candidate === "" || candidate === "-") return "";
  const resolved = path.isAbsolute(candidate)
    ? candidate
    : path.join(cwd, candidate);
  if (!existsSync(resolved)) return "";
  try {
    return readFileSync(resolved, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Every piece of text this command would publish, labelled by where it came
 * from so the refusal can point at the thing to edit.
 * @param tokens - Command tokens.
 * @param cwd - Directory the command runs in.
 * @returns Sources of publishable text.
 */
export function publishableText(tokens, cwd) {
  return tokens.flatMap((token, index) => {
    const bare = token.startsWith("-") ? token.split("=")[0] : token;
    if (TEXT_FLAGS.has(bare)) {
      return [{ origin: bare, text: valueAt(tokens, index) }];
    }
    if (FILE_FLAGS.has(bare)) {
      const file = valueAt(tokens, index).replace(/^@/u, "");
      return [{ origin: file, text: readIfPresent(file, cwd) }];
    }
    if (FIELD_FLAGS.has(bare))
      return [fieldSource(valueAt(tokens, index), cwd)];
    return [];
  });
}

/**
 * One `gh api` field, which may be literal or a file reference.
 * @param assignment - The raw `key=value` token.
 * @param cwd - Directory the command runs in.
 * @returns A text source; empty when the field is not prose.
 */
function fieldSource(assignment, cwd) {
  const split = assignment.indexOf("=");
  if (split === -1) return { origin: "", text: "" };
  const key = assignment.slice(0, split);
  const value = assignment.slice(split + 1);
  if (!PROSE_FIELDS.has(key)) return { origin: "", text: "" };
  if (value.startsWith("@")) {
    const file = value.slice(1);
    return { origin: file, text: readIfPresent(file, cwd) };
  }
  return { origin: key, text: value };
}

/**
 * Whether a matched span sits inside a vendor endpoint rather than a name.
 * @param line - The line the match came from.
 * @param match - The matched span.
 * @returns True when the match is an allowed endpoint.
 */
function isEndpoint(line, match) {
  return ENDPOINT_ALLOWANCES.some(
    endpoint =>
      endpoint.includes(match.toLowerCase()) && line.includes(endpoint)
  );
}

/**
 * Load the compiled detector from the governed project.
 * @param projectDir - The project the command runs in.
 * @returns The detector module, or undefined when it cannot be found.
 */
async function loadDetector(projectDir) {
  for (const candidate of DETECTOR_PATHS) {
    const resolved = path.join(projectDir, candidate);
    if (!existsSync(resolved)) continue;
    try {
      return await import(pathToFileURL(resolved).href);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Every host-name violation in one text source.
 * @param source - The labelled text.
 * @param detector - The loaded detector module.
 * @returns Findings, each naming its origin and line.
 */
function findingsIn(source, detector) {
  if (source.text === "") return [];
  const lines = source.text.split("\n");
  return detector
    .findDownstreamReferences(source.text)
    .filter(hit => !isEndpoint(lines[hit.line - 1] ?? "", hit.match))
    .map(hit => ({ ...hit, origin: source.origin }));
}

/**
 * Render the refusal an agent will act on.
 * @param findings - Every violation found.
 * @returns The message body.
 */
export function formatRefusal(findings) {
  const located = findings
    .map(hit => `  ${hit.origin}:${hit.line} — "${hit.match}" (${hit.reason})`)
    .join("\n");
  return `BLOCKED: this tracker write names a host project.

${located}

WHY: this repository is public and \`dist/\` ships to npm, so a host identity in
an issue body is published twice — on github.com and to every consumer of the
package. See the "Never name a downstream project" rule.

FIX: write the evidence, not the identity. "a caller repo in the portfolio",
"repo A" / "repo B" where two are contrasted, \`<ticket>\` for a real ticket id.
The argument never depends on which named client proved it — if it seems to,
the argument is the thing to fix.

SCOPE: this checks a curated list of known names. It is a rate reduction, not a
closed class — a spelling nobody has added is invisible to it, so a clean result
means "no known name appeared", not "this text is safe".`;
}

/**
 * Evaluate one command.
 * @param command - The command string.
 * @param projectDir - The project the command runs in.
 * @returns The exit code and any message.
 */
export async function evaluate(command, projectDir) {
  const tokens = tokenize(command);
  if (!isOutboundTrackerWrite(tokens)) return { code: EXIT_ALLOWED };
  const detector = await loadDetector(projectDir);
  if (detector === undefined) {
    return {
      code: EXIT_ALLOWED,
      warning:
        "block-host-name-leak: host-name denylist not found (no built dist/ or installed package); host-identity enforcement is NOT active",
    };
  }
  const findings = publishableText(tokens, projectDir).flatMap(source =>
    findingsIn(source, detector)
  );
  if (findings.length === 0) return { code: EXIT_ALLOWED };
  return { code: EXIT_BLOCKED, message: formatRefusal(findings) };
}

/** Entry point: `node block-host-name-leak.mjs <command> [projectDir]`. */
async function main() {
  const [, , command = "", projectDir = process.cwd()] = process.argv;
  if (command === "") process.exit(EXIT_ALLOWED);
  const result = await evaluate(command, projectDir);
  if (result.warning !== undefined) process.stderr.write(`${result.warning}\n`);
  if (result.message !== undefined) process.stderr.write(`${result.message}\n`);
  process.exit(result.code);
}

/**
 * Whether this module is the process entry point.
 *
 * Both sides are realpath'd: comparing `fileURLToPath(import.meta.url)` against
 * `process.argv[1]` disagrees whenever the checkout is reached through a
 * symlink — a git worktree, or any `/tmp` path on macOS, `/tmp` being a symlink
 * to `/private/tmp` — because `import.meta.url` is the REAL path while
 * `argv[1]` is whatever the caller typed. Comparing basenames, which an earlier
 * draft of this file did, matches any file that happens to share a name.
 *
 * The one implementation lives at `scripts/lib/invoked-as-script.mjs`. This
 * file cannot import it: it is materialized into every plugin payload, where
 * there is no `./lib/` to import from — the same accommodation
 * `inject-resolved-config.mjs` and `threshold-ratchet.mjs` make.
 * @param {string} moduleUrl The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  await main();
}
