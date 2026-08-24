/**
 * `--yes` is consent in advance, not consent to discard curated host content.
 *
 * #3026 drew the adjacent line: "no TTY is not consent." A bare `lisa apply`
 * with nobody on either end stopped inventing an approval. This file draws the
 * next one: consent given in advance is not UNCONDITIONAL consent.
 *
 * `core/lisa-owned-templates` already writes the rule down — `tsconfig.json`,
 * `knip.json` and their siblings "are seeded by Lisa and then edited
 * downstream, so a non-interactive apply must never replace them without being
 * asked." `isLisaOwnedTemplate` returns FALSE for exactly those files, and that
 * false is what is supposed to protect them.
 *
 * It does not, on this route. `preserveOwnedHostCopy` returns `undefined` for a
 * non-owned path, and with `--yes` neither `skipGitCheck` nor `unattended` is
 * set, so the file falls through to `promptOverwrite` — which `AutoAcceptPrompter`
 * answers "yes" without asking anyone. The curated file is replaced and reported
 * as approved. Nobody approved that file; they approved the run.
 *
 * The cost is not cosmetic. A curated `knip.json` replaced by a stack template
 * whose `entry` globs name directories the repository does not have makes knip
 * report "Refine entry pattern (no matches)" and stop seeing the source tree at
 * all — a gate that still passes while measuring nothing.
 * @module tests/unit/strategies/copy-overwrite-yes-preserves-curated
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** The action a curated host file must be reported under, never `overwritten`. */
const STALE = "stale";

/**
 * A curated `knip.json`: entry globs matching the repository's real layout,
 * plus the ignore list somebody built one dependency at a time.
 */
const HOST_SOURCE_GLOB = "src/**/*.ts";

/** A second glob the host curated, alongside {@link HOST_SOURCE_GLOB}. */
const HOST_LAMBDA_GLOB = "lambdas/**/*.ts";

const CURATED_KNIP = `${JSON.stringify(
  {
    entry: [HOST_SOURCE_GLOB, HOST_LAMBDA_GLOB],
    project: [HOST_SOURCE_GLOB, HOST_LAMBDA_GLOB],
    ignoreDependencies: ["curated-one", "curated-two", "curated-three"],
  },
  null,
  2
)}\n`;

/** The stack template: entry globs for directories this repository lacks. */
const TEMPLATE_KNIP = `${JSON.stringify(
  {
    entry: ["bin/**/*.ts", "lambda/**/*.ts", "functions/**/*.ts"],
    project: ["bin/**/*.ts", "lambda/**/*.ts"],
  },
  null,
  2
)}\n`;

/** A curated `tsconfig.json`, differing from upstream by one line. */
const CURATED_TSCONFIG = `${JSON.stringify(
  { compilerOptions: { baseUrl: "./", strict: true } },
  null,
  2
)}\n`;

/** The template copy, without the host's `baseUrl`. */
const TEMPLATE_TSCONFIG = `${JSON.stringify(
  { compilerOptions: { strict: true } },
  null,
  2
)}\n`;

let tempDir = "";
let strategy: CopyOverwriteStrategy;

beforeEach(async () => {
  strategy = new CopyOverwriteStrategy();
  tempDir = await createTempDir();
});

afterEach(async () => {
  await cleanupTempDir(tempDir);
});

/**
 * Seed one managed file and return the paths the strategy is called with.
 * @param relativePath Repo-relative destination path.
 * @param hostContent What the project has on disk today.
 * @param templateContent What Lisa ships.
 * @returns Source and destination absolute paths.
 */
async function seed(
  relativePath: string,
  hostContent: string,
  templateContent: string
): Promise<{ srcFile: string; destFile: string }> {
  const srcFile = path.join(tempDir, "src", relativePath);
  const destFile = path.join(tempDir, "dest", relativePath);
  await fs.ensureDir(path.dirname(srcFile));
  await fs.ensureDir(path.dirname(destFile));
  await fs.writeFile(srcFile, templateContent);
  await fs.writeFile(destFile, hostContent);
  return { srcFile, destFile };
}

/**
 * The context `lisa apply --yes` runs with.
 *
 * `yesMode` true, and `promptOverwrite` answers "yes" the way
 * `AutoAcceptPrompter` does — the flag IS the answer, so nothing is asked.
 * `skipGitCheck` stays false: that is the postinstall's flag, not the
 * command's, and the reported reproduction is identical with and without
 * `--skip-git-check`.
 * @param srcFile Packaged template path.
 * @param destFile Installed file path.
 * @param overrides Config fields a case varies.
 * @returns Strategy context for a `--yes` apply.
 */
function yesApplyContext(
  srcFile: string,
  destFile: string,
  overrides: Partial<LisaConfig> = {}
): StrategyContext {
  const config: LisaConfig = {
    lisaDir: path.dirname(srcFile),
    destDir: path.dirname(destFile),
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    skipGitCheck: false,
    harness: "claude",
    ...overrides,
  };
  return {
    config,
    backupFile: async () => {},
    promptOverwrite: async () => true,
  };
}

describe("lisa apply --yes on a repository with curated managed files", () => {
  it("keeps a curated knip.json and reports it stale", async () => {
    const { srcFile, destFile } = await seed(
      "knip.json",
      CURATED_KNIP,
      TEMPLATE_KNIP
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      "knip.json",
      yesApplyContext(srcFile, destFile)
    );

    expect(result.action).toBe(STALE);
    expect(await fs.readFile(destFile, "utf8")).toBe(CURATED_KNIP);
  });

  it("does not leave knip pointed at directories the repository lacks", async () => {
    // The concrete harm, asserted on content rather than on a verdict string.
    // A template `entry` naming `bin/` in a repository that has only `src/`
    // makes knip report "Refine entry pattern (no matches)" and measure
    // nothing, while still exiting green.
    const { srcFile, destFile } = await seed(
      "knip.json",
      CURATED_KNIP,
      TEMPLATE_KNIP
    );

    await strategy.apply(
      srcFile,
      destFile,
      "knip.json",
      yesApplyContext(srcFile, destFile)
    );

    const onDisk = JSON.parse(await fs.readFile(destFile, "utf8")) as {
      entry: string[];
      ignoreDependencies?: string[];
    };
    expect(onDisk.entry).toContain(HOST_SOURCE_GLOB);
    expect(onDisk.ignoreDependencies).toHaveLength(3);
  });

  it("keeps a curated tsconfig.json and reports it stale", async () => {
    const { srcFile, destFile } = await seed(
      "tsconfig.json",
      CURATED_TSCONFIG,
      TEMPLATE_TSCONFIG
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      "tsconfig.json",
      yesApplyContext(srcFile, destFile)
    );

    expect(result.action).toBe(STALE);
    expect(await fs.readFile(destFile, "utf8")).toContain('"baseUrl"');
  });

  it("still refreshes when the operator names the file to --refresh-templates", async () => {
    // The exit `stale` points at has to actually work, or this is not a
    // deferral — it is a refusal.
    const { srcFile, destFile } = await seed(
      "knip.json",
      CURATED_KNIP,
      TEMPLATE_KNIP
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      "knip.json",
      yesApplyContext(srcFile, destFile, {
        refreshTemplates: { mode: "paths", paths: ["knip.json"] },
      })
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf8")).toBe(TEMPLATE_KNIP);
  });

  it("still replaces eslint.config.ts, which declares that it is replaced", async () => {
    // The control, and the reason this fix cannot be a simple inversion of
    // `isLisaOwnedTemplate`. This file is NOT Lisa-owned by that predicate
    // either, yet its own header says "managed by Lisa and IS replaced on each
    // `lisa` run" and directs customization to `eslint.config.local.ts`. The
    // contract is stated and must keep being honoured, so whatever distinguishes
    // curated files from replaced ones has to be finer than owned/not-owned.
    const managed =
      "/**\n * This file is managed by Lisa and IS replaced on each `lisa` run.\n */\nexport default [];\n";
    const upstream =
      "/**\n * This file is managed by Lisa and IS replaced on each `lisa` run.\n */\nexport default [1];\n";
    const { srcFile, destFile } = await seed(
      "eslint.config.ts",
      managed,
      upstream
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      "eslint.config.ts",
      yesApplyContext(srcFile, destFile)
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf8")).toBe(upstream);
  });
});
