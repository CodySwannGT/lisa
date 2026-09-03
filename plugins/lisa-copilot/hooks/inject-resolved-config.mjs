#!/usr/bin/env node
/**
 * Put the RESOLVED Lisa configuration in front of the agent, so reading it is
 * not a decision anyone can decline to make.
 *
 * ## The defect this exists against
 *
 * Projects keep "missing" `.lisa.config.json`. The file is present and
 * correct; agents act against what it declares anyway. The file is not
 * missing — it is unread.
 *
 * The mechanism is visible in what SessionStart already ships. `inject-rules.sh`
 * injects RULE TEXT through `hookSpecificOutput.additionalContext`. Nothing
 * injected the resolved VALUES. So an agent received a paragraph saying that
 * configuration lives in a file, and then had to decide, unprompted, to go read
 * that file. That decision is the step that gets skipped.
 *
 * ## Why this is not more prose
 *
 * `config-resolution.md` is already an EAGER rule — auto-loaded into every
 * session — and it already opens with the words "load-bearing". Nine eager
 * rules already name `.lisa.config.json`. A tenth assertion added to a stack
 * that is demonstrably being read past is not a fix; this repository's own
 * measurement is that executable controls land at 100% and prose rules at
 * roughly zero. An agent cannot skip reading what is already in its context.
 *
 * ## Three properties, none of them decoration
 *
 * 1. RESOLVED, not declared. `.lisa.config.local.json` overrides
 *    `.lisa.config.json` where they overlap, so nobody can compute an effective
 *    value by reading one file — which is part of why the read gets skipped.
 * 2. DECLARED vs DEFAULTED is marked. Without it, a silently absent or
 *    partial config is indistinguishable from one that happens to agree with
 *    Lisa's built-ins, and a gap has no symptom at all.
 * 3. NO CONFIG is stated out loud. Emitting nothing when there is no config is
 *    the original failure mode wearing a new hat.
 *
 * ## Bounded, because this lands in every session
 *
 * {@link CONTEXT_BUDGET} caps the rendered body. Collections are summarised
 * rather than dumped, and `gates` — the largest block in a real config, and the
 * one an agent most often violates — gets its own renderer that groups gate ids
 * by moment and level instead of truncating the list. What does not fit is
 * counted, never silently dropped.
 *
 * ## Fail soft, always
 *
 * Every exit is 0. A malformed or unreadable config emits one line saying so
 * and continues; a hook that kills session start is worse than the problem it
 * was added to solve.
 * @module inject-resolved-config
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Committed, project-wide configuration. */
const MAIN_CONFIG = ".lisa.config.json";
/** Gitignored per-developer overrides. Wins where the two overlap. */
const LOCAL_CONFIG = ".lisa.config.local.json";

/**
 * Character budget for the rendered value body.
 *
 * This block is injected into EVERY session and every subagent, so it competes
 * with the work for context. 4000 characters is roughly one page: enough for a
 * mature project's full identity, lifecycle, gate and policy picture (this
 * repository's own config renders to about 3KB), and small enough that it can
 * never crowd out the task. Over budget, rendering stops and the number of
 * unrendered keys is reported — a silent truncation would reintroduce exactly
 * the invisible-gap failure this hook exists to remove.
 */
const CONTEXT_BUDGET = 4000;

/** Most children of one parent object rendered before summarising the rest. */
const MAX_CHILDREN = 12;

/**
 * Longest single rendered line.
 *
 * {@link MAX_CHILDREN} bounds how MANY values a line carries, not how long each
 * one is, so a config holding a dozen long strings under one parent could
 * otherwise emit a single line that consumed most of {@link CONTEXT_BUDGET} on
 * its own — and the budget check, which reads a line as indivisible, would let
 * it through whole.
 */
const MAX_LINE = 400;

/**
 * The gate-level vocabulary, copied from `LEVELS` in
 * `all/copy-overwrite/scripts/lisa-gates.mjs` (a shipped script this hook
 * cannot import from inside a host project's plugin payload), and pinned
 * against the real export by this hook's unit test.
 *
 * It is how a MOMENT is recognised without copying the moment vocabulary too:
 * a gate's `pull-request` key resolves to one of these and a gate's `run` key
 * resolves to a task name, so the levels alone separate the two. Copying the
 * smaller list also means a new moment family reaches this renderer for free.
 */
const LEVELS = new Set(["required", "optional", "off"]);

/**
 * Words that make a key identity- or credential-shaped.
 *
 * Matched against each path segment after splitting on `_`, `-`, `.` and
 * camelCase boundaries, so `atlassian.email`, `apiKey`, `bypass_actors` and
 * `githubToken` are all caught by a single-word entry.
 *
 * Deliberately broad. The instruction for an unclear key is to OMIT it: a
 * config value withheld from context costs one file read, and an identity or
 * credential injected into context cannot be withdrawn. Adding a word here is
 * always safe; removing one is a security change.
 */
const SENSITIVE_WORDS = new Set([
  "account",
  "actor",
  "actors",
  "apikey",
  "auth",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "dsn",
  "email",
  "identity",
  "key",
  "keys",
  "login",
  "mail",
  "oauth",
  "passphrase",
  "passwd",
  "password",
  "pat",
  "secret",
  "session",
  "signature",
  "token",
  "user",
  "username",
  "webhook",
]);

/**
 * Second line of defence: a value that LOOKS like a developer identity is
 * redacted wherever it appears, whatever key it arrived under.
 *
 * {@link SENSITIVE_WORDS} guards the keys that exist today. This guards the
 * ones added tomorrow by someone who never read this file.
 *
 * `=` and `,` are excluded from both sides deliberately. `\b[^\s@]+@...`
 * swallows the `key=` prefix a rendered line puts in front of the value, so the
 * redaction erased WHICH key had been redacted — and, worse, made a test
 * asserting the key name was absent pass even with the key-name filter removed.
 */
const EMAIL_SHAPED = /[^\s@,=]+@[^\s@,=]+\.[^\s@,=]+/g;

/** What replaces a redacted value, so the KEY's existence is still visible. */
const REDACTED = "[redacted]";

/**
 * Keys Lisa supplies a built-in value for when a project declares none.
 *
 * Each entry names the module that OWNS the constant. This table is a copy for
 * one reason — the constants live in a TypeScript module and a shipped
 * `all/` script, neither importable from a plugin hook running inside an
 * arbitrary host project — and `tests/unit/hooks/inject-resolved-config.test.ts`
 * imports the real constants and asserts this table still agrees with them, so
 * the copy cannot drift silently.
 * @type {ReadonlyArray<{path: string, value: string, owner: string}>}
 */
const BUILT_IN_DEFAULTS = [
  { path: "harness", value: "claude", owner: "src/core/config.ts" },
  {
    path: "gates.runner",
    value: "npm run",
    owner: "all/copy-overwrite/scripts/lisa-gates.mjs",
  },
  {
    path: "gates.unproven",
    value: "warn",
    owner: "all/copy-overwrite/scripts/lisa-gates.mjs",
  },
  {
    path: "learnings.file",
    value: ".lisa/PROJECT_LEARNINGS.md",
    owner: "src/core/learnings-location.ts",
  },
];

/**
 * Keys with NO built-in fallback, whose absence stops a flow rather than
 * defaulting it. Reported as explicitly undeclared, because "absent" and
 * "happens to match the default" are the two states this hook exists to
 * separate and only one of them has a value to print.
 */
const REQUIRED_KEYS = ["tracker", "deploy.branches"];

/**
 * Top-level subtrees rendered, in the order an agent needs them.
 *
 * A subtree allowlist rather than a leaf allowlist: a key added to `github` or
 * `policy` upstream reaches the agent without anyone remembering to edit this
 * file. That is also why {@link SENSITIVE_WORDS} is load-bearing rather than
 * belt-and-braces — `atlassian` is on this list, so `atlassian.email` is
 * REACHED here and kept out by the redaction filter alone.
 */
const SUBTREE_ORDER = [
  "harness",
  "tracker",
  "source",
  "repo",
  "workItem",
  "deploy",
  "github",
  "jira",
  "linear",
  "notion",
  "confluence",
  "atlassian",
  "gates",
  "policy",
  "quality",
  "learnings",
  "verification",
  "nightlyE2E",
  "intake",
  "monitor",
  "automations",
  "remoteEnv",
];

/**
 * Split a config key into lowercase words for sensitivity matching.
 * @param {string} segment One path segment, e.g. `bypass_actors` or `apiKey`.
 * @returns {string[]} Lowercase words.
 */
function words(segment) {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(word => word.toLowerCase());
}

/**
 * Whether a dotted config path is identity- or credential-shaped.
 * @param {string} path Dotted path, e.g. `atlassian.email`.
 * @returns {boolean} True when the path must not be rendered.
 */
function isSensitivePath(path) {
  return path
    .split(".")
    .some(segment => words(segment).some(word => SENSITIVE_WORDS.has(word)));
}

/**
 * Redact anything email-shaped in already-rendered text.
 * @param {string} text Rendered line or block.
 * @returns {string} The text with identity-shaped values replaced.
 */
function scrub(text) {
  return text.replace(EMAIL_SHAPED, REDACTED);
}

/**
 * Whether a value is a plain object worth recursing into.
 * @param {unknown} value Any config value.
 * @returns {boolean} True for non-array objects.
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge the local override onto the committed config.
 *
 * Objects merge key by key so a local file naming one leaf does not erase its
 * siblings; every non-object — scalars and arrays alike — is replaced whole.
 * That reproduces the documented per-key resolution (`jq '.a.b' local` falling
 * through to the committed file) for every path, which is the semantics the
 * rest of Lisa reads with.
 * @param {unknown} base Committed config value.
 * @param {unknown} override Local config value.
 * @returns {unknown} The resolved value.
 */
function deepMerge(base, override) {
  if (override === undefined) return base;
  if (!isObject(base) || !isObject(override)) return override;
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = deepMerge(base[key], value);
  }
  return merged;
}

/**
 * Read one JSON file.
 * @param {string} path Absolute path.
 * @returns {{state: "absent"} | {state: "ok", value: unknown} | {state: "bad", reason: string}}
 *   What was found. `bad` covers unreadable and unparseable alike — from the
 *   agent's seat those are the same fact.
 */
function readJson(path) {
  if (!existsSync(path)) return { state: "absent" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(parsed)) {
      return { state: "bad", reason: "root is not a JSON object" };
    }
    return { state: "ok", value: parsed };
  } catch (err) {
    return { state: "bad", reason: err.message };
  }
}

/**
 * Look a dotted path up in the resolved config.
 * @param {object} config Resolved config.
 * @param {string} path Dotted path.
 * @returns {unknown} The value, or undefined when the path is not declared.
 */
function at(config, path) {
  return path
    .split(".")
    .reduce(
      (node, key) => (isObject(node) ? node[key] : undefined),
      /** @type {unknown} */ (config)
    );
}

/**
 * Render one leaf value compactly.
 * @param {unknown} value A non-object config value.
 * @returns {string} A one-line rendering.
 */
function renderLeaf(value) {
  if (Array.isArray(value)) {
    const scalars = value.filter(
      item => !isObject(item) && !Array.isArray(item)
    );
    return scalars.length === value.length && value.length <= 4
      ? `[${scalars.join(", ")}]`
      : `[${value.length} ${value.length === 1 ? "entry" : "entries"}]`;
  }
  return String(value);
}

/**
 * Render a subtree as `path: key=value, key=value` lines.
 *
 * One line per leaf-bearing object rather than one line per leaf: a real config
 * has well over a hundred leaves, and a hundred-line block is a dump, not a
 * briefing.
 * @param {unknown} node The subtree.
 * @param {string} path Dotted path of this node.
 * @param {string[]} out Lines accumulated so far (mutated).
 */
function renderSubtree(node, path, out) {
  if (isSensitivePath(path)) return;
  if (!isObject(node)) {
    out.push(`${path}: ${renderLeaf(node)}`);
    return;
  }
  const visible = Object.entries(node).filter(([key]) => !key.startsWith("_"));
  const entries = visible.filter(([key]) => !isSensitivePath(`${path}.${key}`));
  // A withheld key is COUNTED, never silently dropped. Omitting an
  // identity-shaped value while leaving no trace that it exists would recreate,
  // one level down, the invisible-gap failure this whole hook is against.
  const withheld = visible.length - entries.length;
  const suffix =
    withheld > 0 ? `, +${withheld} withheld (identity-shaped)` : "";
  const leaves = entries.filter(([, value]) => !isObject(value));
  const branches = entries.filter(([, value]) => isObject(value));
  if (leaves.length > 0 || withheld > 0) {
    const shown = leaves.slice(0, MAX_CHILDREN);
    const rest = leaves.length - shown.length;
    const rendered = shown
      .map(([key, value]) => `${key}=${renderLeaf(value)}`)
      .join(", ");
    out.push(
      `${path}: ${rendered}${rest > 0 ? `, +${rest} more` : ""}${suffix}`
    );
  }
  for (const [key, value] of branches)
    renderSubtree(value, `${path}.${key}`, out);
}

/**
 * The level a gate declares at one moment, whichever shape it used.
 *
 * A moment is either a bare level (`"required"`) or an object carrying `level`
 * alongside `run`/`await`. Both spellings are live in shipped configs.
 * @param {unknown} declaration What the gate declares at that moment.
 * @returns {string|null} The level, or null when this is not a moment.
 */
function levelOf(declaration) {
  const declared =
    typeof declaration === "string"
      ? declaration
      : isObject(declaration) && typeof declaration.level === "string"
        ? declaration.level
        : null;
  return declared !== null && LEVELS.has(declared) ? declared : null;
}

/**
 * Render the gates block grouped by moment and level.
 *
 * Gates are the largest block in a mature config and the one an agent most
 * often acts against, so truncating the list would drop the answer to the
 * question actually being asked — "what must be green before I push?".
 * Grouping answers it in a handful of lines instead, with nothing elided.
 * @param {unknown} gates The resolved `gates` block.
 * @returns {string[]} Rendered lines.
 */
function renderGates(gates) {
  if (!isObject(gates)) return [];
  /** @type {Map<string, string[]>} */
  const grouped = new Map();
  let count = 0;
  for (const [gateId, declaration] of Object.entries(gates)) {
    if (
      gateId === "runner" ||
      gateId === "unproven" ||
      !isObject(declaration)
    ) {
      continue;
    }
    count += 1;
    for (const [moment, momentDeclaration] of Object.entries(declaration)) {
      const level = levelOf(momentDeclaration);
      if (level === null) continue;
      const bucket = `${moment} ${level}`;
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), gateId]);
    }
  }
  if (count === 0) return [];
  return [
    `gates (${count} declared) — a gate below is enforced at that moment; do not skip, weaken or bypass one:`,
    ...[...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, ids]) => `  ${bucket}: ${ids.join(", ")}`),
  ];
}

/**
 * Render the declared-vs-defaulted lines.
 * @param {object} config Resolved config.
 * @returns {string[]} Rendered lines, empty when everything was declared.
 */
function renderDefaults(config) {
  const lines = [];
  for (const { path, value, owner } of BUILT_IN_DEFAULTS) {
    if (at(config, path) !== undefined) continue;
    lines.push(
      `${path}: ${value}   [Lisa built-in default — this project declares none; owner: ${owner}]`
    );
  }
  for (const path of REQUIRED_KEYS) {
    if (at(config, path) !== undefined) continue;
    lines.push(
      `${path}: NOT DECLARED — Lisa has no default for this. Flows that dispatch on it stop rather than guess.`
    );
  }
  return lines;
}

/**
 * Render the whole value body, honouring {@link CONTEXT_BUDGET}.
 * @param {object} config Resolved config.
 * @returns {string} The rendered body.
 */
function renderBody(config) {
  /** @type {string[]} */
  const lines = [];
  const seen = new Set();
  for (const key of SUBTREE_ORDER) {
    if (!(key in config)) continue;
    seen.add(key);
    if (key === "gates") {
      const gates = config.gates;
      const runner = isObject(gates) ? gates.runner : undefined;
      const unproven = isObject(gates) ? gates.unproven : undefined;
      if (runner !== undefined)
        lines.push(`gates.runner: ${renderLeaf(runner)}`);
      if (unproven !== undefined) {
        lines.push(`gates.unproven: ${renderLeaf(unproven)}`);
      }
      lines.push(...renderGates(gates));
      continue;
    }
    renderSubtree(config[key], key, lines);
  }
  const unlisted = Object.keys(config).filter(
    key => !seen.has(key) && !key.startsWith("_")
  );
  if (unlisted.length > 0) {
    lines.push(
      `other declared keys (not summarised here): ${unlisted.join(", ")}`
    );
  }
  lines.push(...renderDefaults(config));
  return withinBudget(lines);
}

/**
 * Join lines, stopping at the budget and counting what did not fit.
 * @param {string[]} lines Rendered lines.
 * @returns {string} The joined body.
 */
function withinBudget(lines) {
  const kept = [];
  let size = 0;
  for (const raw of lines) {
    // Scrubbed BEFORE truncation: a cut through the middle of an identity would
    // leave a fragment `EMAIL_SHAPED` no longer matches, so redacting the
    // joined body afterwards would be redacting text that had already escaped.
    const scrubbed = scrub(raw);
    const line =
      scrubbed.length > MAX_LINE
        ? `${scrubbed.slice(0, MAX_LINE)}… (line truncated)`
        : scrubbed;
    if (size + line.length > CONTEXT_BUDGET) {
      kept.push(
        `… ${lines.length - kept.length} further line(s) omitted to stay within the session-context budget. Read ${MAIN_CONFIG} for the rest.`
      );
      break;
    }
    kept.push(line);
    size += line.length + 1;
  }
  return kept.join("\n");
}

/** Opening tag of the injected block. Tests and readers key off it. */
const OPEN_TAG = "<lisa-resolved-config>";
/** Closing tag of the injected block. */
const CLOSE_TAG = "</lisa-resolved-config>";

/**
 * Wrap a body in the block's tags and preamble.
 * @param {string} body Rendered body.
 * @returns {string} The full injected block.
 */
function block(body) {
  return `${OPEN_TAG}\n${body}\n${CLOSE_TAG}`;
}

/**
 * Build the injected block for a project directory.
 * @param {string} projectDir Absolute path to the project root.
 * @returns {string} The block to inject.
 */
export function buildContext(projectDir) {
  const main = readJson(join(projectDir, MAIN_CONFIG));
  const local = readJson(join(projectDir, LOCAL_CONFIG));

  if (main.state === "bad" || local.state === "bad") {
    const which = main.state === "bad" ? MAIN_CONFIG : LOCAL_CONFIG;
    const reason = main.state === "bad" ? main.reason : local.reason;
    return block(
      `Lisa configuration could not be read: ${which} (${scrub(reason)}).\n` +
        `Treat every Lisa-configured value as UNKNOWN. Do not assume a default, and do not ` +
        `report this project as unconfigured — the file exists and is broken, which is a ` +
        `different fact. Fixing it is the first task.`
    );
  }

  if (main.state === "absent" && local.state === "absent") {
    return block(
      `No Lisa configuration found: neither ${MAIN_CONFIG} nor ${LOCAL_CONFIG} exists here.\n` +
        `Nothing declares this project's tracker, gates, or deploy branches, so any Lisa flow ` +
        `that dispatches on them will stop rather than guess. Run the matching \`/lisa:setup:*\` ` +
        `skill to create one. Do not infer a tracker from the shape of a request.`
    );
  }

  const resolved = deepMerge(
    main.state === "ok" ? main.value : {},
    local.state === "ok" ? local.value : {}
  );
  const sources =
    local.state === "ok"
      ? `${MAIN_CONFIG} + ${LOCAL_CONFIG} (local wins where they overlap)`
      : `${MAIN_CONFIG} (no local override file)`;

  return block(
    `These are this project's EFFECTIVE Lisa configuration values, already resolved from ${sources}.\n` +
      `Act on them directly. Do not re-read the config files to learn them, and do not act ` +
      `against them. A line marked [Lisa built-in default] is NOT something this project ` +
      `declared. Identity- and credential-shaped values are omitted by design.\n\n` +
      renderBody(resolved)
  );
}

/**
 * Read the hook event name from the harness's stdin payload.
 * @param {string} raw Raw stdin.
 * @returns {string} The event name, defaulting to `SessionStart`.
 */
function eventName(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.hook_event_name === "string"
      ? parsed.hook_event_name
      : "SessionStart";
  } catch {
    return "SessionStart";
  }
}

/**
 * Emit the hook envelope. Always exits 0 — see the module comment.
 * @param {string[]} argv Process arguments.
 * @param {string} stdin Raw stdin.
 * @returns {string} The JSON envelope.
 */
export function run(argv, stdin) {
  const flag = argv.indexOf("--project-dir");
  const projectDir = flag >= 0 ? argv[flag + 1] : process.cwd();
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName(stdin),
      additionalContext: buildContext(projectDir),
    },
  });
}

/**
 * Whether this module is the process entry point.
 *
 * Both sides are realpath'd: comparing `fileURLToPath(import.meta.url)` against
 * `path.resolve(process.argv[1])` disagrees whenever the checkout is reached
 * through a symlink — a git worktree, or any `/tmp` path on macOS, `/tmp` being
 * a symlink to `/private/tmp` — because `import.meta.url` is the REAL path
 * while `argv[1]` is whatever the caller typed.
 *
 * The one implementation lives at `scripts/lib/invoked-as-script.mjs`. This
 * file cannot import it: it is materialized into every plugin payload, where
 * there is no `./lib/` to import from — the same accommodation
 * `failure-signature-index.mjs` and `threshold-ratchet.mjs` make.
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
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }
  try {
    process.stdout.write(`${run(process.argv.slice(2), stdin)}\n`);
  } catch {
    // Fail soft: a hook that cannot render must never wedge session start.
  }
}
