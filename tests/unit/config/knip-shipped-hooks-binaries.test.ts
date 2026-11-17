/**
 * Proof that the git hooks Lisa INSTALLS pass the dead-code gate Lisa installs
 * alongside them, with no binary excused.
 *
 * Both halves ship in the same release and are both Lisa-managed, so a
 * disagreement between them is not a host's to fix: editing either file forks
 * it from upstream and stops future refreshes. Measured on a repository
 * upgrading to 3.45.6, a single such disagreement — `printf`, invoked by the
 * shipped `commit-msg` hook — was the entire red pre-push dead-code gate, and
 * every project running a full apply reproduced it out of the box.
 *
 * That was once answered by listing `printf` in every shipped `ignoreBinaries`.
 * Knip 6 knows the shell builtins itself, and the shipped hooks route the
 * dependency audit through `node scripts/lisa-audit.mjs` rather than a package
 * manager's `audit` subcommand, so nothing remains to excuse: the shipped
 * configs carry no `ignoreBinaries` at all (CodySwannGT/lisa#4932), and this
 * suite proves the hooks still report no unlisted binary without one.
 *
 * The pairing is DISCOVERED, never listed: a new `<stack>/copy-overwrite`
 * carrying a `knip.json` inherits these assertions with nobody remembering to
 * add it.
 * @module tests/unit/config/knip-shipped-hooks-binaries
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const KNIP_BIN = path.join(REPO_ROOT, "node_modules", "knip", "bin", "knip.js");

/** Where the git hooks Lisa copies into every TypeScript-descended stack live. */
const SHIPPED_HOOKS_DIR = path.join(
  REPO_ROOT,
  "typescript",
  "copy-contents",
  ".husky"
);

/**
 * A knip run over a small fixture is slower than a unit test's default.
 *
 * Calibrated rather than fixed. As a bare 120_000 this sat BELOW the 300s
 * file-level budget CodySwannGT/lisa#2888 raised, and silently overrode it —
 * a cap nothing in the inventory could see, because it was spelled as a name
 * (CodySwannGT/lisa#2822, CodySwannGT/lisa#2894).
 */
const KNIP_TIMEOUT_MS = ioLatencyBudgetMs(120_000);

/**
 * The hook file names knip's husky plugin actually reads. Anything else in the
 * shipped `.husky` tree (`pre-push.local`, `pre-push.verify`) is invisible to
 * the gate and is deliberately left out rather than silently assumed covered.
 */
const SCANNED_HOOK_NAMES: readonly string[] = [
  "prepare-commit-msg",
  "commit-msg",
  "pre-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "pre-push",
  "pre-rebase",
  "pre-receive",
  "post-checkout",
  "post-commit",
  "post-merge",
  "post-rewrite",
];

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Every shipped hook file knip's husky plugin will read.
 * @returns Absolute paths, sorted, of the hooks under test
 */
function discoverShippedHooks(): readonly string[] {
  return fs
    .readdirSync(SHIPPED_HOOKS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && SCANNED_HOOK_NAMES.includes(entry.name))
    .map(entry => path.join(SHIPPED_HOOKS_DIR, entry.name))
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
}

/**
 * Where a stack keeps the `knip.json` every host receives.
 * @param stack - Stack directory name
 * @returns Absolute path to that stack's shipped config
 */
function shippedKnipConfig(stack: string): string {
  return path.join(REPO_ROOT, stack, "copy-overwrite", "knip.json");
}

/**
 * Every stack that ships a `knip.json` next to those hooks.
 * @returns Stack directory names, sorted
 */
function discoverStacksShippingKnip(): readonly string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .filter(name => fs.existsSync(shippedKnipConfig(name)))
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
}

const SHIPPED_HOOKS = discoverShippedHooks();
const STACKS = discoverStacksShippingKnip();

/**
 * A consumer-shaped checkout holding the shipped hooks and one stack's shipped
 * `knip.json`, exactly as a full apply leaves them.
 * @param stack - Stack directory whose `knip.json` to install
 * @param extraHooks - Additional `.husky` files, by name, for control cases
 * @returns Absolute path to the fixture
 */
function createConsumer(
  stack: string,
  extraHooks: Readonly<Record<string, string>> = {}
): string {
  const fixture = fs.mkdtempSync(path.join(tmpdir(), `lisa-knip-${stack}-`));
  tempDirs.push(fixture);
  fs.mkdirSync(path.join(fixture, ".husky"));
  fs.mkdirSync(path.join(fixture, "src"));

  for (const hook of SHIPPED_HOOKS) {
    fs.copyFileSync(hook, path.join(fixture, ".husky", path.basename(hook)));
  }
  for (const [name, body] of Object.entries(extraHooks)) {
    fs.writeFileSync(path.join(fixture, ".husky", name), body);
  }

  fs.copyFileSync(shippedKnipConfig(stack), path.join(fixture, "knip.json"));
  fs.writeFileSync(
    path.join(fixture, "src", "index.ts"),
    "export const x = 1;"
  );
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    // The husky plugin is gated on the dependency being present, which is what
    // a stack that ships these hooks always has.
    JSON.stringify({
      name: "consumer",
      private: true,
      devDependencies: { husky: "9.1.7" },
    })
  );
  return fixture;
}

/**
 * Unlisted-binary findings the shipped gate reports for a fixture.
 * @param fixture - Consumer-shaped checkout to scan
 * @returns One `hook: binary` line per finding, sorted
 */
function unlistedBinaries(fixture: string): readonly string[] {
  const result = boundedSpawnSync({
    label: "knip --include binaries over the fixture",
    command: process.execPath,
    args: [
      KNIP_BIN,
      "--include",
      "binaries",
      "--no-config-hints",
      "--reporter",
      "json",
    ],
    cwd: fixture,
    baseMs: 30_000,
  });
  const parsed = JSON.parse(result.stdout) as {
    issues?: readonly {
      file: string;
      binaries?: readonly { name: string }[];
    }[];
  };
  return (parsed.issues ?? [])
    .flatMap(issue =>
      (issue.binaries ?? []).map(binary => `${issue.file}: ${binary.name}`)
    )
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
}

describe("shipped git hooks pass the shipped dead-code gate", () => {
  it("discovers the hooks and the stacks that ship a knip config", () => {
    // An empty discovery set on either side would make every assertion below
    // vacuously true. Zero is never a pass here.
    expect(SHIPPED_HOOKS.length).toBeGreaterThan(0);
    expect(STACKS.length).toBeGreaterThan(0);
    expect(SHIPPED_HOOKS.map(hook => path.basename(hook))).toContain(
      "commit-msg"
    );
  });

  it.each(STACKS.map(stack => [stack]))(
    "%s ships no ignoreBinaries and reports no unlisted binary in any hook Lisa ships",
    stack => {
      const config = JSON.parse(
        fs.readFileSync(shippedKnipConfig(stack), "utf8")
      ) as Record<string, unknown>;
      // Checked first: a binary excused by the config would make the scan
      // below pass for the wrong reason.
      expect(config).not.toHaveProperty("ignoreBinaries");
      expect(unlistedBinaries(createConsumer(stack))).toEqual([]);
    },
    KNIP_TIMEOUT_MS
  );

  it(
    "still reports an unlisted binary when one is actually there",
    () => {
      // The negative control. Without it, a harness that had stopped reporting
      // — a knip that fails to parse the hooks, a plugin that never enables —
      // would make every assertion above pass for the wrong reason. knip 6
      // treats a hook's bare commands as optional and reports only what a
      // package manager runs, so the control is the exact call the shipped
      // hooks stopped making: Yarn's `audit` subcommand.
      const fixture = createConsumer(STACKS[0] ?? "typescript", {
        "pre-merge-commit": "#!/bin/sh\nyarn audit --groups dependencies\n",
      });

      expect(unlistedBinaries(fixture)).toContain(
        ".husky/pre-merge-commit: audit"
      );
    },
    KNIP_TIMEOUT_MS
  );
});
