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
 * control; it would break it. The clause is carried to a follow-up verbatim
 * rather than reworded here, and what this suite enforces instead is the half
 * that is coherent: no copy may resolve its tool WITHOUT consulting the
 * declaration first.
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
 * Every tracked edit-time script Lisa ships, across every agent surface.
 *
 * DERIVED. A copy added to a new agent surface tomorrow joins these assertions
 * with no test edited, which is the property the criterion is actually about —
 * the literal count in it is not.
 * @returns Repository-relative paths, sorted.
 */
const shippedCopies = (): string[] => {
  const result = spawnSync(
    "/usr/bin/env",
    ["git", "ls-files", "*-on-edit.sh"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: GIT_TIMEOUT_MS }
  );
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed (${result.status}); the population could not be ` +
        `enumerated, so a passing suite would mean nothing.`
    );
  }
  return (result.stdout ?? "")
    .split("\n")
    .filter(line => line.trim() !== "")
    .sort((left, right) => left.localeCompare(right));
};

describe("every shipped edit-time copy resolves through the façade", () => {
  it("enumerates the population from the repository", () => {
    const copies = shippedCopies();

    // Not a count assertion — a "the enumeration produced something"
    // assertion. An empty list would make every case below pass while proving
    // nothing, which is the failure mode this epic exists to remove.
    expect(copies.length).toBeGreaterThan(20);
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
      ["git", "ls-files", `*${HELPER}`],
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
