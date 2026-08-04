#!/usr/bin/env node
/**
 * Decide what a remote environment already has and what it still needs.
 *
 * Remote environments arrive with a base image that already provides much of
 * what a project needs, so the manifest has two entry kinds rather than one:
 *
 *   require — assert present, fail setup with a clear message if missing
 *   install — provision it, pinned and checksummed
 *
 * The distinction is not bookkeeping. A base image is **not a contract**: the
 * vendor can change it. A project quietly depending on a preinstalled tool
 * should break loudly at setup when that happens, rather than mysteriously
 * mid-task weeks later. `require` is what converts an implicit assumption into
 * an explicit check.
 *
 * Planning is separated from execution so the whole decision table is testable
 * without a container, a network, or a real binary anywhere.
 * @module toolchain
 */

/**
 * Compare dotted version strings numerically.
 *
 * String comparison gets this wrong in the case that matters: "10" sorts before
 * "9", so a base-image bump to a newer major would read as a downgrade and pass
 * a minimum-version check it should fail.
 * @param {string} a Left version.
 * @param {string} b Right version.
 * @returns {number} Negative, zero, or positive.
 */
export function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Pull a dotted version out of whatever a tool prints for `--version`.
 *
 * Tools are wildly inconsistent here ("bws 2.1.0", "v20.11.0", "Python 3.12.1"),
 * and normalising with a regex is more honest than maintaining a per-tool parser
 * table that silently rots.
 * @param {string} output Raw `--version` output.
 * @returns {string|null} The version, or null when none is recognisable.
 */
export function extractVersion(output) {
  const match = /(\d+(?:\.\d+)*)/.exec(String(output ?? ""));
  return match ? match[1] : null;
}

/**
 * Classify one required tool against what the environment actually provides.
 * @param {object} tool Manifest entry.
 * @param {{version: string|null, present: boolean}} found Probe result.
 * @returns {{name: string, action: string, reason: string}} The decision.
 */
function planRequired(tool, found) {
  if (!found.present) {
    return {
      name: tool.name,
      action: "missing",
      reason:
        `${tool.name} is required but not present. The base image is not a ` +
        `contract — if it used to provide this, the vendor has changed it. ` +
        `Either add an install entry or pin a different image.`,
    };
  }
  if (
    tool.minVersion &&
    compareVersions(found.version ?? "0", tool.minVersion) < 0
  ) {
    return {
      name: tool.name,
      action: "missing",
      reason:
        `${tool.name} ${found.version ?? "(unknown)"} is older than the ` +
        `required ${tool.minVersion}. Presence alone is not enough when a ` +
        `project depends on a specific version.`,
    };
  }
  return {
    name: tool.name,
    action: "present",
    reason: `${tool.name} ${found.version ?? ""}`.trim(),
  };
}

/**
 * Classify one installable tool against what is already on disk.
 *
 * Detect first, install second. Skipping a matching version is what makes setup
 * and maintenance the same script, and it is the cheap path when a container
 * resumes from cache rather than being built fresh.
 * @param {object} tool Manifest entry.
 * @param {{version: string|null, present: boolean}} found Probe result.
 * @returns {{name: string, action: string, reason: string}} The decision.
 */
function planInstallable(tool, found) {
  if (!tool.version) {
    return {
      name: tool.name,
      action: "invalid",
      reason: `${tool.name} has no pinned version. An unpinned install is not reproducible.`,
    };
  }
  if (found.present && found.version === tool.version) {
    return {
      name: tool.name,
      action: "skip",
      reason: `${tool.name} ${tool.version} already installed`,
    };
  }
  return {
    name: tool.name,
    action: "install",
    reason: found.present
      ? `${tool.name} ${found.version ?? "(unknown)"} does not match pin ${tool.version}`
      : `${tool.name} ${tool.version} not installed`,
  };
}

/** Surfaces a manifest entry may name. */
const KNOWN_SURFACES = new Set(["local", "remote"]);

/**
 * Whether a manifest entry applies to the surface being provisioned.
 *
 * One declaration per tool, not one block per surface. Most tools a project
 * needs are needed *everywhere* — a Maestro or Sonar CLI is as required on a
 * laptop as in a container — and duplicated blocks drift, which this repository
 * has paid for more than once. What actually differs between surfaces is the
 * install method and, more importantly, consent: a disposable container may
 * install silently, a developer's machine may not.
 *
 * Omitting `surfaces` means every surface, because that is true of most tools
 * and the failure of forgetting it should be "checked somewhere unnecessary"
 * rather than "silently absent where it was needed".
 * @param {object} tool Manifest entry.
 * @param {string} surface Surface being provisioned.
 * @returns {boolean} Whether this entry applies.
 */
export function appliesToSurface(tool, surface) {
  const surfaces = tool.surfaces;
  if (surfaces === undefined) return true;
  // A typo must not silently widen scope. Treating any non-array as "omitted"
  // meant `surfaces: "remote"` — an easy thing to write — quietly applied the
  // entry to every surface, which for a platform-specific archive means
  // offering a Linux binary to a laptop. Absent means everywhere; malformed
  // means stop.
  if (!Array.isArray(surfaces)) {
    throw new Error(
      `${tool.name}: surfaces must be an array, got ${typeof surfaces}.\n` +
        `Omit it to mean every surface; write ["remote"] or ["local"] to narrow.`
    );
  }
  if (surfaces.length === 0) return true;
  const unknown = surfaces.filter(entry => !KNOWN_SURFACES.has(entry));
  if (unknown.length > 0) {
    throw new Error(
      `${tool.name}: unknown surface(s) ${unknown.join(", ")}.\n` +
        `Known: ${[...KNOWN_SURFACES].join(", ")}.`
    );
  }
  return surfaces.includes(surface);
}

/**
 * Produce the complete plan for a toolchain manifest.
 * @param {{require?: object[], install?: object[]}} tools Manifest.
 * @param {(name: string) => {version: string|null, present: boolean}} probe Version probe.
 * @returns {Array<{name: string, action: string, reason: string}>} Ordered decisions.
 */
export function planToolchain(tools, probe, surface = "remote") {
  const plan = [];
  for (const tool of tools.require ?? [])
    if (appliesToSurface(tool, surface))
      plan.push(planRequired(tool, probe(tool.name)));
  for (const tool of tools.install ?? [])
    if (appliesToSurface(tool, surface))
      plan.push(planInstallable(tool, probe(tool.name)));
  return plan;
}

/**
 * Reject a manifest entry that could install something unverifiable.
 *
 * A pinned version with no checksum still trusts whatever the URL serves today.
 * Requiring both, changed together in one reviewed commit, is what makes an
 * unexpected archive fail before installation rather than after.
 * @param {object} tool Manifest entry.
 */
export function assertPinned(tool) {
  // Both archive kinds carry the same obligation, and differ only in how they
  // are unpacked. gh, for one, publishes no zip for Linux at all — only .deb,
  // .rpm and .tar.gz — so a zip-only installer could not pin the CLI that
  // Lisa's own guardrails shell out to.
  if (tool.install === "release-zip" || tool.install === "release-tar") {
    if (!tool.url || !tool.sha256) {
      throw new Error(
        `${tool.name}: a ${tool.install} install needs both url and sha256.\n` +
          `A version bump must move the checksum in the same reviewed commit.`
      );
    }
    return;
  }
  if (tool.install === "npm-global") {
    if (!tool.package)
      throw new Error(`${tool.name}: npm-global install needs a package`);
    return;
  }
  throw new Error(
    `${tool.name}: unknown install method "${tool.install}".\n` +
      `Supported: release-zip, release-tar, npm-global.`
  );
}
