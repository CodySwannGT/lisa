/**
 * Doctor surfaces a failed template apply.
 *
 * The postinstall records the failure; this is what makes anyone aware of it.
 * Without this half, the marker is just another thing nobody reads, and the
 * project stays silently frozen exactly as before.
 * @module tests/unit/cli/doctor-apply-failure
 */

import * as fs from "fs-extra";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPLY_FAILURE_MARKER,
  checkApplyFailure,
  summariseCause,
} from "../../../src/cli/doctor-apply-failure.js";

/**
 * A project root, optionally carrying a recorded failure.
 * @param contents Marker file contents, or undefined for none.
 * @returns The project root.
 */
async function project(contents?: string): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-doctor-apply-"));
  if (contents !== undefined) {
    const file = path.join(root, APPLY_FAILURE_MARKER);
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, contents);
  }
  return root;
}

describe("checkApplyFailure", () => {
  it("reports ok when no failure is recorded", async () => {
    const check = await checkApplyFailure(await project());

    expect(check.status).toBe("ok");
  });

  it("warns, naming the cause, when a failure is recorded", async () => {
    const check = await checkApplyFailure(
      await project(
        JSON.stringify({
          failedAt: "2026-08-19T12:00:00Z",
          exitCode: 1,
          output: "Error: Cannot find package 'brace-expansion'",
        })
      )
    );

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("brace-expansion");
    expect(check.detail).toContain(APPLY_FAILURE_MARKER);
  });

  it("still warns when the marker cannot be parsed", async () => {
    // The absent-case rule applied to a corrupt file. A marker exists, so a
    // failure happened; reading an unparseable one as "no problem" would
    // reintroduce exactly the silence this check exists to end.
    const check = await checkApplyFailure(await project("{ not json"));

    expect(check.status).toBe("warn");
  });

  it("warns even when the record carries no output at all", async () => {
    const check = await checkApplyFailure(await project("{}"));

    expect(check.status).toBe("warn");
  });
});

describe("summariseCause", () => {
  it("prefers a line that names an error over the first line", () => {
    // Real output usually opens with a banner. Leading with that would make
    // every warning look identical and tell the reader nothing.
    expect(
      summariseCause({
        output: "> lisa@1.0.0 apply\n\nError: Cannot find package 'x'\n  at …",
      })
    ).toBe("Error: Cannot find package 'x'");
  });

  it("falls back to the first line when nothing names an error", () => {
    expect(summariseCause({ output: "something unusual\nsecond" })).toBe(
      "something unusual"
    );
  });

  it("returns empty for no output", () => {
    expect(summariseCause({})).toBe("");
  });
});
