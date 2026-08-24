/**
 * An apply that has nobody to ask must not answer for the operator.
 *
 * `core/lisa-owned-templates` states the intent in prose: `tsconfig.json`,
 * `knip.json`, and `eslint.config.ts` "are seeded by Lisa and then edited
 * downstream, so a non-interactive apply must never replace them without being
 * asked." `CopyOverwriteStrategy` implemented only half of that. It read
 * "non-interactive" as `config.skipGitCheck` — the postinstall's flag, not the
 * command's — and every other route fell through to `promptOverwrite`.
 *
 * On a run with no TTY that callback is not a question. `createPrompter`
 * handed back a prompter that answers "yes" without asking anyone, so a bare
 * `lisa apply` in any agent, script, or CI shell replaced the host's edited
 * file and reported it under "Overwritten: N files (approved or Lisa-owned)".
 * Nobody approved it and Lisa does not own it; the absence of a terminal was
 * being read as consent (#3026).
 *
 * Measured against the published 3.70.0 tarball in a consumer-shaped checkout,
 * with no `--yes` passed: `knip.json`, `eslint.config.ts`, and `tsconfig.json`
 * all lost their host customisations in one run.
 *
 * The cases below drive the strategy directly with a `promptOverwrite` that
 * answers "yes", exactly as the auto-accepting prompter does. That is
 * deliberate: if the fix worked only because a new prompter says "no", the
 * routing defect would still be there for anything that builds a context by
 * hand. What has to hold is that an unattended run never reaches the prompt
 * branch at all.
 * @module tests/unit/strategies/copy-overwrite-unattended-consent
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

/** A managed file Lisa seeds and hosts legitimately customise. */
const MANAGED = "knip.json";

/** What the host wrote into it, and the only place this text appears. */
const HOST_COPY = '{ "ignoreDependencies": ["host-owned-package"] }\n';

/** What the packaged template would replace it with. */
const PACKAGED_COPY = '{ "ignoreDependencies": [] }\n';

describe("copy-overwrite on an unattended apply (#3026)", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcFile: string;
  let destFile: string;
  let backedUp: readonly string[];
  let prompted: number;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    backedUp = [];
    prompted = 0;
    srcFile = path.join(tempDir, "src", MANAGED);
    destFile = path.join(tempDir, "dest", MANAGED);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(srcFile, PACKAGED_COPY);
    await fs.writeFile(destFile, HOST_COPY);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build the context an apply runs with.
   *
   * `promptOverwrite` answers "yes" in every case here — the point is which
   * branch the file reaches, not what an imaginary operator would have said.
   * @param overrides - What this case varies from the default apply
   * @param overrides.config - Config fields this case varies
   * @param overrides.unattended - Whether the run has an operator to ask
   * @returns Strategy context for the apply under test
   */
  function applyContext(
    overrides: {
      readonly config?: Partial<LisaConfig>;
      readonly unattended?: boolean;
    } = {}
  ): StrategyContext {
    const config: LisaConfig = {
      lisaDir: path.dirname(srcFile),
      destDir: path.dirname(destFile),
      dryRun: false,
      yesMode: false,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides.config,
    };
    return {
      config,
      ...(overrides.unattended === undefined
        ? {}
        : { unattended: overrides.unattended }),
      backupFile: async absolutePath => {
        backedUp = [...backedUp, absolutePath];
      },
      promptOverwrite: async () => {
        prompted += 1;
        return true;
      },
    };
  }

  /**
   * Run the strategy against the staged pair.
   * @param context - Context the apply runs with
   * @returns The action the strategy reported
   */
  async function run(context: StrategyContext): Promise<string> {
    const result = await strategy.apply(srcFile, destFile, MANAGED, context);
    return result.action;
  }

  /**
   * The managed file as it stands on disk after the apply.
   * @returns Contents of the installed file
   */
  async function installed(): Promise<string> {
    return fs.readFile(destFile, "utf8");
  }

  it("leaves the host's customised file exactly as it was", async () => {
    await run(applyContext({ unattended: true }));

    expect(await installed()).toBe(HOST_COPY);
  });

  it("never asks a prompt there is nobody to answer", async () => {
    await run(applyContext({ unattended: true }));

    expect(prompted).toBe(0);
  });

  it("reports the file as out of date rather than skipped or overwritten", async () => {
    // `skipped` is the bucket the summary prints as "identical or create-only".
    // Counting an undelivered template change there is how a shipped fix
    // reaches nobody with nothing in the output to say so.
    expect(await run(applyContext({ unattended: true }))).toBe("stale");
  });

  it("still replaces the file when the operator passed --yes", async () => {
    const action = await run(
      applyContext({ config: { yesMode: true }, unattended: false })
    );

    expect(action).toBe("overwritten");
    expect(await installed()).toBe(PACKAGED_COPY);
  });

  it("still asks when a terminal is there to answer", async () => {
    await run(applyContext({ unattended: false }));

    expect(prompted).toBe(1);
  });

  it("still delivers when the operator named the file to --refresh-templates", async () => {
    // The exit a preserved file's remediation points at. Refusing on the
    // unattended route and then ignoring the one flag that means "take
    // upstream's version" would leave an operator with a file Lisa never
    // updates and advice that does nothing.
    const action = await run(
      applyContext({
        unattended: true,
        config: { refreshTemplates: { mode: "paths", paths: [MANAGED] } },
      })
    );

    expect(action).toBe("overwritten");
    expect(await installed()).toBe(PACKAGED_COPY);
    expect(backedUp).toContain(destFile);
  });
});
