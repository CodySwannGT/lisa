/**
 * The `skip_jobs` tokens a project still forwards, and what replaces each.
 *
 * `SKIP_JOB_TOKENS` has thirty-one entries and `QUALITY_JOB_GATES` has
 * eighteen; the gap is the point. A token with no gate cannot be migrated, and
 * being wrong about which gate replaces a token does not break a build — it
 * declares the WRONG gate `off`, so a check silently stops running while the
 * configuration reads deliberate.
 * @module cli/gate-report-skip-jobs
 */
import type { GateRegistryModule } from "./gate-report-registry.js";
import type { Finding, SkipJobRow } from "./gate-report-types.js";
import { parseCiWorkflowInputs } from "./ui-ci-quality-jobs-parse.js";

/** The moment `quality.yml` resolves gates at when a caller declares none. */
const DEFAULT_MOMENT = "pull-request";

/** Reads the tokens a project's own `ci.yml` forwards. */
export type SkipJobTokensReader = (
  projectRoot: string
) => Promise<readonly string[]>;

/**
 * Read the tokens from the project's own `ci.yml`.
 * @param projectRoot - Project root
 * @returns The forwarded tokens
 */
export const defaultSkipJobTokensReader: SkipJobTokensReader =
  async projectRoot => (await parseCiWorkflowInputs(projectRoot)).skipJobs;

/**
 * Resolve every forwarded token through the shipped migration table.
 * @param options - Inputs
 * @param options.registry - The shipped registry
 * @param options.projectRoot - Project root
 * @param options.read - Injectable token reader
 * @returns The rows, or a stated reason there are none to report
 */
export async function buildSkipJobRows(options: {
  registry: GateRegistryModule;
  projectRoot: string;
  read: SkipJobTokensReader;
}): Promise<Finding<readonly SkipJobRow[]>> {
  // `Promise.resolve().then` rather than a bare call, so a reader that throws
  // synchronously lands in the same not-applicable branch as one that rejects.
  const tokens = await Promise.resolve()
    .then(() => options.read(options.projectRoot))
    .catch(() => undefined);
  if (tokens === undefined) {
    return {
      state: "not-applicable",
      reason: "no-quality-caller",
      message:
        "This project has no workflow calling Lisa's quality workflow, so it forwards no skip_jobs tokens.",
    };
  }
  const rows = tokens.map(token => {
    const resolution = options.registry.skipJobMigration(token, DEFAULT_MOMENT);
    return {
      token: resolution.token,
      status: resolution.status,
      gate: resolution.gate,
      declaration: resolution.declaration,
    };
  });
  return { state: "verified", value: rows };
}
