/**
 * What a workstation can hold, and how each piece is installed.
 *
 * This is the layer beneath `remoteEnv.tools`: it describes a MACHINE, not a
 * project, so nothing here is read from a checkout and no repository needs to
 * exist. The project-scoped manifest still owns project-scoped tools.
 *
 * ## Install method is a per-tool property, not a global policy
 *
 * The obvious design — put every binary in `~/.local/bin` so one code path
 * serves a laptop and a container alike — is wrong, and the agents show why:
 *
 *     claude       -> ~/.local/share/claude/versions/2.1.221
 *     cursor-agent -> ~/.local/share/cursor-agent/versions/2026.07.16-899851b
 *     codex        -> ~/.codex/packages/standalone/current/bin/codex
 *
 * Each vendor manages its own version directory and `~/.local/bin` holds only a
 * SYMLINK. Writing a raw binary there breaks the vendor's self-updater, which
 * expects to swap a link target and would instead find a real file in its way.
 *
 * So each entry declares its own method, and the honest cost is recorded with
 * it: a `vendor-script` entry is NOT pinned and NOT checksummed. That is a real
 * weakening of the guarantee `assertPinned` exists to provide, so the kind is
 * visible in the catalogue and in the report rather than blended in with
 * checksummed entries. A reader can see which tools are trusted to a vendor.
 * @module catalogue
 */

/** Lisa's supported coding agents. Kept in sync with the harness list. */
export const AGENTS = [
  {
    name: "claude",
    label: "Claude Code",
    kind: "vendor-script",
    // The vendor script installs into ~/.local/share/claude/versions/<v> and
    // links ~/.local/bin/claude at it, which is why we must not write there.
    script: "https://claude.ai/install.sh",
    selfUpdates: true,
  },
  {
    name: "codex",
    label: "Codex",
    kind: "npm-global",
    package: "@openai/codex",
    selfUpdates: true,
  },
  {
    name: "cursor-agent",
    label: "Cursor",
    kind: "vendor-script",
    script: "https://cursor.com/install",
    selfUpdates: true,
  },
  {
    name: "opencode",
    label: "OpenCode",
    kind: "vendor-script",
    script: "https://opencode.ai/install",
    // Installs to its own directory and appends a PATH line to the user's
    // shell rc — which a non-interactive container never sources. Declared
    // here so the run puts it on PATH itself rather than reporting a binary
    // that is on disk as missing.
    binDir: "~/.opencode/bin",
    selfUpdates: true,
  },
  {
    name: "agy",
    label: "Antigravity",
    kind: "vendor-script",
    // Google does publish a headless bootstrapper; this entry previously said
    // otherwise and reported the agent as uninstallable. Confirmed live —
    // `content-type: application/x-sh`, and the payload is a bash script that
    // downloads and verifies the flat native build.
    script: "https://antigravity.google/cli/install.sh",
    selfUpdates: true,
  },
  {
    name: "copilot",
    label: "GitHub Copilot CLI",
    kind: "npm-global",
    package: "@github/copilot",
    selfUpdates: false,
  },
];

/**
 * Credential managers, one of which a workstation may use.
 *
 * A CHOICE, not a fixed tool. `lisa-secrets-access` already treats the provider
 * as an axis — bitwarden, 1password, doppler, vault, aws, or plain `env` — and
 * a bootstrap that installed `bws` unconditionally would contradict that,
 * pushing every workstation onto one vendor and quietly making the others
 * second-class.
 *
 * `none` is a first-class answer. A machine using plain environment variables
 * is a supported configuration, not a degraded one, so it must be selectable
 * rather than merely what happens when a question is skipped.
 *
 * Only the SELECTED provider is installed. Installing all of them would put
 * four unused credential CLIs on a machine, each an extra thing to keep patched
 * for no benefit.
 */
export const PROVIDERS = [
  {
    name: "bitwarden",
    binary: "bws",
    label: "Bitwarden Secrets Manager",
    // The one genuinely pinned credential CLI: Bitwarden publishes per-platform
    // archives that can carry a checksum, and a credential bootstrap is exactly
    // where an unverified download matters most.
    kind: "release-zip",
    version: "2.1.0",
    platforms: {
      "linux-x64": {
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-x86_64-unknown-linux-gnu-2.1.0.zip",
        sha256:
          "ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860",
      },
      "linux-arm64": {
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-aarch64-unknown-linux-gnu-2.1.0.zip",
        sha256:
          "18253757286e119d450133a87eb463bf8c1ce418ce24c834f4f250d60cba6f9e",
      },
      // Bitwarden publishes macOS archives for the same tag, and omitting them
      // made the one genuinely pinned credential CLI the one a macOS operator
      // had to install by hand — the unverified path, for the tool where an
      // unverified download matters most.
      "darwin-arm64": {
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-aarch64-apple-darwin-2.1.0.zip",
        sha256:
          "9cb1c1c6e6164d83b2e339883ba02b4cbb37188ce9a484b1ce8249443163e066",
      },
      "darwin-x64": {
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-x86_64-apple-darwin-2.1.0.zip",
        sha256:
          "6f626b3971368902af1b9847c02791a1b4666969d7561e2047681cded7997537",
      },
    },
  },
  {
    name: "1password",
    binary: "op",
    label: "1Password CLI",
    kind: "vendor-script",
    note: "install from 1password.com/downloads/command-line",
  },
  {
    name: "doppler",
    binary: "doppler",
    label: "Doppler CLI",
    kind: "vendor-script",
    script: "https://cli.doppler.com/install.sh",
  },
  {
    name: "vault",
    binary: "vault",
    label: "HashiCorp Vault CLI",
    kind: "vendor-script",
    note: "install from developer.hashicorp.com/vault/install",
  },
  {
    name: "aws",
    binary: "aws",
    label: "AWS Secrets Manager (via AWS CLI)",
    kind: "vendor-script",
    // Deliberately the same entry as the general AWS CLI below: a provider of
    // `aws` needs exactly that binary and nothing extra.
    note: "uses the AWS CLI, which is also a general tool",
  },
  {
    name: "none",
    binary: null,
    label: "No credential manager (plain environment variables)",
    kind: "none",
    note: "supported configuration; nothing is installed",
  },
];

/**
 * Tools every workstation needs regardless of project or provider.
 */
export const TOOLS = [
  {
    name: "git",
    label: "git",
    kind: "required",
    note: "expected from the OS or base image",
  },
  {
    name: "node",
    label: "Node.js",
    kind: "required",
    minVersion: "22",
    note: "expected from the OS or base image; the installers run on it",
  },
  {
    name: "gh",
    label: "GitHub CLI",
    kind: "release-tar",
    version: "2.83.0",
    platforms: {
      "linux-x64": {
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_linux_amd64.tar.gz",
        sha256:
          "a5cf6cdb40fc67751adf561126b3314044779cea81ba4f254fbe8e9a69f1676f",
        binary: "gh_2.83.0_linux_amd64/bin/gh",
      },
      "linux-arm64": {
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_linux_arm64.tar.gz",
        sha256:
          "12311e320d4cfdb54d7fa2d58cd1e3a2ccb4c12e1c3abb32b0a2e48bd0f991bf",
        binary: "gh_2.83.0_linux_arm64/bin/gh",
      },
      "darwin-arm64": {
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_macOS_arm64.zip",
        sha256:
          "fecba907bc361d5e33620dbf1145f11432c39fb2b388a839463cfbb89a84820b",
        binary: "gh_2.83.0_macOS_arm64/bin/gh",
      },
      // Intel Macs are still in service, and an Apple Silicon-only macOS block
      // reads as "macOS is covered" while leaving half of it uncovered.
      "darwin-x64": {
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_macOS_amd64.zip",
        sha256:
          "0c0de650752bb92d7283e386cafd03d9ac5f47028c648c4ab821ef08a75c0716",
        binary: "gh_2.83.0_macOS_amd64/bin/gh",
      },
    },
  },
  {
    name: "aws",
    label: "AWS CLI v2",
    kind: "aws-cli",
    // Not expressible as release-zip: the artifact is a ~73 MB archive
    // containing an installer, not a single binary on PATH. It gets its own
    // kind rather than a vendor-script URL because the steps in between —
    // unzip, then `./aws/install` with an explicit prefix — are the whole job.
    note: "archive wraps an installer rather than a binary",
    selfUpdates: false,
  },
  {
    name: "sonar",
    label: "SonarQube CLI",
    kind: "vendor-script",
    // The vendor's real installer. The plausible-looking `sonarsource.com/install`
    // that was here first 404s, and because a 404 piped to a shell exits 0, it
    // was reported as installed on a machine that had no `sonar` at all.
    script:
      "https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.sh",
    // Same shell-rc assumption as OpenCode.
    binDir: "~/.local/share/sonarqube-cli/bin",
    selfUpdates: true,
  },
];

/** Install kinds this tool can actually perform, versus report only. */
export const INSTALLABLE = new Set([
  "release-zip",
  "release-tar",
  "npm-global",
  "vendor-script",
  "aws-cli",
]);

/** Kinds whose artifact is verified against a published checksum. */
export const CHECKSUMMED = new Set(["release-zip", "release-tar"]);

/**
 * Every directory a workstation must have on PATH.
 *
 * Vendors that manage their own version directory append a PATH line to the
 * user's shell rc, which a non-interactive run — a container build, a cron, an
 * agent — never sources. Collecting them here means one place decides what PATH
 * must contain, used identically by the runtime and by the emitted Dockerfile.
 * @param {string} home The home directory to expand `~` against.
 * @returns {string[]} Absolute directories, most specific last.
 */
export function pathDirs(home) {
  const declared = [...AGENTS, ...PROVIDERS, ...TOOLS]
    .map(entry => entry.binDir)
    .filter(Boolean)
    .map(dir => dir.replace(/^~/, home));
  // ~/.local/bin first: it is where the pinned, checksummed binaries land, and
  // those must win over whatever an image happens to ship under the same name.
  return [`${home}/.local/bin`, ...declared];
}
