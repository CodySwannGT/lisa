/**
 * Real executable-boundary coverage for killed gate verdicts.
 *
 * `supervise()` already returns the direct shell's signal after reaping. The
 * released executable then replaces that field with exit 128. These cases drive
 * the shipped file as a child so an in-process helper cannot hide that
 * boundary.
 * @module tests/unit/scripts/process-tree-runner-verdict-transport
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as processTreeRunner from "../../../all/copy-overwrite/scripts/lib/process-tree-runner.mjs";

import {
  cleanupTokenProcesses,
  descendantSignalFixture,
  numericExitCommand,
  POSIX_TERMINATING_SIGNALS,
  PROCESS_TREE_RUNNER,
  readFixturePid,
  runProcessTreeSupervisor,
  selfSignalCommand,
  tokenProcessIds,
} from "../../helpers/process-tree-runner-verdict.js";

/** Signal-shaped numeric statuses that must remain ordinary when deliberate. */
const NUMERIC_CONTROLS = [128, 129, 130, 143] as const;

/** Pure parent-visible representation selected for one timeout platform. */
interface TimeoutVerdict {
  /** Numeric result on Windows; null for a real POSIX signal. */
  readonly code: number | null;
  /** POSIX kill signal; null for the explicit Windows status. */
  readonly signal: "SIGKILL" | null;
}

/** Contract for the production module's pure platform seam. */
interface TimeoutVerdictModule {
  /** Map an injected platform without terminating the current test process. */
  readonly timeoutVerdictForPlatform?: (platform: string) => TimeoutVerdict;
}

/** Optional typing keeps the pre-fix missing export observable as a RED. */
const { timeoutVerdictForPlatform } =
  processTreeRunner as unknown as TimeoutVerdictModule;

/**
 * Fixture roots and tokens that remain safe to clean after an assertion fails.
 */
const ownedFixtures: Array<{ readonly root: string; readonly token: string }> =
  [];

afterEach(() => {
  for (const fixture of ownedFixtures.splice(0)) {
    cleanupTokenProcesses(fixture.token);
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

describe.skipIf(process.platform === "win32")(
  "POSIX killed-verdict transport",
  () => {
    it.each(POSIX_TERMINATING_SIGNALS)(
      "preserves a real %s as status null plus the original signal",
      signal => {
        const outcome = runProcessTreeSupervisor(selfSignalCommand(signal));

        expect(outcome.error).toBeUndefined();
        // The released pre-fix executable returned numeric 128 here.
        expect(outcome.status).toBeNull();
        expect(outcome.signal).toBe(signal);
      }
    );

    it("reaps a descendant before transporting the killed result", () => {
      const root = mkdtempSync(
        path.join(tmpdir(), "lisa-runner-verdict-descendant-")
      );
      const fixture = descendantSignalFixture(root, "SIGTERM");
      ownedFixtures.push({ root, token: fixture.token });

      const outcome = runProcessTreeSupervisor(fixture.command);

      expect(existsSync(fixture.pidFile)).toBe(true);
      expect(readFixturePid(fixture.pidFile)).toBeGreaterThan(0);
      expect(tokenProcessIds(fixture.token)).toEqual([]);
      expect(outcome.status).toBeNull();
      expect(outcome.signal).toBe("SIGTERM");
    });
  }
);

describe("ordinary numeric exits are not signal evidence", () => {
  it.each(NUMERIC_CONTROLS)(
    "preserves a deliberate exit %i as a number with no signal",
    code => {
      const outcome = runProcessTreeSupervisor(numericExitCommand(code));

      expect(outcome.error).toBeUndefined();
      expect(outcome.status).toBe(code);
      expect(outcome.signal).toBeNull();
    }
  );
});

describe("the timeout verdict is pure and platform-injectable", () => {
  it("maps an injected Windows platform to explicit ordinary status 255", () => {
    const source = readFileSync(PROCESS_TREE_RUNNER, "utf8");
    const timeoutStart = source.indexOf("const deadline = setTimeout");
    const timeoutEnd = source.indexOf("}, timeoutMs);", timeoutStart);

    expect(timeoutVerdictForPlatform?.("win32")).toEqual({
      code: 255,
      signal: null,
    });
    expect(timeoutStart).toBeGreaterThan(-1);
    expect(timeoutEnd).toBeGreaterThan(timeoutStart);
    expect(source.slice(timeoutStart, timeoutEnd)).toContain(
      "timeoutVerdictForPlatform(process.platform)"
    );
    expect(source.match(/timeoutVerdictForPlatform\(/gu)).toHaveLength(2);
  });

  it.each(["darwin", "linux"])(
    "maps an injected %s platform to signal-shaped no-verdict evidence",
    platform => {
      expect(timeoutVerdictForPlatform?.(platform)).toEqual({
        code: null,
        signal: "SIGKILL",
      });
    }
  );
});

describe.runIf(process.platform === "win32")(
  "the explicit Windows timeout representation",
  () => {
    it("retains status 255 and its ordinary-exit collision", () => {
      const keepAlive = `"${process.execPath}" -e "setInterval(() => {}, 1000)"`;
      const timeout = runProcessTreeSupervisor(keepAlive, "--timeout-ms=20");
      const deliberate = runProcessTreeSupervisor(numericExitCommand(255));

      expect(timeout.error).toBeUndefined();
      expect(timeout.status).toBe(255);
      expect(timeout.signal).toBeNull();
      expect(deliberate.status).toBe(255);
      expect(deliberate.signal).toBeNull();
    });
  }
);
