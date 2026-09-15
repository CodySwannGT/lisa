import { readFile } from "node:fs/promises";
import type { TemplateCandidate } from "../health/template-inspection.js";
import {
  findCopyContentsBlock,
  mergeCopyContents,
} from "../strategies/copy-contents.js";
import { mergeTemplateJson } from "../strategies/merge.js";
import { TaggedMergeStrategy } from "../strategies/tagged-merge.js";
import { isJsonObject } from "../sync/json-path.js";
import type { StarterChange } from "./starter-sync-source.js";

const BEGIN = "# BEGIN: AI GUARDRAILS";
const END = "# END: AI GUARDRAILS";

/**
 * Decode managed text without silently replacing invalid bytes.
 * @param bytes - File payload, if the path exists.
 * @returns Strict UTF-8 content.
 */
function text(bytes: Uint8Array | undefined): string {
  return bytes === undefined
    ? ""
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Extract one complete marker pair without importing outside starter content.
 * @param content - Flat starter or consumer file.
 * @param begin - Canonical Lisa template's opening marker.
 * @returns Normalized managed block, or undefined when absent.
 */
function block(content: string, begin: string): string | undefined {
  const end = END + begin.slice(BEGIN.length);
  const lines = content.split(/\r?\n/u);
  const starts = lines.flatMap((line, index) =>
    line === begin ? [index] : []
  );
  const ends = lines.flatMap((line, index) => (line === end ? [index] : []));
  if (starts.length === 0 && ends.length === 0) return undefined;
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
    throw new Error("Incomplete or ambiguous starter managed block");
  }
  return lines.slice(starts[0]!, ends[0]! + 1).join("\n");
}

/**
 * Replace or remove a verified managed block while retaining outside bytes.
 * @param current - Consumer content.
 * @param begin - Canonical opening marker.
 * @param replacement - New block, or undefined for removal.
 * @returns Updated content.
 */
function replaceBlock(
  current: string,
  begin: string,
  replacement: string | undefined
): string {
  if (replacement !== undefined)
    return mergeCopyContents(`${replacement}\n`, current);
  const end = END + begin.slice(BEGIN.length);
  const offsets = findCopyContentsBlock(current, begin, end);
  return offsets === undefined
    ? current
    : current.slice(0, offsets.start) + current.slice(offsets.end);
}

/**
 * Resolve canonical markers; markerless copy-contents uses whole-file ownership.
 * @param candidates - Applicable copy-contents template sources.
 * @returns Distinct governed opening markers.
 */
export async function starterBlockMarkers(
  candidates: readonly TemplateCandidate[]
): Promise<readonly string[]> {
  const canonical = await Promise.all(
    candidates.map(candidate => readFile(candidate.source, "utf8"))
  );
  return [
    ...new Set(
      canonical.flatMap(source =>
        source.split(/\r?\n/u).filter(line => line.startsWith(BEGIN))
      )
    ),
  ];
}

/**
 * Apply only the blocks governed by the existing canonical template sources.
 * @param change - Exact before/after starter file.
 * @param current - Existing consumer bytes.
 * @param markers - Canonical opening markers for this path.
 * @returns Updated bytes, preserving all consumer content outside those blocks.
 */
export async function mergeStarterBlocks(
  change: StarterChange,
  current: Buffer | undefined,
  markers: readonly string[]
): Promise<Buffer> {
  const before = text(change.before?.bytes);
  const after = text(change.after?.bytes);
  const merged = markers.reduce((content, begin) => {
    const previous = block(before, begin);
    const next = block(after, begin);
    const existing = block(content, begin);
    if (existing === next || previous === next) return content;
    if (existing !== undefined && existing !== previous)
      throw new Error(
        `Starter managed block conflicts with local changes: ${change.path}`
      );
    return replaceBlock(content, begin, next);
  }, text(current));
  return Buffer.from(merged);
}

/**
 * Reuse Lisa's JSON strategies for paths governed by JSON merge semantics.
 * @param change - Pinned starter JSON file.
 * @param current - Existing consumer bytes.
 * @param candidates - Applicable JSON strategies in canonical order.
 * @returns Merged bytes; source removal preserves the consumer's JSON document.
 */
export function mergeStarterJson(
  change: StarterChange,
  current: Buffer | undefined,
  candidates: readonly TemplateCandidate[]
): Buffer | undefined {
  if (change.after === undefined) return current;
  const source: unknown = JSON.parse(text(change.after.bytes));
  const destination: unknown = JSON.parse(
    current === undefined ? "{}" : text(current)
  );
  if (!isJsonObject(source) || !isJsonObject(destination))
    throw new Error(`Starter JSON merge requires objects: ${change.path}`);
  const merged = candidates.reduce<Record<string, unknown>>(
    (result, candidate) =>
      candidate.strategy === "tagged-merge"
        ? new TaggedMergeStrategy().mergeJson(source, result)
        : mergeTemplateJson(source, result),
    destination
  );
  if (JSON.stringify(merged) === JSON.stringify(destination)) return current;
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
}
