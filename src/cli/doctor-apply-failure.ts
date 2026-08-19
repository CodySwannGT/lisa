/**
 * Doctor check: report that the last local `lisa apply` failed.
 *
 * The postinstall apply is deliberately non-fatal — a non-zero postinstall
 * aborts `bun install` / `npm ci`, which would stop a project installing its
 * dependencies at all, including the fix. That caution is correct and stays.
 *
 * What was wrong is that it was also SILENT. The previous one-liner ended in
 * `2>/dev/null || true`: two independent silencers, discarding why it failed
 * and that it failed. A project whose apply could not run therefore received no
 * template updates, no guardrail updates and no signal — install after install,
 * indefinitely. Measured on a consumer: the apply aborted on a module
 * resolution failure before doing any work, and the repository had been frozen
 * at whatever Lisa last managed to write, with every install reporting success.
 *
 * So the failure is now recorded, and this check is what reads it. Non-fatal
 * and observable, rather than non-fatal and invisible.
 *
 * ## Why `warn` and not `fail`
 *
 * The project is not broken; it is STALE, and it may have been stale for a
 * long time before anyone looked. Failing doctor would make every affected
 * repository red simultaneously on the release that ships this, which buries
 * the signal in exactly the population that needs to read it. A warning that
 * names the marker and the command is actionable; a wall of red is not.
 * @module cli/doctor-apply-failure
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";

import type { DoctorCheck } from "./doctor.js";

/** Where the postinstall records a failed apply. */
export const APPLY_FAILURE_MARKER = path.join(
  "node_modules",
  ".lisa",
  "apply-failed.json"
);

const CHECK_NAME = "Template apply (postinstall)";

/** The recorded shape of a failed apply. */
export interface ApplyFailure {
  failedAt?: string;
  exitCode?: number | null;
  output?: string;
}

/**
 * The first line of the recorded error, for a one-line detail.
 *
 * The marker holds a tail of the real output, which is frequently a stack
 * trace. A doctor detail that printed all of it would push every other check
 * off the screen, and the full text is already on disk at a named path.
 * @param failure The recorded failure.
 * @returns A short cause, or an empty string when nothing was recorded.
 */
export function summariseCause(failure: ApplyFailure): string {
  const lines = String(failure.output ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  // Prefer a line that names an error over the first line, which is often a
  // banner or a blank-ish prefix from whatever tool failed.
  const named = lines.find(line => /error|cannot|failed|not found/i.test(line));
  return named ?? lines[0] ?? "";
}

/**
 * Read the recorded failure, or null when the marker cannot be parsed.
 * @param marker Absolute path to the marker file.
 * @returns The parsed failure, or null.
 */
async function readMarker(marker: string): Promise<string | undefined> {
  try {
    return await readFile(marker, "utf8");
  } catch {
    // ENOENT is the healthy case and is indistinguishable here from any other
    // read error. Both mean "no recorded failure to report", and a project
    // whose marker cannot be read at all is covered by the parse branch below.
    return undefined;
  }
}

/**
 * Parse a recorded failure, or null when the text is not readable JSON.
 * @param raw The marker file contents.
 * @returns The parsed failure, or null.
 */
function parseMarker(raw: string): ApplyFailure | null {
  try {
    return JSON.parse(raw) as ApplyFailure;
  } catch {
    return null;
  }
}

/**
 * Report whether the last local apply failed.
 * @param targetPath Project root.
 * @returns The doctor check result.
 */
export async function checkApplyFailure(
  targetPath: string
): Promise<DoctorCheck> {
  const marker = path.join(targetPath, APPLY_FAILURE_MARKER);
  const raw = await readMarker(marker);
  if (raw === undefined) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "The last local template apply completed",
    };
  }

  const failure = parseMarker(raw);
  if (failure === null) {
    // An unreadable marker still means a failure was recorded. Reading it as
    // "no problem" would reintroduce the silence this check exists to end.
    return {
      name: CHECK_NAME,
      status: "warn",
      detail:
        `A failed template apply is recorded at ${APPLY_FAILURE_MARKER}, but the marker could not be read. ` +
        `This project is not receiving template or guardrail updates. Re-run the apply to see the error.`,
    };
  }

  const cause = summariseCause(failure);
  const when = failure.failedAt ? ` at ${failure.failedAt}` : "";
  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `The local template apply FAILED${when}, so this project is frozen at whatever Lisa last wrote — ` +
      `no template or guardrail updates are reaching it.${cause ? ` Cause: ${cause}` : ""} ` +
      `Full output: ${APPLY_FAILURE_MARKER}. The install itself is fine; re-run the apply to fix it.`,
  };
}
