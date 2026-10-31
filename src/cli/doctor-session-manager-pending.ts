/**
 * Items waiting on a human, for the session-manager doctor check
 * (CodySwannGT/lisa#4555, part 3).
 *
 * The manager marks an item that needs a person and keeps dispatching others.
 * Doctor lists what is waiting so an operator sees it without the tracker, and
 * warns about one failure only it can see from outside: a question recorded in
 * the ledger more than one cycle `interval` ago whose tracker mark was never
 * read back (`markedAt: null`). The manager records the question before it
 * writes the mark, so this is a cycle that crashed or was stopped mid-way and
 * has not finished the job since, and nobody on the tracker knows the item is
 * waiting.
 *
 * Only the ref, kind and age are printed, never the question text: it came
 * from a worker or a ticket and could carry anything.
 */
import * as path from "node:path";
import {
  type Finding,
  isRecord,
  readJson,
} from "./doctor-session-manager-trust.js";

/** The cycle interval when `sessionManager.interval` is absent. */
const DEFAULT_INTERVAL_MS = 5 * 60_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1000,
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
};

/** What the pending-human scan adds to the check. */
export interface PendingHumanReport {
  /** One line listing the waiting items, or undefined when there are none. */
  readonly note: string | undefined;
  readonly findings: readonly Finding[];
}

/**
 * Parse a cycle interval such as `5m`; anything else is the default.
 * @param value - `sessionManager.interval`
 * @returns Interval in milliseconds
 */
function intervalMs(value: unknown): number {
  const match =
    typeof value === "string" ? /^(\d+)([smhd])$/.exec(value) : null;
  if (!match) return DEFAULT_INTERVAL_MS;
  return Number(match[1]) * (UNIT_MS[match[2] ?? "m"] ?? MINUTE_MS);
}

/**
 * A short age such as `3h` or `20m`.
 * @param ms - Age in milliseconds
 * @returns Age text
 */
function age(ms: number): string {
  if (ms >= DAY_MS) return `${Math.floor(ms / DAY_MS)}d`;
  if (ms >= HOUR_MS) return `${Math.floor(ms / HOUR_MS)}h`;
  return `${Math.max(0, Math.floor(ms / MINUTE_MS))}m`;
}

/** One ledger item waiting on a human. */
interface Waiting {
  readonly ref: string;
  readonly kind: string;
  readonly ageMs: number;
  readonly marked: boolean;
}

/**
 * The waiting items in a parsed ledger, oldest first.
 * @param ledger - Parsed ledger.json
 * @param now - Current time in ms
 * @returns Waiting items
 */
function waitingItems(ledger: Record<string, unknown>, now: number): Waiting[] {
  const items = isRecord(ledger.items) ? ledger.items : {};
  const rows = Object.entries(items).flatMap(([ref, item]) => {
    const question = isRecord(item) ? item.pendingQuestion : undefined;
    if (!isRecord(question)) return [];
    const asked = Date.parse(String(question.askedAt ?? ""));
    return [
      {
        ref,
        kind:
          typeof question.kind === "string" ? question.kind : "worker-question",
        ageMs: Number.isNaN(asked) ? 0 : now - asked,
        marked: typeof question.markedAt === "string",
      },
    ];
  });
  return [...rows].sort((a, b) => b.ageMs - a.ageMs);
}

/**
 * List the items pending a human and warn about unmarked ones.
 * @param targetPath - Project root
 * @param block - Merged `sessionManager` block
 * @param read - Text reader
 * @param now - Clock
 * @returns The note and findings
 */
export async function pendingHumanReport(
  targetPath: string,
  block: Record<string, unknown>,
  read: (file: string) => Promise<string>,
  now: () => Date
): Promise<PendingHumanReport> {
  const file = path.join(targetPath, ".lisa", "session-manager", "ledger.json");
  const ledger = await readJson(read, file).catch(() => null);
  if (ledger === null) {
    return {
      note: undefined,
      findings: [
        {
          status: "warn",
          text: `${file} is not valid JSON, so doctor cannot list the items waiting on a human; the manager also refuses it until it is repaired`,
        },
      ],
    };
  }
  const waiting =
    ledger === undefined ? [] : waitingItems(ledger, now().getTime());
  if (waiting.length === 0) return { note: undefined, findings: [] };
  const limit = intervalMs(block.interval);
  const unmarked = waiting.filter(item => !item.marked && item.ageMs > limit);
  return {
    note: `${waiting.length} pending a human: ${waiting
      .map(item => `${item.ref} (${item.kind}, ${age(item.ageMs)})`)
      .join(", ")}`,
    findings: unmarked.map(item => ({
      status: "warn" as const,
      text: `${item.ref} has waited ${age(item.ageMs)} for a human but was never marked human-needed on the tracker, so nobody there knows; check the manager is running (session-manager.mjs status) and let its next cycle mark it`,
    })),
  };
}
