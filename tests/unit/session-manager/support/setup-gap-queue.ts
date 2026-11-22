/**
 * Queue helpers for the setup-gap CLI tests (lisa#4820): raw Linear nodes
 * with an optional `repo:<key>` label, and a `queue --tracker linear` run
 * over a complete envelope of them.
 * @module tests/unit/session-manager/support/setup-gap-queue
 */
import path from "node:path";
import { expect } from "vitest";

import { type Sandbox, runCli, writeJson } from "./cli-harness.js";

/** The part of `queue`'s JSON the setup-gap tests read. */
export interface QueueJson {
  readonly ordered: { ref: string }[];
  readonly excluded: { ref: string; reason: string }[];
  readonly setupGaps: Record<string, unknown>[];
}

/**
 * One raw Linear node, optionally labelled `repo:<key>`.
 * @param identifier - Issue key
 * @param repo - Repo key for the label, or null for none
 * @returns Raw node
 */
export function linearNode(identifier: string, repo: string | null) {
  return {
    identifier,
    title: identifier,
    priority: 2,
    createdAt: "2026-01-01T00:00:00Z",
    assignee: null,
    labels: { nodes: repo === null ? [] : [{ name: `repo:${repo}` }] },
    description: "",
    creator: { id: "author" },
    children: { nodes: [] },
  };
}

/**
 * Write a complete Linear envelope of `nodes` for `queue --input`.
 * @param sandbox - Project sandbox
 * @param nodes - Raw Linear nodes
 * @returns The input file path
 */
function writeQueueInput(sandbox: Sandbox, nodes: readonly object[]): string {
  const input = path.join(sandbox.root, "queue-input.json");
  writeJson(input, { complete: true, pages: 1, items: nodes });
  return input;
}

/**
 * Run `queue` over a complete Linear envelope of `nodes`.
 * @param sandbox - Project sandbox
 * @param nodes - Raw Linear nodes
 * @returns The queue JSON
 */
export function queue(sandbox: Sandbox, nodes: readonly object[]): QueueJson {
  const input = writeQueueInput(sandbox, nodes);
  const result = runCli(sandbox, [
    "queue",
    "--tracker",
    "linear",
    "--input",
    input,
  ]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.json;
}

/**
 * The refs `queue` offers, in order.
 * @param json - Queue JSON
 * @returns Refs
 */
export const offered = (json: QueueJson) => json.ordered.map(item => item.ref);
