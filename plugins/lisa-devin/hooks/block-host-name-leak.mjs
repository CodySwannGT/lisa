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
 * WHERE IT APPLIES: THE TARGET, NOT THE CHECKOUT (#4462)
 *
 * Not materializing it was not enough. The guard is registered by the PLUGIN,
 * so it runs in every project the plugin is enabled in, and every host has the
 * denylist at `node_modules/@codyswann/lisa/dist/`. Inside a host it refused
 * that host's own tracker writes — including the `Work-Item: <owner>/<repo>#<n>`
 * line the work-item gate REQUIRES in every pull-request body, so the two Lisa
 * guards contradicted each other and every agent-opened host PR failed
 * traceability.
 *
 * So the guard resolves the active gh call's explicit repository or API
 * endpoint, then GH_REPO, the locally selected gh default, or one unambiguous
 * Git remote. Literal cd and environment assignments use the command's actual
 * directory; the project root still locates the detector. Body text is never
 * routing. Unsupported shell syntax, unresolved expansions and ambiguous
 * repositories earn no host exemption. This is bounded command inspection,
 * not shell execution or a claim to close every shell/identity leak class.
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
import {
  commandRepository,
  ghCommands,
  repositoryFromSpec,
} from "./host-name-command-context.mjs";

export { repositoryFromSpec };

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
const FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field"]);
/** Field names whose value is published prose rather than metadata. */
const PROSE_FIELDS = new Set(["body", "title", "text", "message"]);

/**
 * The repositories this guard protects, lowercased `owner/repo`.
 *
 * Only this one: it is public and ships `dist/` to npm. A host's own tracker
 * is not on the list, which is the point (#4462).
 */
const GUARDED_REPOSITORIES = new Set(["codyswanngt/lisa"]);
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
  return ghCommands(
    tokens.map(token => JSON.stringify(token)).join(" "),
    process.cwd()
  ).some(context => context.writes);
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
 * Resolve the target of one tokenized command without treating prose as routing.
 * @param tokens Command tokens.
 * @param cwd Actual command working directory.
 * @returns Verified owner/repository, or unknown.
 */
export function targetRepository(tokens, cwd) {
  const context = ghCommands(
    tokens.map(token => JSON.stringify(token)).join(" "),
    cwd
  )[0];
  return context === undefined ? undefined : commandRepository(context);
}

/**
 * Whether the guard applies to a write landing in this repository.
 *
 * An undetermined target is guarded: not knowing where text is going is no
 * reason to stop protecting the one place it must not go.
 * @param target - `owner/repo`, or undefined.
 * @returns True when the write must be checked.
 */
export function isGuardedTarget(target) {
  return target === undefined || GUARDED_REPOSITORIES.has(target);
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
 * @param noun - The active gh noun, so api fields retain their own meaning.
 * @returns Sources of publishable text.
 */
export function publishableText(tokens, cwd, noun) {
  return tokens.flatMap((token, index) => {
    const bare = token.startsWith("-") ? token.split("=")[0] : token;
    if (noun !== "api" && TEXT_FLAGS.has(bare)) {
      return [{ origin: bare, text: valueAt(tokens, index) }];
    }
    if (FILE_FLAGS.has(bare)) {
      const value = valueAt(tokens, index);
      // On `gh api`, `-F` is `--field`: `key=@path` or `key=value`. Read as a
      // bare path, `body=@file` named no file and published unchecked (#4462).
      if (noun === "api" && /^[\w.[\]-]+=/u.test(value))
        return [fieldSource(value, cwd)];
      const file = value.replace(/^@/u, "");
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
  let detector;
  const findings = [];
  for (const context of ghCommands(command, process.cwd())) {
    if (!context.writes || !isGuardedTarget(commandRepository(context)))
      continue;
    detector ??= await loadDetector(projectDir);
    if (detector === undefined) {
      return {
        code: EXIT_ALLOWED,
        warning:
          "block-host-name-leak: host-name denylist not found (no built dist/ or installed package); host-identity enforcement is NOT active",
      };
    }
    // Without a known cwd a relative file cannot be inspected honestly. Keep
    // protection, and name the unread input instead of claiming the text clean.
    if (
      context.cwd === undefined &&
      [...context.flags].some(([flag, item]) => {
        const field =
          context.noun === "api" && FIELD_FLAGS.has(flag)
            ? /^([^=]+)=@(.+)$/u.exec(item.value)
            : null;
        const file =
          field !== null
            ? PROSE_FIELDS.has(field[1])
              ? field[2]
              : undefined
            : FILE_FLAGS.has(flag)
              ? item.value.replace(/^@/, "")
              : undefined;
        return file !== undefined && !path.isAbsolute(file);
      })
    ) {
      return {
        code: EXIT_BLOCKED,
        message:
          "BLOCKED: the working directory for this tracker write's body file could not be resolved. Use a literal directory and readable body file so the host-name guard can inspect it.",
      };
    }
    findings.push(
      ...publishableText(
        context.tokens,
        context.cwd ?? projectDir,
        context.noun
      ).flatMap(source => findingsIn(source, detector))
    );
  }
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
