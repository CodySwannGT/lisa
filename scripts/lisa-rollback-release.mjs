#!/usr/bin/env node
/**
 * Roll back a bad `@codyswann/lisa` release with one command
 * (CodySwannGT/lisa#4605).
 *
 * Fixing forward is how a bad release is recovered. This command is what
 * CONTAINS it while the fix is prepared: it stops new installs from picking up
 * the bad version, and it says so where people look. Without it, the same
 * containment is four hand-typed npm and GitHub commands run under pressure,
 * in the right order, by whoever is on hand — which is exactly when a version
 * gets mistyped or a step gets skipped.
 *
 * ## What it does, in order
 *
 * 1. `npm deprecate <pkg>@<bad> "<reason>"` — anyone installing the bad
 *    version sees the reason.
 * 2. `npm dist-tag add <pkg>@<good> latest` — a plain install gets the good
 *    version again.
 * 3. Prepends a deprecation notice to the GitHub release notes of `v<bad>`.
 * 4. Reads the registry back and exits non-zero unless BOTH registry facts
 *    hold. The exit codes of steps 1 and 2 are not trusted on their own: a
 *    publish that "succeeded" and never reached the registry is a measured
 *    incident here (CodySwannGT/lisa#3684), and a rollback that reports success
 *    without having happened is worse than none.
 *
 * ## Why the read-back uses `?write=true`
 *
 * `npm view`, the plain packument and `/-/package/<pkg>/dist-tags` were all
 * measured serving a version two behind for ~13 minutes after a write
 * (CodySwannGT/lisa#3685), while `?write=true` told the truth. A verification
 * fed a cached answer would fail a rollback that worked, or — worse — pass one
 * that did not. Same endpoint `release.yml` uses for its version guard.
 *
 * ## Credentials
 *
 * CI publishes through npm OIDC trusted publishing, which authorizes
 * `npm publish` only, so a rollback runs under the release owner's own
 * `npm login` and `gh auth login`. Both are checked before the first write and
 * a missing one is named in plain English. The command never reads, prints or
 * stores a token: it only asks `npm whoami` and `gh auth status` whether one
 * works, and discards their output.
 *
 * ## The dry run needs no credentials
 *
 * `--dry-run` reads the public packument to resolve the good version, prints
 * the exact commands, and changes nothing. That is the step an operator runs
 * first, so it must work for someone who has not signed in yet.
 * @module scripts/lisa-rollback-release
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import semver from "semver";

import { boundedSpawnSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Public npm registry, the default for every Lisa release. */
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** The package this command rolls back. */
const DEFAULT_PACKAGE = "@codyswann/lisa";

/** The repository whose GitHub release notes carry the notice. */
const DEFAULT_REPO = "CodySwannGT/lisa";

/** How long one npm or gh call may run before it is killed. */
const COMMAND_BUDGET_MS = 120_000;

/** Read-back attempts, and the pause between them. */
const VERIFY_ATTEMPTS = 5;
const VERIFY_DELAY_MS = 3_000;

/** The registry flag, passed through to every npm call. */
const REGISTRY_FLAG = "--registry";

/** Flags that take a value, mapped to the option they set. */
const VALUE_FLAGS = new Map([
  ["--bad", "bad"],
  ["--to", "to"],
  ["--reason", "reason"],
  [REGISTRY_FLAG, "registry"],
  ["--package", "packageName"],
  ["--repo", "repo"],
]);

/** Shown on any usage error, so the fix is on the same screen. */
const USAGE =
  'Usage: node scripts/lisa-rollback-release.mjs --bad <version> --reason "<text>" [--to <version>] [--dry-run] [--registry <url>]';

/**
 * Read the command line into options.
 *
 * Unknown flags are refused rather than ignored: a mistyped `--dryrun` that is
 * silently dropped turns a rehearsal into a real rollback.
 * @param {string[]} argv - Arguments after the script path.
 * @param {Record<string, string | undefined>} env - Environment to read
 *   `LISA_NPM_REGISTRY` from.
 * @returns {{bad: string, to?: string, reason: string, dryRun: boolean,
 *   registry: string, packageName: string, repo: string}} Parsed options.
 * @throws {Error} On a missing, malformed or unknown argument.
 */
export function parseArgs(argv, env) {
  const values = {};
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }
    const key = VALUE_FLAGS.get(flag);
    const value = argv[index + 1];
    if (key === undefined) throw new Error(`Unknown argument ${flag}`);
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    values[key] = value;
    index += 1;
  }
  return validated(values, dryRun, env);
}

/**
 * Require a version spelled exactly as npm records it. `semver.valid` alone
 * accepts `v4.90.1` and returns `4.90.1`, which npm would not find under that
 * spelling — so the input must equal its own normalised form.
 * @param {string} flag - The flag being checked, for the message.
 * @param {string} value - What was passed.
 * @param {string} example - An example version for the message.
 * @returns {void}
 * @throws {Error} When the value is not an exact version.
 */
function exactVersion(flag, value, example) {
  const normalised = semver.valid(value);
  if (normalised === value) return;
  throw new Error(
    normalised !== null && value.startsWith("v")
      ? `${flag} takes the bare version number: use ${normalised}, not ${value}`
      : `${flag} must be an exact published version, e.g. ${example}`
  );
}

/**
 * Apply defaults and check the parsed values.
 * @param {Record<string, string>} values - Flag values by option name.
 * @param {boolean} dryRun - Whether `--dry-run` was given.
 * @param {Record<string, string | undefined>} env - Environment.
 * @returns {ReturnType<typeof parseArgs>} Complete options.
 */
function validated(values, dryRun, env) {
  exactVersion("--bad", values.bad ?? "", "4.90.1");
  if (values.to !== undefined) exactVersion("--to", values.to, "4.90.0");
  // npm treats an empty deprecation message as "un-deprecate", so a blank
  // reason would silently do the opposite of what was asked.
  if ((values.reason ?? "").trim() === "") {
    throw new Error('--reason is required, e.g. --reason "breaks lisa apply"');
  }
  return {
    bad: values.bad,
    ...(values.to === undefined ? {} : { to: values.to }),
    reason: values.reason,
    dryRun,
    registry: values.registry ?? env.LISA_NPM_REGISTRY ?? DEFAULT_REGISTRY,
    packageName: values.packageName ?? DEFAULT_PACKAGE,
    repo: values.repo ?? DEFAULT_REPO,
  };
}

/**
 * The uncached packument URL — see the module docblock for why only this one.
 * @param {string} registry - Registry origin.
 * @param {string} packageName - Package name, scope included.
 * @returns {string} `<registry>/<scope>%2f<name>?write=true`.
 */
export function packumentUrl(registry, packageName) {
  let origin = registry;
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  return `${origin}/${packageName.replace("/", "%2f")}?write=true`;
}

/**
 * Fetch the uncached packument.
 * @param {{registry: string, packageName: string, fetchImpl: typeof fetch}} input
 *   Where to read and how.
 * @returns {Promise<object>} The packument.
 * @throws {Error} When the registry does not answer with one.
 */
async function readPackument({ registry, packageName, fetchImpl }) {
  const url = packumentUrl(registry, packageName);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  }).catch(error => {
    throw new Error(
      `Could not reach ${registry} to read ${packageName} (${error.cause?.code ?? error.message}).`
    );
  });
  if (!response.ok) {
    throw new Error(
      `Could not read ${packageName} from ${registry} (HTTP ${response.status}).`
    );
  }
  return response.json();
}

/**
 * Choose the version `latest` should point to.
 *
 * Default: the highest published version below `bad` that is neither
 * deprecated nor a prerelease — a prerelease or another deprecated version
 * would trade one bad install for another. An explicit `to` may be a
 * prerelease, because then somebody chose it, but it must be published, not
 * deprecated, and not the bad version itself.
 * @param {{versions?: Record<string, {deprecated?: string}>}} packument - The packument.
 * @param {string} bad - The version being rolled back.
 * @param {string} [to] - An explicit target.
 * @returns {string} The good version.
 * @throws {Error} When no acceptable version exists.
 */
export function resolveGoodVersion(packument, bad, to) {
  const versions = packument.versions ?? {};
  if (!(bad in versions)) throw new Error(`${bad} is not published.`);
  if (to !== undefined) return checkedTarget(versions, bad, to);
  const candidates = Object.keys(versions)
    .filter(version => semver.valid(version) && !semver.prerelease(version))
    .filter(version => semver.lt(version, bad) && !versions[version].deprecated)
    .sort(semver.rcompare);
  if (candidates.length === 0) {
    throw new Error(
      `No published, non-deprecated version below ${bad} to point latest at. Pass --to <version> to choose one.`
    );
  }
  return candidates[0];
}

/**
 * Check an explicit `--to`.
 * @param {Record<string, {deprecated?: string}>} versions - Published versions.
 * @param {string} bad - The version being rolled back.
 * @param {string} to - The requested target.
 * @returns {string} The target, when acceptable.
 */
function checkedTarget(versions, bad, to) {
  if (to === bad) throw new Error("--to is the same version as --bad.");
  if (!(to in versions)) throw new Error(`--to ${to} is not published.`);
  if (versions[to].deprecated) {
    throw new Error(`--to ${to} is itself deprecated; choose another version.`);
  }
  return to;
}

/**
 * Refuse to move `latest` backward past a release that is not the bad one.
 *
 * Rolling back an OLDER version than `latest` would otherwise point `latest`
 * below a newer, good release. Allowed without `--to` only when `latest` is
 * the bad version, or already the good one (a re-run finishing a partial
 * rollback); an explicit `--to` is a deliberate choice and is honoured.
 * @param {{"dist-tags"?: {latest?: string}}} packument - The packument.
 * @param {{bad: string, to?: string}} options - Run options.
 * @param {string} good - Resolved good version.
 * @returns {void}
 * @throws {Error} When the move would go backward unasked.
 */
function refuseBackwardMove(packument, { bad, to }, good) {
  const latest = packument["dist-tags"]?.latest;
  if (to !== undefined || latest === bad || latest === good) return;
  throw new Error(
    `latest is ${String(latest)}, not ${bad}; pass --to <version> to move latest anyway.`
  );
}

/**
 * The notice prepended to the bad release's GitHub notes.
 * @param {string} reason - Why the release was rolled back.
 * @param {string} good - Where `latest` now points.
 * @returns {string} Markdown notice.
 */
export function deprecationNotice(reason, good) {
  return `> **This release is deprecated:** ${reason}\n>\n> npm latest now points to ${good}.\n`;
}

/**
 * The three writes, in the order they must run.
 * @param {{bad: string, good: string, reason: string, registry: string,
 *   packageName: string, repo: string, notesFile: string}} input - What to write.
 * @returns {{command: string, args: string[]}[]} Commands as argv arrays.
 */
export function planCommands({
  bad,
  good,
  reason,
  registry,
  packageName,
  repo,
  notesFile,
}) {
  return [
    {
      command: "npm",
      args: [
        "deprecate",
        `${packageName}@${bad}`,
        reason,
        REGISTRY_FLAG,
        registry,
      ],
    },
    {
      command: "npm",
      args: [
        "dist-tag",
        "add",
        `${packageName}@${good}`,
        "latest",
        REGISTRY_FLAG,
        registry,
      ],
    },
    {
      command: "gh",
      args: [
        "release",
        "edit",
        `v${bad}`,
        "--repo",
        repo,
        "--notes-file",
        notesFile,
      ],
    },
  ];
}

/**
 * Render a command for a human to read or copy. Display only — nothing is
 * ever run through a shell.
 * @param {{command: string, args: string[]}} step - The command.
 * @returns {string} A shell-quoted line.
 */
export function formatCommand({ command, args }) {
  const escapedQuote = "'\\''";
  const quote = arg =>
    /^[\w@%+=:,./-]+$/.test(arg)
      ? arg
      : `'${arg.replaceAll("'", escapedQuote)}'`;
  return [command, ...args].map(quote).join(" ");
}

/**
 * Run a command with no shell, capturing its output.
 * @param {string} command - Executable on PATH.
 * @param {string[]} args - Arguments.
 * @returns {{status: number | null, stdout: string, stderr: string}} Outcome.
 */
function defaultRun(command, args) {
  const result = boundedSpawnSync(command, args, {
    encoding: "utf8",
    timeout: COMMAND_BUDGET_MS,
  });
  return {
    status: result.error ? null : result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

/**
 * Which sign-ins are missing. Output is discarded so nothing about a
 * credential is ever echoed.
 * @param {{registry: string, packageName: string}} options - Run options.
 * @param {typeof defaultRun} run - Command runner.
 * @returns {string[]} Plain-English descriptions of each missing sign-in.
 */
function missingCredentials({ registry, packageName }, run) {
  const missing = [];
  if (run("npm", ["whoami", REGISTRY_FLAG, registry]).status !== 0) {
    missing.push(
      `You are not signed in to npm for ${registry} (\`npm whoami\` failed). Run \`npm login --registry ${registry}\` with an account that can publish ${packageName}.`
    );
  }
  if (run("gh", ["auth", "status"]).status !== 0) {
    missing.push(
      "The GitHub CLI is not signed in (`gh auth status` failed). Run `gh auth login` with an account that can edit this repository's releases."
    );
  }
  return missing;
}

/**
 * Run one write; throw with its output when it fails.
 * @param {{command: string, args: string[]}} step - The write.
 * @param {typeof defaultRun} run - Command runner.
 * @param {(line: string) => void} log - Progress output.
 * @returns {void}
 */
function runStep(step, run, log) {
  log(`$ ${formatCommand(step)}`);
  const result = run(step.command, step.args);
  if (result.status !== 0) {
    throw new Error(
      `This step failed (exit ${String(result.status)}):\n  ${formatCommand(step)}\n${result.stderr}${result.stdout}`
    );
  }
}

/**
 * The bad release's notes with the notice on top. Already-noticed notes are
 * left alone, so a re-run does not stack notices.
 * @param {{bad: string, repo: string}} options - Run options.
 * @param {string} notice - The notice to prepend.
 * @param {typeof defaultRun} run - Command runner.
 * @returns {string | null} New notes, or null when no edit is needed.
 */
function noticedNotes({ bad, repo }, notice, run) {
  const view = run("gh", [
    "release",
    "view",
    `v${bad}`,
    "--repo",
    repo,
    "--json",
    "body",
  ]);
  if (view.status !== 0) {
    throw new Error(
      `Could not read the GitHub release v${bad}:\n${view.stderr}`
    );
  }
  const body = JSON.parse(view.stdout).body ?? "";
  return body.startsWith(notice) ? null : `${notice}\n${body}`;
}

/**
 * Problems with the registry state after a rollback, or none.
 * @param {{"dist-tags"?: {latest?: string}, versions?: Record<string, {deprecated?: string}>}} packument
 *   The uncached packument.
 * @param {string} bad - The rolled-back version.
 * @param {string} good - Where `latest` should point.
 * @returns {string[]} What does not hold yet.
 */
function verificationProblems(packument, bad, good) {
  const problems = [];
  const latest = packument["dist-tags"]?.latest;
  if (latest !== good)
    problems.push(`latest is ${String(latest)}, not ${good}`);
  if (!packument.versions?.[bad]?.deprecated) {
    problems.push(`${bad} is not deprecated`);
  }
  return problems;
}

/**
 * Read the registry back until both facts hold, or give up.
 * @param {object} options - Run options.
 * @param {string} good - Where `latest` should point.
 * @param {object} deps - Injected seams.
 * @returns {Promise<string[]>} Problems remaining after the last attempt.
 */
async function verify(options, good, deps) {
  let problems = [];
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    const packument = await readPackument({
      ...options,
      fetchImpl: deps.fetchImpl,
    });
    problems = verificationProblems(packument, options.bad, good);
    if (problems.length === 0 || attempt === VERIFY_ATTEMPTS) break;
    await deps.sleep(VERIFY_DELAY_MS);
  }
  return problems;
}

/**
 * Print what a real run would do.
 * @param {object} options - Run options.
 * @param {string} good - Resolved good version.
 * @param {(line: string) => void} log - Output.
 * @returns {number} Exit code.
 */
function printDryRun(options, good, log) {
  const plan = planCommands({ ...options, good, notesFile: "<notes-file>" });
  log("Dry run: nothing will be changed.");
  log(
    `Rolling back ${options.packageName}@${options.bad}; latest would point to ${good}.`
  );
  log(
    "A real run would check `npm whoami` and `gh auth status`, then run, in order:"
  );
  plan.forEach((step, index) => log(`  ${index + 1}. ${formatCommand(step)}`));
  log(
    `<notes-file> is the current v${options.bad} notes with this notice on top:`
  );
  log(deprecationNotice(options.reason, good));
  log(
    `Then it reads ${packumentUrl(options.registry, options.packageName)} and exits 0 only if latest is ${good} and ${options.bad} is deprecated.`
  );
  return 0;
}

/**
 * Run the three writes in order, recording each one that completes.
 *
 * A failure partway through leaves the registry half-changed, and the person
 * running this needs to know which half. So any failure after the first write
 * is re-raised with what is already done and what is not — and that re-running
 * finishes the rest, because every step is safe to repeat.
 * @param {object} options - Run options.
 * @param {string} good - Resolved good version.
 * @param {RollbackDeps} deps - Injected seams.
 * @param {string} notesFile - Where the edited notes are written.
 * @returns {void}
 */
function applyWrites(options, good, deps, notesFile) {
  const [deprecate, distTag, editNotes] = planCommands({
    ...options,
    good,
    notesFile,
  });
  const steps = [
    [`deprecated ${options.bad}`, () => runStep(deprecate, deps.run, deps.log)],
    [`moved latest to ${good}`, () => runStep(distTag, deps.run, deps.log)],
    [
      `added the deprecation notice to the v${options.bad} release notes`,
      () => writeNotes(options, good, deps, editNotes),
    ],
  ];
  const done = [];
  try {
    for (const [label, step] of steps) {
      step();
      done.push(label);
    }
  } catch (error) {
    if (done.length === 0) throw error;
    const notDone = steps.slice(done.length).map(([label]) => label);
    throw new Error(
      `${error.message}\nAlready done: ${done.join("; ")}. Not done: ${notDone.join("; ")}. Re-running the same command is safe and will finish the rest.`
    );
  }
}

/**
 * Prepend the notice to the bad release's notes, unless it is already there.
 * @param {object} options - Run options.
 * @param {string} good - Resolved good version.
 * @param {RollbackDeps} deps - Injected seams.
 * @param {{command: string, args: string[]}} editNotes - The edit command.
 * @returns {void}
 */
function writeNotes(options, good, deps, editNotes) {
  const notes = noticedNotes(
    options,
    deprecationNotice(options.reason, good),
    deps.run
  );
  if (notes === null) {
    deps.log(`v${options.bad} notes already carry the notice.`);
    return;
  }
  const notesFile = editNotes.args[editNotes.args.indexOf("--notes-file") + 1];
  deps.writeFile(notesFile, notes);
  runStep(editNotes, deps.run, deps.log);
}

/**
 * Do the writes, then verify.
 * @param {object} options - Run options.
 * @param {string} good - Resolved good version.
 * @param {object} deps - Injected seams.
 * @returns {Promise<number>} Exit code.
 */
async function realRun(options, good, deps) {
  const missing = missingCredentials(options, deps.run);
  if (missing.length > 0) {
    deps.error(
      `Refusing to roll back. ${missing.join(" ")} Nothing was changed.`
    );
    return 1;
  }
  if (options.registry !== DEFAULT_REGISTRY) {
    deps.log(
      `Warning: the npm writes go to ${options.registry}, while the GitHub notes edit goes to ${options.repo}.`
    );
  }
  const dir = deps.makeTempDir();
  try {
    applyWrites(
      options,
      good,
      deps,
      path.join(dir, `v${options.bad}-notes.md`)
    );
  } finally {
    deps.removeDir(dir);
  }
  const problems = await verify(options, good, deps);
  if (problems.length > 0) {
    deps.error(
      `Rollback NOT verified on ${options.registry}: ${problems.join("; ")}.`
    );
    return 1;
  }
  deps.log(
    `Verified: ${options.bad} is deprecated and latest is ${good}. Now prepare the fix-forward release.`
  );
  return 0;
}

/**
 * Injected seams for {@link rollback}.
 * @typedef {object} RollbackDeps
 * @property {(command: string, args: string[]) => {status: number | null, stdout: string, stderr: string}} run
 *   Runs one command with no shell.
 * @property {typeof fetch} fetchImpl - Reads the registry.
 * @property {(file: string, text: string) => unknown} writeFile - Writes the notes file.
 * @property {() => string} makeTempDir - Creates a private scratch directory.
 * @property {(dir: string) => unknown} removeDir - Removes that directory.
 * @property {(ms: number) => Promise<unknown>} sleep - Waits between read-backs.
 * @property {(line: string) => unknown} log - Progress output.
 * @property {(line: string) => unknown} error - Failure output.
 */

/** @type {RollbackDeps} Injected seams, with real defaults. */
const DEFAULT_DEPS = {
  run: defaultRun,
  fetchImpl: (...args) => fetch(...args),
  writeFile: (file, text) => writeFileSync(file, text, "utf8"),
  makeTempDir: () => mkdtempSync(path.join(os.tmpdir(), "lisa-rollback-")),
  removeDir: dir => rmSync(dir, { recursive: true, force: true }),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  log: line => process.stdout.write(`${line}\n`),
  error: line => process.stderr.write(`${line}\n`),
};

/**
 * Resolve the good version, then dry-run or roll back.
 * @param {ReturnType<typeof parseArgs>} options - Parsed options.
 * @param {Partial<typeof DEFAULT_DEPS>} [injected] - Test seams.
 * @returns {Promise<number>} Exit code.
 */
export async function rollback(options, injected = {}) {
  const deps = { ...DEFAULT_DEPS, ...injected };
  try {
    const packument = await readPackument({
      ...options,
      fetchImpl: deps.fetchImpl,
    });
    const good = resolveGoodVersion(packument, options.bad, options.to);
    refuseBackwardMove(packument, options, good);
    return options.dryRun
      ? printDryRun(options, good, deps.log)
      : await realRun(options, good, deps);
  } catch (error) {
    deps.error(`Rollback stopped: ${error.message}`);
    return 1;
  }
}

/**
 * CLI entry: parse, then roll back.
 * @param {string[]} argv - Arguments after the script path.
 * @param {Partial<typeof DEFAULT_DEPS> & {env?: Record<string, string | undefined>}} [injected]
 *   Test seams.
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv, injected = {}) {
  const { env = process.env, ...deps } = injected;
  const error = deps.error ?? DEFAULT_DEPS.error;
  let options;
  try {
    options = parseArgs(argv, env);
  } catch (usageError) {
    error(`${usageError.message}\n${USAGE}`);
    return 1;
  }
  return rollback(options, deps);
}

/* c8 ignore start -- CLI wiring, exercised through main() in tests */
if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
/* c8 ignore stop */
