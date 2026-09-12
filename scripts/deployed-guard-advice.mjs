#!/usr/bin/env node
/**
 * What the DEPLOYED guard copies say, not what the source says (#3998).
 *
 * ## The defect
 *
 * The repository forbids a piece of advice, pins a test against it, and
 * deployed guards keep dispensing it anyway. Those are two different claims —
 * *"the repo forbids this advice"* and *"no agent is receiving this advice"* —
 * and until this file only the first was testable. Every conformance control
 * here reads `plugins/**` and `all/**`. None of them can see what a copy that
 * is actually serving an agent says.
 *
 * `parity-safety-net-no-stash-advice.test.ts` forbids four advisory spellings
 * of "use the shared stash to preserve your work". It is green. Three sessions
 * were nonetheless told to use the shared stash in one day, by guards resolving
 * from an older copy — and on a machine running many agents against one `.git`,
 * `stash@{0}` belongs to whoever pushed last, so a `pop` taken on that advice
 * consumes a sibling lane's uncommitted work.
 *
 * ## Why a fix does not retire the advice
 *
 * A guard reaches an agent by more than one channel and the agent sees the
 * UNION of their verdicts, so a TIGHTENING on either channel takes effect at
 * once while a RELAXATION is inert until the slowest channel catches up.
 * Deleting the advice from source is a relaxation. It propagates at the speed
 * of the slowest copy on the disk, and a session resolves its copy ONCE at
 * start and executes that copy for its whole life — which is why every cache
 * entry below is a channel and not an archive.
 *
 * ## One list, cited by both
 *
 * `FORBIDDEN_ADVISORY_PATTERNS` is the single definition of what the advice IS.
 * The in-repo source suite imports it from here rather than keeping its own
 * table, because two lists drift and the drift is invisible: the source suite
 * would stay green against patterns this sweep no longer looks for.
 *
 * ## Fail direction
 *
 * **Report-only on findings, fail-closed on its own blindness.** It gates no
 * commit and no push. It must not: a developer machine legitimately holds
 * hundreds of superseded cache entries, and a blocker that fires on every one
 * of them is a permanent stop-work whose first consequence is being switched
 * off. But the healthy state of this check is an EMPTY report, so a wrong path,
 * an unreadable cache directory, or a channel the resolver does not know about
 * all produce empty and read as clean. Any channel that could not be read makes
 * the sweep `NOT_MEASURED`, never `CLEAN`. Exit codes carry the same split:
 * 0 clean, 1 findings, 2 not measured.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Directory segment holding plugin trees under a harness config directory. */
const PLUGINS = "plugins";

/** The plugin and marketplace both named `lisa`. */
const LISA = "lisa";

/** Name of the channel the plugin manifest serves. */
const PLUGIN_MANIFEST = "plugin-manifest";

/** Directory a plugin's own manifest lives in. */
const PLUGIN_MANIFEST_DIR = ".claude-plugin";

/** Filename of a plugin's own manifest. */
const PLUGIN_MANIFEST_FILE = "plugin.json";

/** The guard every caller means unless it says otherwise. */
const DEFAULT_GUARD = "parity-safety-net";

/** Whole-sweep verdicts. */
export const ADVICE_SWEEP_VERDICTS = Object.freeze([
  "CLEAN",
  "OUTLAWED_ADVICE",
  "NOT_MEASURED",
]);

/**
 * Spellings that RECOMMEND the shared stash rather than prohibiting it.
 *
 * **Every pattern here was verified against the real historical bytes, in both
 * directions** — it matches the text that shipped before the fix and does not
 * match the text that shipped after. That check is not ceremony: the first
 * draft of this table required "stash" to appear AFTER "safe alternatives",
 * and in guard 7's actual comment it appears before, so the pattern matched
 * nothing and the suite passed against the very file it was written to catch.
 * A prose pattern that has not been run against the prose it forbids is not
 * evidence of anything. If you add one, take the bytes from the commit that
 * carried the bad text and watch the case go red first.
 *
 * ## Why these key on ADVISORY forms, not the bare word
 *
 * Guard 7 legitimately BLOCKS `git stash drop` / `git stash clear`, and its
 * message necessarily contains the word. That is a prohibition, not a
 * recommendation, and it must stay. Keying on the bare token would report the
 * one message doing the right thing. Do not "tighten" these to /stash/.
 *
 * The first three were the shipped refusal text of guards 4 and 3 until the
 * fix; the fourth is guard 7's comment, which that fix left behind.
 */
export const FORBIDDEN_ADVISORY_PATTERNS = Object.freeze([
  Object.freeze({
    id: "guard-4-old-refusal",
    label: "guard 4's old refusal",
    pattern: /use\s+git\s+stash/i,
    why: "offers the shared stash as the way to preserve work before a discard",
  }),
  Object.freeze({
    id: "guard-3-old-refusal",
    label: "guard 3's old refusal",
    pattern: /\(\s*stash\s+or\s+commit/i,
    why: "offers the shared stash as an alternative to committing",
  }),
  Object.freeze({
    id: "stash-as-preservation",
    label: "stash offered as the preservation step",
    pattern: /stash\s+to\s+preserve/i,
    why: "names the shared stash as the preservation mechanism",
  }),
  Object.freeze({
    id: "push-pop-safe-alternative",
    label: "push/pop called a safe alternative",
    pattern: /push\/pop[^.]*safe\s+alternatives?/i,
    why: "asserts the shared stash is safe, which it is not across worktrees",
  }),
]);

/**
 * Every in-repo directory a guard is SOURCED from.
 *
 * These are the copies the existing source-only suite reads. They are listed
 * here so the source scan and the deployed scan share one scanner and one
 * pattern table — the whole point being that the two answers differ.
 */
export const SOURCE_GUARD_ROOTS = Object.freeze([
  "plugins/src/base/hooks",
  "plugins/lisa/hooks",
  "plugins/lisa-agy/hooks",
  "plugins/lisa-cursor/hooks",
  "plugins/lisa-copilot/hooks",
  "all/copy-overwrite/scripts/lisa-hooks",
]);

/**
 * The version a JSON manifest states at its top level.
 * @param {string} file - Absolute path to a JSON file.
 * @param {string} key - Top-level key holding the version.
 * @returns {string} The version, or "" when the file or key is unreadable.
 */
function readJsonVersion(file, key) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"))?.[key];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * A channel that resolved to a copy on disk.
 * @param {string} channel - Channel name.
 * @param {string} file - Absolute path to the guard copy.
 * @param {string} version - The copy's vintage, or "" when undateable.
 * @returns {{channel: string, path: string, version: string, reason: string}}
 *   The resolved channel.
 */
function resolved(channel, file, version) {
  return { channel, path: file, version: version || "unknown", reason: "" };
}

/**
 * A channel that exists in the topology but could not be resolved to a copy.
 * @param {string} channel - Channel name.
 * @param {string} reason - Why it could not be resolved.
 * @returns {{channel: string, path: string, version: string, reason: string}}
 *   The unresolved channel.
 */
function unresolved(channel, reason) {
  return { channel, path: "", version: "", reason };
}

/**
 * The guard tree the repository hook dispatcher resolves, and its vintage.
 *
 * Resolution is first-wins: `scripts/lisa-hooks/` shadows `plugins/lisa/hooks/`
 * outright and the shadowed copy never runs, so the tree reported is whichever
 * is FIRST rather than whichever is newest.
 * @param {string} projectDir - Repository root.
 * @param {string} guard - Guard basename without extension.
 * @returns {{channel: string, path: string, version: string, reason: string}}
 *   The dispatcher channel.
 */
export function repositoryChannel(projectDir, guard) {
  const host = path.join(projectDir, "scripts", "lisa-hooks", `${guard}.sh`);
  if (existsFile(host)) {
    const receipt = path.join(projectDir, ".lisa", "apply-receipt.json");
    return resolved(
      "repository",
      host,
      readJsonVersion(receipt, "lisa_version")
    );
  }
  const plugin = path.join(projectDir, PLUGINS, LISA, "hooks", `${guard}.sh`);
  if (existsFile(plugin)) {
    const manifest = path.join(
      projectDir,
      PLUGINS,
      LISA,
      PLUGIN_MANIFEST_DIR,
      PLUGIN_MANIFEST_FILE
    );
    return resolved("repository", plugin, readJsonVersion(manifest, "version"));
  }
  return unresolved("repository", "no-dispatcher-tree-in-project");
}

/**
 * Whether a path names a readable regular file.
 * @param {string} file - Candidate path.
 * @returns {boolean} True when it is a file this process can stat.
 */
function existsFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The channel the plugin manifest runs, per PROJECT DIRECTORY.
 *
 * The runtime keys installs on the project path, which is exactly why two
 * checkouts of one repository on one disk really do run different vintages.
 * A record whose install path does not sit under a `lisa/lisa/` cache is left
 * unresolved on purpose: reporting a clean result about a copy that was never
 * read is the failure this whole file exists to end.
 * @param {string} configDir - Harness config directory.
 * @param {string} projectDir - Repository root.
 * @param {string} guard - Guard basename without extension.
 * @returns {{channel: string, path: string, version: string, reason: string}}
 *   The plugin-manifest channel.
 */
export function pluginManifestChannel(configDir, projectDir, guard) {
  const record = path.join(configDir, PLUGINS, "installed_plugins.json");
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(record, "utf8"));
  } catch {
    return unresolved(PLUGIN_MANIFEST, "install-record-unreadable");
  }
  const installs = Object.values(parsed?.plugins ?? {}).flat();
  const match = installs.find(
    entry =>
      entry?.projectPath === projectDir &&
      typeof entry?.installPath === "string" &&
      entry.installPath.includes(`${path.sep}lisa${path.sep}lisa${path.sep}`)
  );
  if (!match) {
    return unresolved(PLUGIN_MANIFEST, "no-install-record-for-this-project");
  }
  return resolved(
    PLUGIN_MANIFEST,
    path.join(match.installPath, "hooks", `${guard}.sh`),
    String(match.version ?? "")
  );
}

/**
 * The copy this session itself resolved, as the harness reports it.
 *
 * `CLAUDE_PLUGIN_ROOT` is a claim the harness makes rather than something read
 * off disk, so an unset variable is an unanswered question and not an absence.
 * @param {string | undefined} pluginRoot - The harness-declared plugin root.
 * @param {string} guard - Guard basename without extension.
 * @returns {{channel: string, path: string, version: string, reason: string}}
 *   The session channel.
 */
export function sessionChannel(pluginRoot, guard) {
  if (!pluginRoot) return unresolved("session", "plugin-root-not-declared");
  const manifest = path.join(
    pluginRoot,
    PLUGIN_MANIFEST_DIR,
    PLUGIN_MANIFEST_FILE
  );
  return resolved(
    "session",
    path.join(pluginRoot, "hooks", `${guard}.sh`),
    readJsonVersion(manifest, "version")
  );
}

/**
 * The marketplace clone, which is what the next install will copy from.
 * @param {string} configDir - Harness config directory.
 * @param {string} guard - Guard basename without extension.
 * @returns {{channel: string, path: string, version: string, reason: string}}
 *   The marketplace channel.
 */
export function marketplaceChannel(configDir, guard) {
  const root = path.join(
    configDir,
    PLUGINS,
    "marketplaces",
    LISA,
    PLUGINS,
    LISA
  );
  const manifest = path.join(root, PLUGIN_MANIFEST_DIR, PLUGIN_MANIFEST_FILE);
  return resolved(
    "marketplace",
    path.join(root, "hooks", `${guard}.sh`),
    readJsonVersion(manifest, "version")
  );
}

/**
 * Every cache entry a live session may still be pinned to.
 *
 * These are channels, not an archive. A session resolves its copy once at start
 * and executes it for its whole life, so an entry six months old is serving
 * whichever lane started while it was in force. Enumerating them is the only
 * way the sweep can answer "is any agent being told this right now".
 * @param {string} configDir - Harness config directory.
 * @param {string} guard - Guard basename without extension.
 * @returns {readonly {channel: string, path: string, version: string, reason: string}[]}
 *   One channel per cached vintage, or one unresolved channel.
 */
export function cacheChannels(configDir, guard) {
  const root = path.join(configDir, PLUGINS, "cache", LISA, LISA);
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [unresolved("cache", "cache-directory-unreadable")];
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry =>
      resolved(
        `cache:${entry.name}`,
        path.join(root, entry.name, "hooks", `${guard}.sh`),
        entry.name
      )
    );
}

/**
 * Every channel a guard can be SERVED from on this machine.
 * @param {{
 *   readonly projectDir: string
 *   readonly configDir: string
 *   readonly pluginRoot?: string | undefined
 *   readonly guard?: string | undefined
 * }} where - Where to look.
 * @returns {readonly {channel: string, path: string, version: string, reason: string}[]}
 *   The channel roster.
 */
export function resolveGuardChannels(where) {
  const guard = where.guard ?? DEFAULT_GUARD;
  return [
    repositoryChannel(where.projectDir, guard),
    pluginManifestChannel(where.configDir, where.projectDir, guard),
    sessionChannel(where.pluginRoot, guard),
    marketplaceChannel(where.configDir, guard),
    ...cacheChannels(where.configDir, guard),
  ];
}

/**
 * Every channel a guard is SOURCED from in the checkout.
 *
 * The deliberate counterpart to `resolveGuardChannels`: same scanner, same
 * patterns, different copies. A tree whose source scan is empty and whose
 * deployed scan is not is the gap this file closes, stated as two numbers.
 * @param {string} projectDir - Repository root.
 * @param {string} [guard] - Guard basename without extension.
 * @returns {readonly {channel: string, path: string, version: string, reason: string}[]}
 *   The source roster.
 */
export function resolveSourceChannels(projectDir, guard = DEFAULT_GUARD) {
  return SOURCE_GUARD_ROOTS.map(root =>
    resolved(
      `source:${root}`,
      path.join(projectDir, root, `${guard}.sh`),
      "source"
    )
  );
}

/**
 * Every forbidden advisory pattern a piece of guard text carries.
 * @param {string} text - Guard file contents.
 * @returns {readonly {id: string, label: string, why: string}[]} Matches.
 */
export function matchAdvisory(text) {
  return FORBIDDEN_ADVISORY_PATTERNS.filter(entry =>
    entry.pattern.test(text)
  ).map(({ id, label, why }) => ({ id, label, why }));
}

/**
 * Scan a channel roster and report every copy dispensing outlawed advice.
 * @param {{
 *   readonly channels?: readonly {
 *     channel: string, path: string, version: string, reason: string
 *   }[]
 *   readonly read?: (file: string) => string
 * }} input - The roster, and how to read a copy.
 * @returns {{
 *   readonly verdict: string
 *   readonly examinedCount: number
 *   readonly findings: readonly {
 *     readonly channel: string
 *     readonly path: string
 *     readonly version: string
 *     readonly id: string
 *     readonly label: string
 *     readonly why: string
 *   }[]
 *   readonly notMeasured: readonly {
 *     readonly channel: string
 *     readonly reason: string
 *   }[]
 *   readonly reportOnly: true
 * }} The sweep result.
 */
export function scanDeployedGuardAdvice(input = {}) {
  const channels = Array.isArray(input.channels) ? input.channels : null;
  const read = input.read ?? (file => readFileSync(file, "utf8"));
  if (channels === null) {
    return sweep(
      [],
      [{ channel: "<roster>", reason: "channel-list-unavailable" }],
      0
    );
  }

  const findings = [];
  const notMeasured = [];
  let examinedCount = 0;
  for (const channel of channels) {
    if (!channel?.path) {
      notMeasured.push({
        channel: channel?.channel ?? "<unnamed>",
        reason: channel?.reason || "unresolved",
      });
      continue;
    }
    let text = null;
    try {
      text = read(channel.path);
    } catch {
      notMeasured.push({ channel: channel.channel, reason: "copy-unreadable" });
      continue;
    }
    examinedCount += 1;
    for (const match of matchAdvisory(text)) {
      findings.push({
        channel: channel.channel,
        path: channel.path,
        version: channel.version,
        ...match,
      });
    }
  }
  return sweep(findings, notMeasured, examinedCount);
}

/**
 * Assemble a sweep result, with blindness outranking findings.
 *
 * A sweep that could not read part of its roster cannot call the rest clean —
 * but it still reports what it DID find, because a real finding does not stop
 * mattering because a different channel was unreadable.
 * @param {readonly object[]} findings - Copies dispensing outlawed advice.
 * @param {readonly object[]} notMeasured - Channels that could not be read.
 * @param {number} examinedCount - Copies actually read.
 * @returns {ReturnType<typeof scanDeployedGuardAdvice>} The sweep.
 */
function sweep(findings, notMeasured, examinedCount) {
  const verdict =
    notMeasured.length > 0
      ? "NOT_MEASURED"
      : findings.length > 0
        ? "OUTLAWED_ADVICE"
        : "CLEAN";
  return { verdict, examinedCount, findings, notMeasured, reportOnly: true };
}

/**
 * The CLI exit status for a sweep.
 *
 * `2` is load-bearing: a sweep that examined nothing must not exit 0 beside an
 * empty finding list, which is indistinguishable from a clean fleet.
 * @param {{ readonly verdict?: string }} result - A sweep result.
 * @returns {0 | 1 | 2} The exit status.
 */
export function deployedGuardAdviceExitCode(result) {
  if (result?.verdict === "CLEAN") return 0;
  if (result?.verdict === "OUTLAWED_ADVICE") return 1;
  return 2;
}

/** Channel-name prefix marking a superseded copy a session may still be pinned to. */
const CACHE_PREFIX = "cache:";

/**
 * Numeric release fields of a version string, ignoring prerelease suffixes.
 *
 * A field that is not a plain number becomes 0 rather than throwing, so a
 * version string this does not understand can never sort ABOVE one it does.
 * @param {string} version - A dotted version string.
 * @returns {readonly number[]} Three release fields.
 */
function releaseFields(version) {
  const parts = String(version).split("-")[0].split("+")[0].split(".");
  return [0, 1, 2].map(index =>
    /^\d+$/u.test(parts[index] ?? "") ? Number(parts[index]) : 0
  );
}

/**
 * Order two versions newest-first. String order is not usable here: `2.9.0`
 * sorts above `2.128.1` lexically and would name the wrong copy.
 * @param {string} a - Left version.
 * @param {string} b - Right version.
 * @returns {number} Negative when `a` is newer.
 */
function newestFirst(a, b) {
  const left = releaseFields(a);
  const right = releaseFields(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

/**
 * One rendered finding: the copy, its vintage, and the pattern it matched.
 * @param {{channel: string, path: string, version: string, id: string, label: string, why: string}} finding
 *   A finding.
 * @returns {readonly string[]} Report lines.
 */
function renderFinding(finding) {
  return [
    `  ! ${finding.channel} (lisa ${finding.version})`,
    `      ${finding.path}`,
    `      ${finding.id}: ${finding.label} — ${finding.why}`,
  ];
}

/**
 * Render the sweep for an operator.
 *
 * IN-FORCE findings are printed in full and CACHED ones are summarised, with
 * the newest cached vintage per pattern shown. That split is the whole
 * operator judgement: a developer machine legitimately holds hundreds of
 * superseded copies, so printing all of them buries the one that is serving
 * somebody. The newest cached copy carrying a pattern is the one most likely to
 * still be pinned by a live session, so it is the one named.
 * @param {ReturnType<typeof scanDeployedGuardAdvice>} result - A sweep result.
 * @returns {string} A terminal-first report.
 */
export function formatDeployedGuardAdviceReport(result) {
  const inForce = result.findings.filter(
    f => !f.channel.startsWith(CACHE_PREFIX)
  );
  const cached = result.findings.filter(f =>
    f.channel.startsWith(CACHE_PREFIX)
  );
  const lines = [
    `Deployed guard advice: ${result.verdict}`,
    `Read ${result.examinedCount} deployed copy(s); ${result.findings.length} carry advice this repository has outlawed.`,
  ];

  lines.push(`In force now: ${inForce.length} finding(s).`);
  for (const finding of inForce) lines.push(...renderFinding(finding));

  lines.push(
    `Superseded copies a live session may still be pinned to: ${cached.length} finding(s) across ${new Set(cached.map(f => f.channel)).size} vintage(s).`
  );
  for (const id of new Set(cached.map(f => f.id))) {
    const newest = cached
      .filter(f => f.id === id)
      .sort((a, b) => newestFirst(a.version, b.version))[0];
    lines.push(
      ...renderFinding(newest),
      "      (newest cached copy carrying it)"
    );
  }

  if (result.notMeasured.length > 0) {
    lines.push(
      `${result.notMeasured.length} channel(s) could not be read. This is not a clean fleet — it is an unanswered question.`,
      ...result.notMeasured.map(
        entry => `  ? ${entry.channel}: ${entry.reason}`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path.
 * @returns {boolean} Whether to run the CLI body.
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
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(process.env.HOME ?? "", ".claude");
  const result = scanDeployedGuardAdvice({
    channels: resolveGuardChannels({
      projectDir: process.cwd(),
      configDir,
      pluginRoot: process.env.CLAUDE_PLUGIN_ROOT,
      guard: process.argv[2] ?? DEFAULT_GUARD,
    }),
  });
  process.stdout.write(formatDeployedGuardAdviceReport(result));
  process.exitCode = deployedGuardAdviceExitCode(result);
}
