/**
 * Authority before allocation, for the Rails scratch supervisor.
 *
 * ## What was broken
 *
 * Lisa ships five Rails test and mutation routes — PostgreSQL RSpec and MySQL
 * RSpec in the reusable quality workflow, the CI Mutant gate, and the generated
 * pre-push RSpec and Mutant commands — and none of them owned the scratch its
 * payload created. Nothing removed a killed run's fixture debris, because the
 * only thing that could have was the process that had just been killed.
 *
 * ## Why this is shell and not the Node supervisor
 *
 * A Rails repository is not required to have Node, npm, Bun, Yarn, a populated
 * `node_modules`, or a network at test runtime. Reusing an npm-delivered
 * executable would have added a runtime requirement to exactly the routes that
 * are permitted not to have one, so the supervisor is a POSIX shell program
 * materialized into the project by `lisa`, and these tests execute it as one.
 *
 * ## The property this file buys
 *
 * Not "cleanup happens" — a supervisor that arms AFTER allocation also cleans
 * up, right until the moment it is killed, which is the only moment that
 * mattered. The property is that an outside cleanup authority has acknowledged
 * the run token, the canonical run root, the root's filesystem identity, the
 * suite label, and the payload's process-group and process-birth identities
 * BEFORE the payload is allowed to allocate anything. The payload is physically
 * held at a gate until that acknowledgement lands, so "the payload never ran"
 * is observable rather than argued.
 * @module tests/integration/rails-scratch-authority
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SUPERVISOR_EXIT,
  SUPERVISOR_PATH,
  makeScratchBase,
  namespaceEntries,
  readTrace,
  runSupervisor,
  type ScratchBase,
} from "./support/rails-scratch-supervisor";

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

describe("the cleanup authority acknowledges before the payload allocates", () => {
  it("acknowledges, then opens the gate, then lets the payload execute", async () => {
    const scratch = base();
    const trace = path.join(scratch.base, "trace.log");

    const run = await runSupervisor(
      scratch.base,
      ["--suite", "ordering", "--", "sh", "-c", "echo payload-ran"],
      { LISA_SCRATCH_TRACE: trace }
    );

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("payload-ran");

    const events = readTrace(trace);
    const at = (event: string): number =>
      events.findIndex(entry => entry.endsWith(` ${event}`));

    // The launcher reports the process group it has isolated itself into
    // BEFORE anything is armed, so the identity being acknowledged is a fact
    // rather than a prediction.
    expect(at("group-reported")).toBeGreaterThanOrEqual(0);
    expect(at("arm-written")).toBeGreaterThan(at("group-reported"));
    expect(at("ack")).toBeGreaterThan(at("arm-written"));
    expect(at("arm-acked")).toBeGreaterThan(at("ack"));
    expect(at("gate-open")).toBeGreaterThan(at("arm-acked"));
    expect(at("payload-exec")).toBeGreaterThan(at("gate-open"));
    expect(events[at("ack")]).toBe("authority ack");
    expect(events[at("payload-exec")]).toBe("launcher payload-exec");
  });

  it("names token, root, filesystem identity, suite, pgid and birth in the arming record", async () => {
    const scratch = base();
    // The payload copies the record out before it can be deleted, which is the
    // only way to read a record whose whole point is not to outlive the run.
    const copied = path.join(scratch.base, "arm-copy");
    const run = await runSupervisor(scratch.base, [
      "--suite",
      "fields",
      "--",
      "sh",
      "-c",
      `cat "$LISA_SCRATCH_ROOT/.lisa-scratch-arm" > "${copied}"`,
    ]);
    expect(run.code).toBe(0);

    const record = fs.readFileSync(copied, "utf-8");
    const keys = record
      .split("\n")
      .filter(line => line.includes("="))
      .map(line => line.slice(0, line.indexOf("=")))
      .toSorted((a, b) => a.localeCompare(b));
    expect(keys).toEqual([
      "birth",
      "devino",
      "pgid",
      "root",
      "suite",
      "supbirth",
      "suppid",
      "token",
      "version",
    ]);
    expect(record).toMatch(/^token=[0-9a-f]{64}$/m);
    expect(record).toMatch(/^suite=fields$/m);
    expect(record).toMatch(/^devino=\S+ \d+$/m);
    expect(record).toMatch(/^pgid=[1-9]\d*$/m);
    expect(record).toMatch(/^birth=\S.*$/m);
  });

  it("puts the payload in a process group of its own, with no controlling terminal", async () => {
    const scratch = base();
    const observed = path.join(scratch.base, "observed-pgid");
    // The payload asks the kernel, from inside itself, rather than trusting
    // what the supervisor believed. On Darwin the group comes from the parent
    // shell's job control; on Linux `/bin/sh` is dash, whose job-control
    // initialisation wants a controlling terminal a CI runner does not have,
    // and the group comes from setsid instead. Both must land here.
    const run = await runSupervisor(scratch.base, [
      "--suite",
      "isolation",
      "--",
      "sh",
      "-c",
      `printf '%s %s\n' "$$" "$(ps -o pgid= -p $$ | tr -d ' ')" > "${observed}"`,
    ]);
    expect(run.code).toBe(0);

    const [pid, pgid] = fs.readFileSync(observed, "utf-8").trim().split(" ");
    expect(pid).toMatch(/^\d+$/);
    // Leading its own group is the whole point: it is what makes a group-wide
    // signal reach the payload's descendants and nothing else.
    expect(pgid).toBe(pid);
  });

  it("gives the payload an owned TMPDIR, which is where Ruby's Dir.mktmpdir lands", async () => {
    const scratch = base();
    const observed = path.join(scratch.base, "observed-tmpdir");
    const run = await runSupervisor(scratch.base, [
      "--suite",
      "tmpdir",
      "--",
      "sh",
      "-c",
      `printf '%s\\n%s\\n%s\\n' "$TMPDIR" "$TMP" "$TEMP" > "${observed}"`,
    ]);
    expect(run.code).toBe(0);

    const [tmpdir, tmp, temp] = fs
      .readFileSync(observed, "utf-8")
      .trim()
      .split("\n");
    expect(tmpdir).toMatch(
      new RegExp(`^${scratch.namespace}/tmpdir\\.[0-9a-f]{64}/tmp$`)
    );
    expect(tmp).toBe(tmpdir);
    expect(temp).toBe(tmpdir);
  });
});

describe("an arming or acknowledgement failure refuses, it does not proceed", () => {
  it("never executes the payload when the authority declines to acknowledge", async () => {
    const scratch = base();
    const sentinel = path.join(scratch.base, "PAYLOAD_RAN");
    const trace = path.join(scratch.base, "trace.log");

    const run = await runSupervisor(
      scratch.base,
      ["--suite", "declined", "--", "sh", "-c", `touch "${sentinel}"`],
      { LISA_SCRATCH_AUTHORITY_REFUSE: "1", LISA_SCRATCH_TRACE: trace }
    );

    expect(run.code).toBe(SUPERVISOR_EXIT.arming);
    expect(run.stderr).toContain("refusing to execute the payload");
    // Refuse, not warn, and not proceed.
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(readTrace(trace)).not.toContain("launcher payload-exec");
    expect(namespaceEntries(scratch.namespace)).toEqual([]);
  });

  it("never executes the payload when the temp base resolves elsewhere", async () => {
    const scratch = base();
    const sentinel = path.join(scratch.base, "PAYLOAD_RAN");
    const real = path.join(scratch.base, "real-base");
    const link = path.join(scratch.base, "linked-base");
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);

    const run = await runSupervisor(link, [
      "--suite",
      "symlinkbase",
      "--",
      "sh",
      "-c",
      `touch "${sentinel}"`,
    ]);

    expect(run.code).toBe(SUPERVISOR_EXIT.arming);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("refuses to nest, so a route crosses exactly one supervisor boundary", async () => {
    const scratch = base();
    const outer = await runSupervisor(scratch.base, [
      "--suite",
      "outer",
      "--",
      "sh",
      "-c",
      "echo $LISA_SCRATCH_SUITE",
    ]);
    expect(outer.code).toBe(0);
    expect(outer.stdout.trim()).toBe("outer");

    const nested = await runSupervisor(scratch.base, [
      "--suite",
      "outer",
      "--",
      "sh",
      SUPERVISOR_PATH,
      "--suite",
      "inner",
      "--",
      "true",
    ]);
    expect(nested.code).toBe(SUPERVISOR_EXIT.usage);
    expect(nested.stderr).toContain("refusing to nest");
  });
});

describe("usage is refused, never guessed", () => {
  it.each([
    ["no suite", ["--", "true"]],
    ["an unusable suite label", ["--suite", "bad label", "--", "true"]],
    ["an over-long suite label", ["--suite", "x".repeat(65), "--", "true"]],
    ["no payload", ["--suite", "ok", "--"]],
    ["an unexpected argument", ["--nope", "--suite", "ok", "--", "true"]],
  ])("refuses %s", async (_label, args) => {
    const scratch = base();
    const run = await runSupervisor(scratch.base, args);
    expect(run.code).toBe(SUPERVISOR_EXIT.usage);
    expect(namespaceEntries(scratch.namespace)).toEqual([]);
  });
});
