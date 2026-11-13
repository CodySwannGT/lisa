/**
 * Every Node version a shipped stack template names must equal the canonical
 * `typescript/copy-overwrite/.nvmrc` value.
 *
 * A consumer project moving to Node 24 found Lisa's own templates disagreeing:
 * `.nvmrc` and `engines` said 24 while the copy-overwrite `GITHUB_ACTIONS.md`
 * still documented 22 — and because that doc is copy-overwrite, the consumer
 * could not correct it locally (CodySwannGT/lisa#4511). Spot checks of single
 * files let that drift through; this sweep reads every tracked file under every
 * shipped stack directory instead, so a new surface cannot drift unnoticed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CANONICAL = fs
  .readFileSync(path.join(ROOT, "typescript/copy-overwrite/.nvmrc"), "utf8")
  .trim();
const CANONICAL_MAJOR = CANONICAL.split(".")[0];

/** Workflow lines that deliberately pin an independently qualified runtime. */
const PRESERVE_MARKER = "lisa-preserve-node-version:";

/**
 * Files whose Node pins are intentionally NOT the host default. Each entry is
 * part of the hash-bound npm-updater runtime, which is qualified against one
 * exact Node 22 binary and cannot advance with host defaults without a full
 * updater requalification (CodySwannGT/lisa#4367). Named one by one so a new
 * file never inherits the exemption by matching a pattern.
 */
const QUALIFIED_RUNTIME_PINS = new Set([
  "all/copy-overwrite/scripts/lib/npm-update-controller-factory.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-execution-adapter.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-npm.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-prepare.mjs",
  "all/copy-overwrite/scripts/lib/npm-update-runtime.mjs",
]);

/**
 * Lisa's own root doc mirrors the shipped template doc; it is not published,
 * but it is read as the reference for the template and must agree with it.
 */
const EXTRA_FILES = [".github/GITHUB_ACTIONS.md"];

const SEMVER = String.raw`\d+\.\d+\.\d+`;
const VERSION = String.raw`\d+\.(?:\d+\.\d+|x)`;

/** Extractors for every shape a Node version takes in shipped templates. */
const EXTRACTORS: readonly RegExp[] = [
  // `node_version: '24.21.0'`, `node-version: 24.21.0`, `node_version: '24.x'`
  // — including commented usage examples, which consumers copy verbatim.
  new RegExp(
    String.raw`(?:node_version|node-version)\s*:\s*['"]?(${VERSION})\b`,
    "g"
  ),
  // `default:` of a reusable workflow's `node_version` input.
  new RegExp(
    String.raw`node_version:\n(?:[ \t]+(?:description|type|required):[^\n]*\n)*[ \t]+default:\s*['"]?(${VERSION})\b`,
    "g"
  ),
  // `${{ vars.NODE_VERSION || '24.21.0' }}` fallbacks.
  new RegExp(String.raw`NODE_VERSION\s*\|\|\s*['"](${VERSION})['"]`, "g"),
  // `"node": "24.21.0"` / `"node": ">= 24.21.0"` engines and eas.json values.
  new RegExp(String.raw`"node"\s*:\s*"(?:>=\s*)?(${VERSION})"`, "g"),
  // Any other quoted exact version on a line that names Node.
  new RegExp(String.raw`\bnode\b[^\n]*?['"](${SEMVER})['"]`, "gi"),
];

/** One Node version occurrence found in a template file. */
type Occurrence = { file: string; line: number; value: string };

/**
 * Shipped stack template directories: `package.json#files` entries that hold
 * Lisa's ownership-strategy subdirectories.
 * @returns Stack directory names
 */
function shippedStacks(): readonly string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  ) as { files: string[] };
  return manifest.files.filter(entry =>
    ["copy-overwrite", "create-only", "package-lisa"].some(strategy =>
      fs.existsSync(path.join(ROOT, entry, strategy))
    )
  );
}

/**
 * Every Node version named by a tracked file under the shipped stacks.
 * @returns Occurrences outside the deliberate qualified-runtime pins
 */
function collectOccurrences(): readonly Occurrence[] {
  const tracked = boundedExecFileSync({
    label: "list shipped template files",
    command: GIT_BIN,
    args: ["ls-files", "-z", "--", ...shippedStacks()],
    cwd: ROOT,
  })
    .split("\0")
    .filter(Boolean);
  return [...tracked, ...EXTRA_FILES]
    .filter(file => !QUALIFIED_RUNTIME_PINS.has(file))
    .flatMap(file => {
      if (file.endsWith(".nvmrc")) {
        const value = fs.readFileSync(path.join(ROOT, file), "utf8").trim();
        return [{ file, line: 1, value }];
      }
      const content = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (!/node/i.test(content)) return [];
      const lines = content.split("\n");
      const seen = new Set<string>();
      return EXTRACTORS.flatMap(extractor =>
        [...content.matchAll(extractor)].flatMap(match => {
          const value = match[1] ?? "";
          const offset = match.index + match[0].lastIndexOf(value);
          const line = content.slice(0, offset).split("\n").length;
          const key = `${line}:${value}`;
          if (
            seen.has(key) ||
            (lines[line - 1] ?? "").includes(PRESERVE_MARKER)
          ) {
            return [];
          }
          seen.add(key);
          return [{ file, line, value }];
        })
      );
    });
}

describe("shipped template Node versions", () => {
  const occurrences = collectOccurrences();

  it("reads a real canonical version and finds the surfaces it governs", () => {
    expect(CANONICAL).toMatch(/^\d+\.\d+\.\d+$/);
    // Guards against a vacuous pass: the sweep must actually see the
    // workflow, engines, and doc surfaces the issue was about.
    const files = new Set(occurrences.map(({ file }) => file));
    expect(files).toContain(
      "typescript/copy-overwrite/.github/GITHUB_ACTIONS.md"
    );
    expect(files).toContain("typescript/package-lisa/package.lisa.json");
    expect(files).toContain("nestjs/create-only/.github/workflows/ci.yml");
    expect(files).toContain(
      "npm-package/create-only/.github/workflows/publish-to-npm.yml"
    );
  });

  it("names only the canonical .nvmrc version (or its major.x)", () => {
    const drifted = occurrences
      .filter(
        ({ value }) => value !== CANONICAL && value !== `${CANONICAL_MAJOR}.x`
      )
      .map(({ file, line, value }) => `${file}:${line} ${value}`);
    expect(drifted).toEqual([]);
  });

  it("keeps the qualified npm-updater runtime pins out of the sweep only by name", () => {
    for (const file of QUALIFIED_RUNTIME_PINS) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });
});
