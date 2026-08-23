/**
 * The postinstall apply: non-fatal, but never silent.
 *
 * The behaviour being protected is a pair that used to be conflated. The apply
 * must NOT fail the install — a non-zero postinstall aborts `bun install` /
 * `npm ci`, stopping a project installing its dependencies at all, including
 * whatever would fix the apply. That caution is correct.
 *
 * What was wrong is that it was also invisible. The old one-liner ended in
 * `2>/dev/null || true`, discarding both the reason and the fact. Measured on a
 * consumer: the apply aborted before doing any work, and the repository sat
 * frozen at whatever Lisa last wrote while every install reported success.
 *
 * So these tests assert BOTH halves, because either one alone is a regression:
 * the exit code stays 0, and a failure leaves a durable record.
 *
 * A real child process is used rather than a mock. The thing under test is what
 * happens when a spawned apply exits non-zero, and a mocked spawn would be
 * asserting the mock.
 * @module tests/unit/scripts/lisa-postinstall
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  APPLY_FAILURE_MARKER,
  runPostinstall,
} from "../../../all/copy-overwrite/scripts/lisa-postinstall.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/**
 * A project root with a stand-in Lisa entry point.
 * @param behaviour What the fake apply should do.
 * @returns The project root.
 */
function project(behaviour: "succeed" | "fail" | "absent"): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-postinstall-"));
  if (behaviour !== "absent") {
    const dir = path.join(root, "node_modules", "@codyswann", "lisa", "dist");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "index.js"),
      behaviour === "fail"
        ? "console.error(\"Cannot find package 'brace-expansion'\");\nprocess.exit(1);\n"
        : "process.exit(0);\n"
    );
  }
  return root;
}

/** The recorded marker, or null. */
function marker(root: string): Record<string, unknown> | null {
  const file = path.join(root, APPLY_FAILURE_MARKER);
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : null;
}

describe("the install never fails", () => {
  it.each(["succeed", "fail", "absent"] as const)(
    "does not throw when the apply would %s",
    behaviour => {
      // The half that must not regress. Anything that propagates out of here
      // fails the postinstall, which aborts the dependency install and strands
      // the project with no way to install the fix. The entry point's
      // unconditional `process.exit(0)` is asserted separately, end to end.
      expect(() => runPostinstall(project(behaviour), {})).not.toThrow();
    }
  );
});

describe("a failure is recorded", () => {
  it("writes a marker naming the exit code and the cause", () => {
    const root = project("fail");
    runPostinstall(root, {});
    const recorded = marker(root);

    expect(recorded).not.toBeNull();
    expect(recorded?.exitCode).toBe(1);
    expect(String(recorded?.output)).toContain("brace-expansion");
    expect(typeof recorded?.failedAt).toBe("string");
  });

  it("writes NO marker when the apply succeeds", () => {
    const root = project("succeed");
    runPostinstall(root, {});

    expect(marker(root)).toBeNull();
  });

  it("clears a stale marker once the apply succeeds again", () => {
    // Without this, a project that fixed its apply keeps reporting broken
    // forever — and a warning nobody can clear is one everybody learns to
    // ignore.
    const root = project("succeed");
    mkdirSync(path.dirname(path.join(root, APPLY_FAILURE_MARKER)), {
      recursive: true,
    });
    writeFileSync(path.join(root, APPLY_FAILURE_MARKER), "{}\n");

    runPostinstall(root, {});

    expect(marker(root)).toBeNull();
  });
});

describe("cases that are not failures", () => {
  it("does nothing under CI, and records nothing", () => {
    // CI must test the tree as committed, not one the install just rewrote.
    const root = project("fail");

    expect(() => runPostinstall(root, { CI: "true" })).not.toThrow();
    expect(marker(root)).toBeNull();
  });

  it("records nothing when Lisa is not installed", () => {
    // Absence of the entry point is a workspace layout or an install ordering,
    // not a broken apply. Recording it would cry wolf on every fresh clone.
    const root = project("absent");

    expect(() => runPostinstall(root, {})).not.toThrow();
    expect(marker(root)).toBeNull();
  });
});

describe("the entry point exits 0, end to end", () => {
  it("exits 0 even when the apply fails", () => {
    // The contract the unit tests above can only approach. `runPostinstall`
    // returning nothing is not the same promise as the PROCESS exiting 0, and
    // the process exit code is what `bun install` actually reads. Asserting it
    // requires running the file as a program.
    const script = fileURLToPath(
      new URL(
        "../../../all/copy-overwrite/scripts/lisa-postinstall.mjs",
        import.meta.url
      )
    );
    const root = project("fail");

    const run = boundedSpawnSync({
      label: "the postinstall script",
      command: process.execPath,
      args: [script],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
    });

    expect(run.status).toBe(0);
    // And it was not silent about it — the whole point.
    expect(run.stderr).toContain("could not apply its templates");
  });
});
