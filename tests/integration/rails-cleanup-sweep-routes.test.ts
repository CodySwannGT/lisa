/**
 * The Rails test and mutation routes run the start-of-run cleanup sweep, not
 * the retired scratch supervisor (CodySwannGT/lisa#4603).
 *
 * Five shipped routes run a Rails payload: the generated pre-push `rspec` and
 * `mutation` commands, and the reusable workflow's RSpec (unsharded and
 * sharded) and Mutant jobs. Each used to cross `scripts/lisa-scratch-run.sh`,
 * and the workflow failed with "Scratch supervisor missing" when a caller did
 * not have it. The supervisor is gone (a `deletions.json` entry retires a
 * host's unedited copy), so every route must run with the sweep alone.
 *
 * Each case drives the real shipped text against a fixture Rails host built
 * in a private temp directory: the managed `lefthook.yml` commands and the
 * workflow's step bodies are EXECUTED, with `bundle` replaced by a stub that
 * records how it was started. Real Ruby is not needed for what is asserted —
 * the sweep, the order, the owner marker and the absent supervisor — so these
 * cases run on any machine with `sh` and `node`.
 *
 * The sweep that runs is the real CLI. Its temp half is confined to the
 * fixture by `TMPDIR`; its process half lists this user's processes and kills
 * only those whose `LISA_TEST_RUN_OWNER` names an owner that is provably gone,
 * which is exactly what it does on every push.
 * @module tests/integration/rails-cleanup-sweep-routes
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { load as loadYaml } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEFTHOOK = path.join(REPO_ROOT, "rails/copy-overwrite/lefthook.yml");
const WORKFLOW = path.join(REPO_ROOT, ".github/workflows/quality-rails.yml");
const SWEEP_LIBS = [
  "lisa-cleanup-sweep.mjs",
  "lisa-cleanup-sweep-processes.mjs",
  "bounded-spawn.mjs",
  "invoked-as-script.mjs",
];
/** The retired supervisor, which no route may name. */
const RETIRED = "lisa-scratch-run";
const SWEEP_STEP = "🧹 Sweep stale Lisa temp entries";
const RUN_TESTS = "🧪 Run tests";
const POSTGRES = "test-postgres";
const SWEEP_SKIPPED = /^🧹 cleanup sweep skipped/u;
const SWEEP_LINE = /^🧹 swept \d+ stale temp dirs?, \d+ orphaned test process/u;
const HOUR_MS = 60 * 60 * 1000;

/** The pre-push commands as the managed lefthook.yml spells them. */
const lefthook = loadYaml(fs.readFileSync(LEFTHOOK, "utf8")) as {
  "pre-push": { commands: Record<string, { run: string }> };
};
const prePush = lefthook["pre-push"].commands;

const workflow = loadWorkflow(WORKFLOW);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/** A fixture Rails host, its private temp directory and its event log. */
interface Host {
  readonly cwd: string;
  readonly tmp: string;
  readonly log: string;
  readonly bin: string;
}

/**
 * A payload stand-in that records its argv and owner marker in the shared
 * log, next to the sweep's own line, so the order is observable.
 * @param name - Name it logs under
 * @returns Script text
 */
function record(name: string): string {
  return `#!/bin/sh\nprintf '%s owner=%s args=%s\\n' ${name} "$LISA_TEST_RUN_OWNER" "$*" >> "$EVENT_LOG"\n`;
}

/**
 * Build a Rails host carrying what `lisa apply` delivers to the routes: the
 * sweep and its imports, the git-environment wrapper and a mutation gate
 * script, but no `scripts/lisa-scratch-run.sh`.
 * @param options - What to leave out
 * @param options.sweep - Whether the sweep has been delivered yet
 * @returns The host
 */
function railsHost({ sweep = true }: { sweep?: boolean } = {}): Host {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-rails-sweep-"));
  const cwd = path.join(root, "host");
  const tmp = path.join(root, "tmp");
  const bin = path.join(root, "bin");
  const log = path.join(root, "events.log");
  roots.push(root);
  for (const dir of [path.join(cwd, "scripts", "lib"), tmp, bin])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(log, "");
  if (sweep)
    for (const lib of SWEEP_LIBS)
      fs.copyFileSync(
        path.join(REPO_ROOT, "all/copy-overwrite/scripts/lib", lib),
        path.join(cwd, "scripts", "lib", lib)
      );
  fs.copyFileSync(
    path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-clean-git-env.sh"),
    path.join(cwd, "scripts", "lisa-clean-git-env.sh")
  );
  fs.writeFileSync(path.join(bin, "bundle"), record("bundle"), {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(cwd, "scripts", "lisa-mutation.sh"),
    record("lisa-mutation.sh"),
    { mode: 0o755 }
  );
  boundedSpawnSync({
    label: "git init",
    command: "git",
    args: ["init", "-q"],
    cwd,
  });
  return { cwd, tmp, log, bin };
}

/**
 * Run a shell body in the host, appending its stdout to the event log.
 * @param host - Fixture host
 * @param shell - `sh` (lefthook) or `bash` (a workflow step)
 * @param body - Command text
 * @returns Exit status, the event log and the combined output
 */
function run(host: Host, shell: "sh" | "bash", body: string) {
  const child = boundedSpawnSync({
    label: `${shell} route`,
    command: shell === "sh" ? "/bin/sh" : "bash",
    args: ["-c", `{ ${body}\n} >> "$EVENT_LOG"`],
    cwd: host.cwd,
    // Measured at about 0.5 s per route on a quiet box (1 vitest process);
    // 6 s is the highest base the flat 120 s case budget admits.
    baseMs: 6_000,
    env: {
      PATH: `${host.bin}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME,
      TMPDIR: host.tmp,
      EVENT_LOG: host.log,
    },
  });
  return {
    status: child.status,
    events: fs.readFileSync(host.log, "utf8").trim().split("\n"),
    output: `${child.stdout}${child.stderr}`,
  };
}

/**
 * Seed one stale Lisa temp entry, as a killed earlier run leaves.
 * @param host - Fixture host
 * @param name - Entry name
 */
function staleEntry(host: Host, name: string): void {
  const entry = path.join(host.tmp, name);
  const when = new Date(Date.now() - 48 * HOUR_MS);
  fs.mkdirSync(entry, { mode: 0o700 });
  fs.utimesSync(entry, when, when);
}

/**
 * Lisa-prefixed entries left in the host's temp directory.
 * @param host - Fixture host
 * @returns Their count
 */
function lisaEntries(host: Host): number {
  return fs.readdirSync(host.tmp).filter(name => /^lisa[-.]/u.test(name))
    .length;
}

/**
 * The step of a job with a given name.
 * @param jobId - Job id
 * @param name - Step name
 * @returns Its run body
 */
function stepRun(jobId: string, name: string): string {
  const found = (workflow.jobs[jobId]?.steps ?? []).find(
    entry => entry.name === name
  );
  if (!found?.run) throw new Error(`${jobId} has no run step "${name}"`);
  return found.run;
}

describe.each([
  ["rspec", "bundle owner=", "exec rspec"],
  ["mutation", "lisa-mutation.sh owner=", ""],
] as const)("the pre-push %s command", (command, payload, args) => {
  const body = prePush[command]?.run ?? "";

  it("sweeps once, then runs its payload as a marked owner", () => {
    const host = railsHost();
    const outcome = run(host, "sh", body);

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.events.filter(line => SWEEP_LINE.test(line))).toHaveLength(
      1
    );
    expect(SWEEP_LINE.test(outcome.events[0] ?? "")).toBe(true);
    const ran = outcome.events.filter(line => line.startsWith(payload));
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatch(/owner=\d+:0 /u);
    expect(ran[0]).toContain(args);
  });

  it("never invokes the retired supervisor", () => {
    expect(body).not.toContain(RETIRED);
    const host = railsHost();
    const outcome = run(host, "sh", body);
    expect(outcome.output).not.toContain(RETIRED);
    expect(
      fs.existsSync(path.join(host.cwd, "scripts/lisa-scratch-run.sh"))
    ).toBe(false);
  });

  it("still runs its payload before `lisa apply` has delivered the sweep", () => {
    const host = railsHost({ sweep: false });
    const outcome = run(host, "sh", body);

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.events[0]).toMatch(SWEEP_SKIPPED);
    expect(
      outcome.events.filter(line => line.startsWith(payload))
    ).toHaveLength(1);
  });

  it("leaves no growing residue over five runs", () => {
    const host = railsHost();
    const counts = Array.from({ length: 5 }, (_, index) => {
      staleEntry(host, `lisa-killed-run-${index}`);
      expect(run(host, "sh", body).status).toBe(0);
      return lisaEntries(host);
    });

    expect(counts[4]).toBeLessThanOrEqual(counts[0] ?? 0);
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("the reusable Rails workflow without the supervisor", () => {
  const routes = [
    [POSTGRES, RUN_TESTS],
    ["test-mysql", RUN_TESTS],
  ] as const;

  it("references the supervisor nowhere", () => {
    expect(fs.readFileSync(WORKFLOW, "utf8")).not.toContain(RETIRED);
  });

  it.each(routes)(
    "%s sweeps and then runs RSpec, with no supervisor installed",
    (jobId, runStep) => {
      const host = railsHost();
      const outcome = run(
        host,
        "bash",
        `${stepRun(jobId, SWEEP_STEP)}\n${stepRun(jobId, runStep)}`
      );

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.output).not.toContain("Scratch supervisor missing");
      expect(SWEEP_LINE.test(outcome.events[0] ?? "")).toBe(true);
      expect(outcome.events[1]).toMatch(
        /^bundle owner=\d+:0 args=exec rspec$/u
      );
    }
  );

  it.each(["test-postgres-shard", "test-mysql-shard"])(
    "%s gives every leg the same sweep step as the unsharded job",
    jobId => {
      const unsharded = jobId.replace("-shard", "");
      expect(stepRun(jobId, SWEEP_STEP)).toBe(stepRun(unsharded, SWEEP_STEP));
      expect(stepRun(jobId, "🧪 Run this shard's tests")).not.toContain(
        RETIRED
      );
    }
  );

  it("runs the mutation gate after one sweep, with no supervisor installed", () => {
    const host = railsHost();
    const outcome = run(
      host,
      "bash",
      stepRun(
        "mutation",
        "🧬 Run mutation-testing gate (diff-only, self-skips when disabled)"
      )
    );

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.output).not.toContain("Scratch supervisor missing");
    expect(SWEEP_LINE.test(outcome.events[0] ?? "")).toBe(true);
    expect(outcome.events[1]).toMatch(/^lisa-mutation\.sh owner=\d+:0 /u);
  });

  it("does not fail a caller that has neither the supervisor nor the sweep yet", () => {
    const host = railsHost({ sweep: false });
    const outcome = run(
      host,
      "bash",
      `${stepRun(POSTGRES, SWEEP_STEP)}\n${stepRun(POSTGRES, RUN_TESTS)}`
    );

    expect(outcome.status, outcome.output).toBe(0);
    expect(outcome.events[0]).toMatch(SWEEP_SKIPPED);
  });
});
