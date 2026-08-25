/**
 * The two `PreToolUse` refusal scripts must resolve their gate before they
 * refuse anything.
 *
 * #2957 wired the façade into the five `PostToolUse` on-edit scripts and left
 * these two out on purpose: they have no `cd "$CLAUDE_PROJECT_DIR"` — they act
 * on the payload, so the helper's `.lisa.config.json` lookup had no directory
 * to resolve against — and getting a refusal hook wrong blocks or unblocks
 * every agent write rather than mistiming a lint. #3007 carries the unmet
 * clause verbatim, and this is the control it asked for.
 *
 * WHAT THIS SUITE EXECUTES. The shipped scripts, unmodified, with a JSON
 * payload on stdin, in a temporary project. Not greps: whether a declaration
 * is consulted is a question about what RUNS, and a grep for the helper's name
 * passes against a call on an unreachable branch.
 *
 * THE NEGATIVE CONTROLS ARE NOT DECORATION. This repository has shipped guards
 * that report success while inert AND guards that refuse everything, and a
 * suite that only asserts "the declared task ran" passes against both. So every
 * subject carries a payload that must be REFUSED and a payload that must be
 * PERMITTED, and both are asserted declared and undeclared.
 *
 * Equivalence with the pre-change scripts, and the one branch where it is
 * deliberately broken, are in `pre-tool-refusal-equivalence`.
 *
 * @module tests/integration/pre-tool-refusal-scripts-resolve-gates
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DECLARED_TASK,
  PERMITTED,
  REFUSED,
  SUBJECTS,
} from "./support/pre-tool-refusal-fixture.js";
import { createHarness } from "./support/pre-tool-refusal-harness.js";
import type { Harness } from "./support/pre-tool-refusal-harness.js";

describe("the pre-tool refusal scripts resolve their gate before refusing", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe("a project that declares its own task gets it", () => {
    it.each(SUBJECTS)("$script runs the declared task", async subject => {
      await harness.declare(subject);

      const { trace } = await harness.run(
        await harness.installShipped(subject),
        subject.refuses
      );

      expect(trace).toContain(`TASK:${DECLARED_TASK}`);
    });

    it.each(SUBJECTS)(
      "$script lets the declared task decide a write its built-in refuses",
      async subject => {
        // The whole point, and the assertion a grep cannot make. The payload is
        // the one the written-in check exists to block; with a passing declared
        // task in charge the write goes through, which is only possible if the
        // built-in never ran.
        await harness.declare(subject);

        const { status } = await harness.run(
          await harness.installShipped(subject),
          subject.refuses
        );

        expect(status).toBe(PERMITTED);
      }
    );

    it.each(SUBJECTS)(
      "$script refuses when the declared task fails",
      async subject => {
        // The other half. A façade that stands the built-in down and then
        // ignores what the project's own check said would be worse than no
        // façade: it would permit everything while reading as governed.
        await harness.declare(subject);

        const { status, trace } = await harness.run(
          await harness.installShipped(subject),
          subject.refuses,
          { taskExit: "1" }
        );

        expect(trace).toContain(`TASK:${DECLARED_TASK}`);
        expect(status).toBe(REFUSED);
      }
    );

    it.each(SUBJECTS)(
      "$script still permits an ordinary write with a declaration in place",
      async subject => {
        // NEGATIVE CONTROL. A script that refuses everything satisfies every
        // assertion above about refusal; this is the one it fails.
        await harness.declare(subject);

        const { status } = await harness.run(
          await harness.installShipped(subject),
          subject.permits
        );

        expect(status).toBe(PERMITTED);
      }
    );
  });

  describe("an undeclared project is still guarded by the built-in", () => {
    it.each(SUBJECTS)(
      "$script refuses the write it exists to stop",
      async subject => {
        // NEGATIVE CONTROL, the other direction. A façade that stood down
        // whenever the resolver could not answer would permit this, and every
        // "the declared task ran" assertion above would still pass.
        await harness.undeclare();

        const { status, trace } = await harness.run(
          await harness.installShipped(subject),
          subject.refuses
        );

        expect(trace).toBe("");
        expect(status).toBe(REFUSED);
      }
    );

    it.each(SUBJECTS)("$script permits an ordinary write", async subject => {
      await harness.undeclare();

      const { status } = await harness.run(
        await harness.installShipped(subject),
        subject.permits
      );

      expect(status).toBe(PERMITTED);
    });
  });
});
