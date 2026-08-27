/**
 * The commit-time gate for Lisa's generated artifact families.
 *
 * `src/core/upstream-evidence-manifest.ts` and `src/core/lisa-owned-hash-ledger.ts`
 * are both derived from tracked sources, so a commit that edits a source without
 * regenerating them ships an artifact that no longer vouches for the bytes beside
 * it. Both already have a suite-level guard, but the suite is the slow, late place
 * to learn it — CodySwannGT/lisa#2557 only surfaced in a post-merge Release run,
 * with `main` already red for everyone.
 *
 * This file pins the fast pre-commit gate that fires first and names the command.
 * @module tests/unit/scripts/derived-artifact-staleness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

import {
  PACKAGED_EVIDENCE_PREFIXES,
  readableFailure,
  requiresLedgerCheck,
  requiresManifestCheck,
  requiresNightlyGuardCertificateCheck,
} from "../../../scripts/check-derived-artifacts.mjs";

const repoRoot = path.resolve(".");
const LEDGER_COMMAND = "bun run build:lisa-owned-hash-ledger";
const MANIFEST_COMMAND = "bun run build:upstream-evidence-manifest";
const CERTIFICATE_COMMAND = "bun run build:nightly-guard-certificate";
const LISA_OWNED_SOURCE =
  "all/copy-overwrite/scripts/lisa-hooks/block-no-verify.sh";
const PACKAGED_EVIDENCE_SOURCE = "scripts/build-plugins.sh";
const GATE_SCRIPT = "scripts/check-derived-artifacts.mjs";

describe("derived-artifact staleness gate: which checks a commit owes", () => {
  it("owes the ledger check when it stages a copy-overwrite source", () => {
    expect(requiresLedgerCheck([LISA_OWNED_SOURCE])).toBe(true);
  });

  it("owes the ledger check for a brand-new Lisa-owned guard", () => {
    // The exact #2557 arm that had no ledger entry at all: a template added by
    // one branch while the ledger obligation was created by another.
    expect(
      requiresLedgerCheck([
        "all/copy-overwrite/scripts/lisa-hooks/lisa-destructive-guard.mjs",
      ])
    ).toBe(true);
  });

  it("does not owe the ledger check for an unrelated file", () => {
    expect(requiresLedgerCheck(["README.md", "wiki/index.md"])).toBe(false);
  });

  it("triggers the ledger check on any copy-overwrite path, not just `lisa-` ones", () => {
    // Deliberately over-approximate. The ledger's real membership test lives in
    // the generator; re-deriving it here would let the two drift and silently
    // stop triggering. A superset can only run the check more often than needed,
    // never less — the one direction that is safe to be wrong in.
    expect(
      requiresLedgerCheck(["all/copy-overwrite/scripts/unrelated-tool.mjs"])
    ).toBe(true);
  });

  it("owes the manifest check when it stages a packaged evidence source", () => {
    expect(requiresManifestCheck([PACKAGED_EVIDENCE_SOURCE])).toBe(true);
    expect(
      requiresManifestCheck(["typescript/copy-contents/.husky/pre-commit"])
    ).toBe(true);
  });

  it("does not owe the manifest check for a path outside every prefix", () => {
    expect(requiresManifestCheck(["README.md"])).toBe(false);
    expect(requiresManifestCheck(["wiki/index.md"])).toBe(false);
  });

  it("owes the behavior-certificate check for its guard, helper, generator, and package metadata", () => {
    for (const source of [
      "package.json",
      "scripts/generate-nightly-e2e-guard-certificate.mjs",
      "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs",
      "typescript/copy-overwrite/scripts/lib/invoked-as-script.mjs",
    ]) {
      expect(requiresNightlyGuardCertificateCheck([source])).toBe(true);
    }
    expect(requiresNightlyGuardCertificateCheck(["README.md"])).toBe(false);
  });

  it("owes nothing for an empty commit", () => {
    expect(requiresLedgerCheck([])).toBe(false);
    expect(requiresManifestCheck([])).toBe(false);
    expect(requiresNightlyGuardCertificateCheck([])).toBe(false);
  });
});

describe("derived-artifact staleness gate: readable failure output", () => {
  // The person blocked by this gate did not write either generator, and Lisa's
  // gates are read by non-technical operators. A Node stack trace tells them
  // where the throw was, which is never the thing they need.
  // Shaped like what the manifest generator actually throws since #2852: a
  // multi-paragraph refusal naming the input that moved, not one sentence.
  const thrown = [
    "file:///repo/scripts/generate-upstream-evidence-manifest.mjs:200",
    "    throw new Error(describeStaleManifest(",
    "          ^",
    "",
    "Error: src/core/upstream-evidence-manifest.ts is stale.",
    "",
    "  Its inputs moved after it was generated. These files no longer have",
    "  the bytes it recorded:",
    `    ${PACKAGED_EVIDENCE_SOURCE}`,
    "",
    "  Fix: bun run build:upstream-evidence-manifest",
    "    at file:///repo/scripts/generate-upstream-evidence-manifest.mjs:200:11",
    "    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)",
    "",
    "Node.js v22.22.0",
  ].join("\n");

  it("keeps every line that says what is wrong", () => {
    expect(readableFailure(thrown)).toBe(
      [
        "src/core/upstream-evidence-manifest.ts is stale.",
        "",
        "  Its inputs moved after it was generated. These files no longer have",
        "  the bytes it recorded:",
        `    ${PACKAGED_EVIDENCE_SOURCE}`,
        "",
        "  Fix: bun run build:upstream-evidence-manifest",
      ].join("\n")
    );
  });

  it("keeps the blank lines that separate the refusal's paragraphs", () => {
    // Dropping every empty line strips the stack's bracketing blanks and the
    // message's own paragraph breaks alike, which ran a multi-section refusal
    // into one wall of text. Trimming the ends does the first job without the
    // second.
    expect(readableFailure(thrown)).toContain("recorded:\n    scripts");
    expect(readableFailure(thrown)).toContain("\n\n  Fix: ");
  });

  it("drops the code frame, stack frames, and runtime banner", () => {
    const readable = readableFailure(thrown);

    expect(readable).not.toContain("throw new Error(");
    expect(readable).not.toContain("    at ");
    expect(readable).not.toContain("Node.js v");
    expect(readable).not.toContain("^");
  });

  it("passes through a generator that reports without throwing", () => {
    // The ledger writes its own remediation to stderr and exits 1, so there is
    // no frame to strip and nothing may be lost.
    const plain =
      "Lisa-owned hash ledger does not record the bytes currently shipped for:\n" +
      "  all/copy-overwrite/scripts/lisa-hooks/block-no-verify.sh";

    expect(readableFailure(plain)).toBe(plain);
  });
});

describe("derived-artifact staleness gate: prefix list stays in step", () => {
  it("mirrors the generator's packaged evidence prefixes exactly", () => {
    // The duplication is deliberate — the generator runs before the TypeScript
    // build and refuses to load outside the canonical repository, so it cannot
    // be imported for its constant. This test is what keeps the copy honest,
    // the same arrangement `isLisaOwned` already uses in the ledger generator.
    const generator = readFileSync(
      path.join(repoRoot, "scripts/generate-upstream-evidence-manifest.mjs"),
      "utf8"
    );
    const block = /const packagedEvidencePrefixes = \[(?<body>[^\]]*)\]/u.exec(
      generator
    );
    const declared = [
      ...(block?.groups?.body ?? "").matchAll(/"([^"]+)"/gu),
    ].map(match => match[1]);

    const byCodePoint = (left: string, right: string) =>
      left < right ? -1 : Number(left > right);

    expect(declared.length).toBeGreaterThan(0);
    expect([...PACKAGED_EVIDENCE_PREFIXES].toSorted(byCodePoint)).toEqual(
      declared.toSorted(byCodePoint)
    );
  });
});

describe("derived-artifact staleness gate: end to end", () => {
  it("passes on a tree whose artifacts are current", () => {
    expect(() =>
      boundedExecFileSync({
        label: "check-derived-artifacts.mjs --staged",
        command: process.execPath,
        args: [GATE_SCRIPT, "--staged"],
        cwd: repoRoot,
        stdio: "pipe",
      })
    ).not.toThrow();
  });

  it("names the exact regeneration command for each artifact", () => {
    // The whole point of moving the gate earlier is that the developer is told
    // what to run. #2557's failure surfaced as a buried assertion error that
    // named neither command.
    const source = readFileSync(path.join(repoRoot, GATE_SCRIPT), "utf8");

    expect(source).toContain(LEDGER_COMMAND);
    expect(source).toContain(MANIFEST_COMMAND);
    expect(source).toContain(CERTIFICATE_COMMAND);
  });
});

describe("derived-artifact staleness gate: wired into pre-commit", () => {
  const hooks = [
    ".husky/pre-commit",
    "typescript/copy-contents/.husky/pre-commit",
  ];

  for (const hook of hooks) {
    it(`runs the gate from ${hook}`, () => {
      const source = readFileSync(path.join(repoRoot, hook), "utf8");

      expect(source).toContain("scripts/check-derived-artifacts.mjs --staged");
    });

    it(`guards the gate on the script existing in ${hook}`, () => {
      // Downstream projects get this hook but none of Lisa's generators. Without
      // the existence guard the fleet's every commit would fail on a missing file.
      const source = readFileSync(path.join(repoRoot, hook), "utf8");

      expect(source).toContain(`[ -f "${GATE_SCRIPT}" ]`);
    });

    it(`runs the gate after lint-staged in ${hook}`, () => {
      // lint-staged reformats staged files, which can move a template's bytes
      // and stale an artifact that was current a moment earlier. A gate placed
      // before it would vouch for bytes that no longer exist.
      const source = readFileSync(path.join(repoRoot, hook), "utf8");

      expect(source.indexOf("check-derived-artifacts.mjs")).toBeGreaterThan(
        source.indexOf("lint-staged --config")
      );
    });
  }
});

describe("derived-artifact staleness gate: the procedure is written down", () => {
  const RULE = ".agents/rules/regenerating-derived-artifacts.md";

  it("ships a durable note stating stage-before-regenerate", () => {
    const rule = readFileSync(path.join(repoRoot, RULE), "utf8");

    expect(rule).toContain("git add");
    expect(rule).toContain(LEDGER_COMMAND);
    expect(rule).toContain(MANIFEST_COMMAND);
  });

  it("records that lint-staged is why a hand-verified artifact fails at commit", () => {
    const rule = readFileSync(path.join(repoRoot, RULE), "utf8");

    expect(rule).toContain("lint-staged");
  });

  it("records that the manifest does not hash the ledger", () => {
    // The folklore this rule replaces. Measured false in #2852: the ledger sits
    // outside every packaged-evidence prefix, so the manifest records its path
    // and never its bytes. Believing otherwise sends an author to regenerate
    // the file that is not the cause, which is what cost the cycle.
    const rule = readFileSync(path.join(repoRoot, RULE), "utf8");

    expect(rule).toMatch(/does not hash the ledger/u);
  });

  it("is pointed at from the gate that blocks the commit", () => {
    // A note nobody is sent to is a note nobody reads. The person who needs it
    // is standing at this gate, so the gate has to name it.
    const source = readFileSync(path.join(repoRoot, GATE_SCRIPT), "utf8");

    expect(source).toContain(RULE);
  });
});

describe("local test command covers the same files as CI", () => {
  /**
   * CodySwannGT/lisa#2560 reported local `bun run test` collecting 650 files
   * against CI's 656. Measured, the two are identical (656 / 11,658) and the gap
   * was two different commits, not two different sets: 650 is the count at
   * `7e407de88`, and exactly six test files — `lisa-owned-hash-ledger.test.ts`
   * among them — were added between it and `939fec231`. Nothing was excluded,
   * so there is no glob to fix.
   *
   * What is worth pinning is that it stays that way. `--coverage` cannot change
   * test-file discovery, so the only way these sets can come apart is someone
   * editing one script and not the other.
   */
  const scripts = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ).scripts as Record<string, string>;

  it("runs the same vitest invocation locally as CI, differing only by coverage", () => {
    expect(scripts.test).toBe(
      "$npm_execpath run lisa-test-run -- --adapter vitest -- vitest run"
    );
    expect(scripts["test:cov"]).toBe(
      "$npm_execpath run lisa-test-run -- --adapter vitest -- vitest run --coverage"
    );
  });

  it("passes no test-file filter that could shrink the local set", () => {
    // A path argument or --include/--dir here is exactly how the two sets would
    // silently come apart again; --coverage cannot change file discovery.
    for (const script of [scripts.test, scripts["test:cov"]]) {
      expect(script).not.toMatch(/--(?:include|dir|project)\b/u);

      const words = script.split(/\s+/u);
      const vitest = words.indexOf("vitest");
      const positional = words
        .slice(vitest + 2)
        .filter(argument => !argument.startsWith("-"));

      expect(positional).toEqual([]);
    }
  });

  it("is the command CI actually runs for the unit gate", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github/workflows/quality.yml"),
      "utf8"
    );

    expect(workflow).toContain("bun run test:cov");
  });
});
