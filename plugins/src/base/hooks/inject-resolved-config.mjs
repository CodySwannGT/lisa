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
  "arn",
  "auth",
  "authorization",
  "bearer",
  "cert",
  "certificate",
  "connection",
  "cookie",
  "credential",
  "credentials",
  "dsn",
  "email",
  "identity",
  "jwt",
  "key",
  "keys",
  "login",
  "mail",
  "mfa",
  "oauth",
  "otp",
  "passphrase",
  "passwd",
  "password",
  "pat",
  "pem",
  "pin",
  "private",
  "secret",
  "session",
  "signature",
  "token",
  "totp",
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

/**
 * Value shapes that are a credential whatever key they arrived under.
 *
 * {@link SENSITIVE_WORDS} can only ever cover key names somebody thought of.
 * {@link SUBTREE_ORDER} is a SUBTREE allowlist, so a key added under an
 * already-listed parent reaches every session with nobody reviewing it — which
 * is the case these patterns exist for, and the reason the preamble's sentence
 * was made to describe this mechanism rather than promise more than it has.
 *
 * Each pattern is anchored on a structural marker (a scheme with a
 * `user:password@` userinfo, a vendor key prefix, three base64url segments),
 * never on entropy. An entropy heuristic would redact ids a config legitimately
 * carries — routine ids, revisions, digests — and this block exists to make
 * configuration visible, so a false redaction is a real cost, not a free one.
 */
const CREDENTIAL_SHAPED = [
  // A private key pasted into a config value.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Credentials in a connection string's userinfo. The whole URL goes: the
  // host is not worth keeping at the price of splicing a line back together
  // around the part that was cut out. Neither userinfo field may contain `/`,
  // because a path separator means the text is a path and not userinfo:
  // `https://host:8443/repos/main@v2` otherwise reads as password `8443/repos/
  // main` at host `v2`, and an ordinary URL is redacted whole.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@,=/]+:[^\s@,=/]+@[^\s,=]*/g,
  // Vendor-prefixed API keys. The two-letter `xx_live_`/`xx_test_` arm names
  // the prefixes that actually issue keys of that shape rather than accepting
  // any two letters: unconstrained, it matched every snake_case value whose run
  // after `_test_`/`_live_` was 8+ alphanumerics (`us_test_deployment`), and a
  // false redaction is a real cost — the block then reports that a project
  // declared something it did not.
  /\b(?:(?:pk|sk|rk|ak)_(?:live|test)_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,})\b/g,
  // A signed token: three base64url segments, header first.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // An ARN carries an account number in its fifth field.
  /\barn:[a-z0-9-]*:[^\s,=]*/g,
];

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
 *
 * EXPORTED so that test can compare PATH-TO-VALUE PAIRS. Asserting instead that
 * each constant appears somewhere in this file pins only the set of values
 * present: swapping the `harness` and `gates.unproven` entries preserves that
 * set, leaves every test in both suites green, and tells every session with no
 * declared harness that its harness is `warn`.
 * @type {ReadonlyArray<{path: string, value: string, owner: string}>}
 */
export const BUILT_IN_DEFAULTS = [
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
 * Redact anything identity- or credential-shaped in already-rendered text.
 * @param {string} text Rendered line or block.
 * @returns {string} The text with those values replaced.
 */
function scrub(text) {
  return CREDENTIAL_SHAPED.reduce(
    (carried, pattern) => carried.replace(pattern, REDACTED),
    text.replace(EMAIL_SHAPED, REDACTED)
  );
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
 * Keys that reach an object's prototype rather than its own properties.
 *
 * `JSON.parse` makes `__proto__` an OWN property, so a later `merged[key] =`
 * hands it to the prototype setter — and `key in config` and `node[key]` both
 * read the prototype chain. A local override file carrying nothing but a
 * `__proto__` object could therefore make this block announce a gate that no
 * file declares, while the gate runner (which destructures own properties)
 * enforced something else. The injected view is the one an agent is told to
 * act on, so it is the one that must not be forgeable.
 */
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Strip prototype-reaching keys from parsed JSON, at every depth.
 * @param {unknown} value A parsed JSON value.
 * @returns {unknown} The same value with {@link PROTOTYPE_KEYS} removed.
 */
function withoutPrototypeKeys(value) {
  if (Array.isArray(value)) return value.map(withoutPrototypeKeys);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (PROTOTYPE_KEYS.has(key)) continue;
    out[key] = withoutPrototypeKeys(child);
  }
  return out;
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
    // Belt and braces: `readJson` has already stripped these, and this loop is
    // the assignment that would otherwise reach the prototype setter.
    if (PROTOTYPE_KEYS.has(key)) continue;
    merged[key] = deepMerge(base[key], value);
  }
  return merged;
}

/**
 * Why a file could not be read, said without quoting the file or the disk.
 *
 * A `JSON.parse` failure message is not safe to repeat. V8 embeds roughly the
 * first ten characters of the offending input in one of its forms — the entire
 * file when the file is short — and this path runs against the gitignored local
 * override, the one file identity is supposed to live in. There are no keys at
 * that point, so the key-name filter cannot help. An `fs` failure message is
 * not safe either: it carries the absolute path.
 *
 * Only the position is kept, because a line and column number describe the
 * file's SHAPE and can be acted on, while quoting its contents adds nothing a
 * reader with the file in front of them does not already have.
 * @param {unknown} err What was thrown.
 * @returns {string} A reason carrying no content and no path.
 */
function safeReason(err) {
  const code = isObject(err) ? err.code : undefined;
  if (typeof code === "string") return `${code} while reading the file`;
  const message =
    isObject(err) && typeof err.message === "string" ? err.message : "";
  const position = /at position \d+(?: \(line \d+ column \d+\))?/.exec(message);
  return position === null
    ? "not valid JSON"
    : `not valid JSON ${position[0].replace("at position", "at byte")}`;
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
    return { state: "ok", value: withoutPrototypeKeys(parsed) };
  } catch (err) {
    return { state: "bad", reason: safeReason(err) };
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
 * Render one moment-and-level bucket across as many lines as its ids need.
 *
 * The generic {@link MAX_LINE} cut was being applied to the one line this
 * module promises never elides: at 30 gates in a single bucket, six ids
 * vanished behind `… (line truncated)` while the header above still counted
 * them and the words beside it said not to bypass one. Wrapping is what keeps
 * that promise — a count of what was dropped would still be an agent told the
 * name of 24 gates out of 30 it must not skip.
 * @param {string} bucket The `moment level` label.
 * @param {string[]} ids Gate ids declared at that bucket.
 * @returns {string[]} Lines, each within {@link MAX_LINE}.
 */
function bucketLines(bucket, ids) {
  const lines = [];
  let prefix = `  ${bucket}: `;
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    lines.push(`${prefix}${current.join(", ")}`);
    prefix = `  ${bucket} (cont.): `;
    current = [];
  };
  for (const id of ids) {
    const width =
      prefix.length +
      current.reduce((carried, held) => carried + held.length + 2, 0) +
      id.length;
    if (current.length > 0 && width > MAX_LINE) flush();
    current.push(id);
  }
  flush();
  return lines;
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
      .flatMap(([bucket, ids]) => bucketLines(bucket, ids)),
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
  // The gap lines go FIRST, and that ordering is the whole point rather than a
  // presentation choice. `withinBudget` truncates from the end, so appending
  // them last meant the budget ate them first: a config with a large `policy`
  // block and no `tracker` rendered ZERO `NOT DECLARED` lines and zero
  // built-in-default lines — "a gap has no symptom at all", the failure this
  // hook was built against, reproduced inside the hook. A value that does not
  // fit can be looked up in the file. An absence cannot be looked up anywhere,
  // so it is the line that must survive.
  /** @type {string[]} */
  const lines = renderDefaults(config);
  const gapLines = lines.length;
  // The gates block is the one this module promises never elides, so the lines
  // it produced are named here rather than inferred from their shape later.
  // `bucketLines` keeps every line inside MAX_LINE by wrapping, but it cannot
  // wrap a SINGLE id longer than the line — nothing splits an identifier — so
  // without this the generic cut would come back for exactly the id that most
  // needs reading in full.
  /** @type {Set<string>} */
  const unelidable = new Set();
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
      const gateLines = renderGates(gates);
      for (const gateLine of gateLines) unelidable.add(gateLine);
      lines.push(...gateLines);
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
  return withinBudget(lines, { unelidable, gapLines });
}

/**
 * The overflow notice, for a body that kept `keptCount` of `total` lines.
 *
 * Built from the counts rather than held as a constant because the notice is
 * itself part of the body it describes: making room for it changes how many
 * lines were dropped, which changes the sentence, which changes how much room
 * it needs. See {@link withinBudget}.
 * @param {number} total How many lines were rendered in all.
 * @param {number} keptCount How many of them survived the budget.
 * @param {number} gapLines How many leading lines describe gaps and defaults.
 * @returns {string} The notice line.
 */
function overflowNotice(total, keptCount, gapLines) {
  // Two things this notice used to get wrong. It counted LINES while reading as
  // if it counted keys — one line carries many leaves — and it sent the reader
  // to the config file for lines that no file can answer. The second is fixed
  // by ordering (`renderBody` renders the declared-vs-default lines first, so
  // they are never the omitted ones); saying so is what makes the advice true.
  // The claim stays CONDITIONAL, because a config whose gap lines alone
  // exhaust the budget would otherwise have this sentence assert a
  // completeness the body does not have — the exact defect this hook exists to
  // remove, committed by the sentence announcing it.
  const completeness =
    keptCount >= gapLines
      ? `The declared-vs-default lines above are complete — read ${MAIN_CONFIG} and ${LOCAL_CONFIG} for the omitted values.`
      : `The declared-vs-default lines above are NOT complete, so a gap may be missing entirely — read ${MAIN_CONFIG} and ${LOCAL_CONFIG}.`;
  return `… ${total - keptCount} further rendered line(s) omitted to stay within the session-context budget; a line can carry several keys, so more keys than that are unrendered. ${completeness}`;
}

/**
 * Join lines, stopping at the budget and counting what did not fit.
 * @param {string[]} lines Rendered lines.
 * @param {object} [options] Rendering constraints.
 * @param {Set<string>} [options.unelidable] Lines the MAX_LINE cut may not touch.
 * @param {number} [options.gapLines] How many leading lines describe gaps.
 * @returns {string} The joined body.
 */
function withinBudget(lines, { unelidable = new Set(), gapLines = 0 } = {}) {
  const kept = [];
  let size = 0;
  for (const raw of lines) {
    // Scrubbed BEFORE truncation: a cut through the middle of an identity would
    // leave a fragment `EMAIL_SHAPED` no longer matches, so redacting the
    // joined body afterwards would be redacting text that had already escaped.
    const scrubbed = scrub(raw);
    const line =
      scrubbed.length > MAX_LINE && !unelidable.has(raw)
        ? `${scrubbed.slice(0, MAX_LINE)}… (line truncated)`
        : scrubbed;
    if (size + line.length > CONTEXT_BUDGET) {
      // The notice has to fit INSIDE the budget, not be appended past it. It
      // used to be pushed after the check, so a body that filled the budget
      // exactly overshot it by the length of the sentence explaining that it
      // had not. Lines come off the end until it fits, and the notice is
      // rebuilt each time because dropping one is one more line to admit to.
      while (
        kept.length > 0 &&
        size + overflowNotice(lines.length, kept.length, gapLines).length >
          CONTEXT_BUDGET
      ) {
        size -= kept.pop().length + 1;
      }
      kept.push(overflowNotice(lines.length, kept.length, gapLines));
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
      `declared. A key whose NAME is identity- or credential-shaped is withheld and counted, ` +
      `and a VALUE matching a known credential shape is replaced with ${REDACTED}: a ` +
      `best-effort filter, not proof that anything it left alone is safe to repeat.\n\n` +
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
