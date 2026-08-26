import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
  SCRATCH_ROOT_ENV,
  parseRunRootName,
  removeScratchDir,
} from "../../../src/configs/vitest/scratch.js";
import {
  MAX_NAMESPACE_ENTRIES,
  setup,
  teardown,
} from "../../../src/configs/vitest/scratch-global-setup.js";
import {
  scratchGlobalSetup,
  scratchSetupFiles,
} from "../../../src/configs/vitest/base.js";
import { getCdkVitestConfig } from "../../../src/configs/vitest/cdk.js";
import { getHarperFabricVitestConfig } from "../../../src/configs/vitest/harper-fabric.js";
import { getNestjsVitestConfig } from "../../../src/configs/vitest/nestjs.js";
import { getPhaserVitestConfig } from "../../../src/configs/vitest/phaser.js";
import { getTypescriptVitestConfig } from "../../../src/configs/vitest/typescript.js";

describe("the accumulation guard lives in the hook that can fail a run", () => {
  // Vitest SWALLOWS a throw from globalSetup teardown — it prints `error during
  // close` and the process still exits 0 — while the same throw from `setup`
  // exits 1. Measured both ways on vitest 4.1.9, after the first draft of this
  // module put the check in `teardown` and it reported a real overflow into a
  // stream nothing gated on.
  //
  // So the placement is load-bearing, and this pins it. Moving the check back
  // into `teardown` would leave every other test here passing.
  const withNamespace = (
    entries: readonly string[],
    body: (dir: string) => void
  ): void => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guard-placement-"));
    const previous = process.env[SCRATCH_ROOT_ENV];
    process.env[SCRATCH_ROOT_ENV] = base;
    const dir = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(dir, { recursive: true });
    entries.forEach(name => {
      fs.mkdirSync(path.join(dir, name));
    });
    try {
      body(dir);
    } finally {
      if (previous === undefined) {
        delete process.env[SCRATCH_ROOT_ENV];
      } else {
        process.env[SCRATCH_ROOT_ENV] = previous;
      }
      removeScratchDir(base);
    }
  };

  /**
   * Fill the namespace past the ceiling with entries NOBODY owns.
   *
   * It used to fill with roots naming `process.pid` — this very process, which
   * is alive — so it modelled 513 live sibling runs and called them
   * accumulation. That is the confusion the ceiling itself carried
   * (CodySwannGT/lisa#3032): live-owned entries are released when their owner
   * exits and cannot accumulate, and counting them refused runs for their
   * siblings' work in flight.
   *
   * Foreign names carry no owner at all, so they are unowned by construction
   * and need no pid that might or might not still exist. The sweep deliberately
   * preserves them because age is not ownership authority, which is precisely
   * why the bounded global guard must report their accumulation.
   * @param dir - Namespace directory to fill
   */
  const fillPastCeiling = (dir: string): void => {
    Array.from({ length: MAX_NAMESPACE_ENTRIES + 1 }, (_unused, index) => {
      fs.mkdirSync(path.join(dir, `unowned-${String(index)}`));
      return index;
    });
  };

  it("refuses to start a run into an accumulating namespace", () => {
    withNamespace([], dir => {
      fillPastCeiling(dir);

      expect(() => {
        setup();
      }).toThrow(/accumulating rather than being reclaimed/);
    });
  });

  it("starts normally when the namespace holds only a few live sibling runs", () => {
    withNamespace(
      [`run-${String(process.pid)}-${String(Date.now())}-abcdef`],
      () => {
        expect(() => {
          setup();
        }).not.toThrow();
      }
    );
  });

  it("does not put the verdict in teardown, where Vitest would swallow it", () => {
    withNamespace([], dir => {
      fillPastCeiling(dir);

      // The same namespace state that makes `setup` throw. `teardown` must not,
      // because a throw from there never reaches the exit code — so a check
      // placed here would report an overflow nothing gates on.
      expect(() => {
        teardown();
      }).not.toThrow();
    });
  });

  it("states a ceiling the message can name", () => {
    expect(MAX_NAMESPACE_ENTRIES).toBeGreaterThan(0);
  });
});

describe("installScratchRoot", () => {
  // Exercises the SOURCE module directly rather than observing the ambient run.
  //
  // Lisa's own suite runs against the built `dist/` copy of the setup file,
  // because `vitest.config.ts` imports the factory from the package. A guard
  // that only checked the ambient `os.tmpdir()` would therefore keep passing
  // with the source's redirection deleted — measured, by deleting it: the
  // runtime guard reported green. That is this campaign's own thesis appearing
  // in the guard written to prevent it, so the contract is asserted against the
  // source too, where an edit actually lands.
  it("redirects the process temp directory into a run root it owns", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "install-arm-"));
    const previousOverride = process.env[SCRATCH_ROOT_ENV];
    const previousTmp = process.env["TMPDIR"];
    const scope = globalThis as Record<string, unknown>;
    const previousMemo = scope["__lisaScratchRunRoot__"];
    const previousHandle = scope["__lisaScratchRunRootHandleV1__"];

    process.env[SCRATCH_ROOT_ENV] = base;
    delete scope["__lisaScratchRunRoot__"];

    try {
      const { installScratchRoot } =
        await import("../../../src/configs/vitest/scratch-setup.js");
      const root = installScratchRoot();

      expect(path.dirname(root)).toBe(
        fs.realpathSync(path.join(base, SCRATCH_NAMESPACE))
      );
      expect(parseRunRootName(path.basename(root))).toEqual(
        expect.objectContaining({ pid: process.pid })
      );
      expect(
        process.env["TMPDIR"],
        "installScratchRoot() created a run root but did not point TMPDIR at " +
          "it, so every fixture would still write to the shared directory"
      ).toBe(root);
      expect(process.env["TMP"]).toBe(root);
      expect(process.env["TEMP"]).toBe(root);
      expect(os.tmpdir()).toBe(root);
    } finally {
      scope["__lisaScratchRunRoot__"] = previousMemo;
      scope["__lisaScratchRunRootHandleV1__"] = previousHandle;
      if (previousOverride === undefined) {
        delete process.env[SCRATCH_ROOT_ENV];
      } else {
        process.env[SCRATCH_ROOT_ENV] = previousOverride;
      }
      if (previousTmp !== undefined) {
        process.env["TMPDIR"] = previousTmp;
        process.env["TMP"] = previousTmp;
        process.env["TEMP"] = previousTmp;
      }
      removeScratchDir(base);
    }
  });
});

describe("stack factory wiring", () => {
  it("resolves a setup file that exists on disk", () => {
    const files = scratchSetupFiles();
    expect(files).toHaveLength(2);
    expect(files.every(file => fs.existsSync(file))).toBe(true);
  });

  it("resolves a global setup file that exists on disk", () => {
    const files = scratchGlobalSetup();
    expect(files).toHaveLength(1);
    expect(fs.existsSync(files[0] as string)).toBe(true);
  });

  it.each([
    getTypescriptVitestConfig,
    getNestjsVitestConfig,
    getCdkVitestConfig,
    getHarperFabricVitestConfig,
    getPhaserVitestConfig,
  ])("pins setup and hook ordering before suites collect", factory => {
    expect(factory().test?.sequence).toEqual({
      setupFiles: "list",
      hooks: "stack",
    });
  });
});
