/**
 * The durable record that `lisa apply` actually succeeded here.
 *
 * The postinstall bootstrap is loud but non-fatal by design (see
 * `migrations/ensure-lisa-postinstall`), and the detached reconciliation
 * trampoline runs with `stdio: "ignore"` because it outlives the terminal that
 * started it. Both are correct, and both mean a failed apply can leave no trace
 * anyone will ever read. acmeorgb/frontend-v2 went months that way
 * (CodySwannGT/lisa#2467).
 *
 * So success — not failure — is what gets recorded. A receipt is written only
 * on a completed, non-dry-run apply, which makes absence and staleness both
 * self-evident: no receipt means no apply has ever finished here, and an old
 * version stamp means none has finished since that version. `lisa doctor` reads
 * it (see `cli/doctor-apply-freshness`), so the failure is findable long after
 * the install output has scrolled away, without anyone re-running apply by hand.
 *
 * The receipt is machine-local and gitignored: it describes this checkout, not
 * the project. Committing it would churn on every version bump and conflict
 * between developers on different Lisa versions, and a committed receipt would
 * lie about a fresh clone that has never installed.
 * @module core/apply-receipt
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { readJsonOrNull } from "../utils/json-utils.js";

/** Directory-relative location of the receipt, for messages and gitignores. */
export const APPLY_RECEIPT_DISPLAY_PATH = ".lisa/apply-receipt.json";

/**
 * Receipt schema version. Bump only alongside a reader change — an unknown
 * version is treated as no receipt at all rather than being misread.
 */
export const APPLY_RECEIPT_SCHEMA_VERSION = 1;

/**
 * How complete the recorded apply was.
 *
 * `postinstall-safe` is the path a package manager's install runs, selected by
 * the `--postinstall-safe` / `LISA_POSTINSTALL=1` declaration every
 * Lisa-written postinstall invocation carries. (It used to be selected by
 * `--skip-git-check`, which also meant something else entirely — see
 * `core/apply-mode` and CodySwannGT/lisa#3066.) It
 * deliberately skips every agent emit (Codex, Claude, agy, Copilot, OpenCode)
 * and the Sonar integration, because those rewrite host-owned files that must
 * not change under an install. That is the right behaviour and the wrong
 * silence: it means no `bun install` at any version can migrate `.codex/config.toml`
 * — including the deprecated `codex_hooks` key — so a repo can sit on the
 * newest Lisa and still be missing work only a full `lisa apply` performs.
 * Recording the mode is what lets doctor say so.
 *
 * `unknown` covers receipts written before this field existed.
 */
export type ApplyMode = "full" | "postinstall-safe" | "unknown";

/** The persisted `.lisa/apply-receipt.json` shape. */
export interface ApplyReceipt {
  readonly schema_version: number;
  /** Lisa version that completed the apply. */
  readonly lisa_version: string;
  /** ISO timestamp of that apply. */
  readonly applied_at: string;
  /** Harness the apply emitted artifacts for. */
  readonly harness: string;
  /** Whether that apply was a full one or the postinstall-safe subset. */
  readonly apply_mode: ApplyMode;
  /**
   * Managed files that apply found changed upstream and deliberately did not
   * replace.
   *
   * The apply already names these, in the install output — which is scroll-back
   * nobody reads, and which is gone by the time anyone asks why a guard stopped
   * tracking upstream. Recording them is what turns a sentence in a `bun
   * install` into something `lisa doctor` can still report months later
   * (CodySwannGT/lisa#3033).
   *
   * Written by every apply, including the ones that leave nothing stale: an
   * empty array is the assertion "this apply looked, and found none", which is
   * different from a receipt that predates the field and cannot say.
   */
  readonly stale_paths: readonly string[];
}

/**
 * Narrow a persisted mode value, treating anything unrecognised — including a
 * receipt written before the field existed — as `unknown` rather than guessing.
 * @param value - Raw value from the receipt
 * @returns A known apply mode
 */
function toApplyMode(value: unknown): ApplyMode {
  return value === "full" || value === "postinstall-safe" ? value : "unknown";
}

/**
 * Narrow the recorded stale-path list, treating anything unrecognised as an
 * empty list.
 *
 * Deliberately NOT gated behind a schema bump. Raising
 * `APPLY_RECEIPT_SCHEMA_VERSION` would make every receipt already on disk read
 * as no receipt at all, and doctor would tell the entire installed fleet that
 * Lisa had never applied there — a fleet-wide false alarm to add one optional
 * field. An older receipt simply says nothing about staleness, which is the
 * truth about it.
 * @param value - Raw value from the receipt
 * @returns The recorded paths, or an empty list when there are none to read
 */
function toStalePaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Resolve the single path every reader and writer uses.
 * @param root - Project root
 * @returns Absolute path to the receipt
 */
export function resolveApplyReceiptPath(root: string): string {
  return path.join(root, ".lisa", "apply-receipt.json");
}

/**
 * Read the receipt, returning null when it is missing, unparseable, or written
 * by a schema this build does not understand.
 * @param root - Project root
 * @returns The receipt, or null when there is no usable one
 */
export async function readApplyReceipt(
  root: string
): Promise<ApplyReceipt | null> {
  const parsed = await readJsonOrNull<Partial<ApplyReceipt>>(
    resolveApplyReceiptPath(root)
  );
  if (
    parsed?.schema_version !== APPLY_RECEIPT_SCHEMA_VERSION ||
    typeof parsed.lisa_version !== "string" ||
    typeof parsed.applied_at !== "string"
  ) {
    return null;
  }
  return {
    schema_version: parsed.schema_version,
    lisa_version: parsed.lisa_version,
    applied_at: parsed.applied_at,
    harness: typeof parsed.harness === "string" ? parsed.harness : "unknown",
    apply_mode: toApplyMode(parsed.apply_mode),
    stale_paths: toStalePaths(parsed.stale_paths),
  };
}

/**
 * Record that an apply completed successfully.
 *
 * Written atomically (temp file plus rename) so a reader never sees a partial
 * document, and never throws: a receipt that could not be written must not turn
 * a successful apply into a failed one. The cost of a silently missing receipt
 * is one spurious doctor warning; the cost of throwing here is breaking installs.
 * @param root - Project root that was applied to
 * @param details - What completed
 * @param details.lisaVersion - Lisa version that ran the apply
 * @param details.harness - Harness the apply emitted for
 * @param details.applyMode - Whether this was a full or postinstall-safe apply
 * @param details.stalePaths - Managed files the apply left out of date
 * @param now - Clock, injectable for tests
 * @returns True when the receipt was persisted
 */
export async function recordSuccessfulApply(
  root: string,
  details: {
    readonly lisaVersion: string;
    readonly harness: string;
    readonly applyMode: ApplyMode;
    readonly stalePaths: readonly string[];
  },
  now: () => Date = () => new Date()
): Promise<boolean> {
  const receipt: ApplyReceipt = {
    schema_version: APPLY_RECEIPT_SCHEMA_VERSION,
    lisa_version: details.lisaVersion,
    applied_at: now().toISOString(),
    harness: details.harness,
    apply_mode: details.applyMode,
    stale_paths: [...details.stalePaths],
  };
  const receiptPath = resolveApplyReceiptPath(root);
  try {
    await mkdir(path.dirname(receiptPath), { recursive: true });
    const tempPath = `${receiptPath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await rename(tempPath, receiptPath);
    return true;
  } catch {
    return false;
  }
}
