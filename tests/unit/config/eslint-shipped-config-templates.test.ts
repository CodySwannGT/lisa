/**
 * Proof that the `eslint.config.ts` Lisa INSTALLS for a stack passes the ESLint
 * profile Lisa installs for that same stack.
 *
 * Both halves ship in the same release, and the template is Lisa-managed, so a
 * disagreement between them is not a host's to fix: editing the file forks it
 * from upstream and stops future refreshes. Measured on a repository upgrading
 * to 3.45.6, the Expo template assembled its config with
 * `config.push(...localConfig)` — a mutation `functional/immutable-data`
 * rejects at `error` in the very ruleset shipped beside it, so a fresh Expo
 * project was red on Lisa's own file before anyone wrote a line of app code.
 *
 * Restoring the array-literal spread is the move rather than suppressing the
 * rule. A suppression added so Lisa's own file can pass Lisa's own ruleset is
 * the pattern this repository has spent the day removing (#2795, #2798, #2787).
 *
 * The stack set is DISCOVERED, never listed: a new `<stack>/copy-overwrite`
 * carrying an `eslint.config.ts` inherits these assertions with nobody
 * remembering to add it. A stack with no matching factory export fails loudly
 * rather than being skipped.
 * @module tests/unit/config/eslint-shipped-config-templates
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";

import { getCdkConfig } from "../../../src/configs/eslint/cdk.js";
import { getExpoConfig } from "../../../src/configs/eslint/expo.js";
import { getHarperFabricConfig } from "../../../src/configs/eslint/harper-fabric.js";
import { getNestjsConfig } from "../../../src/configs/eslint/nestjs.js";
import { getPhaserConfig } from "../../../src/configs/eslint/phaser.js";
import { getTypescriptConfig } from "../../../src/configs/eslint/typescript.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The strategy directory a managed template is copied from. */
const COPY_OVERWRITE = "copy-overwrite";
/** The managed template's filename, in the template tree and in a consumer. */
const MANAGED_CONFIG = "eslint.config.ts";
/** The one stack whose template carried the defect this suite pins. */
const EXPO = "expo";

/**
 * Linting a type-aware config template is slower than a unit test's default.
 *
 * Calibrated rather than fixed: the cost here is a subprocess's, so a wall-clock
 * number measures the machine (CodySwannGT/lisa#2822). A per-case budget also
 * overrides the file-level one silently, which is how the pre-push gate stayed
 * red after CodySwannGT/lisa#2888 raised it (CodySwannGT/lisa#2894).
 */
const LINT_TIMEOUT_MS = ioLatencyBudgetMs(300_000);

/** Options every shipped factory accepts. */
type FactoryOptions = {
  readonly tsconfigRootDir: string;
  readonly ignorePatterns: readonly string[];
};

/**
 *
 */
type Factory = (options: FactoryOptions) => unknown;

/**
 * The factory each stack's template imports from `@codyswann/lisa/eslint/*`.
 * Keyed by stack directory, which is also the published subpath.
 */
const FACTORIES: Readonly<Record<string, Factory>> = {
  cdk: getCdkConfig as Factory,
  expo: getExpoConfig as Factory,
  "harper-fabric": getHarperFabricConfig as Factory,
  nestjs: getNestjsConfig as Factory,
  phaser: getPhaserConfig as Factory,
  typescript: getTypescriptConfig as Factory,
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Every stack that ships a managed `eslint.config.ts`.
 * @returns Stack directory names, sorted
 */
function discoverStacksShippingEslintConfig(): readonly string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .filter(name =>
      fs.existsSync(path.join(REPO_ROOT, name, COPY_OVERWRITE, MANAGED_CONFIG))
    )
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
}

const STACKS = discoverStacksShippingEslintConfig();

/**
 * The managed `eslint.config.ts` Lisa ships for a stack.
 * @param stack - Stack directory to read from
 * @returns The template source
 */
function readShippedTemplate(stack: string): string {
  return fs.readFileSync(
    path.join(REPO_ROOT, stack, COPY_OVERWRITE, MANAGED_CONFIG),
    "utf-8"
  );
}

/**
 * A consumer-shaped checkout holding one stack's managed template and the
 * project-owned files it reads, exactly as a fresh apply leaves them.
 *
 * The `@codyswann/lisa/eslint/*` subpath resolves straight to the factory
 * SOURCE rather than through `dist/`, which sibling suites delete and rebuild
 * mid-run (#1824).
 * @param stack - Stack directory whose template to install
 * @param managedSource - Template body, defaulting to the shipped file
 * @returns Absolute path to the fixture
 */
function createConsumer(stack: string, managedSource?: string): string {
  const fixture = fs.mkdtempSync(
    path.join(tmpdir(), `lisa-eslintcfg-${stack}-`)
  );
  tempDirs.push(fixture);

  fs.writeFileSync(
    path.join(fixture, MANAGED_CONFIG),
    managedSource ?? readShippedTemplate(stack)
  );
  fs.writeFileSync(
    path.join(fixture, "eslint.config.local.ts"),
    "export default [];\n"
  );
  fs.writeFileSync(
    path.join(fixture, "eslint.ignore.config.json"),
    JSON.stringify({ ignores: [] })
  );
  fs.writeFileSync(path.join(fixture, "eslint.thresholds.json"), "{}");
  fs.writeFileSync(
    path.join(fixture, "tsconfig.eslint.json"),
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: "preserve",
        moduleResolution: "bundler",
        noEmit: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
        typeRoots: [path.join(REPO_ROOT, "node_modules", "@types")],
        types: ["node"],
        paths: {
          [`@codyswann/lisa/eslint/${stack}`]: [
            path.join(REPO_ROOT, "src", "configs", "eslint", `${stack}.ts`),
          ],
        },
      },
      include: [MANAGED_CONFIG, "eslint.config.local.ts"],
    })
  );
  return fixture;
}

/**
 * Error-level findings the shipped profile reports for a fixture's template.
 * @param stack - Stack whose profile to build
 * @param fixture - Consumer-shaped checkout to lint
 * @returns One `line:col rule — message` line per error
 */
async function errorsInTemplate(
  stack: string,
  fixture: string
): Promise<readonly string[]> {
  const factory = FACTORIES[stack];
  if (!factory) {
    throw new Error(
      `No shipped ESLint factory is wired for stack "${stack}". A new stack ` +
        `template must be added to FACTORIES, never silently skipped.`
    );
  }
  const eslint = new ESLint({
    cwd: fixture,
    overrideConfigFile: true,
    overrideConfig: factory({
      tsconfigRootDir: fixture,
      ignorePatterns: [],
    }) as ESLint.Options["overrideConfig"],
  });
  const results = await eslint.lintFiles([path.join(fixture, MANAGED_CONFIG)]);
  return results.flatMap(result =>
    result.messages
      .filter(message => message.severity === 2)
      .map(
        message =>
          `${message.line}:${message.column} ${message.ruleId} — ${message.message}`
      )
  );
}

describe("shipped eslint.config.ts templates pass the shipped ruleset", () => {
  it("discovers the stacks that ship a managed eslint config", () => {
    // An empty discovery set would make every assertion below vacuously true.
    // Zero is never a pass here.
    expect(STACKS.length).toBeGreaterThan(0);
    expect(STACKS).toContain(EXPO);
  });

  it.each(STACKS.map(stack => [stack]))(
    "%s reports no error-level finding in the template Lisa ships",
    async stack => {
      expect(await errorsInTemplate(stack, createConsumer(stack))).toEqual([]);
    },
    LINT_TIMEOUT_MS
  );

  it(
    "still reports an error when the template actually mutates its config",
    async () => {
      // The negative control. Without it, a harness that had stopped reporting
      // — a profile that resolves to nothing, a type-aware rule silently
      // disabled because `tsconfig.eslint.json` did not include the file —
      // would make every assertion above pass for the wrong reason.
      const mutating = readShippedTemplate(EXPO).replace(
        /const config: ReturnType<typeof getExpoConfig> = \[\n([\s\S]*?)\n\];/,
        (_match, body: string) =>
          `const config: ReturnType<typeof getExpoConfig> = [\n${body
            .split("\n")
            .filter(line => !line.includes("localConfig"))
            .join(
              "\n"
            )}\n];\n\nconfig.push(...(localConfig as unknown as ReturnType<typeof getExpoConfig>));`
      );

      const errors = await errorsInTemplate(
        EXPO,
        createConsumer(EXPO, mutating)
      );

      // The exact finding measured on 3.45.6, minus the line number the
      // reconstruction shifts.
      expect(errors.join("\n")).toContain(
        "functional/immutable-data — Modifying an array is not allowed."
      );
    },
    LINT_TIMEOUT_MS
  );
});
