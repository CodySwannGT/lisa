/**
 * A bespoke tracker write path skips the validation gates
 * (CodySwannGT/lisa#3663).
 *
 * The vendor write skills gate every item twice — pre-write validate at Phase
 * 5.5 and post-write verify at Phase 7 — and both phases delegate to the same
 * validator so the bar cannot drift. A consumer writing through its own script
 * enters neither phase, and nothing told it so: the obligation was expressed
 * only as a phase number inside a flow the bespoke path never enters. Before
 * this contract shipped, no write skill said a word about it — the
 * reproduction grep returned zero hits in all three at commit 687ee7ba8.
 *
 * **The script's own read-back is what makes this dangerous rather than merely
 * absent.** A bespoke path re-reads the item and confirms the tracker stored
 * what was sent, which reads as verification and is not: it proves TRANSPORT.
 * It cannot fail for the reason the gates exist, because it never asks whether
 * what was sent was any good. Measured once, in a consumer fleet: an item
 * passed a local script's read-back cleanly and then failed the validator on
 * three real defects, one of which — a human decision left sitting in the
 * middle of a supposedly build-ready leaf — is precisely the gate an author
 * cannot self-apply.
 *
 * This is a documentation contract and it is asserted as one. The fix chosen
 * in the issue was deliberately NOT a guard: the guard family that would have
 * to host it already carries three open mis-fire findings, and a fourth parser
 * would not address the half of the problem that is discoverability.
 *
 * These are agent instructions, so the assertions cover the editable plugin
 * source and every regenerated per-agent copy — a phrase that survives in one
 * root and vanishes from another is a fan-out failure, not a formatting
 * difference. Per the Test Isolation house rule, the skill names and phrases
 * are HARDCODED rather than derived from the files under test.
 * @module tests/unit/strategies/bespoke-write-path-contract
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTRACT_TARGETS,
  matchesBespokePathSearch,
  missingPhrases,
  skillPaths,
} from "./bespoke-write-path-contract-helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Where the authoritative skill sources live. */
const SOURCE = "plugins/src/base/skills";

/**
 * The generated per-agent roots the sources fan out into.
 *
 * Listed rather than globbed. A glob finds what exists, so a fan-out that
 * stopped being produced would leave this checking fewer surfaces while still
 * passing — the shape this repository has paid for before.
 */
const GENERATED: readonly string[] = [
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
];

/** One vendor's write / validate / verify triple. */
interface Triple {
  readonly writer: string;
  readonly validator: string;
  readonly verifier: string;
}

const TRIPLES: readonly Triple[] = [
  {
    validator: "lisa-github-validate-issue",
    verifier: "lisa-github-verify",
    writer: "lisa-github-write-issue",
  },
  {
    validator: "lisa-jira-validate-ticket",
    verifier: "lisa-jira-verify",
    writer: "lisa-jira-write-ticket",
  },
  {
    validator: "lisa-linear-validate-issue",
    verifier: "lisa-linear-verify",
    writer: "lisa-linear-write-issue",
  },
];

/**
 * Reads a repository-relative file.
 * @param relative - Path relative to the repository root.
 * @returns The file contents as UTF-8 text.
 */
function readRepoFile(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Read one skill's markdown.
 * @param root - Skills root, source or generated.
 * @param skill - Skill directory name.
 * @returns The file's text.
 */
function skillText(root: string, skill: string): string {
  return readRepoFile(path.posix.join(root, skill, "SKILL.md"));
}

describe("bespoke tracker write path contract", () => {
  for (const target of CONTRACT_TARGETS) {
    for (const relative of skillPaths(target.skill)) {
      it(`${relative} carries the ${target.kind} contract`, () => {
        expect(missingPhrases(readRepoFile(relative), target)).toEqual([]);
      });
    }
  }

  const writeTargets = CONTRACT_TARGETS.filter(
    target => target.kind === "write"
  );

  for (const target of writeTargets) {
    for (const relative of skillPaths(target.skill)) {
      it(`${relative} answers the bespoke-path search`, () => {
        expect(matchesBespokePathSearch(readRepoFile(relative))).toBe(true);
      });
    }
  }
});

describe("a write skill tells a bespoke path what it still owes", () => {
  it.each(TRIPLES)("$writer names both gate skills", triple => {
    const text = skillText(SOURCE, triple.writer);
    expect(text).toContain(triple.validator);
    expect(text).toContain(triple.verifier);
  });

  it.each(TRIPLES)("$writer says a read-back proves transport", triple => {
    // The load-bearing sentence. Without it the section reads as "also run
    // these", and an agent whose script already re-reads its own write has no
    // reason to think anything is missing.
    const text = skillText(SOURCE, triple.writer);
    expect(text).toMatch(/proves (?:TRANSPORT|transport)/u);
    expect(text).toMatch(
      /never that what was sent was any good|whether what was sent was any good|says nothing about whether what was sent clears/u
    );
  });

  it.each(TRIPLES)("$writer says the gates are not shell scripts", triple => {
    // The discoverability half. An agent searches the repository it is standing
    // in, finds no script, and concludes the capability is absent — at which
    // point the local script stops being the convenient option and starts
    // looking like the only one.
    const text = skillText(SOURCE, triple.writer);
    expect(text.split(/\s+/u).join(" ")).toMatch(
      /plugin-resident(?: skills)?(?: and)? invoked through the Skill tool/u
    );
    expect(text).toMatch(
      /(?:will not appear|not\*\* expected to appear) in any repository's `scripts\/`\s+directory/u
    );
  });
});

describe("a validator is advertised as a standalone entry point", () => {
  it.each(TRIPLES)("$validator documents live-item invocation", triple => {
    const text = skillText(SOURCE, triple.validator);
    expect(text).toMatch(
      /Standalone use, against an item that already exists|Standalone entry point — validating an item written by another path/u
    );
    expect(
      text.includes(`Skill(${triple.validator}) with `) ||
        text.includes(`Skill(skill: "${triple.validator}", args:`)
    ).toBe(true);
  });
});

describe("a verify contract forbids byte-exact comparison", () => {
  it.each(TRIPLES)("$verifier rules byte comparison out", triple => {
    const text = skillText(SOURCE, triple.verifier);
    expect(text).toMatch(
      /Comparison (?:is|semantics —) semantic, never byte-exact/u
    );
    // Naming the CAUSE is what stops the rule being read as fussiness and
    // re-litigated by the next author who sees a body come back different.
    expect(text).toMatch(/normalize[sd]? markdown on\s+write/u);
  });
});

describe("every agent surface carries the same contract", () => {
  it("finds the generated roots it claims to check", () => {
    // A roster naming directories that do not exist would make every assertion
    // below vacuously true.
    for (const root of GENERATED) {
      expect(existsSync(path.join(REPO_ROOT, root)), root).toBe(true);
    }
  });

  it.each(TRIPLES)("$writer fans out with the section intact", triple => {
    for (const root of GENERATED) {
      const file = path.join(REPO_ROOT, root, triple.writer, "SKILL.md");
      if (!existsSync(file)) continue;
      expect(readFileSync(file, "utf8"), file).toMatch(
        /proves (?:TRANSPORT|transport)/u
      );
    }
  });
});
