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
function planInstallable(tool, found, pinIsFloor = false) {
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
  // On a laptop the pin is a floor, not an equality. A container is disposable
  // and reproducible by construction, so an exact match is right there. A
  // developer's machine is shared with every other project they work on, and
  // installing a pinned binary into ~/.local/bin ahead of a NEWER one already on
  // PATH is a downgrade this project imposed on all of them — for gh, pinned at
  // 2.83.0 against a workstation running 2.96.0, that is the likely case rather
  // than the exotic one.
  if (
    pinIsFloor &&
    found.present &&
    found.version &&
    compareVersions(found.version, tool.version) > 0
  ) {
    return {
      name: tool.name,
      action: "newer",
      reason: `${tool.name} ${found.version} is newer than the pinned ${tool.version} — leaving it alone`,
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
 * The platform key a manifest entry is resolved against.
 *
 * `<platform>-<arch>` rather than either alone, because both halves change the
 * artifact: an Apple Silicon laptop and an Intel one run different builds of the
 * same release, and so do an arm64 container and an amd64 one.
 * @param {{platform: string, arch: string}} [runtime] Injectable, for tests.
 * @returns {string} A key such as "darwin-arm64" or "linux-x64".
 */
export function currentPlatform(runtime = process) {
  return `${runtime.platform}-${runtime.arch}`;
}

/**
 * Collapse a manifest entry to the artifact for one platform.
 *
 * A download URL is platform-specific and a checksum doubly so, which the
 * single-URL shape could not express: the only way to stop a laptop being handed
 * a Linux binary was `surfaces: ["remote"]`, which bought that safety by making
 * the tool uninstallable on the laptop entirely. So `bws` and `gh` — the two
 * tools Lisa's own guardrails shell out to — were declared, required, and
 * unprovisionable on the machine most likely to be missing them.
 *
 * A `platforms` map fixes the cause instead of the symptom. `install` lives
 * inside each block rather than beside it, because the method varies too: gh
 * publishes a .tar.gz for Linux and a .zip for macOS, so a single install method
 * would have forced one platform onto an archive kind its vendor does not ship.
 *
 * A flat entry is still valid and means "identical everywhere" — true of every
 * `npm-global` install, which is genuinely platform-independent.
 * @param {object} tool Manifest entry.
 * @param {string} [platform] Platform key to resolve for.
 * @returns {object} The entry with its platform block merged in.
 */
export function resolvePlatform(tool, platform = currentPlatform()) {
  const { platforms } = tool;
  if (platforms === undefined) return tool;
  if (
    typeof platforms !== "object" ||
    platforms === null ||
    Array.isArray(platforms)
  ) {
    throw new Error(
      `${tool.name}: platforms must be an object keyed by <platform>-<arch>, ` +
        `got ${Array.isArray(platforms) ? "an array" : typeof platforms}.\n` +
        `Omit it when one artifact serves every platform.`
    );
  }
  const block = platforms[platform];
  if (!block) {
    const known = Object.keys(platforms).sort().join(", ");
    throw new Error(
      `${tool.name}: no pin for ${platform}.\n` +
        `Declared platforms: ${known || "(none)"}.\n` +
        `Add a block for ${platform} with its own url and sha256, or drop the ` +
        `tool from this surface. Guessing an artifact would defeat the ` +
        `checksum.`
    );
  }
  // The platform block wins over the shared fields, and `platforms` itself is
  // dropped so a resolved entry is indistinguishable from a flat one — that is
  // what lets assertPinned and the installers stay unaware of any of this.
  const { platforms: _discarded, ...shared } = tool;
  return { ...shared, ...block };
}

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
 *
 * Install entries are resolved to the running platform here rather than at
 * install time, so a tool with no artifact for this machine is reported
 * alongside every other problem instead of aborting the run at the first one.
 * An operator fixing a manifest wants the whole list.
 *
 * `require` entries are deliberately not resolved: they carry a name and a
 * minimum version, nothing platform-specific, and inventing a per-platform shape
 * for them would be ceremony with no artifact behind it.
 * @param {{require?: object[], install?: object[]}} tools Manifest.
 * @param {(name: string) => {version: string|null, present: boolean}} probe Version probe.
 * @param {string} [surface] Surface being provisioned.
 * @param {string} [platform] Platform key to resolve install entries against.
 * @returns {Array<{name: string, action: string, reason: string, tool?: object}>} Ordered decisions.
 */
export function planToolchain(
  tools,
  probe,
  surface = "remote",
  platform = currentPlatform()
) {
  const plan = [];
  for (const tool of tools.require ?? [])
    if (appliesToSurface(tool, surface))
      plan.push(planRequired(tool, probe(tool.name)));
  for (const tool of tools.install ?? []) {
    if (!appliesToSurface(tool, surface)) continue;
    let resolved;
    try {
      resolved = resolvePlatform(tool, platform);
    } catch (err) {
      plan.push({ name: tool.name, action: "invalid", reason: err.message });
      continue;
    }
    // The resolved entry travels with the decision so the installer never has to
    // resolve a second time — two resolutions are two chances to disagree, and
    // the one that installs would be the one nothing tested.
    plan.push({
      ...planInstallable(resolved, probe(tool.name), surface === "local"),
      tool: resolved,
    });
  }
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
  // An unresolved entry reaching here means a caller skipped resolvePlatform and
  // is about to read a url and sha256 that belong to no platform in particular.
  // Refusing is the point: the failure this whole change exists to prevent is
  // exactly "downloaded the wrong platform's artifact", and a silent pass here
  // would reintroduce it one call site at a time.
  if (tool.platforms !== undefined) {
    throw new Error(
      `${tool.name}: platform-specific entry was not resolved before install.\n` +
        `Call resolvePlatform() first — the shared fields alone do not name an artifact.`
    );
  }
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
  // A tree carries the same checksum obligation and one more: which file inside
  // it is the entry point. There is no sane default — the archive root is a
  // directory, so guessing would install a directory as a binary.
  if (tool.install === "release-tree") {
    if (!tool.url || !tool.sha256) {
      throw new Error(
        `${tool.name}: a release-tree install needs both url and sha256.\n` +
          `A version bump must move the checksum in the same reviewed commit.`
      );
    }
    if (!tool.binary) {
      throw new Error(
        `${tool.name}: a release-tree install needs "binary" — the path to the ` +
          `entry point INSIDE the archive, such as "maestro/bin/maestro".\n` +
          `Unlike the single-file kinds there is nothing to fall back to: the ` +
          `archive root is a directory.`
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
      `Supported: release-zip, release-tar, release-tree, npm-global.`
  );
}
