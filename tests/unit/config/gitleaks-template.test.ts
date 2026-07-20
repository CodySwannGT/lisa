import { execFileSync } from "node:child_process";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = process.cwd();

const hookPath = path.join(
  repoRoot,
  "typescript",
  "copy-contents",
  ".husky",
  "pre-commit"
);

/**
 * Extracts the `mktemp` fail-closed guard block from the pre-commit template so
 * the test can execute it under a real POSIX shell. Behavioral coverage matters
 * here because the hook runs without `set -e`: a content pin alone cannot prove
 * the hook actually aborts when the temp file cannot be created.
 *
 * @param hook - Full text of the pre-commit template.
 * @returns The guard block, verbatim, ready to execute under `sh`.
 */
const extractMktempGuard = (hook: string): string => {
  const match = /^[ \t]*if ! GITLEAKS_COMBINED_IGNORE=[\s\S]*?^[ \t]*fi$/m.exec(
    hook
  );

  if (match === null) {
    throw new Error("pre-commit template has no mktemp guard block");
  }

  return match[0];
};

/**
 * Runs a shell snippet under `sh` with an explicit TMPDIR, returning the exit
 * status alongside stdout/stderr so assertions can inspect both the failure
 * mode and the operator-facing message.
 *
 * @param snippet - Shell source to execute.
 * @param tmpdir - Value to expose as TMPDIR to the snippet.
 * @returns Exit status plus captured stdout and stderr.
 */
const runUnderSh = (
  snippet: string,
  tmpdir: string
): { status: number; stdout: string; stderr: string } => {
  try {
    // Absolute path: husky hooks are invoked as `/bin/sh` and pinning it here
    // keeps the test independent of whatever PATH the runner inherits.
    const stdout = execFileSync("/bin/sh", ["-c", snippet], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmpdir },
      stdio: ["ignore", "pipe", "pipe"],
    });

    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as {
      status: number | null;
      stdout: string;
      stderr: string;
    };

    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
};

describe("gitleaks allowlist templates", () => {
  it("keeps host-owned .gitleaksignore under create-only", async () => {
    await expect(
      fs.pathExists(
        path.join(repoRoot, "typescript", "copy-overwrite", ".gitleaksignore")
      )
    ).resolves.toBe(false);
    await expect(
      fs.pathExists(
        path.join(repoRoot, "typescript", "create-only", ".gitleaksignore")
      )
    ).resolves.toBe(true);
  });

  it("ships shared Lisa gitleaks entries in a local companion file", async () => {
    const localIgnore = await fs.readFile(
      path.join(
        repoRoot,
        "typescript",
        "copy-overwrite",
        ".gitleaksignore.local"
      ),
      "utf8"
    );

    expect(localIgnore).toContain(
      ".github/workflows/quality.yml:curl-auth-user:1093"
    );
  });

  it("combines host and Lisa gitleaks ignore files in the pre-commit hook", async () => {
    const hook = await fs.readFile(hookPath, "utf8");

    expect(hook).toContain(".gitleaksignore.local");
    expect(hook).toContain("--gitleaks-ignore-path=$GITLEAKS_COMBINED_IGNORE");
  });

  it("uses a portable mktemp template (bare mktemp errors on BSD/macOS)", async () => {
    const hook = await fs.readFile(hookPath, "utf8");

    // BSD/macOS `mktemp` requires an explicit template argument with a trailing
    // X run; bare `$(mktemp)` errors there. GNU mktemp accepts the template too.
    expect(hook).toContain('mktemp "${TMPDIR:-/tmp}/gitleaks-ignore.XXXXXXXX"');
    expect(hook).not.toContain('"$(mktemp)"');
  });

  it("fails closed when mktemp fails", async () => {
    const hook = await fs.readFile(hookPath, "utf8");

    // The hook runs without `set -e`, so an unguarded `mktemp` failure would
    // leave GITLEAKS_COMBINED_IGNORE empty and hand gitleaks a malformed
    // `--gitleaks-ignore-path=`. The guard must abort instead.
    expect(hook).toContain("if ! GITLEAKS_COMBINED_IGNORE=");
    expect(hook).toContain('[ -z "$GITLEAKS_COMBINED_IGNORE" ]');
    expect(hook).toContain(
      "Failed to create the temporary Gitleaks ignore file"
    );
    expect(hook).toContain("TMPDIR");

    const guard = extractMktempGuard(hook);

    expect(guard).toContain("exit 1");
  });

  it("aborts with an operator-facing error when TMPDIR is unusable", async () => {
    const hook = await fs.readFile(hookPath, "utf8");
    const guard = extractMktempGuard(hook);

    const result = runUnderSh(
      guard,
      path.join(os.tmpdir(), "lisa-gitleaks-guard-does-not-exist")
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Failed to create the temporary Gitleaks ignore file"
    );
  });

  it("creates the temporary ignore file when TMPDIR is usable", async () => {
    const hook = await fs.readFile(hookPath, "utf8");
    const guard = extractMktempGuard(hook);

    const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-gitleaks-"));

    try {
      const result = runUnderSh(
        `${guard}\nprintf '%s' "$GITLEAKS_COMBINED_IGNORE"`,
        workdir
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(path.join(workdir, "gitleaks-ignore."));
      await expect(fs.pathExists(result.stdout)).resolves.toBe(true);
    } finally {
      await fs.remove(workdir);
    }
  });
});
