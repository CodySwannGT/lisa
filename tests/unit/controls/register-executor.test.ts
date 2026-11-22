/**
 * What the control register says about a pull-request check that runs from a
 * pipeline file Lisa did not write.
 *
 * Lisa ships the pull-request executor for one hosting platform. On any other
 * the host's agent writes the file, and because Lisa did not write it, every
 * entry it runs reads unproved until both halves of that entry's proof are on
 * record (CodySwannGT/lisa#4991).
 */
import { describe, expect, it } from "vitest";

import {
  EXECUTOR_KEY,
  LISA_WRITTEN_PLATFORM,
  PULL_REQUEST_MOMENT,
  withProofStatus,
} from "../../../src/controls/pull-request-executor.js";
import { serializeControlRegister } from "../../../src/controls/register.js";
import { CONTROL_ENTRY_STATUSES } from "../../../src/controls/register-types.js";
import {
  F_MIXED_GATES,
  F_NONE_GATES,
  F_PAVED_GATES,
  registerSchemaErrors,
  shippedGates,
} from "../../helpers/control-register.js";
import {
  LISA_WRITTEN,
  PIPELINE,
  registerForGates,
  unprovedIds,
  withExecutor,
} from "./support/executor-fixtures.js";
import { entryOf, registerOf } from "./support/register-build.js";

const LINT_API = "code-style@api";
const LINT_WEB = "code-style@web";
const TYPES_WEB = "type-correctness@web";
const MIXED = withExecutor(F_MIXED_GATES);

describe("the names the register and the gate registry share", () => {
  it("are the same in both", async () => {
    const registry = (await shippedGates()) as unknown as Readonly<
      Record<string, unknown>
    >;

    expect(PULL_REQUEST_MOMENT).toBe(registry.PULL_REQUEST);
    expect(EXECUTOR_KEY).toBe(registry.EXECUTOR_FIELD);
    expect(LISA_WRITTEN_PLATFORM).toBe(registry.LISA_EXECUTOR_PLATFORM);
    expect(CONTROL_ENTRY_STATUSES).toEqual(["unproved"]);
  });
});

describe("a declared pull-request executor", () => {
  it("is recorded on the pull-request enforcement point and no other", async () => {
    const entry = entryOf(await registerForGates(MIXED), LINT_API);

    expect(entry.enforcement_points).toEqual([
      { moment: "commit", level: "required", location: "local-checkout" },
      {
        moment: "pull-request",
        level: "required",
        location: "hosting-platform",
        executor: PIPELINE,
      },
    ]);
  });

  it("is recorded without the project's own keys", async () => {
    const register = await registerForGates(
      withExecutor(F_MIXED_GATES, { ...PIPELINE, "x-note": "owned by ops" })
    );

    expect(entryOf(register, LINT_API).enforcement_points[1]?.executor).toEqual(
      PIPELINE
    );
  });

  it("is not recorded for a gate that is off at pull-request", async () => {
    const register = await registerForGates({
      "x-lint": {
        run: "lint",
        commit: "required",
        "pull-request": { level: "off", executor: PIPELINE },
      },
    });

    expect(entryOf(register, "x-lint@.")).toMatchObject({
      enforcement_points: [
        { moment: "commit", level: "required", location: "local-checkout" },
      ],
    });
    expect(unprovedIds(register)).toEqual([]);
  });
});

describe("a non-GitHub executor starts unproved", () => {
  it("on every entry it runs, and on no other", async () => {
    const register = await registerForGates(MIXED);

    expect(unprovedIds(register)).toEqual([LINT_API, LINT_WEB]);
    expect(entryOf(register, TYPES_WEB)).not.toHaveProperty("status");
  });

  it("on a repository with one part, a paved-road one and an awaited check", async () => {
    expect(
      unprovedIds(await registerForGates(withExecutor(F_NONE_GATES)))
    ).toEqual(["code-style@.", "coverage-adequacy@."]);
    expect(
      unprovedIds(await registerForGates(withExecutor(F_PAVED_GATES)))
    ).toEqual([
      "code-review@.",
      "code-style@.",
      "dependency-vulnerability@.",
      "test-correctness@.",
    ]);
  });

  it("and is a register the published schema accepts", async () => {
    expect(registerSchemaErrors(await registerForGates(MIXED))).toEqual([]);
  });

  it("but not when Lisa wrote the executor", async () => {
    const register = await registerForGates(
      withExecutor(F_MIXED_GATES, LISA_WRITTEN)
    );

    expect(unprovedIds(register)).toEqual([]);
    expect(entryOf(register, LINT_API).enforcement_points[1]?.executor).toEqual(
      LISA_WRITTEN
    );
    expect(registerSchemaErrors(register)).toEqual([]);
  });
});

describe("the register stays one set of bytes for one set of inputs", () => {
  it("clears only the external entry whose receipt was confirmed", async () => {
    const register = await registerForGates(MIXED);
    const confirmed = withProofStatus(register.entries, new Set([LINT_API]));

    expect(confirmed.find(entry => entry.id === LINT_API)).not.toHaveProperty(
      "status"
    );
    expect(unprovedIds({ ...register, entries: confirmed })).toEqual([
      LINT_WEB,
    ]);
    expect(registerSchemaErrors({ ...register, entries: confirmed })).toEqual(
      []
    );
  });

  it("writes the same register for a declaration with no hosted executor", async () => {
    const text = serializeControlRegister(
      await registerForGates(F_MIXED_GATES)
    );

    expect(text).toBe(
      serializeControlRegister(await registerOf(F_MIXED_GATES))
    );
    expect(text).not.toContain('"status"');
    expect(text).not.toContain('"executor"');
  });
});
