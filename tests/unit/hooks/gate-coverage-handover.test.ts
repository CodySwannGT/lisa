/**
 * A built-in hook step stands down only for its OWN property.
 *
 * The registry handover was all-or-nothing: the runner exited 0 and both hooks
 * skipped their entire built-in block. Exit 0 says the gates that were declared
 * passed — it says nothing about whether the block covers the properties those
 * steps prove, so a `gates` block declaring `code-style` and silent about
 * `credential-leakage` deleted the secret scan by omission. A control returning
 * success for an input it never examined is the exact defect the gate registry
 * exists to prevent.
 *
 * The handover is now per property. The runner writes the covered gate ids to
 * the file named by `--coverage`, and each step consults only its own. This
 * file asserts both halves of that contract, because they live in two languages
 * in four files and nothing else holds them together:
 *
 * - the runner writes the right ids, and still withholds the moment from a
 *   caller that did NOT pass `--coverage` (an older hook, whose only lever is
 *   all-or-nothing);
 * - the shell reader is exact and fail-safe, and every id the hooks name is one
 *   the runner can actually emit — an id outside that vocabulary would be a
 *   step that can never stand down, or worse, a typo nobody notices.
 * The companion file gate-coverage-errored-leg.test.ts asserts the other
 * half: that a leg which ran and ERRORED cannot stand a built-in step down.
 * Both share the apparatus in gate-coverage-harness.ts.
 * @module tests/unit/hooks/gate-coverage-handover
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupStagedDirs,
  covers,
  HOOKS,
  ROOT,
  runRunner,
} from "../../helpers/gate-coverage-harness.js";

import {
  BUILTIN_FLOOR,
  CONDITIONAL_FLOOR,
  EXIT,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

const LEAKAGE = "credential-leakage";
const STYLE = "code-style";
const SLOW = "code-style-slow";

afterAll(cleanupStagedDirs);

describe("the runner reports what it covers", () => {
  it("writes one declared floor id per line", () => {
    const { status, covered } = runRunner(
      { [STYLE]: { commit: "off" }, [LEAKAGE]: { commit: "off" } },
      "commit"
    );
    expect(status).toBe(EXIT.PROVED);
    expect(covered).toEqual([STYLE, LEAKAGE]);
  });

  it("takes the moment even when the block is half-declared", () => {
    // The whole point: the registry runs what it declares, the built-ins run
    // the rest. Withholding the moment from a per-step caller would keep an
    // incrementally migrating project stuck on the pre-registry path.
    const { status, covered, stdout } = runRunner(
      { [STYLE]: { commit: "off" } },
      "commit"
    );
    expect(status).toBe(EXIT.PROVED);
    expect(covered).toEqual([STYLE]);
    expect(covered).not.toContain(LEAKAGE);
    expect(stdout).toContain(LEAKAGE);
  });

  it("still withholds it from a caller that cannot skip per step", () => {
    // An older hook paired with a newer runner has only the all-or-nothing
    // lever, so for it the floor veto must survive exactly as it was.
    const { status } = runRunner(
      { [STYLE]: { commit: "off" } },
      "commit",
      false
    );
    expect(status).toBe(EXIT.NO_GATES);
  });

  it("covers nothing, in a written file, when there is no gates block", () => {
    const { status, covered } = runRunner(null, "commit");
    expect(status).toBe(EXIT.NO_GATES);
    expect(covered).toEqual([]);
  });
});

describe.each(HOOKS)("$file reads coverage exactly", ({ file }) => {
  it("stands a step down only on a whole-line match", () => {
    expect(covers(file, [LEAKAGE], LEAKAGE)).toBe(true);
    expect(covers(file, [LEAKAGE], STYLE)).toBe(false);
  });

  it("does not let one id satisfy another it is a prefix of", () => {
    // `code-style` and `code-style-slow` are a real shipped pair. A substring
    // match would let the fast lint gate stand the slow lint step down.
    expect(covers(file, [STYLE], SLOW)).toBe(false);
    expect(covers(file, [SLOW], STYLE)).toBe(false);
  });

  it("requires every id when a step proves more than one property", () => {
    expect(covers(file, [STYLE, LEAKAGE], STYLE, LEAKAGE)).toBe(true);
    expect(covers(file, [STYLE], STYLE, LEAKAGE)).toBe(false);
  });

  it("answers no for an empty file and for no file at all", () => {
    // Fail-safe: every route to "I do not know" runs the built-in step.
    expect(covers(file, [], LEAKAGE)).toBe(false);
    expect(covers(file, null, LEAKAGE)).toBe(false);
  });
});

describe.each(HOOKS)("$file names only real properties", ({ file, moment }) => {
  it("guards every step with ids the runner can emit", () => {
    const vocabulary = new Set([
      ...(BUILTIN_FLOOR[moment] ?? []),
      ...(CONDITIONAL_FLOOR[moment] ?? []).map(
        (entry: { id: string }) => entry.id
      ),
    ]);
    const used = [
      ...readFileSync(path.join(ROOT, file), "utf8").matchAll(
        /^if lisa_gate_covers ([\w -]+); then$/gmu
      ),
    ].flatMap(match => (match[1] ?? "").trim().split(/\s+/u));

    // An id outside the vocabulary is a step that can never stand down — a
    // silent no-op rather than a loud failure, so nothing else would catch it.
    expect(used.length).toBeGreaterThan(2);
    expect(used.filter(id => !vocabulary.has(id))).toEqual([]);
  });
});
