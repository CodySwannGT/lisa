#!/usr/bin/env node
/**
 * Validate the `secrets`, `remoteEnv`, `automations`, and `sessionManager`
 * blocks.
 *
 * These blocks are read by shell, by Node, and by generated workflows, so a
 * malformed one surfaces late and somewhere unhelpful — a container that fails
 * mid-setup, a scheduled loop that never fires, a dispatch that names a surface
 * nobody provisioned. Checking the shape up front turns all of those into one
 * message at `doctor` time.
 *
 * Structure only. Whether a credential resolves is `doctor-secrets.mjs`; this
 * asks whether the declaration could ever be correct.
 *
 * Usage:
 *   validate-config.mjs
 * @module validate-config
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { SURFACES as SURFACE_CAPABILITIES } from "./surfaces.mjs";

/** Providers with a read implementation today. */
const IMPLEMENTED_PROVIDERS = new Set(["bitwarden", "doppler", "env"]);

/** Providers named in the dispatch table but not yet implemented. */
const DECLARED_PROVIDERS = new Set(["1password", "aws", "vault"]);

/**
 * Surfaces the resolver knows.
 *
 * Derived from the resolver's own table rather than restated here. The two
 * lists previously drifted apart by construction: adding a surface meant
 * remembering to edit a second file, and forgetting produced a config that
 * resolved correctly at runtime while `doctor` called it unknown.
 */
const SURFACES = new Set(Object.keys(SURFACE_CAPABILITIES));

/**
 * What a provisioned surface must record before anything dispatches to it.
 *
 * Deliberately not uniform, because these surfaces do not bind the same way. A
 * Codex Cloud environment is bound to one repository, so naming the repository
 * is part of proving the environment is the right one. A Claude cloud
 * environment has no repository at all — it is account-scoped configuration
 * (network policy, variables, setup script) and the repository arrives per
 * session — so its durable handle is the routine that dispatch fires.
 *
 * Requiring `repository` of every surface, as this file used to, would demand
 * a field that cannot be true of `claude-web` in any meaningful sense.
 *
 * `repository` stays the default so every existing surface keeps its current
 * contract. This file checks structure only — whether a declaration *could* be
 * correct — so it deliberately does not restate the fuller preconditions that
 * `lisa-remote-dispatch` enforces at the moment it actually dispatches.
 */
const SURFACE_BINDINGS = {
  "claude-web": ["routineId", "fireUrl"],
};

/**
 * The fields a surface must record, with the default applied.
 *
 * Read through one helper rather than at each call site, because the two
 * callers answer different questions — "could this declaration be correct" and
 * "may an automation dispatch to it" — and a fallback that drifted between them
 * would let those answers disagree about the very same config.
 * @param {string} surface Surface name.
 * @returns {string[]} Field names that must be present.
 */
function bindingsFor(surface) {
  return SURFACE_BINDINGS[surface] ?? ["repository"];
}

/**
 * Install methods the toolchain runner supports.
 *
 * This is a deliberate copy of `INSTALL_METHODS` in `toolchain.mjs`, which is
 * the list that actually decides. Skills are distributed as self-contained
 * directories and nothing imports across a skill boundary, so importing the
 * authority here would couple two skills' distribution for one array.
 *
 * The copy has drifted twice. First `release-tar` was missing while the runner
 * had supported it for as long as gh has been pinned. Then `release-tree` and
 * `release-binary` were both missing, which rejected a valid `jq` pin. Each
 * time the only safeguard was a comment asking the next author to remember.
 * A conformance test now compares the two sets directly, so adding a kind on
 * either side fails until both know it.
 */
const INSTALL_METHODS = new Set([
  "release-zip",
  "release-tar",
  "release-tree",
  "release-binary",
  "npm-global",
]);

/**
 * Download kinds — every method that fetches a URL, so every one that needs a
 * checksum. Spelled as "not npm-global" rather than as a list, because the next
 * download kind should inherit the obligation by default; the drift above came
 * from lists that had to be remembered.
 * @param {string} method An install method.
 * @returns {boolean} Whether the method fetches a pinned artifact.
 */
function isDownloadKind(method) {
  return INSTALL_METHODS.has(method) && method !== "npm-global";
}

/**
 * Validate `secrets.propagating`, which carries two shapes on purpose.
 *
 * A bare string mirrors `secrets.rotating`: it pins which *credential* may be
 * copied into a foreign store, and any target may receive it. An object adds
 * `targets`, pinning *where it may go* as well — the stronger statement, and the
 * one worth making for anything not intended fleet-wide.
 *
 * Checked here rather than folded into the `require`/`rotating` loop because
 * that loop assumes every entry is a string, and quietly rejecting the object
 * form would leave the stronger declaration unusable.
 * @param {unknown} propagating The declaration, if present.
 * @returns {string[]} Problems found.
 */
function validatePropagating(propagating) {
  if (propagating === undefined || propagating === null) return [];
  if (!Array.isArray(propagating)) {
    return [
      `secrets.propagating must be an array of exact key names, or of ` +
        `{ name, targets } objects`,
    ];
  }
  const problems = [];
  for (const entry of propagating) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      problems.push(
        `secrets.propagating entry ${JSON.stringify(entry)} has no exact ` +
          `UPPER_SNAKE_CASE name. Lookup is never fuzzy.`
      );
      continue;
    }
    if (typeof entry === "string") continue;
    const targets = entry.targets;
    if (targets === undefined) continue;
    if (!Array.isArray(targets) || targets.length === 0) {
      problems.push(
        `secrets.propagating["${name}"].targets must be a non-empty array of ` +
          `"<org>" or "<owner>/<repo>". Omit it to allow any target.`
      );
      continue;
    }
    for (const target of targets) {
      if (
        typeof target !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(
          target
        )
      ) {
        problems.push(
          `secrets.propagating["${name}"] target ${JSON.stringify(target)} is ` +
            `neither an organization nor an owner/repo.`
        );
      }
    }
  }
  return problems;
}

/**
 * Validate the `secrets` block.
 * @param {object|undefined} secrets The block, if present.
 * @returns {string[]} Problems found.
 */
export function validateSecrets(secrets) {
  if (!secrets) return [];
  const problems = [];
  const provider = secrets.provider ?? "env";

  if (DECLARED_PROVIDERS.has(provider)) {
    problems.push(
      `secrets.provider "${provider}" is documented but has no read ` +
        `implementation yet. Add one in providers.mjs rather than configuring it.`
    );
  } else if (!IMPLEMENTED_PROVIDERS.has(provider)) {
    problems.push(
      `secrets.provider "${provider}" is unknown. ` +
        `Known: ${[...IMPLEMENTED_PROVIDERS, ...DECLARED_PROVIDERS].join(", ")}.`
    );
  }

  if (
    secrets.namespace &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(secrets.namespace)
  ) {
    problems.push(
      `secrets.namespace "${secrets.namespace}" is not one safe path segment. ` +
        `It is joined onto a config root, so a separator could redirect writes.`
    );
  }

  if (secrets.surface && !SURFACES.has(secrets.surface)) {
    problems.push(
      `secrets.surface "${secrets.surface}" is unknown. ` +
        `Known: ${[...SURFACES].join(", ")}.`
    );
  }

  // `rotating` is a flat list on every surface. `require` also accepts a
  // surface-scoped object, because the required set genuinely differs by where
  // the agent runs — see `resolveRequire` in surfaces.mjs.
  validateKeyList("rotating", secrets.rotating, problems);
  validateRequire(secrets.require, problems);

  problems.push(...validatePropagating(secrets.propagating));

  // Excluding a name from every surface and declaring it copyable to a foreign
  // store are opposite instructions about the same credential. The propagator
  // refuses at push time; catching it here means the contradiction surfaces in
  // review rather than the first time someone needs the push to work.
  const excluded = new Set(secrets.narrow?.excludeKeys ?? []);
  for (const entry of secrets.propagating ?? []) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (typeof name === "string" && excluded.has(name)) {
      problems.push(
        `secrets.propagating["${name}"] is also in secrets.narrow.excludeKeys. ` +
          `Those say opposite things about the same credential.`
      );
    }
  }

  if ((secrets.rotating ?? []).length && !secrets.bootstrap?.key) {
    problems.push(
      `secrets.rotating is declared but secrets.bootstrap.key is not. A ` +
        `rotating credential whose replacement cannot be written back is ` +
        `stranded the first time it is used.`
    );
  }

  return problems;
}

/**
 * Validate the artifact half of one install entry.
 *
 * Split out because the same obligations apply whether the fields sit directly
 * on the entry or inside a per-platform block: a method must be one Lisa can
 * execute, an archive must carry a checksum, and an npm install must name a
 * package. Duplicating those three rules per shape is how one shape ends up
 * quietly weaker than the other.
 * @param {string} label How to name this entry in a message.
 * @param {object} entry The entry or platform block.
 * @param {string[]} problems Accumulator.
 */
/**
 * Whether a value parses as a dotted version the comparator can order.
 * @param {unknown} value Candidate version.
 * @returns {boolean} True for "20", "1.2", "1.2.3" and similar.
 */
function isVersionish(value) {
  return typeof value === "string" && /^\d+(\.\d+)*$/.test(value.trim());
}

/**
 * Validate a flat list of exact environment-variable names.
 * @param {string} field Config field name, for messages.
 * @param {unknown} value The declared value.
 * @param {string[]} problems Collector.
 */
function validateKeyList(field, value, problems) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    problems.push(`secrets.${field} must be an array of exact key names`);
    return;
  }
  for (const name of value) {
    if (typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      problems.push(
        `secrets.${field} entry ${JSON.stringify(name)} is not an exact ` +
          `UPPER_SNAKE_CASE environment-variable name. Lookup is never fuzzy.`
      );
    }
  }
}

/**
 * Validate `require` in either of its two shapes.
 *
 * An array means every surface. An object scopes per surface, with `all`
 * applying everywhere. Unknown keys are rejected rather than ignored: a typo
 * like `github_actions` for `github-actions` would otherwise resolve to an
 * empty list and silently assert nothing on the one surface it was written
 * for — a declaration that reads as protection and delivers none.
 * @param {unknown} value The declared value.
 * @param {string[]} problems Collector.
 */
function validateRequire(value, problems) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    validateKeyList("require", value, problems);
    return;
  }
  if (typeof value !== "object") {
    problems.push(
      `secrets.require must be an array of key names, or an object keyed by ` +
        `surface with an optional "all" entry`
    );
    return;
  }
  for (const [key, names] of Object.entries(value)) {
    if (key !== "all" && !SURFACES.has(key)) {
      problems.push(
        `secrets.require key "${key}" is not a known surface. ` +
          `Known: all, ${[...SURFACES].join(", ")}.`
      );
      continue;
    }
    validateKeyList(`require.${key}`, names, problems);
  }
}

function validateInstallArtifact(label, entry, problems) {
  if (!INSTALL_METHODS.has(entry.install)) {
    problems.push(
      `remoteEnv install ${label} has method ${JSON.stringify(entry.install)}. ` +
        `Supported: ${[...INSTALL_METHODS].join(", ")}.`
    );
    return;
  }
  // Every download kind, not an enumerated few. A tarball pinned without a
  // checksum trusts whatever the URL serves today exactly as much as a zip
  // does, and checking only one of them meant the tool Lisa's guardrails shell
  // out to — gh, which ships a tarball on Linux — was the one going unverified.
  // A `release-binary` matters most of all: the artifact is directly
  // executable, so a wrong one needs no unpacking step to run.
  if (isDownloadKind(entry.install) && !(entry.url && entry.sha256)) {
    problems.push(
      `remoteEnv install ${label} needs both url and sha256. A pinned ` +
        `version with no checksum still trusts whatever the URL serves today.`
    );
  }
  // A tree is the one kind with no sane default entry point: the archive root
  // is a directory, so an omitted `binary` would install a directory as a
  // command. The runner refuses it, and a validator that accepted it would just
  // move the failure from review to provisioning.
  if (entry.install === "release-tree" && !entry.binary) {
    problems.push(
      `remoteEnv install ${label} needs "binary" — the path to the entry ` +
        `point INSIDE the archive, such as "maestro/bin/maestro".`
    );
  }
  if (entry.install === "npm-global" && !entry.package) {
    problems.push(`remoteEnv install ${label} needs a package`);
  }
}

/**
 * Validate the `remoteEnv` block.
 * @param {object|undefined} remoteEnv The block, if present.
 * @returns {string[]} Problems found.
 */
export function validateRemoteEnv(remoteEnv) {
  if (!remoteEnv) return [];
  const problems = [];

  for (const tool of remoteEnv.tools?.require ?? []) {
    if (!tool.name) {
      problems.push("remoteEnv.tools.require entry has no name");
      continue;
    }
    // `minVersion` was accepted unvalidated while `install` entries had their
    // shape checked in full. The asymmetry mattered: the value is fed to a
    // version comparison, so `minVersion: "twenty"` sorted below every real
    // version and the requirement silently passed for any installed release —
    // a declared constraint that enforced nothing.
    if (tool.minVersion !== undefined && !isVersionish(tool.minVersion)) {
      problems.push(
        `remoteEnv require "${tool.name}" has minVersion ` +
          `${JSON.stringify(tool.minVersion)}, which is not a dotted version ` +
          `like "20" or "1.2.3". It is compared numerically, so a value that ` +
          `does not parse would accept every installed version.`
      );
    }
  }
  for (const tool of remoteEnv.tools?.install ?? []) {
    if (!tool.name) {
      problems.push("remoteEnv.tools.install entry has no name");
      continue;
    }
    if (!tool.version) {
      problems.push(`remoteEnv install "${tool.name}" has no pinned version`);
    }
    // A flat entry means one artifact serves every platform — true of npm-global
    // and of nothing else. Anything downloaded is platform-specific, so those
    // declare a block per platform and each block is validated in full: a
    // half-filled map is the failure this shape exists to prevent, and it is
    // invisible until someone runs setup on the platform that was left out.
    if (tool.platforms === undefined) {
      validateInstallArtifact(`"${tool.name}"`, tool, problems);
      continue;
    }
    if (
      typeof tool.platforms !== "object" ||
      tool.platforms === null ||
      Array.isArray(tool.platforms)
    ) {
      problems.push(
        `remoteEnv install "${tool.name}" has a platforms field that is not an ` +
          `object keyed by <platform>-<arch>. Omit it when one artifact serves ` +
          `every platform.`
      );
      continue;
    }
    const platforms = Object.entries(tool.platforms);
    if (platforms.length === 0) {
      problems.push(
        `remoteEnv install "${tool.name}" declares platforms but lists none, so ` +
          `it can never be installed anywhere.`
      );
      continue;
    }
    for (const [platform, block] of platforms) {
      validateInstallArtifact(`"${tool.name}" (${platform})`, block, problems);
    }
  }

  for (const [surface, block] of Object.entries(remoteEnv.surfaces ?? {})) {
    if (!SURFACES.has(surface)) {
      problems.push(`remoteEnv.surfaces has unknown surface "${surface}"`);
      continue;
    }
    for (const field of bindingsFor(surface)) {
      if (!block[field]) {
        problems.push(`remoteEnv.surfaces["${surface}"] has no ${field}`);
      }
    }
  }

  return problems;
}

/**
 * Report whether a surface has been provisioned far enough to dispatch to.
 * @param {object|undefined} remoteEnv The remote-environment block.
 * @param {string} surface Surface name.
 * @returns {boolean} Whether every binding field is recorded.
 */
export function isProvisioned(remoteEnv, surface) {
  const block = remoteEnv?.surfaces?.[surface];
  if (!block) return false;
  return bindingsFor(surface).every(field => Boolean(block[field]));
}

/**
 * Validate the `automations` block against declared surfaces.
 * @param {object|undefined} automations The block, if present.
 * @param {object|undefined} remoteEnv The remote-environment block.
 * @returns {string[]} Problems found.
 */
export function validateAutomations(automations, remoteEnv) {
  if (!automations) return [];
  const problems = [];

  for (const [name, loop] of Object.entries(automations)) {
    if (loop.scheduler !== "github-actions") continue;
    if (!loop.schedule) {
      problems.push(`automations["${name}"] has no schedule`);
    }
    if (!loop.executionEnv) {
      problems.push(`automations["${name}"] has no executionEnv`);
      continue;
    }
    if (!SURFACES.has(loop.executionEnv)) {
      problems.push(
        `automations["${name}"].executionEnv "${loop.executionEnv}" is unknown`
      );
      continue;
    }
    if (!isProvisioned(remoteEnv, loop.executionEnv)) {
      problems.push(
        `automations["${name}"] dispatches to "${loop.executionEnv}", which is ` +
          `not provisioned. Run /lisa:setup:remote-env ${loop.executionEnv} first.`
      );
    }
  }

  return problems;
}

/**
 * A manager session name: lowercase letters, digits, `-` and `_`, at most 64
 * characters.
 *
 * Narrower than `managedBy=` accepts on purpose. The same string names the
 * tmux session, the `claude -n` session that workers `SendMessage` to, and the
 * default Telegram state dir. tmux silently rewrites `.` and `:` in session
 * names, so a name containing either would start a session that `stop` could
 * never find again by the name in config.
 */
const SESSION_MANAGER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** One path segment that cannot climb out of, or hide inside, its parent. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Seconds per `/loop` interval unit. */
const INTERVAL_UNITS = { s: 1, m: 60, h: 3600, d: 86_400 };

/**
 * A Telegram bot token's shape (`<bot id>:<secret>`).
 *
 * Matched on values as well as on credential-shaped key names, because the
 * likeliest mistake is pasting the token into a plausible field rather than
 * naming it `token`.
 */
const TOKEN_VALUE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

/** Key names that only ever hold a credential. */
const CREDENTIAL_KEY = /token|secret|password|passwd|api[-_]?key|credential/i;

/**
 * Parse a `/loop` interval such as `5m` into seconds.
 *
 * One parser for the validator and every consumer (the status view's cadence,
 * the launch command), so "valid" and "usable" cannot disagree about the same
 * string.
 * @param {unknown} text Interval as written in config.
 * @returns {number|null} Seconds, or null when it does not parse or is zero.
 */
export function parseLoopInterval(text) {
  if (typeof text !== "string") return null;
  const match = /^(\d+)([smhd])$/.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]) * INTERVAL_UNITS[match[2]];
  return seconds > 0 ? seconds : null;
}

/**
 * Whether a value is a plain object (not null, not an array).
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped values.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate `sessionManager.repos.root`.
 * @param {unknown} root The declared value.
 * @returns {string[]} Problems found.
 */
function validateReposRoot(root) {
  if (root === undefined) return [];
  // `.` means the repos are direct children of the project root.
  if (root === ".") return [];
  const segments = typeof root === "string" ? root.split("/") : [];
  if (segments.length && segments.every(part => SAFE_SEGMENT.test(part))) {
    return [];
  }
  return [
    `sessionManager.repos.root ${JSON.stringify(root)} must be a relative ` +
      `path inside the project, such as "projects" (or "." for repos at the ` +
      `project root). Workers start there with ` +
      `permissions bypassed.`,
  ];
}

/**
 * Validate one `sessionManager.repos.entries` entry.
 * @param {string} key Repo key.
 * @param {unknown} entry Its declaration.
 * @returns {string[]} Problems found.
 */
function validateRepoEntry(key, entry) {
  if (!SAFE_SEGMENT.test(key)) {
    return [
      `sessionManager.repos.entries key ${JSON.stringify(key)} is not one ` +
        `safe path segment. It is joined onto repos.root to find the repo.`,
    ];
  }
  const hints = isPlainObject(entry) ? entry.hints : undefined;
  const valid =
    Array.isArray(hints) &&
    hints.length > 0 &&
    hints.every(hint => typeof hint === "string" && hint.trim() !== "");
  return valid
    ? []
    : [
        `sessionManager.repos.entries["${key}"] needs hints: a non-empty ` +
          `array of words that identify work for this repo.`,
      ];
}

/**
 * Validate `sessionManager.repos`.
 *
 * Every entry needs hints, because hints are the only thing the manager routes
 * a work item on. An entry without them can never be chosen, so a ticket meant
 * for it is either asked about on every cycle or routed somewhere else.
 * @param {unknown} repos The declared value.
 * @returns {string[]} Problems found.
 */
function validateSessionManagerRepos(repos) {
  if (repos === undefined) return [];
  if (!isPlainObject(repos)) {
    return [
      `sessionManager.repos must be an object with an "entries" map. Omit it ` +
        `for a single-repo project.`,
    ];
  }
  const entries = repos.entries;
  if (!isPlainObject(entries) || Object.keys(entries).length === 0) {
    return [
      ...validateReposRoot(repos.root),
      `sessionManager.repos.entries must name at least one repo. Omit ` +
        `sessionManager.repos for a single-repo project.`,
    ];
  }
  return [
    ...validateReposRoot(repos.root),
    ...Object.entries(entries).flatMap(([key, entry]) =>
      validateRepoEntry(key, entry)
    ),
  ];
}

/**
 * Check a block of numeric fields, each against its own predicate.
 * @param {string} block Name under `sessionManager`, for messages.
 * @param {unknown} value The declared block.
 * @param {Record<string, [(n: number) => boolean, string]>} rules Per-key
 *   predicate and the phrase describing a legal value.
 * @returns {string[]} Problems found.
 */
function validateNumberBlock(block, value, rules) {
  if (value === undefined) return [];
  if (!isPlainObject(value))
    return [`sessionManager.${block} must be an object`];
  return Object.entries(rules).flatMap(([key, [legal, phrase]]) => {
    const n = value[key];
    if (n === undefined) return [];
    if (typeof n === "number" && Number.isFinite(n) && legal(n)) return [];
    return [
      `sessionManager.${block}.${key} is ${JSON.stringify(n)}; it must be ` +
        `${phrase}.`,
    ];
  });
}

/** Legal values for `sessionManager.capacity`. */
const CAPACITY_RULES = {
  maxWorkers: [n => Number.isInteger(n) && n > 0, "a positive integer"],
  gbPerWorker: [n => n > 0, "a positive number"],
  reserveGb: [n => n >= 0, "zero or a positive number"],
  cpuFraction: [n => n > 0 && n <= 1, "greater than 0 and at most 1"],
  maxLoadPerCore: [n => n > 0, "a positive number"],
};

/** Legal values for `sessionManager.stall`. */
const STALL_RULES = {
  noOutputMinutes: [n => n >= 0, "zero or a positive number"],
  maxAttempts: [n => Number.isInteger(n) && n > 0, "a positive integer"],
  requestionHours: [n => n >= 0, "zero or a positive number"],
};

/** Notification providers `sessionManager.notify.provider` accepts. */
const NOTIFY_PROVIDERS = ["none", "telegram"];

/**
 * Validate `sessionManager.notify`.
 *
 * A notification channel is optional (#4555): an absent block, an absent
 * provider and `"none"` all mean the manager runs with no channel, and then
 * there is no state dir to name. A `stateDir` without the telegram provider is
 * refused rather than ignored, because it means the operator believes a bot is
 * attached when none will be. For telegram, `stateDir` is required rather than
 * defaulted here: the default dir is shared by every project, and a shared dir
 * is exactly how one project's bot gets taken over by another's session.
 * @param {unknown} notify The declared value.
 * @returns {string[]} Problems found.
 */
function validateNotify(notify) {
  if (notify !== undefined && !isPlainObject(notify)) {
    return ["sessionManager.notify must be an object"];
  }
  const provider = notify?.provider ?? "none";
  if (!NOTIFY_PROVIDERS.includes(provider)) {
    return [
      `sessionManager.notify.provider ${JSON.stringify(provider)} is not ` +
        `supported. Use "none" (no notification channel) or "telegram".`,
    ];
  }
  const hasStateDir = notify?.stateDir !== undefined;
  const stateDirOk =
    typeof notify?.stateDir === "string" && notify.stateDir.trim() !== "";
  if (provider === "none") {
    return hasStateDir
      ? [
          `sessionManager.notify.stateDir is set, but notify.provider is not ` +
            `"telegram", so no bot would use it. Set notify.provider to ` +
            `"telegram", or remove notify.stateDir.`,
        ]
      : [];
  }
  return stateDirOk
    ? []
    : [
        `sessionManager.notify.stateDir is missing. Each project needs its ` +
          `own Telegram state dir, such as ` +
          `"~/.claude/channels/telegram-<project>".`,
      ];
}

/**
 * Walk the block for anything that looks like a credential.
 *
 * Config is committed, and this block configures a bot that grants shell
 * access over chat. The token belongs in the project's secrets provider
 * (#4555; the state dir's 0600 dotenv file only when no provider is
 * configured), so a token here is both leaked and unused. The value is never
 * echoed.
 * @param {unknown} value Subtree.
 * @param {string} path Dotted path so far.
 * @returns {string[]} Problems found.
 */
function findCredentials(value, path) {
  if (typeof value === "string") {
    return TOKEN_VALUE.test(value.trim())
      ? [
          `${path} looks like a bot token. Tokens never go in config: ` +
            `remove it, and store the token in the project's secrets ` +
            `provider with session-manager.mjs store-token ` +
            `(/lisa:setup:session-manager runs it).`,
        ]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findCredentials(item, `${path}[${i}]`));
  }
  if (!isPlainObject(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    CREDENTIAL_KEY.test(key)
      ? [
          `${path}.${key} names a credential. Tokens and secrets never go in ` +
            `config: remove it, and keep the bot token in the project's ` +
            `secrets provider (session-manager.mjs store-token, run by ` +
            `/lisa:setup:session-manager).`,
        ]
      : findCredentials(child, `${path}.${key}`)
  );
}

/**
 * Validate `sessionManager.operatorIds`: the people the manager works for,
 * whose assigned items it dispatches first. Matched against the assignee the
 * way "me" is, so the GitHub entry is a login, not the numeric id
 * `trustedAuthorIds` takes. An empty list reads as configured but names no
 * one, so it is refused like an empty `trustedAuthorIds`.
 * @param {unknown} ids The value, if present.
 * @returns {string[]} Problems found.
 */
function validateOperatorIds(ids) {
  if (ids === undefined) return [];
  if (
    !Array.isArray(ids) ||
    !ids.every(id => typeof id === "string" && id.trim() !== "")
  ) {
    return [
      `sessionManager.operatorIds must be an array of tracker user ids as ` +
        `strings, matched against the assignee: the GitHub login, the Jira ` +
        `accountId or the Linear user id.`,
    ];
  }
  return ids.length === 0
    ? [
        `sessionManager.operatorIds must name at least one person. Remove ` +
          `the key instead if the manager works only for its own identity.`,
      ]
    : [];
}

/**
 * Validate the opt-in `sessionManager` block.
 *
 * Structure only, like the rest of this file: whether the bot answers or tmux
 * is installed is the setup skill's and doctor's business. An absent block is
 * valid, because the manager is opt-in. Pass the merged block (local over
 * global per key), since any field may come from either file.
 * @param {unknown} block The block, if present.
 * @returns {string[]} Problems found.
 */
export function validateSessionManager(block) {
  if (block === undefined || block === null) return [];
  if (!isPlainObject(block)) return ["sessionManager must be an object"];

  const nameOk =
    typeof block.name === "string" && SESSION_MANAGER_NAME.test(block.name);
  const intervalOk =
    block.interval === undefined || parseLoopInterval(block.interval) !== null;
  const trustedOk =
    block.trustedAuthorIds === undefined ||
    (Array.isArray(block.trustedAuthorIds) &&
      block.trustedAuthorIds.every(id => typeof id === "string" && id !== ""));

  return [
    ...(nameOk
      ? []
      : [
          `sessionManager.name ${JSON.stringify(block.name)} must be a slug: ` +
            `lowercase letters, digits, "-" or "_", at most 64 characters. ` +
            `It names the tmux session and the session workers message.`,
        ]),
    ...(intervalOk
      ? []
      : [
          `sessionManager.interval ${JSON.stringify(block.interval)} is not a ` +
            `/loop interval such as "30s", "5m", "2h" or "1d".`,
        ]),
    ...validateSessionManagerRepos(block.repos),
    ...validateNumberBlock("capacity", block.capacity, CAPACITY_RULES),
    ...validateNumberBlock("stall", block.stall, STALL_RULES),
    ...validateNotify(block.notify),
    ...(trustedOk
      ? []
      : [
          `sessionManager.trustedAuthorIds must be an array of stable ` +
            `tracker user ids (GitHub numeric user id, Jira accountId, ` +
            `Linear user id), not logins or display names.`,
        ]),
    // An empty list reads as "set" but filters no author at all, so on a
    // public repo it would dispatch anyone's item while looking configured.
    ...(trustedOk &&
    Array.isArray(block.trustedAuthorIds) &&
    block.trustedAuthorIds.length === 0
      ? [
          `sessionManager.trustedAuthorIds must name at least one author id. ` +
            `An empty list filters no author at all; remove the key instead ` +
            `if every author's item may be dispatched.`,
        ]
      : []),
    ...validateOperatorIds(block.operatorIds),
    ...validateBacklogPickup(block.backlogPickup, block.operatorIds),
    ...findCredentials(block, "sessionManager"),
  ];
}

/**
 * Validate `sessionManager.backlogPickup`: opt-in promotion of validated
 * backlog items to Ready, assigned to `operatorIds[0]`. Without an operator
 * there is nobody to assign the promoted item to, so it is refused rather
 * than promoting work into the agent's own name.
 * @param {unknown} value The value, if present.
 * @param {unknown} operatorIds `sessionManager.operatorIds`, if present.
 * @returns {string[]} Problems found.
 */
function validateBacklogPickup(value, operatorIds) {
  if (value === undefined) return [];
  if (typeof value !== "boolean") {
    return [
      `sessionManager.backlogPickup must be true or false (absent means false).`,
    ];
  }
  const hasOperator =
    Array.isArray(operatorIds) &&
    operatorIds.some(id => typeof id === "string" && id.trim() !== "");
  return value && !hasOperator
    ? [
        `sessionManager.backlogPickup needs sessionManager.operatorIds: a ` +
          `promoted backlog item is assigned to the first operator.`,
      ]
    : [];
}

/**
 * Validate every block this plan introduced.
 * @param {object} cfg Parsed `.lisa.config.json`.
 * @returns {string[]} Problems found.
 */
export function validateConfig(cfg) {
  return [
    ...validateSecrets(cfg.secrets),
    ...validateRemoteEnv(cfg.remoteEnv),
    ...validateAutomations(cfg.automations, cfg.remoteEnv),
    ...validateSessionManager(cfg.sessionManager),
  ];
}

/** Keys a parsed JSON layer may not contribute to a merged object. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Merge config layers key by key, later layers winning — the
 * `config-resolution` rule for `.lisa.config.local.json` over
 * `.lisa.config.json`.
 *
 * Plain objects merge recursively; arrays and scalars are replaced, never
 * concatenated: a local `hints` list means "these hints", not "these as well".
 * Prototype keys are dropped, since a layer is parsed JSON. The session
 * manager's runtime resolver uses this same function, so validation and the
 * runtime can never disagree about what a local override means.
 * @param {...unknown} layers Lowest precedence first.
 * @returns {Record<string, unknown>} A new object; no layer is mutated.
 */
export function mergeConfigLayers(...layers) {
  const objects = layers.filter(isPlainObject);
  const keys = [...new Set(objects.flatMap(Object.keys))].filter(
    key => !UNSAFE_KEYS.has(key)
  );
  return Object.fromEntries(
    keys.map(key => {
      const values = objects
        .filter(layer => Object.hasOwn(layer, key))
        .map(layer => layer[key]);
      const top = values.at(-1);
      return [
        key,
        isPlainObject(top)
          ? mergeConfigLayers(...values.filter(isPlainObject))
          : top,
      ];
    })
  );
}

/**
 * Read a JSON file, or undefined when it does not exist.
 * @param {string} file Absolute path.
 * @returns {unknown} Parsed contents, or undefined.
 */
function readJsonIfPresent(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/**
 * Read the config this CLI validates from a project root.
 *
 * `sessionManager` is merged local over committed (deep, per key), because
 * that is how the runtime resolves it and a bad local override must fail here,
 * not at runtime. Every other block is read from `.lisa.config.json` alone,
 * exactly as before, so their validation is unchanged.
 * @param {string} root Project root.
 * @returns {Record<string, unknown> | null} Config to validate, or null when
 *   neither file exists.
 */
export function readValidationConfig(root) {
  const committed = readJsonIfPresent(join(root, ".lisa.config.json"));
  const local = readJsonIfPresent(join(root, ".lisa.config.local.json"));
  if (committed === undefined && local === undefined) return null;
  const base = isPlainObject(committed) ? committed : {};
  const blocks = [base.sessionManager, local?.sessionManager].filter(
    isPlainObject
  );
  if (blocks.length === 0) return base;
  return { ...base, sessionManager: mergeConfigLayers(...blocks) };
}

function main() {
  const cfg = readValidationConfig(process.cwd());
  if (cfg === null) {
    console.log("no .lisa.config.json — nothing to validate");
    return;
  }
  const problems = validateConfig(cfg);
  if (!problems.length) {
    console.log(
      "config: secrets, remoteEnv, automations and sessionManager blocks are well-formed"
    );
    return;
  }
  for (const problem of problems) console.error(`  ${problem}`);
  throw new Error(`${problems.length} configuration problem(s)`);
}

/**
 * Whether this module is the one node was asked to run.
 *
 * Both sides are realpath'd: a raw URL comparison answers "no" through a
 * symlinked checkout, a git worktree, or a /tmp path on macOS, so the module
 * loads, runs nothing and exits 0 — a silent no-op that reads as success.
 *
 * A local copy rather than an import: plugin payload scripts ship standalone,
 * with no `lib/` sibling to import from once installed.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
