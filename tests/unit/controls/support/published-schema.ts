/**
 * The published evidence and verdict schemas as something a suite can read
 * and run (CodySwannGT/lisa#4998).
 *
 * A schema file is the contract an auditor's own validator reads. The
 * functions here only read it and run it with a generic JSON Schema
 * validator; nothing about the shape is restated.
 * @module tests/unit/controls/support/published-schema
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The part of a JSON Schema object the suites read. */
export interface ObjectSchema {
  readonly required?: readonly string[];
  readonly properties?: Readonly<
    Record<
      string,
      {
        readonly enum?: readonly string[];
        readonly const?: unknown;
        readonly pattern?: string;
        readonly maximum?: number;
        readonly maxLength?: number;
      }
    >
  >;
  readonly $defs?: Readonly<Record<string, ObjectSchema>>;
  readonly enum?: readonly string[];
  readonly pattern?: string;
}

/**
 * A published schema, read from disk on every call so an edit to it cannot
 * be masked by an earlier read.
 * @param packagePath - The schema, from the Lisa package root
 * @returns The parsed schema
 */
export function publishedSchema(packagePath: string): ObjectSchema {
  return JSON.parse(
    readFileSync(path.join(REPO_ROOT, packagePath), "utf8")
  ) as ObjectSchema;
}

/**
 * Validate a document against a published schema.
 * @param packagePath - The schema, from the Lisa package root
 * @param document - The candidate
 * @returns One `<path>: <message>` line per finding; empty when it is valid
 */
export function schemaErrors(packagePath: string, document: unknown): string[] {
  const schema = publishedSchema(packagePath) as Parameters<
    typeof z.fromJSONSchema
  >[0];
  const result = z.fromJSONSchema(schema).safeParse(document);
  return result.success
    ? []
    : result.error.issues.map(
        issue => `${issue.path.map(String).join(".")}: ${issue.message}`
      );
}

/**
 * A list of names in one fixed order, so two lists can be compared as sets.
 * @param values - The names
 * @returns The same names, ordered
 */
export function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => (left < right ? -1 : 1));
}
