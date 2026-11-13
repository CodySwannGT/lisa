#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run the Rails pre-push gates with the pass cache and headroom admission
 * (CodySwannGT/lisa#4613).
 *
 * A Rails host's pre-push used to run RSpec, Brakeman, Reek, Flog and Flay on
 * every push, remembering no pass and ignoring every other heavy run on the
 * machine. Each lefthook pre-push command now calls this script with one gate
 * name, and `lisa check` calls it with `--all`, so both run the SAME commands
 * through the SAME machinery Lisa's own gate runner uses:
 *
 * - The pass cache (`lib/gate-pass-cache.mjs`, `pushGate.cache`). Brakeman,
 *   Reek, Flog, Flay and RSpec are cacheable; a hit prints
 *   `CACHED PASS (<key>)`. `Gemfile.lock`, `ruby -v` and `bundle -v` enter the
 *   key. The mutation gate is never cached.
 * - Headroom admission (`lisa admit`, `pushGate.admission`). RSpec, and the
 *   mutation gate when `mutation.gate.yml` enables it, start only when the
 *   machine has headroom; the wait names the busy runs. Static analysers run
 *   without admission.
 * - A full RSpec run uses `parallel_rspec -n <admitted workers>` when the
 *   host's `config/database.yml` names its test database with
 *   `TEST_ENV_NUMBER`. Lisa never edits that file; without the pattern the run
 *   is serial and one line says what to add.
 *
 * Both switches are ON by default for a Rails project — detected as
 * `src/detection/detectors/rails.ts` does, by `bin/rails` or else
 * `config/application.rb` — and an explicit `false` in `.lisa.config.json`
 * wins.
 *
 * Work-item traceability and the history scan stay in
 * `lisa-rails-prepush.mjs`, untouched and never cached: they read the pushed
 * refs from Git's stdin, which this script never sees.
 * @module lisa-rails-gates
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openGatePassCache } from "./lib/gate-pass-cache.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { runStartOfRunSweep } from "./lib/lisa-cleanup-sweep.mjs";
import {
  admissionEnabled,
  lisaCliPrefix,
  PUSH_CONTEXT,
  shellQuote,
} from "./lib/push-admission.mjs";
import { hostReading, recordPushTiming } from "./lib/push-timing.mjs";

const SCRIPT = fileURLToPath(import.meta.url);

/** Exit status `lisa admit` uses when the wait bound expired (EX_TEMPFAIL). */
export const ADMISSION_REFUSED_EXIT = 75;

/**
 * The Rails pre-push gates, in the order lefthook runs them. `command` is the
 * gate's identity in the cache key; how RSpec is actually started (serial,
 * parallel, a selection) is decided at run time and does not change it.
 */
export const RAILS_GATES = Object.freeze({
  rspec: Object.freeze({
    command: ["bundle", "exec", "rspec"],
    cacheable: true,
    admitted: true,
  }),
  brakeman: Object.freeze({
    command: ["bundle", "exec", "brakeman", "--no-pager", "--quiet"],
    cacheable: true,
    admitted: false,
  }),
  reek: Object.freeze({
    command: ["bundle", "exec", "reek", "app/", "lib/"],
    cacheable: true,
    admitted: false,
  }),
  flog: Object.freeze({
    command: ["bundle", "exec", "flog", "--all", "--group", "app/", "lib/"],
    cacheable: true,
    admitted: false,
  }),
  flay: Object.freeze({
    command: ["bundle", "exec", "flay", "app/", "lib/"],
    cacheable: true,
    admitted: false,
  }),
  mutation: Object.freeze({
    command: ["bash", "scripts/lisa-mutation.sh"],
    cacheable: false,
    admitted: true,
  }),
});

/** What `lisa check` runs: every gate whose pass a later push can reuse. */
export const CHECK_GATES = Object.freeze(
  Object.keys(RAILS_GATES).filter(id => RAILS_GATES[id].cacheable)
);

/** The pattern a parallel-ready test database name carries. */
const TEST_ENV_NUMBER = /TEST_ENV_NUMBER/u;

/** Where the per-process database preparation is remembered. */
const PREPARE_MARKER = join("tmp", "lisa-parallel-prepare.json");

/**
 * Whether `root` is a Rails project: `bin/rails`, else `config/application.rb`.
 * @param {string} root Project root.
 * @returns {boolean} True for a Rails project.
 */
export function isRailsProject(root) {
  return (
    existsSync(join(root, "bin", "rails")) ||
    existsSync(join(root, "config", "application.rb"))
  );
}

/**
 * The `pushGate` block a Rails project runs with: `cache` and `admission` on
 * unless the host set them. A malformed block is handed through unchanged so
 * the shared readers refuse it exactly as they do for Lisa's own runner.
 * @param {object|null|undefined} config Parsed `.lisa.config.json`.
 * @param {string} root Project root.
 * @returns {object} The config, with the effective `pushGate`.
 */
export function railsEffectiveConfig(config, root) {
  const base = config ?? {};
  if (!isRailsProject(root)) return base;
  const block = base.pushGate;
  if (
    block !== undefined &&
    (block === null || typeof block !== "object" || Array.isArray(block))
  )
    return base;
  return { ...base, pushGate: { cache: true, admission: true, ...block } };
}

/**
 * Read `.lisa.config.json`; absent reads as `{}`.
 * @param {string} root Project root.
 * @returns {object} Parsed config.
 * @throws {Error} When the file exists but is not JSON.
 */
function readConfig(root) {
  const path = join(root, ".lisa.config.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * First line of a tool's version output, or null when it is not installed.
 * @param {string} command Executable.
 * @param {string[]} args Arguments.
 * @param {string} cwd Directory.
 * @returns {string|null} Version text.
 */
function versionOf(command, args, cwd) {
  const child = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (child.status !== 0) return null;
  return String(child.stdout).trim().split("\n")[0] ?? null;
}

/**
 * Whether the host's test database name carries `TEST_ENV_NUMBER`, so each
 * parallel process gets its own database.
 * @param {string} root Project root.
 * @returns {boolean} True when `config/database.yml`'s `test:` block names it.
 */
export function parallelDatabaseReady(root) {
  const path = join(root, "config", "database.yml");
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf8").split("\n");
  const start = lines.findIndex(line => /^test:\s*(#.*)?$/u.test(line));
  if (start === -1) return false;
  const end = lines.findIndex(
    (line, index) => index > start && /^\S/u.test(line) && !line.startsWith("#")
  );
  return lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .some(line => TEST_ENV_NUMBER.test(line));
}

/**
 * Whether the bundle carries the `parallel_tests` gem.
 * @param {string} root Project root.
 * @returns {boolean} True when `Gemfile.lock` lists it.
 */
function parallelGemInstalled(root) {
  const lock = join(root, "Gemfile.lock");
  return (
    existsSync(lock) &&
    /^\s+parallel_tests \(/mu.test(readFileSync(lock, "utf8"))
  );
}

/**
 * The workers granted by admission, or 1 when none were.
 * @param {Record<string, string|undefined>} env Environment.
 * @returns {number} Workers.
 */
export function grantedWorkers(env) {
  const granted = Number(env.LISA_ADMITTED_WORKERS);
  return Number.isInteger(granted) && granted > 0 ? granted : 1;
}

/**
 * The spec selection, when the affected-spec selector (CodySwannGT/lisa#4612)
 * is installed; a full run otherwise.
 * @param {string} root Project root.
 * @param {Record<string, string|undefined>} env Environment.
 * @param {(line: string) => void} out Line sink.
 * @returns {Promise<{kind: "full"|"partial", specs: string[]}>} The plan.
 */
async function rspecPlan(root, env, out) {
  const selector = join(dirname(SCRIPT), "lisa-rspec-select.mjs");
  if (!existsSync(selector)) return { kind: "full", specs: [] };
  try {
    const { planRspecRun } = await import(selector);
    const plan = await planRspecRun({ cwd: root, env });
    for (const line of plan.lines ?? []) out(line);
    return plan.kind === "partial"
      ? { kind: "partial", specs: [...plan.specs] }
      : { kind: "full", specs: [] };
  } catch (err) {
    out(
      `ℹ️  rspec: spec selection unavailable (${err.message}); running the full suite.`
    );
    return { kind: "full", specs: [] };
  }
}

/**
 * Prepare the per-process test databases once per schema and worker count.
 * @param {string} root Project root.
 * @param {number} workers Workers.
 * @param {(argv: string[]) => number} run Runs a command.
 * @param {(line: string) => void} out Line sink.
 * @returns {number} Exit status of the preparation (0 when it was not needed).
 */
function prepareParallelDatabases(root, workers, run, out) {
  const schema = ["db/schema.rb", "db/structure.sql"]
    .map(name => join(root, name))
    .find(path => existsSync(path));
  const digest = createHash("sha256")
    .update(schema ? readFileSync(schema) : "")
    .update(String(workers))
    .digest("hex");
  const marker = join(root, PREPARE_MARKER);
  try {
    if (JSON.parse(readFileSync(marker, "utf8")).digest === digest) return 0;
  } catch {
    // No marker yet: prepare.
  }
  out(
    `🗄️  rspec: preparing ${workers} test databases (bundle exec rake parallel:prepare).`
  );
  const status = run(["bundle", "exec", "rake", "parallel:prepare"]);
  if (status === 0) {
    try {
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, `${JSON.stringify({ digest })}\n`);
    } catch {
      // Best effort: the next run prepares again.
    }
  }
  return status;
}

/**
 * The command RSpec actually starts with.
 * @param {object} options Inputs.
 * @param {string} options.root Project root.
 * @param {{kind: string, specs: string[]}} options.plan The selection.
 * @param {number} options.workers Granted workers.
 * @returns {{argv: string[], parallel: boolean, hint: string|null}} The command.
 */
export function rspecCommand({ root, plan, workers }) {
  const serial = [...RAILS_GATES.rspec.command, ...plan.specs];
  if (plan.kind !== "full" || workers < 2) {
    return { argv: serial, parallel: false, hint: null };
  }
  if (!parallelDatabaseReady(root)) {
    return {
      argv: serial,
      parallel: false,
      hint:
        "ℹ️  rspec runs serially: add <%= ENV['TEST_ENV_NUMBER'] %> to the test " +
        "database name in config/database.yml so the full suite can use " +
        `${workers} parallel workers (Lisa never edits that file).`,
    };
  }
  if (!parallelGemInstalled(root)) {
    return {
      argv: serial,
      parallel: false,
      hint:
        "ℹ️  rspec runs serially: the parallel_tests gem is not in Gemfile.lock; " +
        "run bundle install so the full suite can use " +
        `${workers} parallel workers.`,
    };
  }
  return {
    argv: ["bundle", "exec", "parallel_rspec", "-n", String(workers)],
    parallel: true,
    hint: null,
  };
}

/**
 * Run one command with inherited output.
 * @param {string} root Directory.
 * @param {Record<string, string|undefined>} env Environment.
 * @returns {(argv: string[]) => number} Runner returning the exit status.
 */
function runner(root, env) {
  return argv => {
    const child = spawnSync(argv[0], argv.slice(1), {
      cwd: root,
      env,
      stdio: "inherit",
    });
    if (child.error) {
      console.error(`❌ could not start ${argv[0]}: ${child.error.message}`);
      return 127;
    }
    return child.status ?? 1;
  };
}

/**
 * Run a gate's own payload. This is what runs under `lisa admit`.
 * @param {string} id Gate id.
 * @param {string} root Project root.
 * @param {Record<string, string|undefined>} env Environment.
 * @param {(line: string) => void} out Line sink.
 * @returns {Promise<number>} Exit status.
 */
export async function runPayload(id, root, env, out) {
  const run = runner(root, env);
  if (id !== "rspec") return run([...RAILS_GATES[id].command]);
  const workers = grantedWorkers(env);
  const plan = await rspecPlan(root, env, out);
  const command = rspecCommand({ root, plan, workers });
  if (command.hint) out(command.hint);
  if (command.parallel) {
    const prepared = prepareParallelDatabases(root, workers, run, out);
    if (prepared !== 0) return prepared;
  }
  out(`▶️  rspec: ${command.argv.join(" ")}`);
  return run(command.argv);
}

/**
 * Whether the opt-in mutation gate is enabled, so waiting for headroom for it
 * is worth anything; disabled, it self-skips instantly.
 * @param {string} root Project root.
 * @returns {boolean} True when `mutation.gate.yml` sets `enabled: true`.
 */
function mutationEnabled(root) {
  const path = join(root, "mutation.gate.yml");
  return (
    existsSync(path) &&
    /^\s*enabled:\s*true\b/mu.test(readFileSync(path, "utf8"))
  );
}

/**
 * The Lisa CLI as a shell prefix: the project's install, else `lisa` on PATH
 * (a Rails host usually has no `node_modules`).
 * @param {string} root Project root.
 * @returns {string|null} Prefix, or null when none is installed.
 */
export function railsLisaCli(root) {
  const local = lisaCliPrefix(root);
  if (local) return local;
  const found = spawnSync("sh", ["-c", "command -v lisa"], {
    encoding: "utf8",
  });
  return found.status === 0 && String(found.stdout).trim() ? "lisa" : null;
}

/** Overrides how many workers a full RSpec run asks admission for. */
export const RSPEC_WORKERS_ENV = "LISA_ADMISSION_RSPEC_WORKERS";

/**
 * Workers RSpec declares: every core but one, unless
 * `LISA_ADMISSION_RSPEC_WORKERS` names a count. Admission grants fewer, down
 * to one, when the machine is busy. Like every `LISA_ADMISSION*` knob it
 * decides how a run starts, never what it proves, so it stays out of the pass
 * cache key.
 * @param {Record<string, string|undefined>} env Environment.
 * @returns {number} Declared workers.
 */
export function declaredWorkers(env) {
  const asked = Number(env[RSPEC_WORKERS_ENV]);
  if (Number.isInteger(asked) && asked > 0) return asked;
  return Math.max(1, availableParallelism() - 1);
}

/**
 * Run a gate, through `lisa admit` when it is heavy and admission is on.
 * @param {object} options Inputs.
 * @param {string} options.id Gate id.
 * @param {string} options.root Project root.
 * @param {Record<string, string|undefined>} options.env Environment.
 * @param {boolean} options.admit Whether admission is on.
 * @param {(line: string) => void} options.out Line sink.
 * @param {(root: string) => string|null} options.cli CLI resolver.
 * @returns {Promise<number>} Exit status.
 */
async function execute({ id, root, env, admit, out, cli }) {
  const gate = RAILS_GATES[id];
  const wanted =
    admit && gate.admitted && (id !== "mutation" || mutationEnabled(root));
  if (!wanted) return runPayload(id, root, env, out);
  if (process.platform === "win32") {
    out(
      `⚠️  pushGate.admission is on, but ${id} is not admitted on Windows; it starts immediately.`
    );
    return runPayload(id, root, env, out);
  }
  const prefix = cli(root);
  if (prefix === null) {
    out(
      `⚠️  pushGate.admission is on, but no Lisa CLI is installed here ` +
        `(node_modules/.bin/lisa or lisa on PATH); ${id} starts without admission.`
    );
    return runPayload(id, root, env, out);
  }
  const workers = id === "rspec" ? declaredWorkers(env) : 1;
  const inner = `node ${shellQuote(SCRIPT)} --admitted ${id}`;
  const status = runner(root, { ...env, LISA_ADMISSION_CONTEXT: PUSH_CONTEXT })(
    [
      "sh",
      "-c",
      `${prefix} admit --workers ${workers} --min-workers 1 -- ${shellQuote(inner)}`,
    ]
  );
  if (status === ADMISSION_REFUSED_EXIT) {
    out(
      `❌ ${id} did not start: the machine had no headroom within the wait bound ` +
        "(see the lisa admission line above for the busy runs). This is NOT a pass; retry when they finish."
    );
    return 1;
  }
  return status;
}

/**
 * Run the named gates in order, each through the cache and, when heavy,
 * admission. Every gate runs even after one fails, so one push reports all.
 * @param {string[]} ids Gate ids.
 * @param {object} [options] Seams.
 * @param {string} [options.root] Project root.
 * @param {Record<string, string|undefined>} [options.env] Environment.
 * @param {(line: string) => void} [options.out] Line sink.
 * @param {(root: string) => string|null} [options.cli] CLI resolver.
 * @returns {Promise<number>} 0 when every gate passed, else 1.
 */
export async function runRailsGates(
  ids,
  {
    root = process.cwd(),
    env = process.env,
    out = line => console.log(line),
    cli = railsLisaCli,
  } = {}
) {
  let config;
  let admit;
  try {
    config = railsEffectiveConfig(readConfig(root), root);
    admit = admissionEnabled(config);
  } catch (err) {
    out(`🚫 Rails push gates did not run: ${err.message}`);
    out("   Fix pushGate in .lisa.config.json. This is NOT a pass.");
    return 1;
  }
  const startedAtMs = Date.now();
  const start = hostReading();
  const cache = ids.some(id => RAILS_GATES[id].cacheable)
    ? openGatePassCache({
        config,
        gates: config.gates ?? {},
        moment: "push",
        out,
        cwd: root,
        env,
        extraTools: {
          ruby: versionOf("ruby", ["-v"], root),
          bundler: versionOf("bundle", ["-v"], root),
        },
      })
    : null;
  const results = [];
  for (const id of ids) {
    const gate = RAILS_GATES[id];
    const entry = { id, level: "required", command: gate.command.join(" ") };
    const hit = gate.cacheable ? (cache?.lookup(entry) ?? null) : null;
    if (hit) {
      out(`✅ ${id}: CACHED PASS (${hit.key.slice(0, 12)}) ${entry.command}`);
      results.push({
        ...entry,
        state: "passed",
        cached: true,
        code: 0,
        durationMs: 0,
      });
      continue;
    }
    const began = Date.now();
    const code = await execute({ id, root, env, admit, out, cli });
    const durationMs = Date.now() - began;
    results.push({
      ...entry,
      state: code === 0 ? "passed" : "failed",
      code,
      startedAt: new Date(began).toISOString(),
      durationMs,
    });
    if (code === 0) {
      if (gate.cacheable) cache?.remember(entry, durationMs);
    } else {
      out(`❌ ${id} FAILED (exit ${code}): ${entry.command}`);
    }
  }
  cache?.commit();
  recordPushTiming({
    moment: "push",
    startedAtMs,
    start,
    result: { results },
    out,
  });
  return results.every(result => result.code === 0) ? 0 : 1;
}

/**
 * Command-line entry.
 *
 * - `<gate>…` runs the named gates (what lefthook runs).
 * - `--all` runs the cacheable set after the start-of-run sweep (what
 *   `lisa check` runs), so the push that follows finds cached passes.
 * - `--admitted <gate>` runs one payload; `lisa admit` calls it.
 * @param {string[]} argv Arguments.
 * @returns {Promise<number>} Exit status.
 */
export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--admitted") {
    const id = argv[1] ?? "";
    if (!RAILS_GATES[id]) return 2;
    return runPayload(id, process.cwd(), process.env, line =>
      console.log(line)
    );
  }
  if (argv[0] === "--all") {
    try {
      runStartOfRunSweep();
    } catch (err) {
      console.log(
        `🧹 cleanup sweep did not finish (${err.message}); continuing`
      );
    }
    process.env.LISA_TEST_RUN_OWNER ??= `${process.pid}:0`;
    return runRailsGates([...CHECK_GATES]);
  }
  const unknown = argv.filter(id => !RAILS_GATES[id]);
  if (argv.length === 0 || unknown.length > 0) {
    console.error(
      `🚫 lisa-rails-gates: name one or more of ${Object.keys(RAILS_GATES).join(", ")}, or --all.`
    );
    return 2;
  }
  return runRailsGates(argv);
}

if (invokedAsScript(import.meta.url)) process.exitCode = await main();
