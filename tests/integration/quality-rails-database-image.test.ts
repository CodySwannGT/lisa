/**
 * `quality-rails.yml` `database_image` input (CodySwannGT/lisa#4671).
 *
 * The official postgres image ships no extensions such as pgvector, so a
 * caller whose schema enables one failed at `db:prepare` with no lever but
 * `skip_jobs`. `database_image` takes a full image ref (digest pins allowed)
 * for every postgres service, and leaving it empty keeps the image the
 * workflow used before: `postgres:<database_version || 16>`. MySQL services
 * are out of scope and keep their own expression.
 *
 * GitHub evaluates `${{ }}` at run time, so the parsed YAML only proves the
 * expression text. The small evaluator below resolves that one expression
 * with GitHub's semantics (`||` returns the first truthy operand, and an
 * empty string is falsy; `format` substitutes `{0}`) to prove AC-1..AC-3.
 */
import { describe, expect, it } from "vitest";

import { job, workflow } from "./quality-rails-test-shards-fixture.js";

const POSTGRES_IMAGE =
  "${{ inputs.database_image || format('postgres:{0}', inputs.database_version || '16') }}";
const MYSQL_IMAGE = "mysql:${{ inputs.database_version || '8.0' }}";
const POSTGRES_JOBS = ["test-postgres-shard", "test-postgres", "mutation"];
const MYSQL_JOBS = ["test-mysql-shard", "test-mysql"];
const DIGEST_REF = `pgvector/pgvector@sha256:${"a".repeat(64)}`;

/** Caller inputs the image expression reads. */
type ImageInputs = { database_image?: string; database_version?: string };

/**
 * Resolve the postgres image expression the way GitHub would for these inputs.
 * Only the exact expression above is understood; anything else throws, so a
 * drifted workflow cannot be "resolved" by a stale evaluator.
 * @param expression - The service's `image:` text
 * @param inputs - Caller inputs (absent means GitHub's empty default)
 * @returns The image ref the runner would pull
 */
function resolvePostgresImage(expression: string, inputs: ImageInputs): string {
  if (expression !== POSTGRES_IMAGE) {
    throw new Error(`unrecognised postgres image expression: ${expression}`);
  }
  const image = inputs.database_image ?? "";
  const version = inputs.database_version ?? "";
  return image || `postgres:${version || "16"}`;
}

/**
 * The `image:` of a job's database service.
 * @param id - Job id
 * @param service - Service name
 * @returns The image text
 */
function serviceImage(id: string, service: string): string {
  const services = job(id).services as
    | Record<string, { image?: string }>
    | undefined;
  return String(services?.[service]?.image);
}

describe("quality-rails.yml database_image input (#4671)", () => {
  it("declares an optional string input with an empty default", () => {
    const inputs = (
      workflow as {
        on?: {
          workflow_call?: {
            inputs?: Record<
              string,
              { type?: string; required?: boolean; default?: string }
            >;
          };
        };
      }
    ).on?.workflow_call?.inputs;
    expect(inputs?.database_image).toMatchObject({
      type: "string",
      required: false,
      default: "",
    });
  });

  it.each(POSTGRES_JOBS)("%s postgres service reads database_image", id => {
    expect(serviceImage(id, "postgres")).toBe(POSTGRES_IMAGE);
  });

  it.each(MYSQL_JOBS)("AC-4: %s mysql service is untouched", id => {
    expect(serviceImage(id, "mysql")).toBe(MYSQL_IMAGE);
  });

  it.each([
    ["AC-1: no inputs keeps postgres:16", {}, "postgres:16"],
    [
      "AC-2: database_version still selects the tag",
      { database_version: "17" },
      "postgres:17",
    ],
    [
      "AC-3: database_image passes through exactly, digest included",
      { database_image: DIGEST_REF, database_version: "17" },
      DIGEST_REF,
    ],
    [
      "an empty database_image falls back like an omitted one",
      { database_image: "", database_version: "" },
      "postgres:16",
    ],
  ] as const)("%s", (_name, inputs: ImageInputs, expected) => {
    for (const id of POSTGRES_JOBS) {
      expect(resolvePostgresImage(serviceImage(id, "postgres"), inputs)).toBe(
        expected
      );
    }
  });
});
