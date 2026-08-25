/**
 * Every shipped copy of an edit-time script must resolve through the façade,
 * and the population must be read from the repository rather than written down.
 *
 * #2839's own criterion put the count at 29 and the parent measured 30; the
 * number today is different again. Every stated count in this epic has been
 * wrong at least once, and a criterion pinned to a stale literal either passes
 * vacuously or blocks on a file that does not exist. So nothing here is
 * counted in prose: the list IS the count, and it comes from `git ls-files`.
 *
 * WHAT THE CONTROL DOES NOT ASSERT, and why. #2839's Scenario 6 also asks that
 * "no copy retains a hardcoded tool name". As written that contradicts the two
 * criteria beside it — an undeclared project must see NO change, and the
 * overwhelming majority of projects declare nothing, so the written-in tool has
 * to remain as the fallback. Deleting it would not satisfy the equivalence
 * control; it would break it.
 *
 * #3007 carried the clause forward verbatim and measured the one reading that
 * looked like it could hold: move every tool name out of the ~30 script copies
 * into the shared helper, so no *copy* names a tool. That does not satisfy the
 * clause either — it RELOCATES the violation into a file this same suite
 * enumerates and asserts byte-identical across every hook directory, of which
 * there are more than a dozen. Any scheme that preserves the undeclared
 * project's command must keep the tool name in some shipped artifact, so the
 * clause is satisfiable only under a definition of "copy" narrow enough to
 * exclude wherever the name was moved to. That makes it a claim about file
 * layout, not about who decides — and who decides is the property the epic is
 * about.
 *
 * So the clause is superseded, not implemented, and the half that is coherent
 * is what this suite enforces: no copy may resolve its tool WITHOUT consulting
 * the declaration first. That ordering is what makes a project able to take the
 * hook over; the presence of a fallback underneath it is not.
 *
 * @module tests/integration/edit-time-copies-are-derived
 */

import { spawnSync } from "node:child_process";
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Wall-clock ceiling for the repository enumeration. */
const GIT_TIMEOUT_MS = 30_000;

/** The shared façade helper, by basename. */
const HELPER = "lisa-edit-gate.sh";

/** The call every copy must make before it resolves a tool. */
const RESOLVES = "lisa_edit_gate_tasks";

/**
 * Tracked paths matching a set of `git ls-files` patterns.
 * @param patterns The patterns to enumerate.
 * @returns Repository-relative paths, unsorted.
 */
const gitLines = (patterns: readonly string[]): string[] => {
  const result = spawnSync("/usr/bin/env", ["git", "ls-files", ...patterns], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed (${result.status}); the population could not be ` +
        `enumerated, so a passing suite would mean nothing.`
    );
  }
  return (result.stdout ?? "").split("\n").filter(line => line.trim() !== "");
};

/** A stack manifest's hook table, as this derivation reads it. */
interface StackManifest {
  hooks?: Record<
    string,
    { matcher?: string; hooks?: { command?: string }[] }[]
  >;
}

/**
 * The hook script basenames one stack registers on the agent write boundary.
 * @param stack Repository-relative path to the stack's plugin source.
 * @returns Basenames of the scripts it registers at a tool moment.
 */
const editTimeNamesIn = (stack: string): string[] => {
  const manifestPath = path.join(
    REPO_ROOT,
    stack,
    ".claude-plugin",
    "plugin.json"
  );
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  ) as StackManifest;
  return Object.entries(manifest.hooks ?? {})
    .filter(([event]) => event === "PreToolUse" || event === "PostToolUse")
    .flatMap(([, matchers]) => matchers)
    .filter(matcher => (matcher.matcher ?? "").includes("Write"))
    .flatMap(matcher => matcher.hooks ?? [])
    .map(hook => path.basename((hook.command ?? "").trim()));
};

/**
 * Every edit-time hook script name, derived from the stack manifests.
 *
 * The names come from the manifests: every hook a stack registers at
 * `PreToolUse` or `PostToolUse` on the write matcher. That is what "edit-time
 * script" MEANS, and reading it here is what let the two `PreToolUse` refusal
 * hooks join this population by being fixed rather than by a suffix being
 * edited into a test. The earlier version globbed `*-on-edit.sh`, which is a
 * naming convention and not a moment: `block-suppress-directives.sh` and
 * `block-migration-edits.sh` fire on the same boundary and were invisible to
 * it, which is exactly how they went unwired for a release.
 *
 * The stacks are those that SHIP THE FAÇADE HELPER beside their hooks, which is
 * a property of the repository rather than a list. It excludes exactly one
 * stack — harper-fabric, whose two write-matcher hooks prove properties the
 * gate registry has no id for, so there is nothing a project could declare to
 * take them over, and demanding the façade of them would demand a consult of a
 * declaration that cannot exist. That gap is real and is recorded in #3007; it
 * is not silently swept in here.
 * @returns The basenames, deduplicated.
 */
const editTimeNames = (): string[] => {
  const names = new Set(
    gitLines([`plugins/src/*/hooks/${HELPER}`])
      .map(helper => path.dirname(path.dirname(helper)))
      .flatMap(editTimeNamesIn)
  );
  if (names.size === 0) {
    throw new Error(
      "no edit-time hook names were derived from the stack manifests; a " +
        "passing suite would mean nothing."
    );
  }
  return [...names];
};

/**
 * Every tracked edit-time script Lisa ships, across every agent surface.
 *
 * DERIVED. A copy added to a new agent surface tomorrow joins these assertions
 * with no test edited, which is the property the criterion is actually about —
 * the literal count in it is not.
 *
 * SHIPPED locations only. The globs alone also match the pinned pre-façade
 * snapshots under `tests/fixtures`, which deliberately do NOT consult the
 * declaration — that is what makes them the "before" half of the equivalence
 * controls. Sweeping them in would demand the façade of a file whose whole
 * purpose is to predate it. The exclusion is by ROOT, not by name, so a
 * genuinely shipped copy can never be excluded by being called something
 * fixture-ish, and the assertion below proves no test path survived.
 * @returns Repository-relative paths, sorted.
 */
const shippedCopies = (): string[] => {
  const names = editTimeNames();
  return gitLines([
    ...names.map(name => `plugins/**/${name}`),
    ...names.map(name => `src/**/${name}`),
  ]).sort((left, right) => left.localeCompare(right));
};

describe("every shipped edit-time copy resolves through the façade", () => {
  it("enumerates the population from the repository", () => {
    const copies = shippedCopies();

    // Not a count assertion — a "the enumeration produced something"
    // assertion. An empty list would make every case below pass while proving
    // nothing, which is the failure mode this epic exists to remove.
    expect(copies.length).toBeGreaterThan(20);
    // No test path may reach the population, or the control would be asserting
    // the façade of a fixture.
    expect(copies.filter(copy => copy.startsWith("tests/"))).toEqual([]);
    expect(copies.some(copy => copy.startsWith("plugins/src/"))).toBe(true);
    expect(copies.some(copy => copy.startsWith("src/codex/"))).toBe(true);
    expect(
      copies.some(copy => /^plugins\/lisa-[a-z-]+\/hooks\//.test(copy))
    ).toBe(true);
  });

  it.each(shippedCopies())("%s consults the declaration", copy => {
    expect(fs.readFileSync(path.join(REPO_ROOT, copy), "utf8")).toContain(
      RESOLVES
    );
  });

  it.each(shippedCopies())("%s ships the helper beside it", copy => {
    // Sourcing a file that is not installed alongside would make the façade
    // unreachable on that surface while the call site read as wired.
    expect(
      fs.existsSync(path.join(REPO_ROOT, path.dirname(copy), HELPER)),
      `${path.dirname(copy)} has no ${HELPER}`
    ).toBe(true);
  });

  it.each(shippedCopies())(
    "%s consults the declaration BEFORE it resolves a tool",
    copy => {
      // Order is the whole property. A façade consulted after the tool has
      // already been resolved and found missing has not stopped the refusal
      // that criterion three is about.
      const source = fs.readFileSync(path.join(REPO_ROOT, copy), "utf8");
      const consults = source.indexOf(RESOLVES);
      const resolves = source.search(
        /(node_modules\/\.bin|command -v (oxlint|prettier|ast-grep|sg|rubocop)|bundle exec)/
      );

      expect(consults).toBeGreaterThan(-1);
      if (resolves > -1) expect(consults).toBeLessThan(resolves);
    }
  );

  it("keeps every copy of the helper byte-identical", () => {
    // Four source trees ship it and the generators fan it out; a copy that
    // drifted would give one agent surface a different answer to the same
    // declaration.
    const helpers = spawnSync(
      "/usr/bin/env",
      ["git", "ls-files", `plugins/**/${HELPER}`, `src/**/${HELPER}`],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
      }
    );
    const paths = (helpers.stdout ?? "")
      .split("\n")
      .filter(line => line.trim() !== "");
    const bodies = new Set(
      paths.map(file => fs.readFileSync(path.join(REPO_ROOT, file), "utf8"))
    );

    expect(paths.length).toBeGreaterThan(3);
    expect([...bodies]).toHaveLength(1);
  });
});
