#!/usr/bin/env node
/**
 * Generate the digest-to-contract behavior certificate for the nightly guard.
 *
 * A Lisa-owned hash proves ownership, not behavior. This generator instead
 * loads only Lisa package/release artifacts and exercises the actual exported
 * waiver handler: valid audited waiver, self-service, non-maintainer refusal,
 * malformed-trailer refusal, the 72-hour ceiling, and verdict application.
 * Runtime doctor then needs only an exact digest lookup and never evaluates a
 * host project's target.
 *
 * Retention is explicit. A future guard-changing release adds its immutable git
 * ref to `RETAINED_RELEASES`; regeneration rereads that release artifact and
 * reruns the behavior suite. No digest is copied forward from the generated
 * output, so arbitrary historical bytes cannot become trusted by inertia.
 * @module scripts/generate-nightly-e2e-guard-certificate
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const DEFAULT_REPO_ROOT = path.resolve(import.meta.dirname, "..");
const GUARD_PATH =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";
const HELPER_PATH =
  "typescript/copy-overwrite/scripts/lib/invoked-as-script.mjs";
const OUTPUT_PATH = "src/core/nightly-e2e-guard-behavior-certificate.ts";
const CERTIFICATE_SCHEMA_VERSION = 1;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/**
 * Immutable releases retained after the workspace guard changes.
 *
 * Every entry is reread from git and behavior-tested. Adding a digest or source
 * blob here is intentionally impossible; the only input is a release ref.
 */
export const RETAINED_RELEASES = Object.freeze(["v2.353.0", "v4.17.16"]);

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

const invariant = (condition, message) => {
  if (!condition) {
    throw new Error(`Nightly guard behavior certificate refused: ${message}`);
  }
};

const validRequest = Object.freeze({
  labelEvent: Object.freeze({
    actor: "maintainer",
    createdAt: "2026-08-12T06:00:00Z",
  }),
  prAuthor: "author",
  prNumber: 2519,
  label: "nightly-e2e-bypass",
  prBody: "Nightly-E2E-Bypass: #2519 bounded handler proof\n",
  actorPermission: "maintain",
  maxHours: 24,
  extraReasonPattern: "",
  now: new Date("2026-08-12T09:00:00Z"),
});

const VERSION_EXPECTATIONS = Object.freeze({
  "1.1.0": Object.freeze({ selfService: "refused" }),
  "1.7.0": Object.freeze({ selfService: "valid" }),
});

/**
 * Exercise the exported handler and the waiver-to-verdict boundary.
 * @param {Record<string, unknown>} mod - Imported Lisa package artifact
 * @returns {string} Strict compatible contract version proven by behavior
 */
export function verifyNightlyGuardBehavior(mod) {
  const version = mod.NIGHTLY_E2E_CONTRACT_VERSION;
  const semantic = typeof version === "string" ? SEMVER.exec(version) : null;
  invariant(
    semantic?.[1] === "1",
    "contract must be strict ASCII major-1 semver"
  );
  invariant(
    typeof mod.evaluateBypass === "function" &&
      typeof mod.decide === "function",
    "actual handler exports evaluateBypass and decide"
  );
  const expectations = VERSION_EXPECTATIONS[version];
  invariant(
    expectations !== undefined,
    `contract ${version} has no explicit version-appropriate behavior expectations`
  );
  invariant(
    mod.BYPASS_ABSOLUTE_MAX_HOURS === 72,
    "bounded waiver ceiling must remain 72 hours"
  );

  const valid = mod.evaluateBypass(validRequest);
  invariant(
    valid?.valid === true &&
      valid.reason === "valid" &&
      valid.ticket === "#2519" &&
      valid.expiresAt === "2026-08-13T06:00:00.000Z",
    "valid audited waiver behavior changed"
  );
  const selfService = mod.evaluateBypass({
    ...validRequest,
    labelEvent: { actor: "author", createdAt: "2026-08-12T06:00:00Z" },
  });
  invariant(
    expectations.selfService === "valid"
      ? selfService?.valid === true && selfService.actor === "author"
      : selfService?.valid === false && selfService.reason === "self_bypass",
    "self-service audited waiver behavior changed"
  );
  const unauthorized = mod.evaluateBypass({
    ...validRequest,
    actorPermission: "write",
  });
  invariant(
    unauthorized?.valid === false &&
      unauthorized.reason === "actor_not_maintainer",
    "non-maintainer waiver refusal changed"
  );
  const malformed = mod.evaluateBypass({
    ...validRequest,
    prBody: "no ticketed waiver trailer",
    extraReasonPattern: ".*",
  });
  invariant(
    malformed?.valid === false && malformed.reason === "no_reason_or_ticket",
    "built-in waiver reason may no longer be widened"
  );
  const expired = mod.evaluateBypass({
    ...validRequest,
    labelEvent: { actor: "maintainer", createdAt: "2026-08-08T06:00:00Z" },
    maxHours: 24 * 365,
  });
  invariant(
    expired?.valid === false &&
      expired.reason === "bypass_expired" &&
      expired.expiresAt === "2026-08-11T06:00:00.000Z",
    "bounded waiver lifetime behavior changed"
  );

  const red = Object.freeze({ state: "fail", label: "nightly" });
  const bootstrap = Object.freeze({ active: false, until: null });
  const waived = mod.decide([red], { bootstrap, bypass: valid });
  const rejected = mod.decide([red], { bootstrap, bypass: unauthorized });
  invariant(
    waived?.verdict === "bypassed" &&
      waived.blocked === false &&
      waived.bypass?.waived?.length === 1,
    "valid waiver no longer produces one audited bypass verdict"
  );
  invariant(
    rejected?.verdict === "fail" && rejected.blocked === true,
    "rejected waiver no longer leaves the gate closed"
  );
  return version;
}

/**
 * Import one candidate with only the sibling helper the package ships.
 * @param {Buffer} guardBytes - Exact guard artifact bytes
 * @param {Buffer | undefined} invokedAsScriptBytes - Exact sibling helper bytes when that release imports it
 * @returns {Promise<Record<string, unknown>>} Imported module namespace
 */
async function importPackageArtifact(guardBytes, invokedAsScriptBytes) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lisa-guard-cert-"));
  try {
    await mkdir(path.join(temp, "lib"));
    await writeFile(path.join(temp, "guard.mjs"), guardBytes);
    if (invokedAsScriptBytes !== undefined) {
      await writeFile(
        path.join(temp, "lib", "invoked-as-script.mjs"),
        invokedAsScriptBytes
      );
    }
    return await import(pathToFileURL(path.join(temp, "guard.mjs")).href);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

/**
 * Certify exact bytes from an identified Lisa package artifact.
 * @param {{guardBytes: Buffer, invokedAsScriptBytes?: Buffer, packageVersion: string, provenance: string}} input - Package bytes and immutable origin
 * @returns {Promise<{digest: string, contractVersion: string, packageVersion: string, provenance: string}>} Verified certificate source
 */
export async function certifyNightlyGuardPackageArtifact(input) {
  invariant(
    SEMVER.test(input.packageVersion),
    "package provenance must carry a strict semantic version"
  );
  invariant(
    typeof input.provenance === "string" && input.provenance.length > 0,
    "package provenance must identify its artifact"
  );
  const mod = await importPackageArtifact(
    input.guardBytes,
    input.invokedAsScriptBytes
  );
  return Object.freeze({
    digest: digest(input.guardBytes),
    contractVersion: verifyNightlyGuardBehavior(mod),
    packageVersion: input.packageVersion,
    provenance: input.provenance,
  });
}

const gitFile = (repoRoot, ref, file) =>
  Buffer.from(
    boundedExecFileSync("git", ["show", `${ref}:${file}`], {
      cwd: repoRoot,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    })
  );

const gitFileOptional = (repoRoot, ref, file) => {
  try {
    return gitFile(repoRoot, ref, file);
  } catch {
    return undefined;
  }
};

const packageMetadata = bytes => {
  const parsed = JSON.parse(bytes.toString("utf8"));
  invariant(
    parsed?.name === "@codyswann/lisa" &&
      Array.isArray(parsed.files) &&
      parsed.files.includes("typescript"),
    "artifact is not an @codyswann/lisa package containing typescript"
  );
  return parsed;
};

const workspaceArtifact = async repoRoot => {
  const metadata = packageMetadata(
    await readFile(path.join(repoRoot, "package.json"))
  );
  return await certifyNightlyGuardPackageArtifact({
    guardBytes: await readFile(path.join(repoRoot, GUARD_PATH)),
    invokedAsScriptBytes: await readFile(path.join(repoRoot, HELPER_PATH)),
    packageVersion: metadata.version,
    provenance: `workspace package @codyswann/lisa@${metadata.version} (${GUARD_PATH})`,
  });
};

const releaseArtifact = async (repoRoot, ref) => {
  const metadata = packageMetadata(gitFile(repoRoot, ref, "package.json"));
  return await certifyNightlyGuardPackageArtifact({
    guardBytes: gitFile(repoRoot, ref, GUARD_PATH),
    invokedAsScriptBytes: gitFileOptional(repoRoot, ref, HELPER_PATH),
    packageVersion: metadata.version,
    provenance: `git tag ${ref} package @codyswann/lisa@${metadata.version} (${GUARD_PATH})`,
  });
};

const mergeCertificates = entries => {
  const grouped = new Map();
  for (const entry of entries) {
    const prior = grouped.get(entry.digest);
    if (prior && prior.contractVersion !== entry.contractVersion) {
      throw new Error(
        `Nightly guard behavior certificate refused: digest ${entry.digest} has conflicting contracts`
      );
    }
    grouped.set(entry.digest, {
      digest: entry.digest,
      contractVersion: entry.contractVersion,
      packageVersions: [
        ...new Set([...(prior?.packageVersions ?? []), entry.packageVersion]),
      ].sort(),
      provenances: [
        ...new Set([...(prior?.provenances ?? []), entry.provenance]),
      ].sort(),
    });
  }
  return [...grouped.values()].sort((left, right) =>
    left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0
  );
};

const render = async certificates => {
  const rows = certificates
    .map(
      certificate => `  ${JSON.stringify(certificate.digest)}: Object.freeze({
    contractVersion: ${JSON.stringify(certificate.contractVersion)},
    packageVersions: Object.freeze(${JSON.stringify(certificate.packageVersions)}),
    provenances: Object.freeze(${JSON.stringify(certificate.provenances)}),
  }),`
    )
    .join("\n");
  return await format(
    `/**
 * @file nightly-e2e-guard-behavior-certificate.ts
 * @description Generated exact-byte certificates for behavior-proven Lisa guard artifacts
 * @module core/nightly-e2e-guard-behavior-certificate
 * Generated by scripts/generate-nightly-e2e-guard-certificate.mjs.
 */

/** Behavior-certificate schema consumed by doctor. */
export const NIGHTLY_E2E_GUARD_CERTIFICATE_SCHEMA_VERSION = ${CERTIFICATE_SCHEMA_VERSION};

/**
 * Exact digests whose real package handlers passed the bounded-waiver suite.
 * Generic Lisa ownership hashes are deliberately not consulted at runtime.
 */
export const NIGHTLY_E2E_GUARD_BEHAVIOR_CERTIFICATES = Object.freeze({
${rows}
});
`,
    { parser: "typescript" }
  );
};

/**
 * Generate current workspace plus explicitly retained release certificates.
 * @param {string} [repoRoot] - Canonical Lisa checkout
 * @returns {Promise<{source: string, certificates: readonly object[]}>} Generated artifact and structured records
 */
export async function generateNightlyGuardBehaviorCertificate(
  repoRoot = DEFAULT_REPO_ROOT
) {
  const sources = [await workspaceArtifact(repoRoot)];
  for (const ref of RETAINED_RELEASES) {
    sources.push(await releaseArtifact(repoRoot, ref));
  }
  const certificates = mergeCertificates(sources);
  return Object.freeze({
    source: await render(certificates),
    certificates,
  });
}

/**
 * Generate or verify the checked-in artifact.
 * @param {readonly string[]} argv - CLI arguments
 * @param {string} [repoRoot] - Canonical Lisa checkout
 * @returns {Promise<number>} Process exit code
 */
export async function runCertificateCli(argv, repoRoot = DEFAULT_REPO_ROOT) {
  const generated = await generateNightlyGuardBehaviorCertificate(repoRoot);
  const output = path.join(repoRoot, OUTPUT_PATH);
  if (argv.includes("--check")) {
    const current = await readFile(output, "utf8").catch(() => "");
    if (current === generated.source) {
      process.stdout.write("Nightly guard behavior certificate is current.\n");
      return 0;
    }
    process.stderr.write(
      "Nightly guard behavior certificate drifted. Run `bun run build:nightly-guard-certificate` and commit the generated artifact.\n"
    );
    return 1;
  }
  await writeFile(output, generated.source);
  process.stdout.write(
    `Wrote ${OUTPUT_PATH} (${generated.certificates.length} certified digest(s)).\n`
  );
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = await runCertificateCli(process.argv.slice(2));
}
