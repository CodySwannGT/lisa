import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { parseAuditReport } from "./audit-report.js";
import type { AuditFinding, AuditManager } from "./audit-types.js";

/**
 * A numeric retry typo uses the established default; zero cannot skip auditing.
 * @param value - Untrusted input value to validate
 * @param fallback - Established default used for an invalid numeric knob
 * @returns The validated result described above
 */
function numeric(value: string | undefined, fallback: number): number {
  return value !== undefined && /^\d+$/u.test(value) ? Number(value) : fallback;
}

/**
 * Decode the observed gzip transport without assuming every payload is compressed.
 * @param buffer - Complete audit stdout bytes
 * @returns The validated result described above
 */
function decode(buffer: Buffer): string {
  try {
    return gunzipSync(buffer).toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

/** Optional retry knobs passed by the CLI, separate from the matcher inputs. */
export interface AuditCaptureOptions {
  readonly attempts?: string;
  readonly retryDelay?: string;
}

/**
 * Capture the real production audit, retrying only indeterminate transport/report data.
 * @param root - Project root containing the exact lockfile and exclusion documents
 * @param manager - Package manager whose report and lockfile are evaluated
 * @param options - Retry knobs passed by the calling CLI
 * @param attempt - Current transport attempt, starting at one
 * @returns The validated result described above
 */
export async function captureAudit(
  root: string,
  manager: AuditManager,
  options: AuditCaptureOptions = {},
  attempt = 1
): Promise<AuditFinding[]> {
  const attempts = Math.max(1, numeric(options.attempts, 3));
  const initialDelay = numeric(options.retryDelay, 2);
  const args =
    manager === "yarn"
      ? ["audit", "--groups", "dependencies", "--json"]
      : ["audit", "--production", "--json"];
  const result = spawnSync(manager, args, {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  const diagnosis =
    result.error?.message ?? result.stderr?.toString("utf8") ?? "";
  const output = decode(result.stdout ?? Buffer.alloc(0));
  try {
    if (result.error) throw result.error;
    return parseAuditReport(output, manager);
  } catch {
    if (attempt < attempts) {
      console.error(
        `Security audit attempt ${attempt} of ${attempts} parsed no advisory data (the audit did not run — this is not a finding); retrying...`
      );
      await delay(initialDelay * 2 ** (attempt - 1) * 1000);
      return captureAudit(root, manager, options, attempt + 1);
    }
  }
  const shape = output.trim()
    ? "output is neither JSON nor gzipped JSON in a recognized advisory report shape"
    : "produced no output";
  throw new Error(
    `${manager} audit ${shape}; nothing was audited. This is NOT a clean result. Tried ${attempts} attempt(s). ${diagnosis}`
  );
}
