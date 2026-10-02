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
 * merges, approves, or skips a check.
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
 * @returns {{install: string[], bump: string[]}} argv arrays.
 */
export function packageCommands(manager, version) {
  const spec = `${LISA_PACKAGE}@${version}`;
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
 * @param {string | undefined} workItem `LISA_UPDATE_WORK_ITEM`, if set.
 * @returns {string} Full message.
 */
export function commitMessage(subject, body, workItem) {
  const trailer = workItem ? `\n\nWork-Item: ${workItem}` : "";
  return `${subject}\n\n${body}${trailer}\n`;
}

/**
 * Pull request body, written for a non-technical reader.
 * @param {{from: string, to: string}} plan The update.
 * @param {string | undefined} workItem Standing work item, if configured.
 * @returns {string} Markdown body.
 */
export function pullRequestBody(plan, workItem) {
  const lines = [
    `This updates Lisa, the project's engineering guardrails, from **${plan.from}** to **${plan.to}**.`,
    "",
    "It was opened automatically by the scheduled Lisa Update workflow. It contains two commits: the dependency bump, and the template changes Lisa applies for the new version. It goes through every check a normal change does and merges itself only when they all pass.",
    "",
    `Release notes: https://github.com/CodySwannGT/lisa/releases/tag/v${plan.to}`,
  ];
  if (!workItem) {
    lines.push(
      "",
      'If this project requires every change to reference a work item, set the repository variable `LISA_UPDATE_WORK_ITEM` to a standing work item (for example a "Keep Lisa current" ticket) so future update pull requests carry it.'
    );
  }
  return `${lines.join("\n")}\n`;
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
        env: options.env ?? process.env,
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
  const manifest = readJson(path.join(ctx.root, "package.json"));
  const declares = declaresLisa(manifest);
  if (!declares) return { declares, manifest };
  const manager = choosePackageManager(
    manifest.engines,
    LOCKFILES.map(([file]) => file).filter(file =>
      existsSync(path.join(ctx.root, file))
    )
  );
  const latest = await ctx
    .run(["npm", "view", LISA_PACKAGE, "version"], { cwd: ctx.root })
    .catch(() => null);
  if (!ctx.dryRun) {
    ctx.log(`Installing the current lockfile with ${manager}…`);
    await ctx.run(packageCommands(manager, latest ?? "latest").install, {
      cwd: ctx.root,
    });
  }
  const installed =
    readJson(
      path.join(ctx.root, "node_modules", "@codyswann", "lisa", "package.json")
    )?.version ?? null;
  return { declares, manifest, manager, latest, installed };
}

/**
 * Bump, apply, prove, and commit on the update branch.
 * @param {object} ctx Context.
 * @param {{from: string, to: string, branch: string}} plan The update.
 * @param {string} manager Package manager.
 * @returns {Promise<void>} Resolves when both commits exist.
 */
async function buildBranch(ctx, plan, manager) {
  const { root, run, workItem } = ctx;
  await run(["git", "checkout", "-B", plan.branch], { cwd: root });
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
async function publish(ctx, plan, base) {
  const { root, run, repo, log, workItem } = ctx;
  await run(["git", "push", "--force", "-u", "origin", plan.branch], {
    cwd: root,
  });
  const existing = await run(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      repo,
      "--head",
      plan.branch,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      '.[0].url // ""',
    ],
    { cwd: root }
  );
  const url =
    existing ||
    (await run(
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
        `chore(deps): update Lisa to ${plan.to}`,
        "--body",
        pullRequestBody(plan, workItem),
      ],
      { cwd: root }
    ));
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
  const settings = JSON.parse(
    await run(["gh", "api", `repos/${repo}`], { cwd: root })
  );
  const flag = chooseMergeFlag(settings);
  if (flag) {
    await run(["gh", "pr", "merge", url, "--auto", flag], { cwd: root });
    log(
      `Auto-merge armed (${flag}); the pull request merges when its checks pass.`
    );
  } else {
    log(
      "Auto-merge is not enabled for this repository, so the pull request stays open for someone to merge once its checks pass."
    );
  }
  return url;
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
 * @param {{root: string, repo: string, dryRun: boolean, workItem?: string, run?: typeof runCommand, log?: (line: string) => void, defaultBranch?: string}} options Options.
 * @returns {Promise<number>} Exit code.
 */
export async function main(options) {
  const ctx = {
    run: runCommand,
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
  ctx.log(
    `lisa-self-update: Lisa ${plan.from} → ${plan.to}; branch ${plan.branch} into ${base}.`
  );
  if (ctx.dryRun) {
    ctx.log(
      `Dry run: would bump with ${facts.manager}, run the full apply, commit, push ${plan.branch}, open a pull request into ${base}, close older ${BRANCH_PREFIX}* pull requests and arm auto-merge.`
    );
    return 0;
  }
  await buildBranch(ctx, plan, facts.manager);
  const url = await publish(ctx, plan, base);
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
