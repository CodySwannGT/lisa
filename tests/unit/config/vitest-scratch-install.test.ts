import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
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
import { createScratchNamespaceAuthority } from "../../../src/configs/vitest/scratch-authority.js";
import { withProcessPlatformTempRoot } from "../../helpers/platform-temp-root.js";
import {
  createScratchOwnerRecord,
  processBirthFingerprint,
  writeScratchOwnerRecord,
} from "../../../src/configs/vitest/scratch-owner.js";

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
    const dir = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    entries.forEach(name => {
      fs.mkdirSync(path.join(dir, name));
    });
    try {
      withProcessPlatformTempRoot(base, () => body(dir));
    } finally {
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
      }).toThrow(/without valid owner-marker authority/);
    });
  });

  it("starts normally when the namespace holds only a few live sibling runs", () => {
    withNamespace(
      [`run-${String(process.pid)}-${String(Date.now())}-abcdef`],
      dir => {
        const root = path.join(dir, fs.readdirSync(dir)[0] as string);
        const authority = createScratchNamespaceAuthority();
        writeScratchOwnerRecord(
          root,
          createScratchOwnerRecord({
            authority,
            root,
            pid: process.pid,
            processBirthFingerprint: processBirthFingerprint(process.pid),
            suiteLabel: "live-sibling-control",
            registeredPrefixes: [],
          })
        );
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
    const scope = globalThis as Record<string, unknown>;
    const previousMemo = scope["__lisaScratchRunRoot__"];
    const previousHandle = scope["__lisaScratchWorkerScopeV1__"];

    delete scope["__lisaScratchRunRoot__"];
    delete scope["__lisaScratchWorkerScopeV1__"];

    try {
      const { installScratchRoot } =
        await import("../../../src/configs/vitest/scratch-setup.js");
      const root = installScratchRoot();
      const suiteRoot = path.dirname(root);

      expect(path.basename(root)).toMatch(/^worker-/u);
      expect(path.basename(path.dirname(suiteRoot))).toBe(SCRATCH_NAMESPACE);
      expect(parseRunRootName(path.basename(suiteRoot))).toEqual(
        expect.objectContaining({ pid: expect.any(Number) })
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
      scope["__lisaScratchWorkerScopeV1__"] = previousHandle;
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
