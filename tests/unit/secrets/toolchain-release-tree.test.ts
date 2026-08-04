/**
 * Tests for the `release-tree` install kind.
 *
 * `release-zip` and `release-tar` extract an archive and copy ONE file onto
 * PATH. That is right for a static binary and silently wrong for an artifact
 * whose entry point resolves its own siblings — the install reports success and
 * the tool fails at first use, which is the failure the toolchain manifest
 * exists to convert into a loud setup error.
 *
 * Maestro is the case that forced it: a launcher computing
 * `CLASSPATH=$APP_HOME/lib/*` from its own location. Installed as `release-zip`
 * it reports success and then dies with `Could not find or load main class`.
 *
 * The archives here are built on the fly rather than downloaded, so the suite
 * stays fast and offline while still exercising the real unpack-and-link path.
 * @module tests/unit/secrets/toolchain-release-tree
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  installTool,
  treePrefix,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";
import { assertPinned } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

/** Directories created for a single test. */
const created: string[] = [];

/** The fixture tool's name, used as its directory and its name on PATH. */
const TOY = "toy";

/** The entry point path inside every fixture archive. */
const ENTRY = `${TOY}/bin/${TOY}`;

/** What the fixture launcher prints when its siblings are reachable. */
const PAYLOAD = "classpath-ok";

/** A stand-in release URL; never fetched, only asserted on. */
const MAESTRO_URL = "https://example.invalid/maestro.zip";

/** Maestro's real entry point path, the case that motivated this kind. */
const MAESTRO_ENTRY = "maestro/bin/maestro";

/** An absolute archiver path, so the test never resolves a command via PATH. */
const ZIP = "/usr/bin/zip";

/** The install kind under test. */
const RELEASE_TREE = "release-tree";

/** A well-formed digest for entries that are never actually fetched. */
const FAKE_SHA = "a".repeat(64);

/** Description of a fixture archive on disk. */
interface Fixture {
  /** `file://` URL the installer downloads from. */
  readonly url: string;
  /** Digest of the archive, for the pin. */
  readonly sha256: string;
  /** Scratch directory holding the archive. */
  readonly root: string;
}

/**
 * Build a zip whose entry point reads a sibling file, like a real JVM launcher.
 *
 * The sibling is the whole point: a copy-one-file installer loses it, and the
 * script then fails exactly where maestro fails. This launcher deliberately
 * does NOT resolve symlinks, which is what caught an earlier symlink-based
 * implementation — plenty of real launchers behave the same way.
 * @returns The fixture archive.
 */
function toyArchive(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-tree-"));
  const stage = path.join(root, "stage");
  const archive = path.join(root, "toy.zip");
  const launcher = [
    "#!/bin/sh",
    'here=$(cd -P "$(dirname "$0")" && pwd)',
    'app_home=$(cd -P "$here/.." && pwd)',
    'cat "$app_home/lib/payload"',
    "",
  ].join("\n");

  created.push(root);
  mkdirSync(path.join(stage, TOY, "bin"), { recursive: true });
  mkdirSync(path.join(stage, TOY, "lib"), { recursive: true });
  writeFileSync(path.join(stage, TOY, "lib", "payload"), `${PAYLOAD}\n`);
  writeFileSync(path.join(stage, ENTRY), launcher);
  chmodSync(path.join(stage, ENTRY), 0o755);
  execFileSync(ZIP, ["-qr", archive, TOY], { cwd: stage });

  return {
    url: `file://${archive}`,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    root,
  };
}

/**
 * Build a manifest entry for a fixture archive.
 * @param archive Fixture from {@link toyArchive}.
 * @param overrides Fields to replace.
 * @returns A manifest entry.
 */
function entry(
  archive: Fixture,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name: TOY,
    version: "1.0.0",
    install: RELEASE_TREE,
    url: archive.url,
    sha256: archive.sha256,
    binary: ENTRY,
    ...overrides,
  };
}

/**
 * Create a fixture and the bin directory an install would target.
 * @returns The fixture and its bin directory.
 */
function installed(): { archive: Fixture; binDir: string } {
  const archive = toyArchive();
  const binDir = path.join(archive.root, "bin");
  mkdirSync(binDir, { recursive: true });
  return { archive, binDir };
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("assertPinned for release-tree", () => {
  it("accepts a fully pinned entry", () => {
    expect(() =>
      assertPinned({
        name: "maestro",
        version: "2.8.0",
        install: RELEASE_TREE,
        url: MAESTRO_URL,
        sha256: FAKE_SHA,
        binary: MAESTRO_ENTRY,
      })
    ).not.toThrow();
  });

  it("refuses an entry with no checksum", () => {
    expect(() =>
      assertPinned({
        name: "maestro",
        install: RELEASE_TREE,
        url: MAESTRO_URL,
        binary: MAESTRO_ENTRY,
      })
    ).toThrow(/needs both url and sha256/);
  });

  it("refuses an entry with no entry point, since there is nothing to guess", () => {
    // The archive root is a directory. Falling back to the tool name — which the
    // single-file kinds do — would install a directory as a binary.
    expect(() =>
      assertPinned({
        name: "maestro",
        install: RELEASE_TREE,
        url: MAESTRO_URL,
        sha256: FAKE_SHA,
      })
    ).toThrow(/needs "binary"/);
  });

  it("names release-tree among the supported methods", () => {
    expect(() => assertPinned({ name: "x", install: "nonsense" })).toThrow(
      /release-tree/
    );
  });
});

describe("installTool with release-tree", () => {
  it("puts a wrapper on PATH that execs the entry point in place", () => {
    // Not a copy, and deliberately not a symlink either: a launcher that does
    // not resolve symlinks would read the link's directory as its home and look
    // for its resources beside the link — the same broken install, for a subset
    // of tools.
    const { archive, binDir } = installed();
    installTool(entry(archive), binDir);

    const shim = path.join(binDir, TOY);
    expect(lstatSync(shim).isSymbolicLink()).toBe(false);
    expect(readFileSync(shim, "utf8")).toContain(
      path.join(treePrefix(entry(archive), binDir), ENTRY)
    );
  });

  it("produces an entry point that can actually resolve its siblings", () => {
    // The real assertion. "A file appeared on PATH" is what the broken kind
    // also achieved.
    const { archive, binDir } = installed();
    installTool(entry(archive), binDir);

    const out = execFileSync(path.join(binDir, TOY), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out.trim()).toBe(PAYLOAD);
  });

  it("keeps the tree out of the bin directory", () => {
    const { archive, binDir } = installed();
    installTool(entry(archive), binDir);

    const prefix = treePrefix(entry(archive), binDir);
    expect(existsSync(path.join(prefix, TOY, "lib"))).toBe(true);
    expect(existsSync(path.join(binDir, TOY, "lib"))).toBe(false);
  });

  it("replaces a previous install rather than layering onto it", () => {
    // Extracting over a stale tree leaves both versions' payloads in place,
    // which fails in a way that reads as a version bug rather than a stale
    // install.
    const { archive, binDir } = installed();
    installTool(entry(archive), binDir);

    const stale = path.join(
      treePrefix(entry(archive), binDir),
      TOY,
      "lib",
      "leftover"
    );
    writeFileSync(stale, "from an older pin\n");
    installTool(entry(archive), binDir);

    expect(existsSync(stale)).toBe(false);
  });

  it("is idempotent — a second install still runs", () => {
    const { archive, binDir } = installed();
    installTool(entry(archive), binDir);
    installTool(entry(archive), binDir);

    const out = execFileSync(path.join(binDir, TOY), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out.trim()).toBe(PAYLOAD);
  });

  it("refuses an archive whose checksum does not match, before unpacking", () => {
    const { archive, binDir } = installed();

    expect(() =>
      installTool(entry(archive, { sha256: "b".repeat(64) }), binDir)
    ).toThrow(/checksum mismatch/);
    expect(existsSync(path.join(binDir, TOY))).toBe(false);
  });

  it("says so plainly when the entry point is not in the archive", () => {
    const { archive, binDir } = installed();

    expect(() =>
      installTool(entry(archive, { binary: `${TOY}/bin/wrong` }), binDir)
    ).toThrow(/not in the archive/);
  });
});
