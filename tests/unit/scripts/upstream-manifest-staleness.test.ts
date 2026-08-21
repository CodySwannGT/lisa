/**
 * What a stale upstream-evidence-manifest refusal is allowed to say.
 *
 * The refusal used to be one line — "src/core/upstream-evidence-manifest.ts is
 * stale; run bun run build:upstream-evidence-manifest" — which names the file
 * that is out of date and nothing about why. The obvious response is to
 * regenerate that file, and when the cause is an input that keeps moving
 * underneath it, regenerating reproduces the same refusal. CodySwannGT/lisa#2852
 * is what that costs: a whole cycle spent regenerating the named file, twice.
 *
 * These tests pin the replacement: the refusal names the INPUT that moved, and
 * the recovery that clears it. The parser is exercised against the real
 * checked-in manifest rather than a hand-written sample, so a change to the
 * generator's output shape fails here instead of silently emitting a refusal
 * with an empty cause.
 * @module tests/unit/scripts/upstream-manifest-staleness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeStaleManifest,
  diagnoseStaleManifest,
  parseManifestInputs,
} from "../../../scripts/lib/upstream-manifest-staleness.mjs";

const MANIFEST_PATH = "src/core/upstream-evidence-manifest.ts";
const currentManifest = readFileSync(path.resolve(MANIFEST_PATH), "utf8");

/** A hash-pinned evidence path that the real manifest is known to record. */
const PINNED_EVIDENCE = "scripts/generate-upstream-evidence-manifest.mjs";
/** A tracked path recorded in the surface manifest and hashed by neither. */
const LEDGER_PATH = "src/core/lisa-owned-hash-ledger.ts";
/** A copy-overwrite template, whose bytes both artifacts record. */
const TEMPLATE_SOURCE =
  "all/copy-overwrite/scripts/lisa-hooks/block-no-verify.sh";

describe("upstream manifest staleness: parsing the generated file", () => {
  it("reads hash-pinned evidence entries out of the real manifest", () => {
    const inputs = parseManifestInputs(currentManifest);

    expect(inputs.evidence.get(PINNED_EVIDENCE)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("reads the tracked-surface entries out of the real manifest", () => {
    const inputs = parseManifestInputs(currentManifest);

    expect(inputs.surface.has(LEDGER_PATH)).toBe(true);
    expect(inputs.surface.has(PINNED_EVIDENCE)).toBe(true);
  });

  it("does not mistake public commit SHAs for tracked paths", () => {
    const inputs = parseManifestInputs(currentManifest);

    // The commit section renders `<sha>: true,` — the same shape as a surface
    // entry. A parser that reads the whole file with one regex swallows 40-char
    // SHAs as file paths and then reports thousands of phantom removals.
    const shaShaped = [...inputs.surface].filter(entry =>
      /^[a-f0-9]{40}$/u.test(entry)
    );
    expect(shaShaped).toEqual([]);
  });
});

describe("upstream manifest staleness: classifying what moved", () => {
  it("reports an input whose bytes moved, not the manifest itself", () => {
    const stale = currentManifest.replace(
      /("scripts\/generate-upstream-evidence-manifest\.mjs":\n {6}")[a-f0-9]{64}/u,
      `$1${"0".repeat(64)}`
    );
    expect(stale).not.toBe(currentManifest);

    const diagnosis = diagnoseStaleManifest(stale, currentManifest);

    expect(diagnosis.changed).toEqual([PINNED_EVIDENCE]);
    expect(diagnosis.added).toEqual([]);
    expect(diagnosis.removed).toEqual([]);
  });

  it("reports a path staged after generation as an addition", () => {
    const stale = currentManifest.replace(
      /^ {4}"src\/core\/lisa-owned-hash-ledger\.ts": true,\n/mu,
      ""
    );
    expect(stale).not.toBe(currentManifest);

    const diagnosis = diagnoseStaleManifest(stale, currentManifest);

    expect(diagnosis.added).toEqual([LEDGER_PATH]);
    expect(diagnosis.changed).toEqual([]);
  });

  it("reports a path removed after generation as a removal", () => {
    const diagnosis = diagnoseStaleManifest(
      currentManifest,
      currentManifest.replace(
        /^ {4}"src\/core\/lisa-owned-hash-ledger\.ts": true,\n/mu,
        ""
      )
    );

    expect(diagnosis.removed).toEqual([LEDGER_PATH]);
    expect(diagnosis.added).toEqual([]);
  });

  it("finds nothing to blame when only the generated file's own bytes differ", () => {
    const diagnosis = diagnoseStaleManifest(
      `${currentManifest}\n// reformatted by hand\n`,
      currentManifest
    );

    expect(diagnosis.changed).toEqual([]);
    expect(diagnosis.added).toEqual([]);
    expect(diagnosis.removed).toEqual([]);
  });
});

describe("upstream manifest staleness: what the refusal says", () => {
  it("names the moved input and the reformat that usually moved it", () => {
    const message = describeStaleManifest({
      changed: [TEMPLATE_SOURCE],
      added: [],
      removed: [],
    });

    expect(message).toContain(MANIFEST_PATH);
    expect(message).toContain(TEMPLATE_SOURCE);
    expect(message).toContain("lint-staged");
    expect(message).toContain("bun run build:upstream-evidence-manifest");
  });

  it("tells a commit that moved a copy-overwrite template to regenerate the ledger too", () => {
    const message = describeStaleManifest({
      changed: [TEMPLATE_SOURCE],
      added: [],
      removed: [],
    });

    expect(message).toContain("bun run build:lisa-owned-hash-ledger");
  });

  it("does not send a non-template change chasing the ledger", () => {
    const message = describeStaleManifest({
      changed: ["scripts/build-plugins.sh"],
      added: [],
      removed: [],
    });

    expect(message).not.toContain("bun run build:lisa-owned-hash-ledger");
  });

  it("names staging, not regeneration, when the tracked set moved", () => {
    const message = describeStaleManifest({
      changed: [],
      added: ["scripts/lib/new-helper.mjs"],
      removed: ["scripts/lib/old-helper.mjs"],
    });

    expect(message).toContain("scripts/lib/new-helper.mjs");
    expect(message).toContain("scripts/lib/old-helper.mjs");
    expect(message).toContain("git add");
  });

  it("says so plainly when no input moved at all", () => {
    const message = describeStaleManifest({
      changed: [],
      added: [],
      removed: [],
    });

    expect(message).toContain("None of its inputs moved");
    expect(message).toContain("bun run build:upstream-evidence-manifest");
  });

  it("truncates a long list instead of printing hundreds of paths", () => {
    const changed = Array.from(
      { length: 25 },
      (_unused, index) => `scripts/lib/file-${index}.mjs`
    );

    const message = describeStaleManifest({ changed, added: [], removed: [] });

    expect(message).toContain("and 15 more");
    expect(message).not.toContain("scripts/lib/file-24.mjs");
  });
});

describe("upstream manifest staleness: the diagnosis is actually wired in", () => {
  it("is what the generator's --check branch reports", () => {
    // The pure functions above are only worth anything if the refusal path
    // calls them. The generator refuses to load outside the canonical
    // repository and does its work at module scope, so it cannot be imported
    // for a direct assertion; its source is read instead.
    const generator = readFileSync(
      path.resolve("scripts/generate-upstream-evidence-manifest.mjs"),
      "utf8"
    );

    expect(generator).toContain("upstream-manifest-staleness.mjs");
    expect(generator).toContain("describeStaleManifest(");
    expect(generator).toContain("diagnoseStaleManifest(");
  });
});
