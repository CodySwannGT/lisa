/**
 * Fixtures shared by the workstation suites.
 * @module tests/unit/workstation/fixtures
 */

/** A path that stands in for "installed, somewhere ordinary". */
export const ANY_PATH = "/usr/local/bin";

/** The directory pinned, checksummed binaries land in. */
export const BIN_DIR = "/root/.local/bin";

/** A home directory to expand `~` against in assertions. */
export const HOME = "/root";

/** The install kind whose artifacts are fetched from a vendor script. */
export const VENDOR_SCRIPT = "vendor-script";

/** A stand-in installer URL; never fetched, only asserted on. */
export const SCRIPT_URL = "https://example.invalid/install.sh";

/**
 * Build probes that report a fixed set of tools as present.
 * @param present Map of tool name to the path it resolves at.
 * @returns Injectable probes.
 */
export const probes = (present: Record<string, string> = {}) => ({
  locate: (name: string) => present[name] ?? null,
  version: () => "1.2.3",
});

/** Where a base image's own git lives; the canonical "system" provenance. */
export const SYSTEM_GIT = "/usr/bin/git";

/** Where a base image's own node lives. */
export const SYSTEM_NODE = "/usr/bin/node";

/** The install method that opens an archive with `unzip`. */
export const RELEASE_ZIP = "release-zip";

/** The install method that opens an archive with `tar`. */
export const RELEASE_TAR = "release-tar";

const BWS_RELEASE =
  "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0";
const GH_RELEASE = "https://github.com/cli/cli/releases/download/v2.83.0";

/**
 * The exact artifact each pinned platform must resolve to.
 *
 * Written out in full rather than checked for shape: a URL pattern and a
 * 64-character hex pattern are satisfied by the WRONG release just as happily
 * as by the right one, and a pin carrying another platform's digest is the
 * specific failure a checksum exists to catch. Every digest here was produced
 * by downloading that artifact and hashing it, so this table is the record of
 * that verification rather than a restatement of the catalogue.
 *
 * `install` is part of the identity because it decides whether the archive is
 * opened with `unzip` or with `tar`. gh publishes .tar.gz for Linux and .zip
 * for macOS under one entry-level `release-tar`, so its macOS blocks must
 * override that or the installer runs tar over a ZIP and fails during
 * extraction — a pin that resolves and cannot install.
 */
export const PINNED_ARTIFACTS = [
  {
    tool: "bws",
    platform: "linux-x64",
    url: `${BWS_RELEASE}/bws-x86_64-unknown-linux-gnu-2.1.0.zip`,
    sha256: "ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860",
    install: RELEASE_ZIP,
  },
  {
    tool: "bws",
    platform: "linux-arm64",
    url: `${BWS_RELEASE}/bws-aarch64-unknown-linux-gnu-2.1.0.zip`,
    sha256: "18253757286e119d450133a87eb463bf8c1ce418ce24c834f4f250d60cba6f9e",
    install: RELEASE_ZIP,
  },
  {
    tool: "bws",
    platform: "darwin-arm64",
    url: `${BWS_RELEASE}/bws-aarch64-apple-darwin-2.1.0.zip`,
    sha256: "9cb1c1c6e6164d83b2e339883ba02b4cbb37188ce9a484b1ce8249443163e066",
    install: RELEASE_ZIP,
  },
  {
    tool: "bws",
    platform: "darwin-x64",
    url: `${BWS_RELEASE}/bws-x86_64-apple-darwin-2.1.0.zip`,
    sha256: "6f626b3971368902af1b9847c02791a1b4666969d7561e2047681cded7997537",
    install: RELEASE_ZIP,
  },
  {
    tool: "gh",
    platform: "linux-x64",
    url: `${GH_RELEASE}/gh_2.83.0_linux_amd64.tar.gz`,
    sha256: "a5cf6cdb40fc67751adf561126b3314044779cea81ba4f254fbe8e9a69f1676f",
    binary: "gh_2.83.0_linux_amd64/bin/gh",
    install: RELEASE_TAR,
  },
  {
    tool: "gh",
    platform: "linux-arm64",
    url: `${GH_RELEASE}/gh_2.83.0_linux_arm64.tar.gz`,
    sha256: "12311e320d4cfdb54d7fa2d58cd1e3a2ccb4c12e1c3abb32b0a2e48bd0f991bf",
    binary: "gh_2.83.0_linux_arm64/bin/gh",
    install: RELEASE_TAR,
  },
  {
    tool: "gh",
    platform: "darwin-arm64",
    url: `${GH_RELEASE}/gh_2.83.0_macOS_arm64.zip`,
    sha256: "fecba907bc361d5e33620dbf1145f11432c39fb2b388a839463cfbb89a84820b",
    binary: "gh_2.83.0_macOS_arm64/bin/gh",
    install: RELEASE_ZIP,
  },
  {
    tool: "gh",
    platform: "darwin-x64",
    url: `${GH_RELEASE}/gh_2.83.0_macOS_amd64.zip`,
    sha256: "0c0de650752bb92d7283e386cafd03d9ac5f47028c648c4ab821ef08a75c0716",
    binary: "gh_2.83.0_macOS_amd64/bin/gh",
    install: RELEASE_ZIP,
  },
] as const;
