/**
 * Derive the CLIs a project's own configuration already implies.
 *
 * The symmetric half of `routing-floor.mjs`. A credential and the binary that
 * consumes it are the same question asked twice — can this agent do the work —
 * and both were answered only by a hand-maintained list.
 *
 * `detect-tooling` already knows most of these pairings and states them well:
 * "the work-item guardrails shell out to `gh` for every tracker read". But it
 * knows them at *proposal* time, as suggestions a human runs a skill to see and
 * then copies into config. Nothing derives them at runtime, so a project that
 * never ran the skill — or ran it before it adopted Maestro — has a manifest
 * that silently understates what its agents need.
 *
 * This promotes those pairings to a derivation. The floor is unioned into the
 * required set, never written into config, so it cannot drift from the routing
 * that produces it.
 *
 * Deliberately narrow. An entry belongs here only when the configuration that
 * implies it makes the tool unavoidable — not merely likely. A project can have
 * `quality.testCoverage` thresholds and run them through any runner, so no CLI
 * is derived from that; `secrets.provider: "bitwarden"` on the other hand
 * cannot resolve one credential without `bws`.
 * @module tool-floor
 */

/**
 * Config predicates that make a CLI unavoidable, with the reason to report.
 *
 * The reason is not decoration. A missing tool has two valid remedies — install
 * it, or change the configuration that demands it — and an operator cannot pick
 * between them without knowing which line of config is responsible.
 */
const DERIVATIONS = [
  {
    tool: "gh",
    applies: cfg => cfg.tracker === "github" || cfg.source === "github",
    reason: cfg =>
      `${cfg.tracker === "github" ? "tracker" : "source"} is "github", and ` +
      `the work-item guardrails shell out to gh for every tracker read`,
  },
  {
    tool: "bws",
    applies: cfg => cfg.secrets?.provider === "bitwarden",
    reason: () =>
      `secrets.provider is "bitwarden", and the CLI is how every secret is ` +
      `resolved`,
  },
  {
    tool: "doppler",
    applies: cfg => cfg.secrets?.provider === "doppler",
    reason: () => `secrets.provider is "doppler"`,
  },
  {
    tool: "maestro",
    // Keyed on the coverage block rather than a `.maestro` directory: config is
    // the declaration that this project gates on Maestro, where a stray
    // directory could be a leftover. `detect-tooling` uses the directory
    // because it is guessing; here the project has already said so.
    applies: cfg => cfg.quality?.e2eCoverage?.maestro !== undefined,
    reason: () =>
      `quality.e2eCoverage.maestro is configured, and nothing installs the ` +
      `maestro binary`,
  },
];

/**
 * The CLIs a project's configuration makes mandatory.
 * @param {object} [config] Parsed `.lisa.config.json` root.
 * @returns {Array<{name: string, reason: string}>} Sorted derived tools.
 */
export function toolFloor(config = {}) {
  return DERIVATIONS.filter(entry => safely(() => entry.applies(config)))
    .map(entry => ({ name: entry.tool, reason: entry.reason(config) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Evaluate a predicate, treating a malformed config as "does not apply".
 *
 * A config shaped unexpectedly is a problem for the schema validator to report
 * in its own vocabulary. Throwing here would make a readiness check the place a
 * structural defect first surfaces, with a message about tools that names
 * nothing an operator can act on.
 * @param {Function} predicate Test to run.
 * @returns {boolean} The result, or false when it threw.
 */
function safely(predicate) {
  try {
    return Boolean(predicate());
  } catch {
    return false;
  }
}
