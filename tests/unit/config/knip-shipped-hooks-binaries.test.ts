/**
 * Proof that the git hooks Lisa INSTALLS pass the dead-code gate Lisa installs
 * alongside them.
 *
 * Both halves ship in the same release and are both Lisa-managed, so a
 * disagreement between them is not a host's to fix: editing either file forks
 * it from upstream and stops future refreshes. Measured on a repository
 * upgrading to 3.45.6, a single such disagreement — `printf`, invoked by the
 * shipped `commit-msg` hook and absent from every shipped `ignoreBinaries` —
 * was the entire red pre-push dead-code gate, and every project running a full
 * apply reproduced it out of the box.
 *
 * `printf` is a POSIX shell BUILTIN in every shell git runs a hook under, so
 * there is no tool to declare. knip's own `IGNORED_GLOBAL_BINARIES` already
 * carries that class — `echo`, `printenv`, `test`, `true` — and simply omits
 * this one. Correcting the gate's facts is the move; rewriting the hook to
 * avoid `printf` would trade away the shell-portability guarantee the hook's
 * own comment records (a POSIX/XSI `echo` honours `\c` and truncates the
 * message before `grep` ever sees the trailer — #2143).
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
 * Every stack that ships a `knip.json` next to those hooks.
 * @returns Stack directory names, sorted
 */
function discoverStacksShippingKnip(): readonly string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .filter(name =>
      fs.existsSync(path.join(REPO_ROOT, name, "copy-overwrite", "knip.json"))
    )
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

  fs.copyFileSync(
    path.join(REPO_ROOT, stack, "copy-overwrite", "knip.json"),
    path.join(fixture, "knip.json")
  );
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
    "%s reports no unlisted binary in any hook Lisa ships",
    stack => {
      expect(unlistedBinaries(createConsumer(stack))).toEqual([]);
    },
    KNIP_TIMEOUT_MS
  );

  it(
    "still reports an unlisted binary when one is actually there",
    () => {
      // The negative control. Without it, a harness that had stopped reporting
      // — a knip that fails to parse the hooks, a plugin that never enables —
      // would make every assertion above pass for the wrong reason.
      const fixture = createConsumer(STACKS[0] ?? "typescript", {
        "pre-merge-commit":
          "#!/bin/sh\nif ! lisa-not-a-real-binary | grep -q x; then exit 1; fi\n",
      });

      expect(unlistedBinaries(fixture)).toContain(
        ".husky/pre-merge-commit: lisa-not-a-real-binary"
      );
    },
    KNIP_TIMEOUT_MS
  );
});
