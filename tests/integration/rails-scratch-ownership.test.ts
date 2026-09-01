/**
 * Ownership boundaries for the Rails scratch supervisor: concurrent runs,
 * uncertain ownership, and the leak gate.
 *
 * Two Rails runs share one machine and one temp base all the time — a developer
 * pushing while CI runs locally, two worktrees, two suites. Cleanup that is
 * bounded by "everything under the temp namespace" would take the sibling with
 * it, so every deletion here is bound to one run token, one canonical root, and
 * one device+inode pair, re-verified at the moment of deletion.
 *
 * The hostile cases are driven against the cleanup authority directly, with
 * hand-built markers, because a refusal that only happens when the supervisor
 * politely asks for it is not a refusal.
 * @module tests/integration/rails-scratch-ownership
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FAKE_TOKEN,
  PROBE_SUFFIX,
  SUPERVISOR_EXIT,
  collect,
  isAlive,
  makeProbeRoot,
  makeScratchBase,
  markerBody,
  namespaceEntries,
  runSupervisor,
  spawnSupervisor,
  startOutsideService,
  waitFor,
  writeMarker,
  type ScratchBase,
} from "./support/rails-scratch-supervisor";

/** Entry point that drives the cleanup authority directly. */
const AUTHORITY = "--authority";

const bases: ScratchBase[] = [];

/**
 * Allocate a temp base that is torn down when the test finishes.
 * @returns A fresh isolated scratch base
 */
function base(): ScratchBase {
  const created = makeScratchBase();
  bases.push(created);
  return created;
}

afterEach(() => {
  while (bases.length > 0) bases.pop()?.cleanup();
});

describe("concurrent runs on one machine and one temp base", () => {
  it("removes only its own root and leaves a live sibling usable", async () => {
    const scratch = base();
    const siblingRunning = path.join(scratch.base, "sibling.running");
    const sibling = spawnSupervisor(scratch.base, [
      "--suite",
      "sibling",
      "--",
      "sh",
      "-c",
      `touch "${siblingRunning}"; sleep 30`,
    ]);
    const siblingDone = collect(sibling);
    expect(await waitFor(() => fs.existsSync(siblingRunning))).toBe(true);
    const siblingRoot = namespaceEntries(scratch.namespace).find(entry =>
      entry.startsWith("sibling.")
    );
    expect(siblingRoot).toBeDefined();

    const victimRunning = path.join(scratch.base, "victim.running");
    const victim = spawnSupervisor(scratch.base, [
      "--suite",
      "victim",
      "--",
      "sh",
      "-c",
      `touch "${victimRunning}"; sleep 30`,
    ]);
    const victimDone = collect(victim);
    expect(await waitFor(() => fs.existsSync(victimRunning))).toBe(true);
    victim.kill("SIGKILL");
    await victimDone;

    expect(
      await waitFor(() =>
        namespaceEntries(scratch.namespace).every(
          entry => !entry.startsWith("victim.")
        )
      )
    ).toBe(true);
    // The sibling's root — and the sibling itself — are untouched and usable.
    expect(namespaceEntries(scratch.namespace)).toContain(siblingRoot);
    expect(
      fs.existsSync(path.join(scratch.namespace, siblingRoot as string, "tmp"))
    ).toBe(true);

    sibling.kill("SIGTERM");
    await siblingDone;
  });

  it("performs no opportunistic global sweep of the namespace", async () => {
    const scratch = base();
    fs.mkdirSync(scratch.namespace, { recursive: true });
    const foreign = path.join(scratch.namespace, "not-ours");
    const foreignQuarantine = path.join(
      scratch.namespace,
      `.quarantine.${"f".repeat(64)}`
    );
    fs.mkdirSync(foreign);
    fs.mkdirSync(foreignQuarantine);

    const run = await runSupervisor(scratch.base, [
      "--suite",
      "noglobalsweep",
      "--",
      "true",
    ]);
    expect(run.code).toBe(0);

    // Only the token-bound root went. A foreign quarantine name is somebody
    // else's in-flight cleanup, not debris to help with.
    expect(fs.existsSync(foreign)).toBe(true);
    expect(fs.existsSync(foreignQuarantine)).toBe(true);
  });
});

describe("uncertain ownership exits nonzero with an actionable reason", () => {
  it.each([
    ["a marker with no token", "version=1\n"],
    ["a malformed token", "version=1\ntoken=not-hex\n"],
    [
      "a duplicated key",
      `version=1\ntoken=${FAKE_TOKEN}\ntoken=${"b".repeat(64)}\n`,
    ],
    ["an unsupported version", `version=99\ntoken=${FAKE_TOKEN}\n`],
    [
      "an oversized marker",
      `version=1\ntoken=${FAKE_TOKEN}\n${"x".repeat(9000)}\n`,
    ],
  ])("refuses %s", async (_label, marker) => {
    const scratch = base();
    const root = makeProbeRoot(scratch.namespace, "probe");
    writeMarker(root, marker);

    const run = await runSupervisor(scratch.base, [AUTHORITY, root]);
    expect(run.code).toBe(SUPERVISOR_EXIT.ambiguous);
    expect(run.stderr).toMatch(/authority:/);
    // The probed directory is still there: a refusal deletes nothing.
    expect(fs.existsSync(root)).toBe(true);
  });

  it.each([
    ["a traversal path", (ns: string): string => path.join(ns, "..", "escape")],
    ["a nested path", (ns: string): string => path.join(ns, "a", "b")],
    ["the namespace itself", (ns: string): string => ns],
  ])("refuses %s as a run root", async (_label, build) => {
    const scratch = base();
    fs.mkdirSync(path.join(scratch.namespace, "a", "b"), { recursive: true });
    fs.mkdirSync(path.join(scratch.base, "escape"), { recursive: true });

    const run = await runSupervisor(scratch.base, [
      "--authority",
      build(scratch.namespace),
    ]);
    expect(run.code).toBe(SUPERVISOR_EXIT.ambiguous);
    expect(fs.existsSync(path.join(scratch.base, "escape"))).toBe(true);
  });

  it("refuses a symlinked run root and leaves the link target intact", async () => {
    const scratch = base();
    const target = path.join(scratch.base, "outside-target");
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(scratch.namespace, { recursive: true });
    const link = path.join(scratch.namespace, `linked.${PROBE_SUFFIX}`);
    fs.symlinkSync(target, link);

    const run = await runSupervisor(scratch.base, [AUTHORITY, link]);
    expect(run.code).toBe(SUPERVISOR_EXIT.ambiguous);
    expect(run.stderr).toContain("symlinked run root");
    expect(fs.existsSync(target)).toBe(true);
  });

  it("refuses when the run root's filesystem identity no longer matches", async () => {
    const scratch = base();
    const root = makeProbeRoot(scratch.namespace, "swapped");
    // A device+inode pair that cannot be this directory's — what an inode swap
    // underneath a live run would look like.
    writeMarker(root, markerBody(root, { devino: "0 1" }));

    const run = await runSupervisor(scratch.base, [AUTHORITY, root]);
    expect(run.code).toBe(SUPERVISOR_EXIT.ambiguous);
    expect(run.stderr).toContain("filesystem identity changed");
    expect(fs.existsSync(root)).toBe(true);
  });

  it.each([
    ["process group 0", "0"],
    ["process group 1", "1"],
    ["a non-numeric process group", "notapid"],
  ])(
    "refuses %s so cleanup cannot broaden past this invocation",
    async (_label, pgid) => {
      const scratch = base();
      const root = makeProbeRoot(scratch.namespace, "pgid");
      writeMarker(root, markerBody(root, { pgid }));

      const run = await runSupervisor(scratch.base, [AUTHORITY, root]);
      expect(run.code).toBe(SUPERVISOR_EXIT.ambiguous);
      expect(run.stderr).toContain("refusing process group");
    }
  );

  it("refuses a reused PID whose birth identity does not match", async () => {
    const scratch = base();
    const root = makeProbeRoot(scratch.namespace, "reuse");
    // A live process group we do NOT own, armed with a birth identity that
    // cannot be its own. PID reuse looks exactly like this.
    const bystander = startOutsideService(20);

    try {
      writeMarker(
        root,
        markerBody(root, {
          pgid: String(bystander.pid),
          birth: "Thu Jan  1 00:00:00 1970",
        })
      );

      const run = await runSupervisor(scratch.base, [AUTHORITY, root]);
      expect(run.code).toBe(SUPERVISOR_EXIT.ambiguous);
      expect(run.stderr).toContain("process-birth identity mismatch");
      // The bystander was never signalled.
      expect(isAlive(bystander.pid)).toBe(true);
    } finally {
      bystander.stop();
    }
  });
});

describe("a fixture leak fails the same Rails suite", () => {
  it("fails a green suite and names the label, count and sorted basenames", async () => {
    const scratch = base();
    const run = await runSupervisor(scratch.base, [
      "--suite",
      "leaky-suite",
      "--",
      "sh",
      "-c",
      'mkdir -p "$TMPDIR/zeta" "$TMPDIR/alpha" "$TMPDIR/mid"; exit 0',
    ]);

    expect(run.code).toBe(SUPERVISOR_EXIT.leak);
    expect(run.stderr).toContain("suite 'leaky-suite'");
    expect(run.stderr).toContain("3 unregistered direct child(ren)");
    expect(run.stderr).toContain("alpha mid zeta");
    expect(namespaceEntries(scratch.namespace)).toEqual([]);
  });

  it("keeps a red payload verdict and reports the leak in addition", async () => {
    const scratch = base();
    const run = await runSupervisor(scratch.base, [
      "--suite",
      "leaky-red",
      "--",
      "sh",
      "-c",
      'mkdir -p "$TMPDIR/leftover"; exit 4',
    ]);

    // A green parent may not mask a red leaking child, and a leak may not
    // overwrite a genuine test failure either.
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("1 unregistered direct child(ren): leftover");
  });

  it("batch-cleans registered prefixes without a false failure", async () => {
    const scratch = base();
    const run = await runSupervisor(
      scratch.base,
      [
        "--suite",
        "registered",
        "--",
        "sh",
        "-c",
        'mkdir -p "$TMPDIR/fixture-a" "$TMPDIR/fixture-b" "$TMPDIR/lisa-c"; exit 0',
      ],
      { LISA_SCRATCH_REGISTERED_PREFIXES: "fixture-,lisa-" }
    );

    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("scratch leak");
  });
});
