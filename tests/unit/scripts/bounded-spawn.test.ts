/**
 * Tests for the shared child-start deadline: its behaviour, and its
 * byte-identical materialization into every lane that imports it.
 *
 * The property under test is not "children have a `timeout:`". It is **a guard
 * cannot return a verdict from a child that never finished** — which is a
 * different and stronger claim, because the fail-open spelling this module
 * exists to remove looks exactly like correct handling:
 *
 * ```js
 * return result.status === 0 ? result.stdout : null;
 * ```
 *
 * `status === 0` is false for a killed child AND for a program that ran and
 * exited non-zero, so a busy machine produces the same value a clean negative
 * does. Every behavioural case below exists to pin one half of that
 * discrimination.
 * @module tests/unit/scripts/bounded-spawn
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasOwnershipHeader,
  withoutOwnershipHeader,
} from "../../../scripts/materialize-copy-overwrite.mjs";
import {
  boundedExecFileSync,
  boundedSpawnSync,
  DEFAULT_CHILD_BUDGET_MS,
  isChildTimeout,
  rethrowIfChildTimeout,
} from "../../../scripts/lib/bounded-spawn.mjs";

const REPO_ROOT = process.cwd();

/** The one editable copy. */
const CANONICAL_REL = "scripts/lib/bounded-spawn.mjs";

/** The generator that must keep every lane copy in step with it. */
const GENERATOR_REL = "scripts/build-plugins.sh";

/**
 * Lanes that must carry a copy.
 *
 * DECLARED, never discovered. A roster derived from the copies that happen to
 * exist cannot notice a copy being deleted — it would simply compare the
 * survivors and pass, which is the exact roster defect this issue is about
 * (a conformance scan whose predicate is narrower than the property it claims).
 * So the list is written here, the existence of each copy is asserted, and a
 * deleted copy fails loudly rather than silently reducing the sweep.
 */
const HELPER_LANES = ["all", "typescript", "expo"] as const;

/** A short deadline for cases that must actually reach it. */
const SHORT_MS = 200;

/** A deadline long enough that a fast child never reaches it. */
const AMPLE_MS = 30_000;

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");

/**
 * The materialized copy of the helper in one lane.
 * @param lane - Project-type lane.
 * @returns Repo-relative path of that lane's copy.
 */
const laneCopy = (lane: string): string =>
  `${lane}/copy-overwrite/scripts/lib/bounded-spawn.mjs`;

describe("a killed child is told apart from one that answered", () => {
  it("throws rather than returning the empty-streamed result spawnSync hands back", () => {
    // THE CENTRAL CASE. Without the throw this returns `{ status: null,
    // stdout: "" }`, and every `status === 0 ? out : null` call site reads that
    // as a clean negative.
    let caught: unknown;
    try {
      boundedSpawnSync("/bin/sleep", ["5"], {
        encoding: "utf8",
        timeout: SHORT_MS,
      });
    } catch (error) {
      caught = error;
    }
    expect(isChildTimeout(caught)).toBe(true);
  });

  it("returns normally, with real streams, when the child merely exits non-zero", () => {
    // The other half of the discrimination. A guard must still be able to read
    // "the command said no" — that is a verdict, not a failure to get one.
    const result = boundedSpawnSync("/bin/sh", ["-c", "echo out; exit 3"], {
      encoding: "utf8",
      timeout: AMPLE_MS,
    });
    expect(result.status).toBe(3);
    expect(String(result.stdout).trim()).toBe("out");
    expect(isChildTimeout(result.error)).toBe(false);
  });

  it("does not call a missing binary a timeout", () => {
    // ENOENT is a real, repeatable answer about the environment. Folding it
    // into "timed out" would hide a broken install behind a retryable-looking
    // error, and would make a permanently broken guard look like a flaky one.
    const result = boundedSpawnSync("/definitely/not/here", [], {
      encoding: "utf8",
    });
    expect(isChildTimeout(result.error)).toBe(false);
    expect((result.error as { code?: string } | undefined)?.code).toBe(
      "ENOENT"
    );
  });

  it("recognises the timeout execFileSync throws, which is a different code path", () => {
    // `execFileSync` throws on a timeout where `spawnSync` returns; both must
    // answer the same question the same way or the 29 catch blocks would have
    // to ask it two ways.
    let caught: unknown;
    try {
      boundedExecFileSync("/bin/sleep", ["5"], {
        encoding: "utf8",
        timeout: SHORT_MS,
      });
    } catch (error) {
      caught = error;
    }
    expect(isChildTimeout(caught)).toBe(true);
  });

  it("applies a deadline when the caller states none", () => {
    // The default is what makes an unconverted call site safe the moment it
    // routes through here. A helper that only honoured an explicit `timeout:`
    // would leave the forgetful call site exactly as unbounded as before.
    expect(DEFAULT_CHILD_BUDGET_MS).toBeGreaterThan(0);
    const source = read(CANONICAL_REL);
    expect(source).toContain(
      "timeout: options.timeout ?? DEFAULT_CHILD_BUDGET_MS"
    );
    expect(source).toContain('killSignal: "SIGKILL"');
  });
});

describe("isChildTimeout answers safely for anything a catch can bind", () => {
  it.each([
    ["an ordinary error", new Error("nope")],
    ["a string", "ETIMEDOUT"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 60],
    ["an object with no code", {}],
  ])("is false for %s", (_label, value) => {
    // A `catch` binding is `unknown`, and a thrown non-object is legal
    // JavaScript. A guard being careful must not crash for its trouble.
    expect(isChildTimeout(value)).toBe(false);
  });

  it("is true only for the platform's own marker", () => {
    expect(isChildTimeout({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("re-raises a timeout and swallows nothing else", () => {
    expect(() => {
      rethrowIfChildTimeout({ code: "ETIMEDOUT" });
    }).toThrow();
    expect(() => {
      rethrowIfChildTimeout(new Error("ordinary"));
    }).not.toThrow();
    expect(() => {
      rethrowIfChildTimeout("a string");
    }).not.toThrow();
  });

  it("re-raises the ORIGINAL value, not a wrapper", () => {
    // A wrapped error loses the `code` the next frame up needs to make the
    // same decision, so the second `catch` in a chain would swallow it.
    const original = { code: "ETIMEDOUT", marker: Symbol.for("original") };
    try {
      rethrowIfChildTimeout(original);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBe(original);
    }
  });
});

describe("shared deadline wiring", () => {
  it("carries a copy in every declared lane, failing on a MISSING one", () => {
    // The assertion the roster exists for. `expect(exists).toBe(true)` per
    // DECLARED lane means deleting a copy fails here; a test that iterated the
    // copies it found would compare the survivors and pass.
    for (const lane of HELPER_LANES) {
      const copy = laneCopy(lane);
      expect(
        fs.existsSync(path.join(REPO_ROOT, copy)),
        `${copy} is missing. It is materialized by ${GENERATOR_REL}; a lane ` +
          `that imports the helper and has no copy fails to resolve at run ` +
          `time, and a roster derived from surviving copies would not notice.`
      ).toBe(true);
    }
  });

  it("materializes byte-identical copies into every lane", () => {
    const canonical = read(CANONICAL_REL);
    for (const lane of HELPER_LANES) {
      const copy = laneCopy(lane);
      expect(withoutOwnershipHeader(read(copy), copy), copy).toBe(canonical);
    }
  });

  it("stamps the ownership header on every copy, and on no canonical source", () => {
    for (const lane of HELPER_LANES) {
      expect(hasOwnershipHeader(read(laneCopy(lane))), laneCopy(lane)).toBe(
        true
      );
    }
    expect(hasOwnershipHeader(read(CANONICAL_REL))).toBe(false);
  });

  it("keeps the declared lanes and the generator's lanes in step", () => {
    // Both halves of the wiring, compared to each other. Adding a lane to the
    // generator without adding it here would leave the new copy unchecked;
    // adding it here without the generator would fail the existence case above
    // with a confusing message about a file nobody generates.
    const generator = read(GENERATOR_REL);
    const declared = [...HELPER_LANES].join(" ");
    expect(
      generator,
      `${GENERATOR_REL} must materialize bounded-spawn.mjs into exactly the ` +
        `lanes this suite declares (${declared}).`
    ).toContain(`for spawn_lane in ${declared}; do`);
  });

  it("guards the materialize step on the generator as well as the source", () => {
    // This script runs against isolated fixtures that vendor `scripts/lib/`
    // but not the repository's own `scripts/*.mjs`, so testing the source
    // alone would find it present and then fail the whole build on a missing
    // materializer.
    const generator = read(GENERATOR_REL);
    expect(generator).toContain(
      'if [ -f "$ROOT_DIR/scripts/lib/bounded-spawn.mjs" ] &&'
    );
    expect(generator).toContain(
      '[ -f "$ROOT_DIR/scripts/materialize-copy-overwrite.mjs" ]; then'
    );
  });
});
