/** File-type, source-size, and invisible-control defenses for public evidence. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FIXTURE_ROOT = "tests/runtime-upstream-attribution";
const BODY_MODULE_PATH = "src/core/upstream-attribution-body.ts";
const PUBLIC_SHA = "90549e6dae19aa5e53b86908d5050d303b724f55";
const FILES = [
  "bidi.txt",
  "nul.txt",
  "large.txt",
  "aggregate.txt",
  "excerpt.txt",
  "link.txt",
  "pipe.txt",
] as const;
let packageRoot = "";
let buildUpstreamAttributionIssueBody: (input: unknown) => string;

/**
 * Compute the digest used by the test-only exact manifest.
 * @param value - Fixture bytes
 * @returns SHA-256 digest
 */
function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Build a valid event around one runtime file fixture.
 * @param file - Lisa-relative fixture path
 * @param text - Verbatim excerpt expected in the fixture
 * @returns Candidate event
 */
function candidate(file: string, text: string) {
  return {
    documentKind: "issue" as const,
    failureClass: "data-integrity-failure" as const,
    lisaOwnedExcerpts: [{ file, text }],
    lisaSurface: file,
    redactedPlaceholders: ["<host-project>"],
    upstreamCommitRefs: [PUBLIC_SHA],
  };
}

describe("upstream attribution file safety", () => {
  beforeAll(async () => {
    packageRoot = mkdtempSync(path.join(tmpdir(), "lisa-upstream-safety-"));
    const fixtureDirectory = path.join(packageRoot, FIXTURE_ROOT);
    mkdirSync(path.join(packageRoot, "src/core"), { recursive: true });
    mkdirSync(fixtureDirectory, { recursive: true });
    copyFileSync("package.json", path.join(packageRoot, "package.json"));
    copyFileSync(BODY_MODULE_PATH, path.join(packageRoot, BODY_MODULE_PATH));
    const fixtureContents = {
      "aggregate.txt": `${"a".repeat(5000)}\n`,
      "bidi.txt": "safe\u202eunsafe\n",
      "excerpt.txt": `${"a".repeat(17_000)}\n`,
      "large.txt": Buffer.alloc(1_000_001),
      "nul.txt": "safe\0unsafe\n",
    } as const;
    for (const [filename, contents] of Object.entries(fixtureContents)) {
      writeFileSync(path.join(fixtureDirectory, filename), contents);
    }
    writeFileSync(path.join(fixtureDirectory, "target.txt"), "target\n");
    symlinkSync("target.txt", path.join(fixtureDirectory, "link.txt"));
    execFileSync("/usr/bin/mkfifo", [path.join(fixtureDirectory, "pipe.txt")]);
    const evidenceManifest = Object.fromEntries(
      FILES.map(filename => [
        `${FIXTURE_ROOT}/${filename}`,
        filename in fixtureContents
          ? digest(fixtureContents[filename as keyof typeof fixtureContents])
          : "0".repeat(64),
      ])
    );
    const surfaceManifest = Object.fromEntries(
      FILES.map(filename => [`${FIXTURE_ROOT}/${filename}`, true])
    );
    writeFileSync(
      path.join(packageRoot, "src/core/upstream-evidence-manifest.ts"),
      [
        `export const UPSTREAM_EVIDENCE_MANIFEST = Object.freeze(${JSON.stringify(evidenceManifest)});`,
        `export const UPSTREAM_SURFACE_MANIFEST = Object.freeze(${JSON.stringify(surfaceManifest)});`,
        `export const UPSTREAM_PUBLIC_COMMITS = Object.freeze(${JSON.stringify({ [PUBLIC_SHA]: true })});`,
      ].join("\n"),
      "utf8"
    );
    const moduleUrl = `${
      pathToFileURL(path.join(packageRoot, BODY_MODULE_PATH)).href
    }?safety=${Date.now()}`;
    const imported = (await import(moduleUrl)) as {
      readonly buildUpstreamAttributionIssueBody: (input: unknown) => string;
    };
    buildUpstreamAttributionIssueBody =
      imported.buildUpstreamAttributionIssueBody;
  });

  afterAll(() => {
    rmSync(packageRoot, { force: true, recursive: true });
  });

  it.each(["bidi.txt", "nul.txt"])(
    "rejects invisible controls in %s",
    filename => {
      expect(() =>
        buildUpstreamAttributionIssueBody(
          candidate(`${FIXTURE_ROOT}/${filename}`, "safe")
        )
      ).toThrow(/control|bidirectional/i);
    }
  );

  it("rejects an oversized source before reading it", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        candidate(`${FIXTURE_ROOT}/large.txt`, "safe")
      )
    ).toThrow(/source byte limit/i);
  });

  it("enforces per-excerpt and aggregate byte limits", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        candidate(`${FIXTURE_ROOT}/excerpt.txt`, "a".repeat(17_000))
      )
    ).toThrow(/per-excerpt byte limit/i);

    const file = `${FIXTURE_ROOT}/aggregate.txt`;
    expect(() =>
      buildUpstreamAttributionIssueBody({
        ...candidate(file, "a".repeat(5000)),
        lisaOwnedExcerpts: Array.from({ length: 10 }, () => ({
          file,
          text: "a".repeat(5000),
        })),
      })
    ).toThrow(/aggregate byte limit/i);
  });

  it("rejects a symlink even when listed in the manifest", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        candidate(`${FIXTURE_ROOT}/link.txt`, "target")
      )
    ).toThrow(/symlink/i);
  });

  it("rejects a FIFO without blocking", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        candidate(`${FIXTURE_ROOT}/pipe.txt`, "target")
      )
    ).toThrow(/regular file/i);
  });
});
