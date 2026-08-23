/**
 * Tests for the `release-binary` install kind.
 *
 * Several tools worth pinning publish a raw executable rather than an archive —
 * `jq` ships `jq-linux-amd64` plus a `sha256sum.txt`, ideal material for a
 * checksummed pin and inexpressible by any archive kind.
 *
 * The failure this prevents is the bad sort: `release-zip` PASSES `assertPinned`
 * for such an entry and then dies at install when `unzip` is handed a binary. An
 * entry that validates and cannot install surfaces during provisioning instead
 * of during review.
 * @module tests/unit/secrets/toolchain-release-binary
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installTool } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { assertPinned } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** Directories created for a single test. */
const created: string[] = [];

/** The install kind under test. */
const RELEASE_BINARY = "release-binary";

/** A well-formed digest for entries that are never fetched. */
const FAKE_SHA = "a".repeat(64);

/** What the fixture binary prints, proving it ran rather than merely landed. */
const OUTPUT = "binary-ran";

/**
 * Publish a bare executable to a `file://` URL, as a vendor release would.
 * @returns The url, its digest, and a scratch root.
 */
function bareBinary(): { url: string; sha256: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-binary-"));
  const artifact = path.join(root, "toy");

  created.push(root);
  writeFileSync(artifact, `#!/bin/sh\necho ${OUTPUT}\n`);

  return {
    url: `file://${artifact}`,
    sha256: createHash("sha256").update(readFileSync(artifact)).digest("hex"),
    root,
  };
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("assertPinned for release-binary", () => {
  it("accepts url + sha256 without a binary path", () => {
    // The download IS the binary, so there is nothing inside it to name.
    expect(() =>
      assertPinned({
        name: "jq",
        version: "1.8.2",
        install: RELEASE_BINARY,
        url: "https://example.invalid/jq-linux-amd64",
        sha256: FAKE_SHA,
      })
    ).not.toThrow();
  });

  it("refuses an entry with no checksum", () => {
    // More load-bearing here than for the archives: the artifact is directly
    // executable, so a wrong one placed on PATH can simply be run.
    expect(() =>
      assertPinned({
        name: "jq",
        install: RELEASE_BINARY,
        url: "https://example.invalid/jq-linux-amd64",
      })
    ).toThrow(/needs both url and sha256/);
  });

  it("names release-binary among the supported methods", () => {
    expect(() => assertPinned({ name: "x", install: "nonsense" })).toThrow(
      /release-binary/
    );
  });
});

describe("installTool with release-binary", () => {
  it("installs an executable that actually runs", () => {
    const artifact = bareBinary();
    const binDir = path.join(artifact.root, "bin");
    mkdirSync(binDir, { recursive: true });

    installTool(
      { name: "toy", version: "1.0.0", install: RELEASE_BINARY, ...artifact },
      binDir
    );

    const installed = path.join(binDir, "toy");
    expect(statSync(installed).mode & 0o777).toBe(0o755);
    expect(
      boundedExecFileSync({
        label: "the installed release-binary tool",
        command: installed,
        args: [],
      }).trim()
    ).toBe(OUTPUT);
  });

  it("refuses a mismatched checksum before anything reaches PATH", () => {
    // Ordering is the assertion. Verifying after placement would leave a
    // runnable wrong binary in the bin directory even on a failed install.
    const artifact = bareBinary();
    const binDir = path.join(artifact.root, "bin");
    mkdirSync(binDir, { recursive: true });

    expect(() =>
      installTool(
        {
          name: "toy",
          version: "1.0.0",
          install: RELEASE_BINARY,
          url: artifact.url,
          sha256: "b".repeat(64),
        },
        binDir
      )
    ).toThrow(/checksum mismatch/);
    expect(existsSync(path.join(binDir, "toy"))).toBe(false);
  });

  it("leaves no download scratch behind", () => {
    const artifact = bareBinary();
    const binDir = path.join(artifact.root, "bin");
    mkdirSync(binDir, { recursive: true });

    installTool(
      { name: "toy", version: "1.0.0", install: RELEASE_BINARY, ...artifact },
      binDir
    );

    expect(existsSync(path.join(binDir, ".toy-download"))).toBe(false);
  });
});
