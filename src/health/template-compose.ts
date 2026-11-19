/**
 * In-memory composition of every template that targets one destination, in
 * factory order, and its exact comparison with the captured host file.
 * @module health/template-compose
 */
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { mergeCopyContents } from "../strategies/copy-contents.js";
import { mergeTemplateJson } from "../strategies/merge.js";
import { TaggedMergeStrategy } from "../strategies/tagged-merge.js";
import { readProjectFile } from "./read-only-fs.js";
import {
  COPY_CONTENTS,
  COPY_OVERWRITE,
  type TemplateCandidate,
} from "./template-plan.js";

const MAX_TEMPLATE_BYTES = 1024 * 1024;

/** In-memory destination after one or more factory strategy applications. */
interface ComposedDestination {
  readonly bytes: Buffer;
  readonly comparison: "bytes" | "json";
  readonly requiresExecutable: boolean;
}

/**
 * Decode trusted or safely captured bytes as strict UTF-8.
 * @param bytes - Bytes to decode
 * @returns The decoded text
 */
function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Canonicalize JSON object key order while preserving array order.
 * @param value - JSON value
 * @returns The value with object keys sorted
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)])
    );
  }
  return value;
}

/**
 * Apply one candidate to an in-memory destination in factory order.
 * @param current - Destination composed so far
 * @param candidate - Next template to apply
 * @returns The destination after this template
 */
async function composeCandidate(
  current: ComposedDestination,
  candidate: TemplateCandidate
): Promise<ComposedDestination> {
  const sourceStat = await lstat(candidate.source);
  if (!sourceStat.isFile() || sourceStat.size > MAX_TEMPLATE_BYTES) {
    throw new Error("Unsafe health template source");
  }
  const source = await readFile(candidate.source);
  const executable =
    current.requiresExecutable || (sourceStat.mode & 0o100) !== 0;
  if (candidate.strategy === COPY_OVERWRITE) {
    return {
      bytes: source,
      comparison: "bytes",
      requiresExecutable: executable,
    };
  }
  if (candidate.strategy === COPY_CONTENTS) {
    return {
      bytes: Buffer.from(
        mergeCopyContents(decode(source), decode(current.bytes))
      ),
      comparison: "bytes",
      requiresExecutable: executable,
    };
  }
  const sourceJson = JSON.parse(decode(source)) as Record<string, unknown>;
  const targetJson = JSON.parse(decode(current.bytes)) as Record<
    string,
    unknown
  >;
  const merged =
    candidate.strategy === "merge"
      ? mergeTemplateJson(sourceJson, targetJson)
      : new TaggedMergeStrategy().mergeJson(sourceJson, targetJson);
  return {
    bytes: Buffer.from(JSON.stringify(merged, null, 2)),
    comparison: "json",
    requiresExecutable: executable,
  };
}

/**
 * Compare one final composed destination against its captured host state.
 * @param projectRoot - Canonical host project root
 * @param candidates - Every template targeting this destination, in factory order
 * @returns Whether the host file matches the composed plan
 */
export async function destinationConforms(
  projectRoot: string,
  candidates: readonly TemplateCandidate[]
): Promise<boolean> {
  const first = candidates[0];
  if (first === undefined) return true;
  const target = await readProjectFile(projectRoot, first.destination);
  if (target === undefined) return false;
  const initial: ComposedDestination = {
    bytes: target.bytes,
    comparison: "bytes",
    requiresExecutable: false,
  };
  const planned = await candidates.reduce<Promise<ComposedDestination>>(
    async (state, candidate) => composeCandidate(await state, candidate),
    Promise.resolve(initial)
  );
  const normalizedDestination = first.destination.split(path.sep).join("/");
  if (
    normalizedDestination.startsWith(".husky/") &&
    planned.requiresExecutable &&
    (target.mode & 0o100) === 0
  ) {
    return false;
  }
  if (planned.comparison === "bytes") return planned.bytes.equals(target.bytes);
  return (
    JSON.stringify(canonicalJson(JSON.parse(decode(planned.bytes)))) ===
    JSON.stringify(canonicalJson(JSON.parse(decode(target.bytes))))
  );
}
