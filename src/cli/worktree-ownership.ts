/**
 * Ownership receipts for agent worktrees.
 *
 * A receipt is the only POSITIVE ownership evidence available: it records which
 * agent claimed a worktree, so a cleaner can tell "mine" from "somebody
 * else's" without inspecting a single path component.
 *
 * The receipt lives in the worktree's git ADMIN directory, never in the working
 * tree. Two reasons, both load-bearing. A file in the working tree would dirty
 * `git status`, which would make a claimed worktree permanently ineligible for
 * the very cleanup the claim exists to authorize. And git removes the admin
 * directory when the worktree is removed, so a receipt cannot outlive its
 * subject and be inherited by an unrelated checkout at the same path.
 * @module cli/worktree-ownership
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Receipt filename inside a worktree's git admin directory. */
export const OWNER_RECEIPT_FILENAME = "lisa-worktree-owner.json";

/**
 * Environment variables consulted, in order, for the caller's owner id.
 *
 * All of them are supplied by the surrounding agent runtime. None is invented
 * by Lisa, because an id Lisa minted per invocation would never match a receipt
 * written by an earlier invocation and would make every claim useless.
 */
export const OWNER_ID_VARIABLES: readonly string[] = Object.freeze([
  "LISA_OWNER_ID",
  "CLAUDE_SESSION_ID",
  "CODEX_SESSION_ID",
]);

/** What a receipt says about the caller's relationship to a worktree. */
export type OwnershipVerdict = "mine" | "theirs" | "unclaimed";

/** Persisted claim on one worktree. */
export interface OwnerReceipt {
  /** Opaque id of the agent that claimed the worktree. */
  readonly ownerId: string;
  /** ISO timestamp the claim was written. */
  readonly claimedAt: string;
}

/**
 * Resolve the owner id of the process running the cleaner.
 *
 * Returns undefined when no runtime supplied one. Undefined is a real answer
 * and a restrictive one: a caller with no id can never match a receipt, so
 * every claimed worktree is somebody else's as far as it is concerned.
 * @param env - Environment to read
 * @returns Owner id, or undefined when none is available
 */
export function resolveCallerOwnerId(
  env: NodeJS.ProcessEnv = readProcessEnvironment()
): string | undefined {
  const name = OWNER_ID_VARIABLES.find(variable => {
    const value = env[variable];
    return typeof value === "string" && value.trim() !== "";
  });
  return name === undefined ? undefined : (env[name] as string).trim();
}

/**
 * Read the CLI process environment through one explicit, reviewable exception.
 *
 * The owner id is supplied by the surrounding agent runtime and by nothing
 * else, so it has to be read from the externally-supplied environment. Every
 * other function in this module takes the environment as a parameter.
 * @returns Current process environment
 */
function readProcessEnvironment(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- the agent runtime supplies the owner id through process env and nowhere else
  return process.env;
}

/**
 * Judge a worktree's claim against the caller.
 *
 * A receipt naming somebody else is a hard "theirs" even when the caller has no
 * id of its own — an unidentified caller proves nothing, and "I could not tell"
 * must never resolve in favour of deletion.
 * @param receiptOwner - Owner recorded in the receipt, if any
 * @param callerOwner - Owner id of the running process, if any
 * @returns Ownership verdict
 */
export function judgeOwnership(
  receiptOwner: string | undefined,
  callerOwner: string | undefined
): OwnershipVerdict {
  if (receiptOwner === undefined || receiptOwner === "") return "unclaimed";
  return receiptOwner === callerOwner ? "mine" : "theirs";
}

/**
 * Absolute path of the receipt for one worktree admin directory.
 * @param adminDirectory - Worktree's git admin directory
 * @returns Absolute receipt path
 */
export function ownerReceiptPath(adminDirectory: string): string {
  return path.join(adminDirectory, OWNER_RECEIPT_FILENAME);
}

/**
 * Read the owner recorded for one worktree.
 *
 * An unreadable or malformed receipt returns undefined rather than throwing:
 * the caller then treats the worktree as unclaimed and falls back to the
 * non-use gates, which are strictly more conservative than a claim.
 * @param adminDirectory - Worktree's git admin directory
 * @returns Recorded owner id, or undefined when there is no usable receipt
 */
export async function readOwnerReceipt(
  adminDirectory: string
): Promise<string | undefined> {
  const raw = await readFile(ownerReceiptPath(adminDirectory), "utf8").catch(
    () => undefined
  );
  if (raw === undefined) return undefined;
  return parseOwnerId(raw);
}

/**
 * Write an ownership claim for one worktree.
 * @param adminDirectory - Worktree's git admin directory
 * @param ownerId - Owner id to record
 * @param now - Clock, injectable for tests
 * @returns Absolute path of the receipt written
 */
export async function writeOwnerReceipt(
  adminDirectory: string,
  ownerId: string,
  now: () => Date = () => new Date()
): Promise<string> {
  const receipt: OwnerReceipt = {
    ownerId,
    claimedAt: now().toISOString(),
  };
  const target = ownerReceiptPath(adminDirectory);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, undefined, 2)}\n`, "utf8");
  return target;
}

/**
 * Extract an owner id from raw receipt JSON.
 * @param raw - Receipt file contents
 * @returns Owner id, or undefined when the receipt is unusable
 */
function parseOwnerId(raw: string): string | undefined {
  const parsed: unknown = safeParse(raw);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const owner = (parsed as { ownerId?: unknown }).ownerId;
  return typeof owner === "string" && owner.trim() !== ""
    ? owner.trim()
    : undefined;
}

/**
 * Parse JSON without throwing.
 * @param raw - Candidate JSON text
 * @returns Parsed value, or undefined when parsing failed
 */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
