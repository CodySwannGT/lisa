/**
 * The Rails pre-push gates run through the pass cache, headroom admission and
 * `lisa check` (CodySwannGT/lisa#4613).
 *
 * Each case builds a fixture Rails host in a private temp directory carrying
 * what `lisa apply` delivers — `scripts/lisa-rails-gates.mjs`, its `lib/`
 * imports and the git-environment wrapper — commits it, and then EXECUTES the
 * real `pre-push` command text from the managed `rails/copy-overwrite/lefthook.yml`.
 * `lisa check` is the real command (`runCheck` from source, spawning the real
 * script), and admission is the real built `lisa admit` against a private
 * state directory with a stated machine reading
 * (`LISA_ADMISSION_FAKE_MACHINE`), exactly as `tests/integration/admission.test.ts`
 * drives it.
 *
 * Real Ruby is NOT used: `bundle` and `ruby` are stubs that record how they
 * were started. What is proved is which commands start, with how many workers,
 * and when — not that a real RSpec suite passes under `parallel_rspec`.
 * @module tests/integration/rails-push-gate-cache
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { load as loadYaml } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

import { runCheck } from "../../src/cli/check-cmd.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { partialSelector } from "./support/rails-partial-selector.js";

// File-scoped budget (CodySwannGT/lisa#4582): every case here starts real
// host processes, measured at 0.4 to 3.5 s per case (the longest waits on a held reservation) on a quiet box (1 vitest process). Both
// the case budget and each child's bound scale with the measured slowdown, and
// a child base at half the case base keeps the child dying first, by name.
useIoLatencyBudget(120_000);

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "dist", "index.js");
const LEFTHOOK = path.join(REPO_ROOT, "rails/copy-overwrite/lefthook.yml");
const GATES_SCRIPT = path.join(
  REPO_ROOT,
  "rails/copy-overwrite/scripts/lisa-rails-gates.mjs"
);
const CACHEABLE = ["rspec", "brakeman", "reek", "flog", "flay"] as const;
/** Room for one four-worker run, and no other load. */
const ROOM_FOR_FOUR = JSON.stringify({
  cores: 4,
  load1: 0,
  freeMemoryMb: 8192,
});
const PARALLEL_DB =
  "test:\n  adapter: postgresql\n  database: sample_test<%= ENV['TEST_ENV_NUMBER'] %>\n";
const SERIAL_DB = "test:\n  adapter: postgresql\n  database: sample_test\n";

const prePush = (
  loadYaml(fs.readFileSync(LEFTHOOK, "utf8")) as {
    "pre-push": { commands: Record<string, { run: string }> };
  }
)["pre-push"].commands;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/** A fixture host and the paths around it. */
interface Host {
  readonly cwd: string;
  readonly log: string;
  readonly env: Record<string, string>;
}

/** `bundle` stand-in: logs every `exec`, fails the gate named in STUB_FAIL. */
const BUNDLE = `#!/bin/sh
if [ "$1" = "-v" ]; then echo "Bundler version 2.6.0"; exit 0; fi
printf 'bundle %s workers=%s\\n' "$*" "\${LISA_ADMITTED_WORKERS:-none}" >> "$EVENT_LOG"
if [ -n "$STUB_FAIL" ]; then case " $* " in *" $STUB_FAIL "*) exit 1;; esac; fi
exit 0
`;

/**
 * Build and commit a Rails host.
 * @param database - Contents of config/database.yml
 * @param selector - Source of a stand-in scripts/lisa-rspec-select.mjs
 * @returns The host
 */
function railsHost(database = PARALLEL_DB, selector?: string): Host {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-rg-"))
  );
  const cwd = path.join(root, "host");
  const bin = path.join(root, "bin");
  const log = path.join(root, "events.log");
  const env = hostEnv(root, bin, log);
  roots.push(root);
  writeHost(root, cwd, bin, database);
  if (selector !== undefined)
    fs.writeFileSync(path.join(cwd, "scripts/lisa-rspec-select.mjs"), selector);
  fs.writeFileSync(log, "");
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-qm",
      "init",
    ],
  ])
    boundedSpawnSync({ label: "git", command: "git", args, cwd, env });
  return { cwd, log, env };
}

/**
 * The environment every host command runs with: no CI markers, a private
 * cache, temp and admission state, and a stated machine reading.
 * @param root - Fixture root
 * @param bin - Stub directory, first on PATH
 * @param log - Event log
 * @returns Environment
 */
function hostEnv(
  root: string,
  bin: string,
  log: string
): Record<string, string> {
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: process.env.HOME ?? root,
    TMPDIR: path.join(root, "tmp"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    EVENT_LOG: log,
    LISA_ADMISSION_STATE_DIR: path.join(root, "state"),
    LISA_ADMISSION_FAKE_MACHINE: ROOM_FOR_FOUR,
    LISA_ADMISSION_POLL_MS: "100",
    LISA_ADMISSION_RSPEC_WORKERS: "3",
  };
}

/**
 * Write what `lisa apply` delivers, the Rails markers and the stubs.
 * @param root - Fixture root
 * @param cwd - Host checkout
 * @param bin - Stub directory
 * @param database - Contents of config/database.yml
 */
function writeHost(
  root: string,
  cwd: string,
  bin: string,
  database: string
): void {
  const files: Record<string, string> = {
    "config/application.rb": "module Sample; end\n",
    "config/database.yml": database,
    "db/schema.rb": "ActiveRecord::Schema.define {}\n",
    "Gemfile.lock":
      "GEM\n  specs:\n    parallel_tests (5.9.0)\n    rspec (3.13.0)\n",
    "mutation.gate.yml": "enabled: false\n",
    "scripts/lisa-mutation.sh": "#!/bin/sh\nexit 0\n",
    ".gitignore": ".lisa/\ntmp/\n",
  };
  for (const dir of [
    path.join(cwd, "scripts", "lib"),
    path.join(cwd, "config"),
    path.join(cwd, "db"),
    bin,
    path.join(root, "tmp"),
    path.join(root, "state"),
  ])
    fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(GATES_SCRIPT, path.join(cwd, "scripts/lisa-rails-gates.mjs"));
  // lib/ is copied whole: the gate script imports into it, and a list of its
  // members here would be a second, silently stale dependency set.
  fs.cpSync(
    path.join(REPO_ROOT, "all/copy-overwrite/scripts/lib"),
    path.join(cwd, "scripts/lib"),
    { recursive: true }
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-clean-git-env.sh"),
    path.join(cwd, "scripts/lisa-clean-git-env.sh")
  );
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(cwd, name), text);
  fs.writeFileSync(path.join(bin, "bundle"), BUNDLE, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "ruby"), "#!/bin/sh\necho 'ruby 3.4.0'\n", {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(bin, "lisa"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"\n`,
    { mode: 0o755 }
  );
}

/**
 * The bundle commands started so far.
 * @param host - Fixture host
 * @returns One line per `bundle exec …`
 */
function started(host: Host): string[] {
  return fs.readFileSync(host.log, "utf8").split("\n").filter(Boolean);
}

/**
 * Run one managed lefthook pre-push command in the host.
 * @param host - Fixture host
 * @param name - Command name in lefthook.yml
 * @param extra - Extra environment
 * @returns Exit status and combined output
 */
function hook(host: Host, name: string, extra: Record<string, string> = {}) {
  const child = boundedSpawnSync({
    label: `pre-push ${name}`,
    command: "/bin/sh",
    args: ["-c", prePush[name]?.run ?? "exit 99"],
    cwd: host.cwd,
    env: { ...host.env, ...extra },
    baseMs: 30_000,
  });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

describe("Rails pre-push through the pass cache and admission", () => {
  it("re-pushes an unchanged tree from cache after lisa check passed", async () => {
    const host = railsHost();
    const lines: string[] = [];
    const code = await runCheck(
      {},
      {
        cwd: host.cwd,
        env: host.env,
        log: line => lines.push(line),
        error: line => lines.push(line),
      }
    );
    expect(code, lines.join("\n")).toBe(0);
    expect(started(host)).toHaveLength(CACHEABLE.length + 1);
    const before = started(host).length;
    for (const gate of CACHEABLE) {
      const result = hook(host, gate);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(
        new RegExp(`${gate}: CACHED PASS \\([0-9a-f]{12}\\)`, "u")
      );
    }
    expect(started(host)).toHaveLength(before);
  });

  it("runs a needed full suite as parallel_rspec -n <admitted workers>", () => {
    const host = railsHost();
    const result = hook(host, "rspec");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/admitted .* with 3 worker/u);
    const runs = started(host);
    expect(runs).toContain("bundle exec rake parallel:prepare workers=3");
    expect(runs).toContain("bundle exec parallel_rspec -n 3 workers=3");
    expect(runs.some(line => line.startsWith("bundle exec rspec"))).toBe(false);
  });

  it("runs serially with a one-line hint, without editing database.yml, when the test database lacks TEST_ENV_NUMBER", () => {
    const host = railsHost(SERIAL_DB);
    const result = hook(host, "rspec");
    expect(result.status, result.output).toBe(0);
    expect(started(host)).toEqual(["bundle exec rspec workers=3"]);
    const hints = result.output
      .split("\n")
      .filter(line => line.includes("rspec runs serially"));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("TEST_ENV_NUMBER");
    expect(
      fs.readFileSync(path.join(host.cwd, "config/database.yml"), "utf8")
    ).toBe(SERIAL_DB);
  });

  it("waits for headroom naming the busy run, then starts rspec when it ends", async () => {
    const host = railsHost();
    const marker = path.join(host.cwd, "..", "holder-started");
    const holder = spawn(
      process.execPath,
      [
        CLI,
        "admit",
        "--workers",
        "4",
        "--",
        process.execPath,
        "-e",
        `require("fs").writeFileSync(${JSON.stringify(marker)}, "1"); setTimeout(() => {}, 3000);`,
      ],
      { cwd: host.cwd, env: host.env, stdio: "ignore" }
    );
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(marker)) {
      if (Date.now() > deadline) throw new Error("holder never started");
      await new Promise(settle => setTimeout(settle, 50));
    }
    const outcome = await new Promise<{ code: number | null; out: string }>(
      settle => {
        const chunks: string[] = [];
        const child = spawn("/bin/sh", ["-c", prePush.rspec?.run ?? ""], {
          cwd: host.cwd,
          env: host.env,
        });
        child.stdout.on("data", chunk => chunks.push(String(chunk)));
        child.stderr.on("data", chunk => chunks.push(String(chunk)));
        child.once("close", code => settle({ code, out: chunks.join("") }));
      }
    );
    holder.kill("SIGKILL");
    expect(outcome.code, outcome.out).toBe(0);
    expect(outcome.out).toMatch(/waiting for headroom/u);
    expect(outcome.out).toMatch(/Held by: pid \d+/u);
    expect(started(host).some(line => line.includes("parallel_rspec"))).toBe(
      true
    );
  });

  // A partial selection proves a slice; remembered, it would let a later push
  // skip the full suite it owes (e.g. after affectedTests is turned off).
  it("never remembers a partial RSpec selection, so the next push runs RSpec again", () => {
    const host = railsHost(PARALLEL_DB, partialSelector(false));
    const first = hook(host, "rspec");
    expect(first.status, first.output).toBe(0);
    expect(first.output).toContain("selected 1 spec");
    const again = hook(host, "rspec");
    expect(again.status, again.output).toBe(0);
    expect(again.output).not.toMatch(/CACHED PASS/u);
    expect(started(host)).toEqual([
      "partial spec/a_spec.rb",
      "partial spec/a_spec.rb",
    ]);
  });

  it("remembers a partial selection that escalated to the full suite", () => {
    const host = railsHost(PARALLEL_DB, partialSelector(true));
    const first = hook(host, "rspec");
    expect(first.status, first.output).toBe(0);
    expect(started(host)).toContain(
      "bundle exec parallel_rspec -n 3 workers=3"
    );
    const again = hook(host, "rspec");
    expect(again.status, again.output).toBe(0);
    expect(again.output).toMatch(/rspec: CACHED PASS/u);
  });

  it("never remembers a failed gate, so the next push runs it again", () => {
    const host = railsHost();
    const failed = hook(host, "brakeman", { STUB_FAIL: "brakeman" });
    expect(failed.status).not.toBe(0);
    expect(failed.output).toMatch(/brakeman FAILED/u);
    const again = hook(host, "brakeman");
    expect(again.status, again.output).toBe(0);
    expect(again.output).not.toMatch(/CACHED PASS/u);
    expect(
      started(host).filter(line => line.startsWith("bundle exec brakeman"))
    ).toHaveLength(2);
  });

  it("leaves traceability and the history scan in the uncached rails-prepush command", () => {
    expect(prePush["rails-prepush"]?.run).toContain(
      "./scripts/lisa-rails-prepush.mjs"
    );
    expect(prePush["rails-prepush"]?.run).not.toContain("lisa-rails-gates");
    const wrapper = fs.readFileSync(
      path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-rails-prepush.mjs"),
      "utf8"
    );
    expect(wrapper).not.toMatch(/gate-pass-cache|lisa-rails-gates/u);
  });
});
