/**
 * The capabilities/tools readiness producer (PRD #1739, #1896).
 *
 * Dimension 2 of the `readiness-rubric` asks whether every tool the work needs
 * is provably *reachable*, not merely installed. The `tool-access-gate` names
 * the anti-pattern explicitly: a binary on `PATH`, a dependency in a manifest,
 * or a configured MCP server proves that something was declared, never that a
 * request through it succeeds. Reachability is established by a live read-only
 * probe against the real system, and nothing an offline file read can see is a
 * substitute for one.
 *
 * So this dimension has no offline evidence to gather and no blocker to stand.
 * What it has is an obligation to say so: a blank dimension reads as "nothing to
 * report" when it actually means "never looked" (#1898), and a presence-based
 * PASS would be worse still — it would report the anti-pattern as proof. The
 * producer therefore renders one reasoned SKIP, every time, naming the live
 * probe it did not run.
 * @module cli/doctor-readiness-capabilities
 */
import type { ReadinessDimensionRecord } from "./doctor-readiness-types.js";

/** The capabilities/tools readiness dimension id (readiness-rubric, RRR-1). */
export const CAPABILITIES_TOOLS_DIMENSION_ID = "capabilities-tools";

/** The stated reason this dimension is never assessed by an offline read. */
const CAPABILITIES_SKIP_REASON =
  "Tool reachability requires a live read-only probe against the real system " +
  "and cannot be established from an offline read. The `tool-access-gate` rule " +
  "names presence — a binary on `PATH`, a dependency in a manifest, a " +
  "configured MCP server — as the anti-pattern: it proves a tool was declared, " +
  "never that a request through it succeeds. This dimension was therefore " +
  "deliberately not assessed rather than answered from presence.";

/**
 * Assess the capabilities/tools dimension. Always a reasoned SKIP: the question
 * is not offline-answerable, so the honest answer is a stated non-answer. The
 * record names no `blocker`, so it can never stand one up, and the `root`
 * argument is accepted only to satisfy the shared producer signature — reading
 * it would be the presence anti-pattern the rule forbids.
 * @param _root - Project root (deliberately unread)
 * @returns The capabilities/tools dimension record
 */
export async function assessCapabilitiesToolsDimension(
  _root: string
): Promise<ReadinessDimensionRecord> {
  return await Promise.resolve({
    id: CAPABILITIES_TOOLS_DIMENSION_ID,
    status: "SKIP",
    findings: [{ reason: CAPABILITIES_SKIP_REASON, skip: true }],
  });
}
