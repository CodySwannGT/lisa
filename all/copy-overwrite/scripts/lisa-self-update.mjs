#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Open this project's own Lisa update pull request (CodySwannGT/lisa#4325).
 *
 * A host project never moved forward on its own: the only update path was a
 * person running the fleet update from the Lisa checkout, so projects sat many
 * releases behind with nothing saying so. This script is the pull half. The
 * scheduled `.github/workflows/lisa-update.yml` runs it; it can also be run by
 * hand with `--dry-run` to see what it would do.
 *
 * What it does, in order:
 *
 * 1. Compares the installed `@codyswann/lisa` with npm latest. Current → exit 0.
 * 2. Bumps the dependency with the package manager the project's `engines`
 *    field allows (a `please-use-*` sentinel is authoritative; lockfiles only
 *    break a tie), and commits that.
 * 3. Runs the FULL explicit apply. Installs never apply templates
 *    (CodySwannGT/lisa#4135), so a bump without this step would land a version
 *    whose templates, guardrails and migrations never arrived (#2763).
 * 4. Proves the apply ran — `.lisa/apply-receipt.json` must name the new
 *    version and `"apply_mode": "full"` — and commits the template diff.
 * 5. Pushes `lisa/update-<version>`, opens (or reuses) the pull request,
 *    closes older `lisa/update-*` pull requests as superseded, and arms
 *    auto-merge with a merge method the repository allows.
 *
 * The pull request goes through every gate a human change does. Nothing here
 * merges, approves, or skips a check. A project that tracks work in GitHub
 * Issues gets a fresh work item per update (trailer, PR line and backlink), so
 * a traceability gate is satisfied rather than bypassed; elsewhere,
 * `LISA_UPDATE_WORK_ITEM` names one.
 *
 * In Lisa's own repository (self mode, CodySwannGT/lisa#4331) the same flow
 * moves Lisa's dependency on its published self after each release: no template
 * apply, a caret floor, and a loop guard so a self-bump never chases the release
 * its own merge cuts.
 * @module scripts/lisa-self-update
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The package this script keeps current. */
export const LISA_PACKAGE = "@codyswann/lisa";

/** Branch prefix every update pull request uses; supersession keys on it. */
export const BRANCH_PREFIX = "lisa/update-";

/** The manifest every package-manager decision reads. */
const MANIFEST = "package.json";

/** Flags this script accepts. Anything else is refused, never ignored. */
const KNOWN_FLAGS = new Set(["--dry-run", "--help"]);

/** Package managers in lockfile-tiebreak order. */
const LOCKFILES = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** Merge methods in preference order, with the REST setting that allows each. */
const MERGE_METHODS = [
  ["--merge", "allow_merge_commit"],
  ["--squash", "allow_squash_merge"],
  ["--rebase", "allow_rebase_merge"],
];

/**
 * Parse argv strictly: an unknown flag is an error, because a typo that
 * silently dropped `--dry-run` would push a real branch.
 * @param {readonly string[]} argv Arguments after the script path.
 * @returns {{dryRun: boolean, help: boolean}} Parsed options.
 */
export function parseFlags(argv) {
  const unknown = argv.filter(arg => !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(
      `lisa-self-update: unknown argument(s) ${unknown.join(", ")}. Accepted: ${[...KNOWN_FLAGS].join(", ")}.`
    );
  }
  return { dryRun: argv.includes("--dry-run"), help: argv.includes("--help") };
}

/**
 * Whether a project declares Lisa as a dependency it can update.
 * @param {Record<string, any> | null} manifest Parsed package.json.
 * @returns {boolean} True when the project consumes Lisa from npm.
 */
export function declaresLisa(manifest) {
  if (!manifest || manifest.name === LISA_PACKAGE) return false;
  return Boolean(
    manifest.devDependencies?.[LISA_PACKAGE] ??
    manifest.dependencies?.[LISA_PACKAGE]
  );
}

/**
 * Whether this manifest IS Lisa — the repository that publishes the package.
 *
 * Lisa depends on a published copy of itself, and that pin is the one no other
 * automation corrects: `lisa apply` deliberately skips the self-pin phase on
 * its own manifest (CodySwannGT/lisa#3768). Self mode updates it the same way
 * a host is updated, minus the template apply Lisa never runs on itself.
 * @param {Record<string, any> | null} manifest Parsed package.json.
 * @returns {boolean} True for Lisa's own repository.
 */
export function isSelfManifest(manifest) {
  return manifest?.name === LISA_PACKAGE;
}

/** Subject of the commit a self-update makes; the loop guard keys on it. */
export function selfBumpSubject(version) {
  return `chore(deps): update ${LISA_PACKAGE} self-dependency to ${version}`;
}

/** A release-bot commit, in either form Lisa's release workflow has emitted. */
const RELEASE_SUBJECT = /^chore\(release\): \S+ \[skip ci\](?: \[skip-cd\])?$/u;

/** A self-update commit made by {@link selfBumpSubject}. */
const SELF_BUMP_SUBJECT =
  /^chore\(deps\): update @codyswann\/lisa self-dependency to \S+$/u;

/**
 * The loop guard. Every merge to Lisa's `main` cuts a release, so merging a
 * self-bump publishes a NEWER version than the one it pinned — and an updater
 * that chased it would open a bump, merge it, release, and bump again forever.
 * When everything a release added since the pinned one is release commits and
 * self-bumps, the two differ only by the pin itself, and the pin is current.
 * @param {readonly string[]} subjects Non-merge commit subjects between the tags.
 * @returns {boolean} True when the newer release carries nothing else.
 */
export function onlySelfBumps(subjects) {
  return subjects.every(
    subject => RELEASE_SUBJECT.test(subject) || SELF_BUMP_SUBJECT.test(subject)
  );
}

/**
 * The version Lisa should pin itself to. Its own `package.json` names the
 * release `main` just cut; once npm serves that exact version it is the
 * target, which beats waiting minutes for the cached `latest` pointer to move
 * (CodySwannGT/lisa#3685). Until then, npm latest.
 * @param {string | undefined} own Version in Lisa's own manifest.
 * @param {boolean} ownPublished Whether npm serves that exact version.
 * @param {string | null} npmLatest npm's `latest`.
 * @returns {string | null} Target version.
 */
export function chooseSelfTarget(own, ownPublished, npmLatest) {
  if (!own || !ownPublished) return npmLatest;
  if (!npmLatest) return own;
  return isOlder(own, npmLatest) ? npmLatest : own;
}

/**
 * Choose the package manager. `engines` is authoritative: a value of
 * `please-use-<pm>` names the only allowed manager, and any manager whose own
 * entry is such a sentinel is forbidden. Lockfiles break the remaining tie.
 * @param {Record<string, string> | undefined} engines The `engines` field.
 * @param {readonly string[]} lockfiles Lockfile names present at the root.
 * @returns {"bun" | "npm" | "pnpm" | "yarn"} The manager to run.
 */
export function choosePackageManager(engines, lockfiles) {
  const entries = Object.entries(engines ?? {});
  const named = entries
    .map(([, value]) => /^please-use-(bun|npm|pnpm|yarn)$/u.exec(String(value)))
    .find(Boolean);
  if (named) return /** @type {any} */ (named[1]);
  const forbidden = new Set(
    entries
      .filter(([, value]) => String(value).startsWith("please-use-"))
      .map(([key]) => key)
  );
  const fromLock = LOCKFILES.find(
    ([file, manager]) => lockfiles.includes(file) && !forbidden.has(manager)
  );
  return /** @type {any} */ (fromLock ? fromLock[1] : "npm");
}

/**
 * The commands that install the current lockfile and bump Lisa.
 * @param {"bun" | "npm" | "pnpm" | "yarn"} manager Package manager.
 * @param {string} version Target version.
 * @param {string} [range] Range operator to write, e.g. `^` for Lisa's own
 *   caret floor; a host gets the exact version its manager records.
 * @returns {{install: string[], bump: string[]}} argv arrays.
 */
export function packageCommands(manager, version, range = "") {
  const spec = `${LISA_PACKAGE}@${range}${version}`;
  const table = {
    bun: {
      install: ["bun", "install", "--frozen-lockfile"],
      bump: ["bun", "add", "-D", spec],
    },
    npm: { install: ["npm", "ci"], bump: ["npm", "install", "-D", spec] },
    pnpm: {
      install: ["pnpm", "install", "--frozen-lockfile"],
      bump: ["pnpm", "add", "-D", spec],
    },
    yarn: {
      install: ["yarn", "install", "--immutable"],
      bump: ["yarn", "add", "-D", spec],
    },
  };
  return table[manager];
}

/**
 * Numeric `major.minor.patch` of a version; anything unparseable is 0, so an
 * unreadable version can never look newer than a readable one.
 * @param {string} version Version string.
 * @returns {number[]} Three numbers.
 */
function release(version) {
  const parts = String(version).split(/[-+]/u)[0].split(".");
  return [0, 1, 2].map(index =>
    /^\d+$/u.test(parts[index] ?? "") ? Number(parts[index]) : 0
  );
}

/**
 * Whether `a` is an older release than `b`.
 * @param {string} a Candidate older version.
 * @param {string} b Candidate newer version.
 * @returns {boolean} True when `a` precedes `b`.
 */
export function isOlder(a, b) {
  const left = release(a);
  const right = release(b);
  const index = left.findIndex((value, i) => value !== right[i]);
  if (index !== -1) return left[index] < right[index];
  // Same release: a prerelease of it is older than the release itself
  // (`4.66.5-rc.1` → `4.66.5`). npm `latest` is never a prerelease, so two
  // prereleases are not compared here.
  return prerelease(a) !== "" && prerelease(b) === "";
}

/**
 * The prerelease suffix of a version, without build metadata.
 * @param {string} version Version string.
 * @returns {string} The suffix, or "" for a release.
 */
function prerelease(version) {
  const core = String(version).split("+")[0];
  const dash = core.indexOf("-");
  return dash === -1 ? "" : core.slice(dash + 1);
}

/**
 * Decide what this run does.
 * @param {{declares: boolean, installed: string | null, latest: string | null}} input Facts.
 * @returns {{action: "skip", reason: string} | {action: "update", from: string, to: string, branch: string}} The plan.
 */
export function planUpdate(input) {
  if (!input.declares) {
    return {
      action: "skip",
      reason:
        "this project does not install @codyswann/lisa from npm, so there is nothing to update.",
    };
  }
  if (!input.installed) {
    return {
      action: "skip",
      reason:
        "the installed Lisa version could not be read after install; refusing to guess.",
    };
  }
  if (!input.latest) {
    return {
      action: "skip",
      reason: "npm did not answer with a latest version; try again later.",
    };
  }
  if (!isOlder(input.installed, input.latest)) {
    return {
      action: "skip",
      reason: `Lisa is current (${input.installed}).`,
    };
  }
  return {
    action: "update",
    from: input.installed,
    to: input.latest,
    branch: `${BRANCH_PREFIX}${input.latest}`,
  };
}

/**
 * The base branch the update targets: the lowest environment in
 * `deploy.order`, else the only configured deploy branch, else the default.
 * @param {Record<string, any> | null} config Parsed `.lisa.config.json`.
 * @param {string} defaultBranch Repository default branch.
 * @returns {string} Base branch name.
 */
export function chooseBase(config, defaultBranch) {
  const branches = config?.deploy?.branches;
  if (!branches || typeof branches !== "object") return defaultBranch;
  const lowest = Array.isArray(config.deploy.order)
    ? config.deploy.order.find(env => typeof branches[env] === "string")
    : undefined;
  if (lowest) return branches[lowest];
  const values = Object.values(branches).filter(v => typeof v === "string");
  return values.length === 1 ? values[0] : defaultBranch;
}

/**
 * The `gh pr merge` flag for the first method the repository allows.
 * @param {Record<string, unknown>} settings REST repository settings.
 * @returns {string | null} Flag, or null when auto-merge cannot be armed.
 */
export function chooseMergeFlag(settings) {
  if (settings.allow_auto_merge !== true) return null;
  const allowed = MERGE_METHODS.find(([, key]) => settings[key] === true);
  return allowed ? allowed[0] : null;
}

/**
 * Open update pull requests other than the one this run owns.
 * @param {readonly {number: number, headRefName: string}[]} open Open PRs.
 * @param {string} branch This run's branch.
 * @returns {number[]} PR numbers to close as superseded.
 */
export function supersededPullRequests(open, branch) {
  return open
    .filter(
      pr =>
        pr.headRefName.startsWith(BRANCH_PREFIX) && pr.headRefName !== branch
    )
    .map(pr => pr.number);
}

/**
 * Commit message, with the optional standing work-item trailer.
 * @param {string} subject Conventional subject.
 * @param {string} body Paragraph explaining the change.
 * @param {string | undefined} workItem The update's work item, if any.
 * @returns {string} Full message.
 */
export function commitMessage(subject, body, workItem) {
  const trailer = workItem ? `\n\nWork-Item: ${workItem}` : "";
  return `${subject}\n\n${body}${trailer}\n`;
}

/**
 * Pull request body, written for a non-technical reader.
 * @param {{from: string, to: string}} plan The update.
 * @param {string | undefined} workItem The update's work item, if any.
 * @param {boolean} [selfMode] Whether this is Lisa updating itself.
 * @returns {string} Markdown body.
 */
export function pullRequestBody(plan, workItem, selfMode = false) {
  const what = selfMode
    ? `This updates the copy of Lisa that Lisa itself is built and checked with, from **${plan.from}** to **${plan.to}**, so its own checks run the guardrails it ships.`
    : `This updates Lisa, the project's engineering guardrails, from **${plan.from}** to **${plan.to}**.`;
  const contents = selfMode
    ? "It was opened automatically after a release. It contains one commit, the dependency bump; Lisa does not apply its own templates to itself."
    : "It was opened automatically by the scheduled Lisa Update workflow. It contains two commits: the dependency bump, and the template changes Lisa applies for the new version.";
  const lines = [
    what,
    "",
    `${contents} It goes through every check a normal change does and merges itself only when they all pass.`,
    "",
    `Release notes: https://github.com/CodySwannGT/lisa/releases/tag/v${plan.to}`,
  ];
  if (workItem) {
    lines.push("", `Work-Item: ${workItem}`);
  } else {
    lines.push(
      "",
      "If this project requires every change to reference a work item and does not track work in GitHub Issues, set the repository variable `LISA_UPDATE_WORK_ITEM` to an open work item for the next update. Projects that track work in GitHub Issues get a fresh work item for each update automatically."
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Labels for a per-update work item, from the project's own lifecycle config.
 *
 * A fresh item per update, never a standing one: merging into the production
 * branch completes the item it names, so a standing item is closed by the first
 * update and refuses every later one.
 * @param {Record<string, any> | null} config Parsed `.lisa.config.json`.
 * @returns {{ready: string, claimed: string, repo: string} | null} Labels, or
 *   null when the project does not track work in GitHub Issues.
 */
export function workItemLabels(config) {
  if (config?.tracker !== "github" || !config.github?.repo) return null;
  const build = config.github.labels?.build ?? {};
  return {
    ready: build.ready ?? "status:ready",
    claimed: build.claimed ?? "status:in-progress",
    repo: `repo:${config.github.repo}`,
  };
}

/**
 * Body of a per-update work item, written for a non-technical reader.
 * @param {{from: string, to: string}} plan The update.
 * @param {boolean} selfMode Whether this is Lisa updating itself.
 * @returns {string} Markdown body.
 */
export function workItemBody(plan, selfMode) {
  const subject = selfMode
    ? "the copy of Lisa this repository builds with"
    : "Lisa";
  return [
    "Filed by: lisa-self-update (automated).",
    "",
    "## Context / Business Value",
    "",
    `Lisa ${plan.to} is published and this repository uses ${plan.from}. Keeping ${subject} current means the newest guardrails and fixes apply here.`,
    "",
    "## Acceptance Criteria",
    "",
    "```gherkin",
    "Scenario: the update lands",
    `  Given ${subject} is ${plan.from}`,
    "  When the update pull request merges after every required check passes",
    `  Then ${subject} is ${plan.to}`,
    "```",
    "",
    "## Target Backend Environment",
    "",
    "None — no runtime behavior change: config-only",
    "",
  ].join("\n");
}

/**
 * Proof the full apply ran for the target version.
 * @param {Record<string, any> | null} receipt Parsed `.lisa/apply-receipt.json`.
 * @param {string} version Target version.
 * @returns {string | null} A failure reason, or null when proven.
 */
export function receiptProblem(receipt, version) {
  if (!receipt) return "the apply wrote no .lisa/apply-receipt.json";
  if (receipt.lisa_version !== version) {
    return `the apply receipt names ${receipt.lisa_version}, not ${version}`;
  }
  if (receipt.apply_mode !== "full") {
    return `the apply ran in "${receipt.apply_mode}" mode, not "full", so agent emits and migrations were skipped`;
  }
  return null;
}

/**
 * Read and parse a JSON file, or null.
 * @param {string} file Absolute path.
 * @returns {any} Parsed value or null.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Variables that can carry the GitHub credential; never inherited by default. */
const TOKEN_VARS = ["LISA_UPDATE_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

/**
 * An environment with every GitHub credential removed.
 * @param {NodeJS.ProcessEnv} env Source environment.
 * @returns {NodeJS.ProcessEnv} A copy without credentials.
 */
export function withoutToken(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !TOKEN_VARS.includes(key))
  );
}

/**
 * The environment one command runs with: the credential reaches only the
 * commands that talk to GitHub. Installs, the bump and the apply run without
 * it, because they execute dependency lifecycle scripts, and a compromised
 * release must not be able to read a token that can push and merge. `gh` gets
 * `GH_TOKEN`; git fetch and push get an auth header through git's environment
 * config (never argv, which other processes can read); the work-item backlink
 * shells out to `gh`.
 * @param {readonly string[]} argv Command and arguments.
 * @param {NodeJS.ProcessEnv | undefined} env Environment the caller supplied.
 * @param {string | undefined} token GitHub credential, if any.
 * @returns {NodeJS.ProcessEnv} The environment to spawn with.
 */
export function commandEnv(argv, env, token) {
  const base = withoutToken(env ?? process.env);
  if (!token) return base;
  const talksToGithub =
    argv[0] === "gh" || (argv[0] === "node" && argv.includes("backlink"));
  if (talksToGithub) return { ...base, GH_TOKEN: token };
  if (argv[0] === "git" && (argv[1] === "fetch" || argv[1] === "push")) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return {
      ...base,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    };
  }
  return base;
}

/**
 * Run a command, inheriting nothing but the environment given.
 * @param {string[]} argv Command and arguments.
 * @param {{cwd: string, env?: NodeJS.ProcessEnv}} options Spawn options.
 * @returns {Promise<string>} Trimmed stdout.
 */
export function runCommand(argv, options) {
  return new Promise((resolve, reject) => {
    execFile(
      argv[0],
      argv.slice(1),
      {
        cwd: options.cwd,
        env: options.env ?? withoutToken(process.env),
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `\`${argv.join(" ")}\` failed: ${String(stderr || error.message).trim()}`
            )
          );
          return;
        }
        resolve(String(stdout).trim());
      }
    );
  });
}

/**
 * Gather the facts a plan needs, installing the base branch first.
 * @param {{root: string, run: typeof runCommand, log: (line: string) => void}} ctx Context.
 * @returns {Promise<object>} Facts.
 */
async function gatherFacts(ctx) {
  const manifest = readJson(path.join(ctx.root, MANIFEST));
  const selfMode = isSelfManifest(manifest);
  const declares = selfMode || declaresLisa(manifest);
  if (!declares) return { declares, manifest, selfMode };
  const manager = choosePackageManager(
    manifest.engines,
    LOCKFILES.map(([file]) => file).filter(file =>
      existsSync(path.join(ctx.root, file))
    )
  );
  // probe-direction: neutral — an unanswered registry query yields no target,
  // and planUpdate turns that into a reported skip; nothing is gated on it.
  const view = spec =>
    ctx
      .run(["npm", "view", spec, "version"], { cwd: ctx.root })
      .catch(() => null);
  const npmLatest = await view(LISA_PACKAGE);
  const latest = selfMode
    ? chooseSelfTarget(
        manifest.version,
        (await view(`${LISA_PACKAGE}@${manifest.version}`)) ===
          manifest.version,
        npmLatest
      )
    : npmLatest;
  if (!ctx.dryRun) {
    ctx.log(`Installing the current lockfile with ${manager}…`);
    await ctx.run(packageCommands(manager, latest ?? "latest").install, {
      cwd: ctx.root,
    });
  }
  const installed =
    readJson(
      path.join(ctx.root, "node_modules", "@codyswann", "lisa", MANIFEST)
    )?.version ?? null;
  return { declares, manifest, manager, latest, installed, selfMode };
}

/**
 * Apply the loop guard to a self-update plan (see {@link onlySelfBumps}).
 *
 * A missing tag is an error, never a pass: an unreadable range cannot show the
 * newer release is only a self-bump, and treating it as one would stop Lisa
 * updating itself with nothing saying so.
 * @param {object} ctx Context.
 * @param {{from: string, to: string}} plan The planned update.
 * @returns {Promise<boolean>} True when the pin is effectively current.
 */
async function pinIsEffectivelyCurrent(ctx, plan) {
  await ctx.run(["git", "fetch", "--tags", "--quiet", "origin"], {
    cwd: ctx.root,
  });
  const log = await ctx.run(
    ["git", "log", "--no-merges", "--format=%s", `v${plan.from}..v${plan.to}`],
    { cwd: ctx.root }
  );
  return onlySelfBumps(log.split("\n").filter(Boolean));
}

/**
 * Create a fresh work item for this update when the project tracks work in
 * GitHub Issues and none was supplied. Filed into the ready role, then claimed,
 * as every work item is. Jira and Linear projects use `LISA_UPDATE_WORK_ITEM`.
 * @param {object} ctx Context.
 * @param {{from: string, to: string}} plan The update.
 * @param {boolean} selfMode Whether this is Lisa updating itself.
 * @returns {Promise<string | undefined>} `owner/repo#N`, or undefined.
 */
async function resolveWorkItem(ctx, plan, selfMode) {
  if (ctx.workItem) return ctx.workItem;
  const labels = workItemLabels(
    readJson(path.join(ctx.root, ".lisa.config.json"))
  );
  if (!labels) return undefined;
  const title = selfMode
    ? `Update Lisa's own self-dependency to ${plan.to}`
    : `Update Lisa to ${plan.to}`;
  const url = await ctx.run(
    [
      "gh",
      "issue",
      "create",
      "--repo",
      ctx.repo,
      "--title",
      title,
      "--body",
      workItemBody(plan, selfMode),
      "--label",
      "type:Task",
      "--label",
      labels.repo,
      "--label",
      labels.ready,
    ],
    { cwd: ctx.root }
  );
  const number = /\/issues\/(\d+)$/u.exec(url)?.[1];
  if (!number)
    throw new Error(
      `lisa-self-update: could not read the work item created at ${url}.`
    );
  await ctx.run(
    [
      "gh",
      "issue",
      "edit",
      number,
      "--repo",
      ctx.repo,
      "--remove-label",
      labels.ready,
      "--add-label",
      labels.claimed,
    ],
    { cwd: ctx.root }
  );
  ctx.log(`Filed work item ${ctx.repo}#${number} for this update.`);
  return `${ctx.repo}#${number}`;
}

/**
 * Post the managed `[lisa-pr-link]` backlink from the work item to the PR,
 * through the project's own work-item tool so its format never drifts.
 * @param {object} ctx Context.
 * @param {string} url Pull request URL.
 * @returns {Promise<void>} Resolves once the backlink is posted.
 */
async function backlink(ctx, url) {
  const tool = [
    "scripts/lisa-work-item.mjs",
    "all/copy-overwrite/scripts/lisa-work-item.mjs",
  ].find(candidate => existsSync(path.join(ctx.root, candidate)));
  if (!tool) {
    ctx.log(
      "No lisa-work-item.mjs here, so the work item was not backlinked to the pull request."
    );
    return;
  }
  await ctx.run(
    ["node", tool, "backlink", "--ref", ctx.workItem, "--pr-url", url],
    { cwd: ctx.root }
  );
}

/**
 * The open pull request already carrying this update, if any. Checked before
 * anything is filed or built, so a re-run reuses it instead of duplicating it.
 * @param {object} ctx Context.
 * @param {string} branch Update branch.
 * @returns {Promise<string>} Its URL, or "".
 */
function openUpdatePullRequest(ctx, branch) {
  return ctx.run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      ctx.repo,
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      '.[0].url // ""',
    ],
    { cwd: ctx.root }
  );
}

/**
 * Self mode's single commit: bump the caret floor, prove the install, commit.
 * Lisa never applies its own templates to itself, so there is no apply step.
 * @param {object} ctx Context.
 * @param {{from: string, to: string}} plan The update.
 * @param {string} manager Package manager.
 * @returns {Promise<void>} Resolves when the commit exists.
 */
async function buildSelfBump(ctx, plan, manager) {
  const { root, run, workItem } = ctx;
  await run(packageCommands(manager, plan.to, "^").bump, { cwd: root });
  const installed = readJson(
    path.join(root, "node_modules", "@codyswann", "lisa", MANIFEST)
  )?.version;
  if (installed !== plan.to) {
    throw new Error(
      `lisa-self-update: the bump installed ${installed ?? "nothing"}, not ${plan.to}.`
    );
  }
  await run(
    [
      "git",
      "add",
      MANIFEST,
      ...LOCKFILES.map(([file]) => file).filter(file =>
        existsSync(path.join(root, file))
      ),
    ],
    { cwd: root }
  );
  await run(
    [
      "git",
      "commit",
      "-m",
      commitMessage(
        selfBumpSubject(plan.to),
        `Moves the copy of Lisa this repository builds and checks with from ${plan.from} to ${plan.to}.`,
        workItem
      ),
    ],
    { cwd: root }
  );
}

/**
 * Bump, apply, prove, and commit on the update branch.
 * @param {object} ctx Context.
 * @param {{from: string, to: string, branch: string}} plan The update.
 * @param {string} manager Package manager.
 * @param {boolean} [selfMode] Whether this is Lisa updating itself.
 * @returns {Promise<void>} Resolves when the commits exist.
 */
async function buildBranch(ctx, plan, manager, selfMode = false) {
  const { root, run, workItem } = ctx;
  await run(["git", "checkout", "-B", plan.branch], { cwd: root });
  if (selfMode) {
    await buildSelfBump(ctx, plan, manager);
    return;
  }
  await run(packageCommands(manager, plan.to).bump, { cwd: root });
  await run(["git", "add", "-A"], { cwd: root });
  await run(
    [
      "git",
      "commit",
      "-m",
      commitMessage(
        `chore(deps): update ${LISA_PACKAGE} to ${plan.to}`,
        `Bumps Lisa from ${plan.from} to ${plan.to}.`,
        workItem
      ),
    ],
    { cwd: root }
  );
  await run(
    ["node", "node_modules/@codyswann/lisa/dist/index.js", "--yes", "."],
    { cwd: root, env: { ...process.env, LISA_BOOTSTRAP: "1" } }
  );
  const problem = receiptProblem(
    readJson(path.join(root, ".lisa", "apply-receipt.json")),
    plan.to
  );
  if (problem) throw new Error(`lisa-self-update: ${problem}.`);
  await run(["git", "add", "-A"], { cwd: root });
  const staged = await run(["git", "diff", "--cached", "--name-only"], {
    cwd: root,
  });
  if (staged) {
    await run(
      [
        "git",
        "commit",
        "-m",
        commitMessage(
          `chore: apply Lisa ${plan.to} templates`,
          `Template, guardrail and migration changes from \`lisa apply\` at ${plan.to}.`,
          workItem
        ),
      ],
      { cwd: root }
    );
  }
}

/**
 * Push, open or reuse the PR, close superseded ones, and arm auto-merge.
 * @param {object} ctx Context.
 * @param {{from: string, to: string, branch: string}} plan The update.
 * @param {string} base Base branch.
 * @returns {Promise<string>} The pull request URL.
 */
async function publish(ctx, plan, base, selfMode = false) {
  const { root, run, repo, workItem } = ctx;
  await run(["git", "push", "--force", "-u", "origin", plan.branch], {
    cwd: root,
  });
  const title = selfMode
    ? selfBumpSubject(plan.to)
    : `chore(deps): update Lisa to ${plan.to}`;
  const url = await run(
    [
      "gh",
      "pr",
      "create",
      "--repo",
      repo,
      "--base",
      base,
      "--head",
      plan.branch,
      "--title",
      title,
      "--body",
      pullRequestBody(plan, workItem, selfMode),
    ],
    { cwd: root }
  );
  if (workItem) await backlink(ctx, url);
  await closeSupersededPullRequests(ctx, plan, url);
  await armAutoMerge(ctx, url);
  return url;
}

/**
 * Close every other open update pull request as superseded by `url`.
 *
 * Runs for a newly opened AND a reused pull request: a run that stopped after
 * `gh pr create` would otherwise leave older update PRs open forever, because
 * every later run takes the reuse path.
 * @param {object} ctx Context.
 * @param {{to: string, branch: string}} plan The update.
 * @param {string} url The pull request carrying this update.
 * @returns {Promise<void>} Resolves once every superseded PR is closed.
 */
async function closeSupersededPullRequests(ctx, plan, url) {
  const { root, run, repo, log } = ctx;
  const open = JSON.parse(
    await run(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--search",
        `head:${BRANCH_PREFIX}`,
        "--json",
        "number,headRefName",
      ],
      { cwd: root }
    )
  );
  for (const number of supersededPullRequests(open, plan.branch)) {
    await run(
      [
        "gh",
        "pr",
        "close",
        String(number),
        "--repo",
        repo,
        "--delete-branch",
        "--comment",
        `Superseded by ${url} (Lisa ${plan.to}).`,
      ],
      { cwd: root }
    );
    log(`Closed superseded pull request #${number}.`);
  }
}

/**
 * Arm auto-merge with the first method the repository allows, or say why not.
 * @param {object} ctx Context.
 * @param {string} url Pull request URL.
 * @returns {Promise<void>} Resolves once armed or reported.
 */
async function armAutoMerge(ctx, url) {
  const settings = JSON.parse(
    await ctx.run(["gh", "api", `repos/${ctx.repo}`], { cwd: ctx.root })
  );
  const flag = chooseMergeFlag(settings);
  if (flag) {
    await ctx.run(["gh", "pr", "merge", url, "--auto", flag], {
      cwd: ctx.root,
    });
    ctx.log(
      `Auto-merge armed (${flag}); the pull request merges when its checks pass.`
    );
  } else {
    ctx.log(
      "Auto-merge is not enabled for this repository, so the pull request stays open for someone to merge once its checks pass."
    );
  }
}

/**
 * Start from the tip of the base branch, whatever the workflow checked out.
 * @param {object} ctx Context.
 * @param {string} base Base branch.
 * @returns {Promise<void>} Resolves when HEAD is the base tip.
 */
async function checkoutBase(ctx, base) {
  await ctx.run(["git", "fetch", "origin", base], { cwd: ctx.root });
  await ctx.run(["git", "checkout", "-B", base, `origin/${base}`], {
    cwd: ctx.root,
  });
}

/**
 * Run the whole flow.
 * @param {{root: string, repo: string, dryRun: boolean, workItem?: string, token?: string, run?: typeof runCommand, log?: (line: string) => void, defaultBranch?: string}} options Options.
 * @returns {Promise<number>} Exit code.
 */
export async function main(options) {
  const ctx = {
    run: (argv, opts) =>
      runCommand(argv, {
        ...opts,
        env: commandEnv(argv, opts?.env, options.token),
      }),
    log: line => console.log(line),
    ...options,
  };
  const base = chooseBase(
    readJson(path.join(ctx.root, ".lisa.config.json")),
    ctx.defaultBranch ?? "main"
  );
  if (!ctx.dryRun) await checkoutBase(ctx, base);
  const facts = await gatherFacts(ctx);
  const plan = planUpdate(facts);
  if (plan.action === "skip") {
    ctx.log(`lisa-self-update: nothing to do — ${plan.reason}`);
    return 0;
  }
  if (facts.selfMode && (await pinIsEffectivelyCurrent(ctx, plan))) {
    ctx.log(
      `lisa-self-update: nothing to do — the self-dependency is effectively current: ${plan.to} differs from ${plan.from} only by release and self-bump commits.`
    );
    return 0;
  }
  ctx.log(
    `lisa-self-update: Lisa ${plan.from} → ${plan.to}; branch ${plan.branch} into ${base}.`
  );
  if (ctx.dryRun) {
    const steps = facts.selfMode
      ? "bump the self-dependency (no template apply)"
      : "run the full apply";
    ctx.log(
      `Dry run: would bump with ${facts.manager}, ${steps}, commit, push ${plan.branch}, open a pull request into ${base}, close older ${BRANCH_PREFIX}* pull requests and arm auto-merge.`
    );
    return 0;
  }
  const existing = await openUpdatePullRequest(ctx, plan.branch);
  if (existing) {
    ctx.log(`lisa-self-update: ${existing} already carries this update.`);
    await closeSupersededPullRequests(ctx, plan, existing);
    await armAutoMerge(ctx, existing);
    return 0;
  }
  ctx.workItem = await resolveWorkItem(ctx, plan, facts.selfMode);
  await buildBranch(ctx, plan, facts.manager, facts.selfMode);
  const url = await publish(ctx, plan, base, facts.selfMode);
  ctx.log(`lisa-self-update: update pull request ${url}`);
  return 0;
}

/** CLI entry: reads flags and the workflow's environment. */
export async function runCli() {
  try {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) {
      console.log(
        "Usage: node scripts/lisa-self-update.mjs [--dry-run]\nOpens a pull request updating @codyswann/lisa to npm latest. Needs GITHUB_REPOSITORY and an authenticated gh."
      );
      return;
    }
    const repo = process.env.GITHUB_REPOSITORY ?? "";
    if (!flags.dryRun && !/^[\w.-]+\/[\w.-]+$/u.test(repo)) {
      throw new Error(
        "lisa-self-update: set GITHUB_REPOSITORY to owner/repository."
      );
    }
    process.exitCode = await main({
      root: process.cwd(),
      repo,
      dryRun: flags.dryRun,
      workItem: process.env.LISA_UPDATE_WORK_ITEM || undefined,
      // The workflow passes LISA_UPDATE_TOKEN; a hand run may rely on GH_TOKEN,
      // or on neither, in which case gh and git use their own stored login.
      token: process.env.LISA_UPDATE_TOKEN || process.env.GH_TOKEN || undefined,
      defaultBranch: process.env.LISA_DEFAULT_BRANCH || undefined,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli();
}
