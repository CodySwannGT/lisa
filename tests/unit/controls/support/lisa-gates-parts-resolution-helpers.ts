/**
 * Shared declarations for the suites that resolve a gate declaring `parts`.
 *
 * The suites were one file under `tests/unit/scripts/` until the control-audit
 * tests moved under `tests/unit/controls/` (planning decision P4 of
 * CodySwannGT/lisa#4961). That folder holds each suite under the line limit, so
 * the file was split in two and what both halves read lives here.
 * @module tests/unit/controls/support/lisa-gates-parts-resolution-helpers
 */
import { resolveMoment } from "../../../../all/copy-overwrite/scripts/lisa-gates.mjs";

export const COMMIT = "commit";
export const PUSH = "push";
export const PULL_REQUEST = "pull-request";

/** A gate this project invented, proved by a different command per folder. */
export const LINT = "x-lint";

export const API_COMMAND = ["go", "vet", "./..."];
export const WEB_COMMAND = ["npm", "run", "lint"];

/** How the push-moment prover prints a measured failure. */
export const PUSH_SHAPE = "✖ push lint";

export const API_PART = { scope: "api", command: API_COMMAND };
export const WEB_PART = { scope: "web", command: WEB_COMMAND };

/** The keys every resolved entry carried before parts existed, in order. */
export const ESTABLISHED_KEYS = [
  "id",
  "level",
  "mode",
  "awaits",
  "postedBy",
  "declared",
  "task",
  "command",
  "label",
  "work",
  "alias",
  "evidence",
  "callerChain",
  "failureShape",
  "mayRewrite",
  "costly",
];

/** One resolved entry, as far as these assertions read it. */
interface ResolvedEntry {
  readonly id: string;
  readonly level: string;
  readonly mode: string;
  readonly task: string | null;
  readonly command: string | null;
  readonly failureShape: string[] | null;
  readonly scope?: string;
  readonly argv?: string[] | null;
}

/**
 * Resolve a gates block at one moment.
 * @param gates - The gates block
 * @param moment - The moment to resolve at
 * @param includeOff - Whether to report gates declared off
 * @returns The resolved entries
 */
export const resolveAt = (
  gates: Record<string, unknown>,
  moment: string,
  includeOff = false
): ResolvedEntry[] =>
  resolveMoment({ gates, moment, runner: "bun run", includeOff });
