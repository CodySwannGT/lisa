/**
 * What the published register schema says about a pull-request executor and
 * the status it gives an entry.
 *
 * The schema and the types are written by hand. The general suites hold their
 * keys to each other; this one holds the values the two new keys may take
 * (CodySwannGT/lisa#4991).
 */
import { describe, expect, it } from "vitest";

import { CONTROL_ENTRY_STATUSES } from "../../../src/controls/register-types.js";
import {
  registerSchema,
  registerSchemaErrors,
  shippedGates,
} from "../../helpers/control-register.js";
import {
  BARE_ENTRY,
  BARE_POINT,
  ENTRY,
  EXECUTOR,
  POINT,
  registerWith,
} from "./support/register-samples.js";

/** The part of the schema these cases read. */
interface SchemaSlice {
  readonly $defs: Readonly<
    Record<
      string,
      {
        readonly properties: Readonly<
          Record<
            string,
            { readonly enum?: readonly string[]; readonly pattern?: string }
          >
        >;
      }
    >
  >;
}

const schema = registerSchema() as unknown as SchemaSlice;

/**
 * The schema's findings for an entry whose pull-request point names an
 * executor.
 * @param executor - The executor, well-formed or not
 * @returns One line per finding
 */
function errorsForExecutor(executor: unknown): readonly string[] {
  return registerSchemaErrors(
    registerWith({
      ...BARE_ENTRY,
      enforcement_points: [{ ...POINT, executor }],
    })
  );
}

describe("the status of an entry", () => {
  it("may take the values the types allow, and no other", () => {
    expect(schema.$defs.entry?.properties.status?.enum).toEqual(
      CONTROL_ENTRY_STATUSES
    );
  });

  it.each(CONTROL_ENTRY_STATUSES)("is accepted as %s", status => {
    expect(registerSchemaErrors(registerWith({ ...ENTRY, status }))).toEqual(
      []
    );
  });

  it("is accepted left off", () => {
    expect(BARE_ENTRY).not.toHaveProperty("status");
    expect(registerSchemaErrors(registerWith(BARE_ENTRY))).toEqual([]);
  });

  it.each(["proved", "", null, true])("is refused as %j", status => {
    expect(
      registerSchemaErrors(registerWith({ ...ENTRY, status }))
    ).not.toEqual([]);
  });
});

describe("the executor of an enforcement point", () => {
  it("is accepted with a platform and a path", () => {
    expect(errorsForExecutor(EXECUTOR)).toEqual([]);
  });

  it("is accepted left off", () => {
    expect(BARE_POINT).not.toHaveProperty("executor");
  });

  it.each([
    ["names no path", { platform: "gitlab" }],
    ["names no platform", { path: ".gitlab-ci.yml" }],
    ["names an empty path", { ...EXECUTOR, path: "" }],
    ["writes the platform with a capital", { ...EXECUTOR, platform: "GitLab" }],
    ["carries a key the schema does not list", { ...EXECUTOR, note: "x" }],
    ["is a path on its own", ".gitlab-ci.yml"],
  ])("is refused when it %s", (_name, executor) => {
    expect(errorsForExecutor(executor)).not.toEqual([]);
  });

  it("names a platform the way the gates declaration must", async () => {
    const registry = await shippedGates();
    const pattern = new RegExp(
      schema.$defs.executor?.properties.platform?.pattern ?? "^$",
      "u"
    );
    const platforms = ["github", "gitlab", "azure-devops", "GitLab", "a b", ""];
    const declared = (platform: string): boolean =>
      registry.validateGates({
        "x-lint": {
          run: "lint",
          "pull-request": {
            level: "required",
            executor: { ...EXECUTOR, platform },
          },
        },
      }).length === 0;

    expect(platforms.map(platform => pattern.test(platform))).toEqual(
      platforms.map(declared)
    );
  });
});
