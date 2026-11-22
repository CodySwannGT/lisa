/**
 * What the control register says about a pull-request check that runs from a
 * pipeline file Lisa did not write.
 *
 * Lisa ships the pull-request executor for one hosting platform. On any other
 * the host's agent writes the file, and because Lisa did not write it, every
 * entry it runs reads unproved until both halves of that entry's proof are on
 * record (CodySwannGT/lisa#4991).
 */
import { describe, expect, it, vi } from "vitest";

import { loadCriterionCatalogue } from "../../../src/controls/catalogue.js";
import {
  EXECUTOR_KEY,
  LISA_WRITTEN_PLATFORM,
  PULL_REQUEST_MOMENT,
} from "../../../src/controls/pull-request-executor.js";
import {
  buildControlRegister,
  serializeControlRegister,
} from "../../../src/controls/register.js";
import { CONTROL_ENTRY_STATUSES } from "../../../src/controls/register-types.js";
import {
  F_MIXED_GATES,
  F_NONE_GATES,
  F_PAVED_GATES,
  declarationOf,
  registerSchemaErrors,
  shippedGates,
} from "../../helpers/control-register.js";
import {
  LISA_WRITTEN,
  PIPELINE,
  bothHalves,
  proofRecord,
  registerWithEvidence,
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
    const entry = entryOf(await registerWithEvidence(MIXED), LINT_API);

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
    const register = await registerWithEvidence(
      withExecutor(F_MIXED_GATES, { ...PIPELINE, "x-note": "owned by ops" })
    );

    expect(entryOf(register, LINT_API).enforcement_points[1]?.executor).toEqual(
      PIPELINE
    );
  });

  it("is not recorded for a gate that is off at pull-request", async () => {
    const register = await registerWithEvidence({
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
    const register = await registerWithEvidence(MIXED);

    expect(unprovedIds(register)).toEqual([LINT_API, LINT_WEB]);
    expect(entryOf(register, TYPES_WEB)).not.toHaveProperty("status");
  });

  it("on a repository with one part, a paved-road one and an awaited check", async () => {
    expect(
      unprovedIds(await registerWithEvidence(withExecutor(F_NONE_GATES)))
    ).toEqual(["code-style@.", "coverage-adequacy@."]);
    expect(
      unprovedIds(await registerWithEvidence(withExecutor(F_PAVED_GATES)))
    ).toEqual([
      "code-review@.",
      "code-style@.",
      "dependency-vulnerability@.",
      "test-correctness@.",
    ]);
  });

  it("and is a register the published schema accepts", async () => {
    expect(registerSchemaErrors(await registerWithEvidence(MIXED))).toEqual([]);
  });

  it("but not when Lisa wrote the executor", async () => {
    const register = await registerWithEvidence(
      withExecutor(F_MIXED_GATES, LISA_WRITTEN)
    );

    expect(unprovedIds(register)).toEqual([]);
    expect(entryOf(register, LINT_API).enforcement_points[1]?.executor).toEqual(
      LISA_WRITTEN
    );
    expect(registerSchemaErrors(register)).toEqual([]);
  });
});

describe("evidence clears the status", () => {
  it("for the entry whose two proof halves are on record, and no other", async () => {
    const register = await registerWithEvidence(MIXED, bothHalves(LINT_API));

    expect(entryOf(register, LINT_API)).not.toHaveProperty("status");
    expect(unprovedIds(register)).toEqual([LINT_WEB]);
    expect(registerSchemaErrors(register)).toEqual([]);
  });

  it.each(["violation", "clean"] as const)(
    "but not with only the %s half",
    async half => {
      const register = await registerWithEvidence(MIXED, [
        proofRecord(LINT_API, half),
      ]);

      expect(unprovedIds(register)).toEqual([LINT_API, LINT_WEB]);
    }
  );

  it("but not with halves that were run at another moment", async () => {
    const register = await registerWithEvidence(
      MIXED,
      bothHalves(LINT_API, { moment: "commit" })
    );

    expect(unprovedIds(register)).toEqual([LINT_API, LINT_WEB]);
  });

  it("whatever the clock says: a record's age is the verdict's to judge", async () => {
    const register = await registerWithEvidence(
      MIXED,
      bothHalves(LINT_API, {
        completed_at: "2001-01-01T00:00:00.000Z",
        freshness_seconds: 1,
      })
    );

    expect(unprovedIds(register)).toEqual([LINT_WEB]);
  });
});

describe("the register stays one set of bytes for one set of inputs", () => {
  it("for the same declaration and the same evidence, in any order", async () => {
    const records = [...bothHalves(LINT_API), ...bothHalves(LINT_WEB)];
    const first = await registerWithEvidence(MIXED, records);
    const second = await registerWithEvidence(MIXED, [...records].reverse());

    expect(serializeControlRegister(second)).toBe(
      serializeControlRegister(first)
    );
  });

  it("and a declaration that names no executor writes what it always wrote", async () => {
    const text = serializeControlRegister(
      await registerWithEvidence(F_MIXED_GATES, bothHalves(LINT_API))
    );

    expect(text).toBe(
      serializeControlRegister(await registerOf(F_MIXED_GATES))
    );
    expect(text).not.toContain('"status"');
    expect(text).not.toContain('"executor"');
  });

  it.each([
    ["names no executor", F_MIXED_GATES, 0],
    ["names one Lisa wrote", withExecutor(F_MIXED_GATES, LISA_WRITTEN), 0],
    ["names one Lisa did not write", MIXED, 1],
  ])(
    "and the evidence is read only when a status depends on it: a declaration that %s",
    async (_name, block, reads) => {
      const evidence = vi.fn(() => ({ records: [] }));

      buildControlRegister({
        declaration: declarationOf(block),
        registry: await shippedGates(),
        catalogue: loadCriterionCatalogue(),
        evidenceDocument: evidence,
      });

      expect(evidence).toHaveBeenCalledTimes(reads);
    }
  );
});
