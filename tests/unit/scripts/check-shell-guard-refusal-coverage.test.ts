/**
 * Tests for the shell-guard refusal-coverage check (CodySwannGT/lisa#3190).
 *
 * The load-bearing cases are the ones that make the check BITE and the ones
 * that stop it biting where it should not:
 *
 *  - a guard observed only ever exiting 0 is named — the ticket's defect;
 *  - the same guard, with one refusal observation, comes back clean, because a
 *    check that reported everything would satisfy the first case and be useless;
 *  - a tool-boundary guard seen refusing only with exit 1 is still named, which
 *    is the exit-1-versus-exit-2 discrimination the whole ticket turns on;
 *  - a trace with no observations exits 2, because an empty measurement and a
 *    clean tree otherwise print the same tick;
 *  - `bash -n script.sh` does NOT count as driving the script. That one is not
 *    hypothetical: before it was fixed, the syntax-check pass in
 *    `hook-scripts-parse` made fourteen `scripts/*.sh` read as "driven, only
 *    ever exit 0" — a false accusation of exactly the defect being hunted.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/check-shell-guard-refusal-coverage
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BOUNDED_SPAWN_BASE_MS,
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import {
  formatReport,
  guardPopulation,
  judge,
  parseTrace,
} from "../../../scripts/lib/shell-guard-refusal-coverage.mjs";

/** The check's CLI, by repository-relative path. */
const CHECK = "scripts/check-shell-guard-refusal-coverage.mjs";

/** The tracer, by repository-relative path. */
const TRACER = "scripts/lib/shell-guard-trace.mjs";

/** A guard with thirteen byte-identical tracked copies. */
const EDIT_GATE = "plugins/src/typescript/hooks/lisa-edit-gate.sh";

/** One guard entry, as `guardPopulation` shapes them. */
type Guard = ReturnType<typeof guardPopulation>[number];

/** Temp directories created by a test, removed afterwards. */
const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Create a throwaway directory.
 * @returns Absolute path of the new directory.
 */
function scratch(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "guard-refusal-check-"));
  created.push(directory);
  return directory;
}

/**
 * A stand-in population entry.
 * @param overrides - Fields to set on top of a plain refusable guard.
 * @returns One population entry.
 */
function guard(overrides: Partial<Guard> = {}): Guard {
  return {
    path: "plugins/src/base/hooks/probe.sh",
    sha256: "0".repeat(64),
    size: 128,
    canRefuse: true,
    toolBoundary: false,
    ...overrides,
  };
}

/**
 * A trace holding one observation per status.
 * @param script - Repository-relative guard path.
 * @param statuses - Exit statuses to record.
 * @returns Raw JSONL.
 */
function trace(script: string, statuses: readonly number[]): string {
  return statuses
    .map(status => JSON.stringify({ script, status, origin: "probe" }))
    .join("\n");
}

describe("the refusal-coverage verdict", () => {
  it("names a guard the run only ever saw allow", () => {
    const subject = guard();

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [0])),
    });

    expect(report.driven).toBe(1);
    expect(report.findings).toEqual([
      {
        script: "plugins/src/base/hooks/probe.sh",
        kind: "no-refusal-case",
        detail:
          "driven 1 time(s), only ever exit 0 — nothing proves it can refuse",
      },
    ]);
  });

  it("clears the same guard once one refusal is observed", () => {
    const subject = guard();

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [0, 1])),
    });

    expect(report.findings).toEqual([]);
  });

  it("still names a tool-boundary guard that only ever refused with exit 1", () => {
    const subject = guard({ toolBoundary: true });

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [0, 1])),
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.kind).toBe("no-refusal-case");
    expect(report.findings[0]?.detail).toContain("the tool boundary contract");
  });

  it("accepts a tool-boundary guard once exit 2 is observed", () => {
    const subject = guard({ toolBoundary: true });

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [0, 2])),
    });

    expect(report.findings).toEqual([]);
  });

  it("asks no refusal of a script whose source has no non-zero exit", () => {
    const subject = guard({ canRefuse: false });

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [0])),
    });

    expect(report.findings).toEqual([]);
  });

  it("names a guard the run only ever saw refuse", () => {
    const subject = guard();

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [1])),
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.kind).toBe("no-allow-control");
  });

  it("ignores an execution of something the population does not contain", () => {
    const report = judge({
      population: [guard()],
      observed: parseTrace(trace("tests/fixtures/pinned-snapshot.sh", [0])),
    });

    expect(report.driven).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("reports an exclusion for a guard nothing drives as stale", () => {
    const subject = guard();

    const report = judge({
      population: [subject],
      observed: parseTrace(""),
      exclusions: [{ script: subject.path, reason: "needs live credentials" }],
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.kind).toBe("stale-exclusion");
  });

  it("reports an exclusion naming a script that is not a guard", () => {
    const report = judge({
      population: [guard()],
      observed: parseTrace(""),
      exclusions: [{ script: "scripts/gone.sh", reason: "removed upstream" }],
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.kind).toBe("unknown-exclusion");
  });

  it("suppresses the refusal demand for an excluded guard, and says so", () => {
    const subject = guard();

    const report = judge({
      population: [subject],
      observed: parseTrace(trace(subject.path, [0])),
      exclusions: [{ script: subject.path, reason: "needs live credentials" }],
    });

    expect(report.findings).toEqual([]);
    expect(formatReport(report)).toContain(
      "omitted on purpose: needs live credentials"
    );
  });
});

describe("the population", () => {
  it("excludes the pinned snapshots under tests/", () => {
    const population = guardPopulation(process.cwd()).map(entry => entry.path);

    expect(population.some(file => file.startsWith("tests/"))).toBe(false);
    expect(population).toContain(EDIT_GATE);
  });

  it("gives every byte-identical copy the same digest", () => {
    const copies = guardPopulation(process.cwd()).filter(
      entry => path.basename(entry.path) === "lisa-edit-gate.sh"
    );

    expect(copies.length).toBeGreaterThan(3);
    expect(new Set(copies.map(entry => entry.sha256)).size).toBe(1);
  });
});

describe("the trace", () => {
  it("keeps the valid records either side of a malformed line", () => {
    const first = JSON.stringify({ script: "a.sh", status: 0 });
    const second = JSON.stringify({ script: "a.sh", status: 2 });

    const observed = parseTrace(`${first}\nnot json\n${second}\n`);

    const seen = [...(observed.get("a.sh")?.statuses ?? [])].toSorted(
      (left, right) => left - right
    );

    expect(seen).toEqual([0, 2]);
  });

  it("records a guard run under bash and not one merely parsed with -n", () => {
    const root = scratch();
    const tracePath = path.join(root, "trace.jsonl");
    const indexPath = path.join(root, "index.json");
    const driverPath = path.join(root, "driver.mjs");
    const subject = guardPopulation(process.cwd()).find(
      entry => entry.path === EDIT_GATE
    );
    writeFileSync(tracePath, "");
    writeFileSync(
      indexPath,
      JSON.stringify({
        byHash: { [subject?.sha256 ?? ""]: [EDIT_GATE] },
        sizes: [subject?.size ?? 0],
      })
    );
    // The driver's own children take their deadline from argv rather than from
    // a literal, so the bound scales with the machine exactly like every other
    // bounded child here — and `test-budget-conformance` is not asked to tell a
    // number inside a string from a number inside code.
    writeFileSync(
      driverPath,
      [
        'import { spawnSync } from "node:child_process";',
        "const [, , target, budget] = process.argv;",
        "const bound = { timeout: Number(budget) };",
        'spawnSync("/bin/bash", ["-n", target], bound);',
        'spawnSync("/bin/bash", [target], bound);',
        "",
      ].join("\n")
    );

    const result = boundedSpawnSync({
      label: "shell-guard tracer driver",
      command: process.execPath,
      args: [
        `--import=${path.resolve(TRACER)}`,
        driverPath,
        path.resolve(EDIT_GATE),
        String(ioLatencyBudgetMs(BOUNDED_SPAWN_BASE_MS)),
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        LISA_SHELL_GUARD_INDEX: indexPath,
        LISA_SHELL_GUARD_TRACE: tracePath,
      },
    });

    expect(result.status).toBe(0);
    // Exactly one record: the `-n` pass parsed the file and executed nothing,
    // so counting it would report a guard as driven that never ran a line.
    const observed = parseTrace(readFileSync(tracePath, "utf8"));
    expect([...(observed.get(EDIT_GATE)?.statuses ?? [])]).toEqual([0]);
  });
});

describe("the CLI", () => {
  it("exits 2 when the trace observed nothing at all", () => {
    const root = scratch();
    const emptyTrace = path.join(root, "empty.jsonl");
    writeFileSync(emptyTrace, "");

    const result = boundedSpawnSync({
      label: "check-shell-guard-refusal-coverage --trace",
      command: process.execPath,
      args: [CHECK, "--trace", emptyTrace],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("NOTHING was observed");
  });

  it("exits 2 on an unknown flag", () => {
    const result = boundedSpawnSync({
      label: "check-shell-guard-refusal-coverage --nope",
      command: process.execPath,
      args: [CHECK, "--nope"],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown flag --nope");
  });
});
