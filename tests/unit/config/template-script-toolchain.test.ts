/**
 * A script pinned in a parent stack's `package.lisa.json` reaches every child
 * stack, and can name a tool that stack cannot run — invisibly (#2848).
 *
 * The invisibility is the defect, not any one bad pin. `package.lisa.json`
 * layers deep-merge parent into child, so a key added to the `typescript`
 * template is written verbatim into six other stacks' `package.json`. Nothing
 * says which six, and an unreferenced script proves nothing until something
 * invokes it — which is how a Jest stack came to carry a vitest coverage
 * command that only became a failure when a hook started resolving that key,
 * four weeks later, in consumers.
 *
 * This is the class check. The pair-specific guard in
 * `coverage-unit-script-runner-parity` still stands: it asserts something
 * stronger about one pair of keys (same runner as each other) that no
 * dependency-derived check can see.
 * @module tests/unit/config/template-script-toolchain
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  commandTools,
  findToolchainViolations,
  formatViolation,
} from "../../helpers/template-toolchain.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * The fixture tree is written under real type names because the resolver
 * expands the shipped hierarchy — `typescript` is the parent layer and `expo`
 * the inheriting child. Their contents are entirely synthetic.
 */
const FIXTURE_PARENT = "typescript";
const FIXTURE_CHILD = "expo";

/** Synthetic tools and pins, chosen so nothing here matches a real package. */
const TOOL_A = "runner-a";
const TOOL_B = "runner-b";
const RANGE = "^1.0.0";
const SCRIPT_KEY = "test:cov:unit";
const COMMAND_A = `${TOOL_A} run --coverage`;
const COMMAND_B = `${TOOL_B} run --coverage`;

/**
 * A package whose binary is declared only through `directories.bin`, and the
 * binary it exposes. Deliberately distinct from {@link TOOL_A} and
 * {@link TOOL_B}: the fixture root is shared across this block, so reusing one
 * of those would leak an installed manifest into the neighbouring cases.
 */
const DIRBIN_PACKAGE = "runner-dirbin";
const DIRBIN_BINARY = "dirbin-cli";

/**
 * Write a synthetic template layer.
 * @param root - Fixture lisaDir
 * @param layer - Layer directory name
 * @param template - Template body
 */
function writeLayer(
  root: string,
  layer: string,
  template: Record<string, unknown>
): void {
  const dir = path.join(root, layer, "package-lisa");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.lisa.json"),
    JSON.stringify(template)
  );
}

/**
 * Install a synthetic package into the fixture's `node_modules`.
 * @param root - Fixture lisaDir
 * @param pkg - Package name
 * @param manifest - Its `package.json` body, beyond name and version
 * @param binFiles - Files to create under `directories.bin`, if declared
 */
function installPackage(
  root: string,
  pkg: string,
  manifest: Record<string, unknown>,
  binFiles: readonly string[] = []
): void {
  const dir = path.join(root, "node_modules", pkg);
  const declared = (manifest as { directories?: { bin?: string } }).directories
    ?.bin;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: pkg, version: "1.0.0", ...manifest })
  );
  if (declared !== undefined) {
    const binDir = path.join(dir, declared);
    fs.mkdirSync(binDir, { recursive: true });
    for (const file of binFiles) {
      fs.writeFileSync(path.join(binDir, file), "#!/usr/bin/env node\n");
    }
  }
}

describe("shipped package.lisa.json templates", () => {
  it("never hand a stack a script whose tool it is not given", async () => {
    const violations = await findToolchainViolations(REPO_ROOT);
    expect(violations.map(formatViolation)).toStrictEqual([]);
  });

  it("refuse to return a verdict with no installed packages to read a bin from", async () => {
    // Binary names come from each installed package's own `bin` field. Guessed
    // from names instead, the map cannot see that `@playwright/test` provides
    // `playwright`, and the check would report a stack that is fine as broken
    // — or, worse, quietly return nothing at all.
    await expect(
      findToolchainViolations(path.join(REPO_ROOT, "no-such-lisa-dir"))
    ).rejects.toThrow(/install dependencies/u);
  });
});

describe("commandTools", () => {
  it("reads the executable through leading environment assignments", () => {
    expect(commandTools("NODE_ENV=test jest --coverage")).toStrictEqual([
      "jest",
    ]);
  });

  it("reads every command in a chain", () => {
    expect(commandTools("oxlint && eslint . --quiet")).toStrictEqual([
      "oxlint",
      "eslint",
    ]);
  });

  it("does not split on a separator inside quotes", () => {
    expect(
      commandTools(`node -e "if (a) process.exit(0); process.exit(1);"`)
    ).toStrictEqual(["node"]);
  });

  it("ignores a tool an on-demand runner fetches", () => {
    expect(commandTools("npx some-cli@latest .")).toStrictEqual([]);
  });

  it("ignores a sibling script a package manager delegates to", () => {
    expect(
      commandTools(
        "bun run build:dist && node scripts/x.mjs",
        new Set(["build:dist"])
      )
    ).toStrictEqual(["node"]);
  });

  it("reads a binary `bun run` falls through to when no such script exists", () => {
    // Bun's documented resolution order is scripts, then source files, then
    // `node_modules/.bin`, then $PATH. So `bun run vitest` in a stack with no
    // `vitest` script runs the vitest BINARY, and treating every `bun` command
    // as script delegation let a stack missing that dependency pass this check
    // reporting nothing at all.
    expect(
      commandTools("bun run vitest", new Set(["build:dist"]))
    ).toStrictEqual(["vitest"]);
  });

  it("still ignores the delegated word for a manager with no binary fallback", () => {
    // `npm run <name>` fails when no such script exists rather than falling
    // through to a binary, so the next word really is always a sibling script.
    // Reading it as a tool would invent a violation.
    expect(commandTools("npm run vitest", new Set())).toStrictEqual([]);
  });

  it("looks past flags between the verb and the binary", () => {
    expect(commandTools("bun run --silent vitest", new Set())).toStrictEqual([
      "vitest",
    ]);
  });
});

describe("the check itself", () => {
  // eslint-disable-next-line functional/no-let -- Fixture root is created once
  let root = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-toolchain-"));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * Run the check over the fixture tree.
   * @returns Formatted violations
   */
  const run = async (): Promise<readonly string[]> =>
    (
      await findToolchainViolations(root, {
        types: [FIXTURE_PARENT, FIXTURE_CHILD],
        nodeModulesDir: path.join(root, "node_modules"),
      })
    ).map(formatViolation);

  it("fails when an inherited pin names a tool the child is not given, even though nothing invokes it", async () => {
    writeLayer(root, FIXTURE_PARENT, {
      force: {
        scripts: { [SCRIPT_KEY]: COMMAND_A },
        devDependencies: { [TOOL_A]: RANGE },
      },
    });
    writeLayer(root, FIXTURE_CHILD, {
      force: { devDependencies: { [TOOL_B]: RANGE } },
      remove: { devDependencies: [TOOL_A] },
    });

    const violations = await run();

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(FIXTURE_CHILD);
    expect(violations[0]).toContain(SCRIPT_KEY);
    expect(violations[0]).toContain(TOOL_A);
    expect(violations[0]).toContain(`inherited from ${FIXTURE_PARENT}`);
  });

  it("sees the binaries a package exposes only through directories.bin", async () => {
    // npm exposes every file in `directories.bin` as an executable. Reading
    // only `bin`, this package appeared to provide NOTHING — so the binary its
    // script invokes was governed by no package at all, and a child that drops
    // the dependency passed a check whose entire job is to catch that. The
    // failure direction matters: the check did not report a false violation,
    // it reported success while proving nothing.
    installPackage(root, DIRBIN_PACKAGE, { directories: { bin: "cli" } }, [
      DIRBIN_BINARY,
    ]);
    writeLayer(root, FIXTURE_PARENT, {
      force: {
        scripts: { [SCRIPT_KEY]: `${DIRBIN_BINARY} --check` },
        devDependencies: { [DIRBIN_PACKAGE]: RANGE },
      },
    });
    writeLayer(root, FIXTURE_CHILD, {
      remove: { devDependencies: [DIRBIN_PACKAGE] },
    });

    const violations = await run();

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(FIXTURE_CHILD);
    expect(violations[0]).toContain(DIRBIN_BINARY);
    expect(violations[0]).toContain(DIRBIN_PACKAGE);
  });

  it("exonerates a child that overrides the inherited script", async () => {
    writeLayer(root, FIXTURE_PARENT, {
      force: {
        scripts: { [SCRIPT_KEY]: COMMAND_A },
        devDependencies: { [TOOL_A]: RANGE },
      },
    });
    writeLayer(root, FIXTURE_CHILD, {
      force: {
        scripts: { [SCRIPT_KEY]: COMMAND_B },
        devDependencies: { [TOOL_B]: RANGE },
      },
      remove: { devDependencies: [TOOL_A] },
    });

    expect(await run()).toStrictEqual([]);
  });

  it("covers a newly added parent pin with no roster edited", async () => {
    writeLayer(root, FIXTURE_PARENT, {
      force: {
        scripts: {
          [SCRIPT_KEY]: COMMAND_B,
          "audit:licences": `${TOOL_A} scan`,
        },
        devDependencies: { [TOOL_A]: RANGE, [TOOL_B]: RANGE },
      },
    });
    writeLayer(root, FIXTURE_CHILD, {
      force: {
        scripts: { [SCRIPT_KEY]: COMMAND_B },
        devDependencies: { [TOOL_B]: RANGE },
      },
      remove: { devDependencies: [TOOL_A] },
    });

    const violations = await run();

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("audit:licences");
  });

  it("ignores a tool no stack pins, which the host supplies", async () => {
    writeLayer(root, FIXTURE_PARENT, {
      force: { scripts: { typecheck: "tsc --noEmit" } },
    });
    writeLayer(root, FIXTURE_CHILD, { force: {} });

    expect(await run()).toStrictEqual([]);
  });
});
