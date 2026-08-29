/**
 * The documented run-recorder invocation has to resolve where it is documented
 * to be run.
 *
 * ## The defect this refutes, and the measurement that found it
 *
 * CodySwannGT/lisa#3433. Six skills documented the run recorder as
 *
 * ```bash
 * node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" ...
 * ```
 *
 * and `CLAUDE_PLUGIN_ROOT` is **not exported into an agent's Bash tool
 * environment**. Measured 2026-08-29 from a consumer repository's root (node
 * v22.22.0, lisa 4.23.1), the whole documented surface was dead and only an
 * undocumented path worked:
 *
 * | invocation | exit |
 * |---|---|
 * | `node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" --help` | **1** |
 * | `node plugins/lisa/scripts/automation-run-record.mjs --help` | **1** |
 * | `node plugins/src/base/scripts/automation-run-record.mjs --help` | **1** |
 * | `node node_modules/@codyswann/lisa/plugins/lisa/scripts/automation-run-record.mjs --help` | 0 |
 *
 * `env` reported **zero** `CLAUDE_*` variables, so the first form expanded to an
 * absolute `/scripts/automation-run-record.mjs`. The two documented fallbacks are
 * relative to the **Lisa package root** while the recorder is invoked from the
 * **consumer repository root**, so neither resolved either.
 *
 * The cost was not that the command failed loudly. It was that every caller
 * routed around it privately: transcript history across sessions showed the
 * invocation forked three ways — ~43 calls node_modules-relative, ~36 through an
 * absolute marketplace path, ~10 through an absolute plugin-cache path. Which
 * copy of the recorder actually ran became accidental, and the copies do not
 * always agree about their flag surface. `automation-runbook-contract` says a
 * registered loop run that stops without recording its outcome is a contract
 * violation; the contract was being held up entirely by agents improvising
 * around its own instructions.
 *
 * ## Why this file executes the command instead of only reading it
 *
 * The defect is "the documented text does not resolve", so a case that only
 * pattern-matches the text is asserting against the same class of mistake that
 * produced it — a path can look plausible and still not exist. {@link RESOLVES}
 * therefore builds a synthetic consumer repository and runs the extracted
 * command line in it, with `CLAUDE_PLUGIN_ROOT` genuinely unset.
 *
 * {@link BITE} is the control. It runs the same harness against a deliberately
 * wrong recorder path and requires a non-zero exit, so a harness that passes
 * everything cannot report the resolution case as green.
 *
 * ## The second rule, which is not the first one
 *
 * A default that is correct on a command line is NOT automatically correct in
 * an `import()`. `node node_modules/…/x.mjs` resolves the bare relative path
 * against the cwd; `import("node_modules/…/x.mjs")` reads it as a **package
 * specifier** and fails with `ERR_MODULE_NOT_FOUND: Cannot find package
 * 'node_modules'` before the module is read. Measured both ways in the same
 * sandbox, the `./`-prefixed form being the control that loads.
 *
 * `lisa-linear-build-intake` documents the denominator helper through an
 * `import()`, so its default carries a `./` that the recorder's deliberately
 * does not. {@link SPECIFIERS} holds that distinction, and it too has a bite
 * control requiring a bare specifier to still fail.
 * @module tests/integration/documented-run-recorder-invocation
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const ROOT = path.resolve(__dirname, "..", "..");

/** Every plugin variant ships its own copy of each skill; all are checked. */
const PLUGINS_DIR = path.join(ROOT, "plugins");

/**
 * The prefix a consumer repository resolves the package through.
 *
 * This is the only prefix that resolves from a consumer repository root, which
 * is the directory the recorder is invoked from. It is asserted rather than
 * merely used, so a future move of the shipped scripts fails here by name.
 */
const CONSUMER_PREFIX = "node_modules/@codyswann/lisa/plugins/lisa";

/** The recorder, relative to a plugin root. */
const RECORDER_SUFFIX = "scripts/automation-run-record.mjs";

/** The dead form, spelled out so a regression is named rather than inferred. */
const DEAD_FORM = `"\${CLAUDE_PLUGIN_ROOT}/${RECORDER_SUFFIX}"`;

/**
 * The two fallback paths the skills used to name, both package-root-relative.
 *
 * Kept as literals because the regression to guard against is someone
 * re-introducing exactly these spellings while "simplifying" the prose.
 */
const DEAD_FALLBACKS: readonly string[] = [
  `plugins/lisa/${RECORDER_SUFFIX}`,
  `plugins/src/base/${RECORDER_SUFFIX}`,
];

/** Matches a documented recorder invocation and captures its plugin-root expression. */
const INVOCATION = /^node "([^"]+)\/scripts\/automation-run-record\.mjs"/gm;

/**
 * Matches a documented `import()` of a plugin script, capturing its argument.
 *
 * A separate pattern from {@link INVOCATION} because the two resolve under
 * different rules, which is the whole point of {@link SPECIFIERS}.
 *
 * The argument is captured whole rather than as a quoted string: these
 * `import()` calls sit inside `node -e '…'` blocks, where the specifier is
 * assembled by shell quote-juggling (`"'"${VAR}"'/scripts/x.mjs"`) and so
 * contains quote characters of its own. {@link shellConcatenated} joins it back
 * up.
 */
const DOCUMENTED_IMPORT = /import\(([^)]*\/scripts\/[\w-]+\.mjs[^)]*)\)/g;

/**
 * Specifier prefixes `import()` treats as a PATH rather than a package name.
 *
 * Everything else is a bare specifier and is looked up as a package, so a
 * documented `import("node_modules/…")` fails with
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'node_modules'`.
 */
const PATH_PREFIXES: readonly string[] = ["./", "../", "/", "file:"];

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Every `SKILL.md` that ships, repository-relative.
 * @returns Repository-relative paths.
 */
function shippedSkills(): string[] {
  return fs
    .globSync("**/SKILL.md", { cwd: PLUGINS_DIR })
    .map(rel => path.join("plugins", rel));
}

/**
 * The plugin-root expressions a skill documents for the recorder.
 * @param relative - Repository-relative `SKILL.md` path.
 * @returns One entry per documented invocation, in file order.
 */
function documentedRoots(relative: string): string[] {
  const body = fs.readFileSync(path.join(ROOT, relative), "utf8");
  return [...body.matchAll(INVOCATION)].map(match => match[1]);
}

/** Every skill that documents the recorder at all, with its expressions. */
const DOCUMENTED: readonly { file: string; roots: string[] }[] = shippedSkills()
  .map(file => ({ file, roots: documentedRoots(file) }))
  .filter(entry => entry.roots.length > 0);

/**
 * A consumer repository: the package reachable only through `node_modules`.
 *
 * Symlinked rather than copied so the case runs against the artifacts this
 * build just produced, not a snapshot of them.
 * @returns The synthetic repository root.
 */
function consumerRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-recorder-"));
  const parent = path.join(
    dir,
    "node_modules",
    "@codyswann",
    "lisa",
    "plugins"
  );
  tempDirs.push(dir);
  fs.mkdirSync(parent, { recursive: true });
  fs.symlinkSync(path.join(PLUGINS_DIR, "lisa"), path.join(parent, "lisa"));
  return dir;
}

/**
 * Run a documented plugin-root expression from a consumer repository root.
 *
 * `CLAUDE_PLUGIN_ROOT` is removed from the environment rather than set empty:
 * an empty-but-present variable defeats a `:-` default, so setting it would
 * test the opposite of the reported condition.
 * @param root - The plugin-root expression, verbatim from the skill text.
 * @param cwd - The consumer repository root.
 * @param env - Extra environment, e.g. an exported `CLAUDE_PLUGIN_ROOT`.
 * @returns The child's exit status and merged output.
 */
function runDocumented(
  root: string,
  cwd: string,
  env: Record<string, string> = {}
): { status: number | null; output: string } {
  const { CLAUDE_PLUGIN_ROOT: _dropped, ...clean } = process.env;
  const run = boundedSpawnSync({
    label: `documented recorder invocation (${root})`,
    command: "/bin/sh",
    args: ["-c", `node "${root}/${RECORDER_SUFFIX}" --help`],
    cwd,
    env: { ...clean, ...env },
  });
  return {
    status: run.status,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/**
 * The one string a shell builds out of an adjacent-quoted argument.
 *
 * `"'"${VAR}"'/scripts/x.mjs"` is four concatenated pieces to a shell and one
 * specifier to Node. Dropping the quote characters is exactly that join, and it
 * is what makes the leading `./` visible to the assertions below.
 * @param argument - The raw `import()` argument, quotes and all.
 * @returns The specifier Node receives.
 */
function shellConcatenated(argument: string): string {
  return argument.replaceAll('"', "").replaceAll("'", "");
}

/**
 * Every documented `import()` specifier, with `CLAUDE_PLUGIN_ROOT` unset.
 *
 * The `${CLAUDE_PLUGIN_ROOT:-default}` expansion is applied here rather than by
 * a shell, because the property under test is what the DEFAULT resolves to.
 */
const SPECIFIERS: readonly { file: string; specifier: string }[] =
  shippedSkills().flatMap(file => {
    const body = fs.readFileSync(path.join(ROOT, file), "utf8");
    return [...body.matchAll(DOCUMENTED_IMPORT)].map(match => ({
      file,
      specifier: shellConcatenated(match[1]).replace(
        /\$\{CLAUDE_PLUGIN_ROOT:-([^}]*)\}/g,
        "$1"
      ),
    }));
  });

/**
 * Import a documented specifier from a consumer repository root.
 * @param specifier - The specifier, with its default already expanded.
 * @param cwd - The consumer repository root.
 * @returns The child's exit status and merged output.
 */
function importDocumented(
  specifier: string,
  cwd: string
): { status: number | null; output: string } {
  const { CLAUDE_PLUGIN_ROOT: _dropped, ...clean } = process.env;
  const run = boundedSpawnSync({
    label: `documented import (${specifier})`,
    command: process.execPath,
    args: [
      "-e",
      `import(${JSON.stringify(specifier)}).then(() => process.exit(0)).catch(error => { console.error(error.code, error.message); process.exit(1); })`,
    ],
    cwd,
    env: clean,
  });
  return {
    status: run.status,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

/** The resolution case's name, referenced from this file's module docs. */
const RESOLVES =
  "resolves and exits 0 from a consumer repository root with CLAUDE_PLUGIN_ROOT unset";

/** The control's name, referenced from this file's module docs. */
const BITE = "BITE CONTROL: a wrong recorder path still exits non-zero";

describe("the documented run-recorder invocation", () => {
  it("is documented by at least one shipped skill", () => {
    // Guards the whole file against passing vacuously if the invocation is
    // renamed or the glob stops matching: every case below iterates DOCUMENTED.
    expect(DOCUMENTED.length).toBeGreaterThan(0);
  });

  it("ships the recorder at the path a consumer repository resolves", () => {
    expect(
      fs.existsSync(path.join(ROOT, "plugins", "lisa", RECORDER_SUFFIX)),
      `${CONSUMER_PREFIX}/${RECORDER_SUFFIX} is the only prefix that resolves from a consumer repository root, so the shipped scripts must live there`
    ).toBe(true);
  });

  it("never documents the bare ${CLAUDE_PLUGIN_ROOT} form", () => {
    const offenders = DOCUMENTED.filter(entry =>
      entry.roots.includes("${CLAUDE_PLUGIN_ROOT}")
    ).map(entry => entry.file);
    expect(
      offenders,
      `${DEAD_FORM} expands to an absolute /${RECORDER_SUFFIX} whenever CLAUDE_PLUGIN_ROOT is unset, which is the normal case inside an agent's Bash tool. Use a \${CLAUDE_PLUGIN_ROOT:-${CONSUMER_PREFIX}} default instead`
    ).toEqual([]);
  });

  it("never documents a package-root-relative fallback path", () => {
    const offenders = shippedSkills().filter(file => {
      const body = fs.readFileSync(path.join(ROOT, file), "utf8");
      return DEAD_FALLBACKS.some(dead => body.includes(dead));
    });
    expect(
      offenders,
      `these paths are relative to the Lisa package root, not to the consumer repository the recorder is invoked from, so they exit 1 there: ${DEAD_FALLBACKS.join(", ")}`
    ).toEqual([]);
  });

  it(RESOLVES, () => {
    const cwd = consumerRepo();
    const roots = [...new Set(DOCUMENTED.flatMap(entry => entry.roots))];
    for (const root of roots) {
      const { status, output } = runDocumented(root, cwd);
      expect(
        status,
        `the documented plugin-root expression ${root} did not resolve from a consumer repository root:\n${output}`
      ).toBe(0);
    }
  });

  it("still honours an exported CLAUDE_PLUGIN_ROOT", () => {
    // The `:-` default must not shadow a real value: a host that does export
    // the variable has to keep reaching its own plugin root.
    const cwd = consumerRepo();
    const exported = path.join(PLUGINS_DIR, "lisa");
    for (const root of new Set(DOCUMENTED.flatMap(entry => entry.roots))) {
      const { status, output } = runDocumented(root, os.tmpdir(), {
        CLAUDE_PLUGIN_ROOT: exported,
      });
      expect(
        status,
        `${root} did not honour an exported CLAUDE_PLUGIN_ROOT (${exported}), run from a directory with no node_modules:\n${output}`
      ).toBe(0);
    }
    expect(fs.existsSync(cwd)).toBe(true);
  });

  it("never documents an import() of a plugin script as a bare specifier", () => {
    // A `node <path>` command line resolves a bare relative path against the
    // cwd; `import()` does NOT. It reads anything without a path prefix as a
    // PACKAGE name, so the same string that works on the command line raises
    // `Cannot find package 'node_modules'` inside an import. The two defaults
    // in these skills therefore differ by exactly this `./`, on purpose.
    expect(SPECIFIERS.length).toBeGreaterThan(0);
    const bare = SPECIFIERS.filter(
      entry => !PATH_PREFIXES.some(prefix => entry.specifier.startsWith(prefix))
    ).map(entry => `${entry.file}: import("${entry.specifier}")`);
    expect(
      bare,
      `import() resolves a specifier with no ./ ../ / or file: prefix as a package name, so these fail with ERR_MODULE_NOT_FOUND before the module is ever read`
    ).toEqual([]);
  });

  it("resolves every documented import() from a consumer repository root", () => {
    const cwd = consumerRepo();
    for (const specifier of new Set(SPECIFIERS.map(entry => entry.specifier))) {
      const { status, output } = importDocumented(specifier, cwd);
      expect(
        status,
        `the documented import specifier ${specifier} did not resolve from a consumer repository root:\n${output}`
      ).toBe(0);
    }
  });

  it("BITE CONTROL: a bare import specifier still fails", () => {
    // Pairs with the two cases above the way BITE pairs with RESOLVES: without
    // it, "every documented import resolves" could be green because the import
    // harness reports success unconditionally.
    const cwd = consumerRepo();
    const { status, output } = importDocumented(
      "node_modules/@codyswann/lisa/plugins/lisa/scripts/intake-prework-denominator.mjs",
      cwd
    );
    expect(
      status,
      `a bare node_modules/... specifier imported successfully, so this harness cannot tell a package specifier from a path:\n${output}`
    ).not.toBe(0);
    expect(output).toContain("ERR_MODULE_NOT_FOUND");
  });

  it(BITE, () => {
    // Without this the resolution case could be green because the harness
    // passes everything. A wrong path has to reach a non-zero exit through the
    // same code path.
    const cwd = consumerRepo();
    const { status, output } = runDocumented(
      "node_modules/@codyswann/lisa/plugins/does-not-exist",
      cwd
    );
    expect(
      status,
      `a deliberately wrong recorder path exited 0, so this harness cannot tell a resolvable path from an unresolvable one:\n${output}`
    ).not.toBe(0);
  });
});
