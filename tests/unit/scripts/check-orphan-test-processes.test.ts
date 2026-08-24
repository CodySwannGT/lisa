/**
 * Tests for the orphaned test-fixture process gate.
 *
 * The final case plants a REAL orphan — a process reparented to PID 1 whose
 * command line names a Lisa fixture temp path — and asserts the gate fails on
 * it. A gate proven only against hand-written `ps` strings would demonstrate
 * that it parses, not that it bites; this leak has twice been cleaned by hand
 * precisely because nothing failed when it returned.
 *
 * @module tests/unit/scripts/check-orphan-test-processes
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  excerptCommand,
  humanReport,
  main,
  parseArgs,
  parseEtimeSeconds,
  parsePsOutput,
  reapUntilSettled,
  selectOrphans,
} from "../../../scripts/check-orphan-test-processes.mjs";

const FIXTURE_PATH =
  "/var/fixtures/lisa-self-postinstall-abc123/scripts/install.sh";

/**
 * Collect writes into a string, standing in for process.stdout.
 * @returns The writable stream and an accessor for what has been written.
 */
function captureStream(): { stream: Writable; text: () => string } {
  // eslint-disable-next-line functional/no-let -- the sink accumulates until read
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback): void {
      text += String(chunk);
      callback();
    },
  });
  return { stream, text: () => text };
}

const plantedRoots: string[] = [];
const plantedPids: number[] = [];

afterEach(async () => {
  for (const pid of plantedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  await Promise.all(
    plantedRoots
      .splice(0)
      .map(root => rm(root, { force: true, recursive: true }))
  );
});

describe("parseEtimeSeconds", () => {
  it("parses mm:ss", () => {
    expect(parseEtimeSeconds("05:30")).toBe(330);
  });

  it("parses hh:mm:ss", () => {
    expect(parseEtimeSeconds("13:08:12")).toBe(47292);
  });

  it("parses dd-hh:mm:ss", () => {
    expect(parseEtimeSeconds("2-03:04:05")).toBe(183845);
  });

  it("returns 0 for an unparseable field", () => {
    expect(parseEtimeSeconds("bogus")).toBe(0);
  });
});

describe("parsePsOutput", () => {
  it("parses pid, ppid, etime, and the full command", () => {
    const rows = parsePsOutput(
      [
        "  PID  PPID     ELAPSED COMMAND",
        `  2595     1    11:18:12 jq -r --arg cwd ${FIXTURE_PATH}`,
      ].join("\n")
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pid).toBe(2595);
    expect(rows[0]?.ppid).toBe(1);
    expect(rows[0]?.etimeSeconds).toBe(40692);
    expect(rows[0]?.command).toBe(`jq -r --arg cwd ${FIXTURE_PATH}`);
  });
});

describe("selectOrphans narrowing", () => {
  const base = { command: `jq ${FIXTURE_PATH}`, etimeSeconds: 600, pid: 10 };

  it("reports an aged, fixture-named, PPID-1 process", () => {
    expect(selectOrphans([{ ...base, ppid: 1 }], 120)).toHaveLength(1);
  });

  it("ignores a process with a live parent — that is a running test", () => {
    expect(selectOrphans([{ ...base, ppid: 4242 }], 120)).toHaveLength(0);
  });

  it("ignores a young orphan — a run may still be starting up", () => {
    expect(
      selectOrphans([{ ...base, etimeSeconds: 5, ppid: 1 }], 120)
    ).toHaveLength(0);
  });

  it("ignores an unrelated orphan not naming a fixture path", () => {
    expect(
      selectOrphans(
        [{ ...base, command: "jq -r .name package.json", ppid: 1 }],
        120
      )
    ).toHaveLength(0);
  });

  it("sorts oldest first", () => {
    const rows = selectOrphans(
      [
        { ...base, etimeSeconds: 600, pid: 10, ppid: 1 },
        { ...base, etimeSeconds: 47292, pid: 11, ppid: 1 },
      ],
      120
    );
    expect(rows.map(row => row.pid)).toEqual([11, 10]);
  });
});

/** Prefix the planted-orphan fixture uses, and the one a report must name. */
const GUARDTEST_PREFIX = "lisa-self-postinstall-guardtest-";

describe("excerptCommand", () => {
  // A fixture path is
  // `$TMPDIR/lisa-scratch/run-<pid>-<epoch-ms>-<hash>/lisa-self-postinstall-<rand>/…`
  // once the per-process scratch redirection nests it, and the run root alone
  // eats the first 100 characters. A head-of-string cut therefore reported a
  // path that named no fixture — the one thing a reader acts on. The gate's own
  // planted-orphan case is what caught it.

  it("returns a short command unchanged", () => {
    expect(excerptCommand("bash /tmp/lisa-test-abc/wait.sh")).toBe(
      "bash /tmp/lisa-test-abc/wait.sh"
    );
  });

  it("keeps the fixture segment when the run root is long enough to bury it", () => {
    const command =
      "bash /var/folders/_2/29n6gy1s42777swvq24j3fh00000gn/T/lisa-scratch/" +
      `run-91251-1787576278006-ed1454ad/${GUARDTEST_PREFIX}Ab3xQ/wait.sh`;

    const excerpt = excerptCommand(command);

    expect(
      excerpt,
      "the tail is the identifying part of a path; a head-only cut drops it"
    ).toContain(GUARDTEST_PREFIX);
    expect(excerpt).toContain("wait.sh");
  });

  it("stays within its budget and marks what it removed", () => {
    const command = `bash ${"x".repeat(400)}/lisa-test-tail/run.sh`;

    const excerpt = excerptCommand(command);

    expect(excerpt.length).toBeLessThanOrEqual(100);
    expect(excerpt).toContain("…");
    expect(excerpt).toContain("/lisa-test-tail/run.sh");
    expect(excerpt.startsWith("bash ")).toBe(true);
  });
});

describe("humanReport", () => {
  it("reports the clean state", () => {
    expect(humanReport([])).toContain("No orphaned");
  });

  it("names the count and the reap command", () => {
    const text = humanReport([
      { command: `jq ${FIXTURE_PATH}`, etimeSeconds: 47292, pid: 2595 },
    ]);
    expect(text).toContain("1 orphaned");
    expect(text).toContain("2595");
    expect(text).toContain("--reap");
  });
});

describe("parseArgs", () => {
  it("defaults to a reporting run", () => {
    expect(parseArgs([])).toEqual({
      json: false,
      minAgeSeconds: 120,
      reap: false,
    });
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown flag");
  });

  it("rejects --min-age-seconds without a value", () => {
    expect(() => parseArgs(["--min-age-seconds"])).toThrow("requires a value");
  });
});

describe("reapUntilSettled", () => {
  it("reaps nothing when no process can satisfy the age floor", () => {
    // Deliberately the non-destructive direction. Asserting a real reap would
    // mean signalling every fixture-named orphan on the machine, including
    // live ones belonging to concurrent work.
    const oneYearSeconds = 60 * 60 * 24 * 365;
    expect(reapUntilSettled(oneYearSeconds)).toBe(0);
  });
});

describe("the gate bites on a real planted orphan", () => {
  it("exits non-zero when a fixture-named process is reparented to PID 1", async () => {
    // Plant a genuine orphan: an outer bash spawns the long-lived inner bash
    // and exits immediately, so the inner process is reparented to PID 1 —
    // the exact state the leaked jq/node/git trees are found in.
    const root = await mkdtemp(path.join(os.tmpdir(), GUARDTEST_PREFIX));
    plantedRoots.push(root);
    const scriptPath = path.join(root, "wait.sh");
    await writeFile(scriptPath, "#!/usr/bin/env bash\nsleep 300\n", "utf8");

    // Record the inner pid to disk rather than recovering it from the guard's
    // own report: cleanup must not depend on the component under test, or a
    // broken guard leaks the very process the test plants.
    const pidFile = path.join(root, "orphan.pid");
    /* eslint-disable sonarjs/no-os-command-from-path -- fixed executable, fixture-owned argv */
    const outer = spawn(
      "bash",
      ["-c", `bash ${scriptPath} & echo $! > ${pidFile}; exit 0`],
      { detached: true, stdio: "ignore" }
    );
    /* eslint-enable sonarjs/no-os-command-from-path -- end fixture spawn scope */
    outer.unref();
    await new Promise(resolve => setTimeout(resolve, 1500));
    plantedPids.push(Number((await readFile(pidFile, "utf8")).trim()));

    // Locate the planted orphan through the gate's own selection logic.
    const clean = captureStream();
    const code = main(["--min-age-seconds", "0"], clean.stream);

    const reported = clean.text();
    expect(reported).toContain(GUARDTEST_PREFIX);
    expect(code).toBe(1);
  });
});
