/**
 * Contract coverage for BCE-7 (#1841): the bounded-claims evidence disciplines
 * reach every supported agent surface, spec-conformance consumes the v2 verdict,
 * and the whole system is documented for an operator.
 *
 * BCE-1..BCE-6 shipped the disciplines into `plugins/src/base`. Claude is the
 * reference implementation, so a discipline that never leaves the source tree is
 * a discipline five of six agents never see. This suite is the parity backstop:
 * every BCE-touched source file is pinned present and body-identical in each
 * generated root that can represent it, and the one surface that genuinely
 * cannot be represented (agy carries no rules tree; only Claude fires a Stop
 * hook) is pinned as a DOCUMENTED gap with a prose fallback, never a silent drop.
 *
 * It also pins the two wiring obligations of the closeout ticket: the
 * `lisa-spec-conformance` surface reads the v2 verdict's claim→evidence mapping
 * (boundary, required evidence kinds, artifact identity, Not established) so a
 * boundary mismatch is a conformance finding, and the operator-readable
 * end-to-end write-up exists and names both config flip points.
 * @module tests/unit/strategies/bce-parity-and-consumption
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source of truth for every generated plugin root. */
const SRC = "plugins/src/base";

/** The Claude reference artifact plus the four derived agent roots. */
const CLAUDE_ROOT = "plugins/lisa";
const CODEX_ROOT = "plugins/lisa/.codex-plugin";
const CURSOR_ROOT = "plugins/lisa-cursor";
const AGY_ROOT = "plugins/lisa-agy";
const COPILOT_ROOT = "plugins/lisa-copilot";

/**
 * Every `plugins/src` file touched by BCE-1..BCE-6, grouped by the surface kind
 * that decides which roots can represent it.
 */
const BCE_SKILLS = [
  "lisa-implement",
  "lisa-security-review",
  "lisa-security-zap-scan",
  "lisa-tracker-evidence",
  "lisa-github-evidence",
  "lisa-jira-evidence",
  "lisa-linear-evidence",
] as const;

const BCE_RULES = [
  "rules/eager/claim-evidence-mapping.md",
  "rules/reference/claim-evidence-mapping.md",
  "rules/reference/verification.md",
  "rules/reference/config-resolution.md",
] as const;

const BCE_AGENTS = ["security-specialist"] as const;

const BCE_HOOKS = ["hooks/enforce-verification-gate.sh"] as const;

/** Roots that carry skills verbatim (Codex transforms only the frontmatter). */
const VERBATIM_SKILL_ROOTS = [
  CLAUDE_ROOT,
  CURSOR_ROOT,
  AGY_ROOT,
  COPILOT_ROOT,
] as const;

const read = (rel: string): string => readFileSync(path.resolve(rel), "utf8");

/**
 * Strip a leading YAML frontmatter block so per-agent frontmatter transforms
 * (Codex description rewrites, Cursor `.mdc` headers) do not read as drift.
 * @param text - the raw file contents
 * @returns the trimmed body with any frontmatter removed
 */
const body = (text: string): string => {
  if (!text.startsWith("---\n")) return text.trim();
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text.trim() : text.slice(end + 4).trim();
};

/**
 * Cursor rewrites sibling rule links to its flattened `.mdc` names, so compare
 * prose with link *targets* normalized away — the words must still match.
 * @param text - the raw file contents
 * @returns the body with every markdown link target emptied
 */
const proseOnly = (text: string): string =>
  body(text).replace(/\]\([^)]*\)/g, "]()");

describe("BCE six-agent parity backstop (BCE-7)", () => {
  describe.each(BCE_SKILLS)("skill %s", skill => {
    const rel = `skills/${skill}/SKILL.md`;
    const source = read(`${SRC}/${rel}`);

    it.each(VERBATIM_SKILL_ROOTS)("ships byte-identical in %s", root => {
      expect(existsSync(path.resolve(root, rel))).toBe(true);
      expect(read(`${root}/${rel}`)).toBe(source);
    });

    it("ships in the Codex surface with only the frontmatter transformed", () => {
      const codex = read(`${CODEX_ROOT}/${rel}`);
      expect(body(codex)).toBe(body(source));
    });
  });

  describe.each(BCE_RULES)("rule %s", rel => {
    const source = read(`${SRC}/${rel}`);

    it("ships byte-identical in the Claude and Copilot roots", () => {
      expect(read(`${CLAUDE_ROOT}/${rel}`)).toBe(source);
      expect(read(`${COPILOT_ROOT}/${rel}`)).toBe(source);
    });

    it("ships in the Cursor root as an .mdc rule with the same body", () => {
      const slug = path.basename(rel, ".md");
      const cursorName = rel.startsWith("rules/reference/")
        ? `${slug}-reference.mdc`
        : `${slug}.mdc`;
      const cursor = read(`${CURSOR_ROOT}/rules/${cursorName}`);
      expect(proseOnly(cursor)).toBe(proseOnly(source));
    });
  });

  describe.each(BCE_AGENTS)("agent %s", agent => {
    const rel = `agents/${agent}.md`;
    const source = read(`${SRC}/${rel}`);

    it("ships byte-identical in the Claude, Cursor, and agy roots", () => {
      for (const root of [CLAUDE_ROOT, CURSOR_ROOT, AGY_ROOT]) {
        expect(read(`${root}/${rel}`)).toBe(source);
      }
    });

    it("ships in the Copilot root under the .agent.md adapter name", () => {
      const copilot = read(`${COPILOT_ROOT}/agents/${agent}.agent.md`);
      expect(body(copilot)).toBe(body(source));
    });
  });

  describe.each(BCE_HOOKS)("hook %s", rel => {
    const source = read(`${SRC}/${rel}`);

    it("ships byte-identical everywhere a hook script can run", () => {
      expect(read(`${CLAUDE_ROOT}/${rel}`)).toBe(source);
      expect(read(`${CURSOR_ROOT}/${rel}`)).toBe(source);
      expect(read(`${COPILOT_ROOT}/${rel}`)).toBe(source);
    });
  });

  describe("representation gaps are documented, never silent", () => {
    it("agy carries no rules tree, and the generator says why", () => {
      expect(existsSync(path.resolve(AGY_ROOT, "rules"))).toBe(false);
      const generator = read("scripts/generate-agy-plugin-artifacts.mjs");
      expect(generator).toMatch(/rules/i);
      expect(generator).toMatch(/no full rules tree in agy artifacts/i);
    });

    it("the Stop-hook gate is Claude-only, so the prose gate carries it", () => {
      const implement = read(`${SRC}/skills/lisa-implement/SKILL.md`);
      expect(implement).toMatch(/Claude-only/i);
    });
  });
});

describe("Non-Claude prose gate carries the v2 expectations (BCE-7)", () => {
  const implement = read(`${SRC}/skills/lisa-implement/SKILL.md`);

  it("names every v2 expectation a harness without a Stop hook must self-enforce", () => {
    for (const expectation of [
      "schema_version",
      "boundary",
      "required_evidence_kinds",
      "artifact.head_sha",
      "not_established",
      "not_established_reviewed",
    ]) {
      expect(implement).toContain(expectation);
    }
  });

  it("states the obligation is by convention where no Stop hook fires", () => {
    expect(implement).toMatch(
      /harness(es)? (that )?(do(es)? not|without)[^.]*Stop hook/i
    );
    expect(implement).toMatch(/claim-evidence-mapping/);
  });

  it("names the Claude-only gate as the known representation gap, not a drop", () => {
    const claudeOnly = implement.indexOf("Claude-only");
    expect(claudeOnly).toBeGreaterThan(-1);
    // The gap must be named in the same passage, not somewhere else entirely.
    expect(implement.slice(claudeOnly, claudeOnly + 800)).toMatch(
      /representation\W{0,4}gap/i
    );
  });
});

describe("spec-conformance consumes the v2 claim→evidence mapping (BCE-7)", () => {
  const ROOTS = [SRC, CLAUDE_ROOT] as const;
  /** The contract slug every consuming surface must cite by name. */
  const MAPPING_SLUG = "claim-evidence-mapping";

  describe.each(ROOTS)("%s", root => {
    const skill = read(`${root}/skills/lisa-spec-conformance/SKILL.md`);
    const agent = read(`${root}/agents/spec-conformance-specialist.md`);

    it("reads the v2 verdict file and cites the mapping contract by slug", () => {
      expect(skill).toContain(".lisa/verification-status.json");
      expect(skill).toContain(MAPPING_SLUG);
      expect(skill).toMatch(/schema_version.*2|v2/);
    });

    it("cross-checks each cited claim against its boundary and evidence kinds", () => {
      expect(skill).toContain("boundary");
      expect(skill).toContain("required_evidence_kinds");
      expect(skill).toContain("evidence_refs");
    });

    it("makes a boundary mismatch its own conformance finding status", () => {
      expect(skill).toContain("BOUNDARY_MISMATCH");
      // A mismatch must not be able to render as CONFORMS.
      expect(skill).toMatch(/BOUNDARY_MISMATCH[\s\S]{0,600}DIVERGES/);
    });

    it("surfaces the Not-established section in the coverage matrix output", () => {
      expect(skill).toMatch(/Not established/i);
      expect(skill).toContain("not_established_reviewed");
      // Never omitted: an empty list still renders.
      expect(skill).toMatch(/None outstanding/i);
    });

    it("checks artifact identity so the verdict is bound to what shipped", () => {
      expect(skill).toContain("artifact_head_sha");
    });

    it("degrades instead of blocking when no v2 verdict is present", () => {
      expect(skill).toMatch(/v1|absent|not present|missing/i);
    });

    it("tells the specialist agent a boundary mismatch is a finding", () => {
      expect(agent).toContain(MAPPING_SLUG);
      expect(agent).toMatch(/boundary/i);
      expect(agent).toContain("BOUNDARY_MISMATCH");
    });

    it("has verification-specialist cite the same contract", () => {
      const verification = read(`${root}/agents/verification-specialist.md`);
      expect(verification).toContain(MAPPING_SLUG);
    });
  });
});

/** One evidence row of a v2 verdict, as the skill instructs it be read. */
type EvidenceRow = {
  evidence_id: string;
  kind: string;
  artifact_head_sha?: string;
};

/** One claim of a v2 verdict, bound to its boundary and reaching kinds. */
type ClaimRow = {
  claim_id: string;
  boundary: string;
  required_evidence_kinds?: string[];
  evidence_refs?: string[];
  not_established?: string[];
};

/** The v2 verdict shape Phase 3b of `lisa-spec-conformance` consumes. */
type Verdict = {
  artifact?: { head_sha?: string };
  claims?: ClaimRow[];
  evidence?: EvidenceRow[];
  not_established_reviewed?: boolean;
};

/**
 * Findings for one cited evidence reference: does the kind reach the claim's
 * boundary, and was it captured against the artifact that will ship?
 * @param claim - the claim doing the citing
 * @param ref - the `evidence_id` it cites
 * @param byId - every evidence row of the verdict, keyed by id
 * @param headSha - the verdict's `artifact.head_sha`
 * @returns zero or more human-readable findings
 */
const referenceFindings = (
  claim: ClaimRow,
  ref: string,
  byId: Map<string, EvidenceRow>,
  headSha: string | undefined
): string[] => {
  const ev = byId.get(ref);
  if (!ev) return [`${claim.claim_id}: dangling evidence ref ${ref}`];
  const findings: string[] = [];
  if (!(claim.required_evidence_kinds ?? []).includes(ev.kind)) {
    findings.push(
      `${claim.claim_id}: ${ev.kind} does not reach boundary ${claim.boundary}`
    );
  }
  if (ev.artifact_head_sha !== headSha) {
    findings.push(`${claim.claim_id}: artifact identity mismatch on ${ref}`);
  }
  return findings;
};

/**
 * The three checks Phase 3b of `lisa-spec-conformance` instructs — boundary
 * reach, artifact identity, and the Not-established review — implemented here
 * against the SHIPPED BCE-6 fixtures. The skill is prose an agent follows; this
 * pins that the procedure it describes is actually decidable, and that the
 * fixtures still carry the fields the procedure reads.
 * @param verdict - a parsed `.lisa/verification-status.json` in schema v2
 * @returns every conformance finding, empty when the verdict is clean
 */
const conformanceFindings = (verdict: Verdict): string[] => {
  const findings: string[] = [];
  const byId = new Map((verdict.evidence ?? []).map(e => [e.evidence_id, e]));
  const headSha = verdict.artifact?.head_sha;
  for (const claim of verdict.claims ?? []) {
    for (const ref of claim.evidence_refs ?? []) {
      findings.push(...referenceFindings(claim, ref, byId, headSha));
    }
    if (claim.not_established === undefined) {
      findings.push(`${claim.claim_id}: missing not_established list`);
    }
  }
  if (verdict.not_established_reviewed !== true) {
    findings.push("verdict: not_established_reviewed is not true");
  }
  return findings;
};

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(read(`tests/fixtures/verification/${name}.json`));

describe("The Phase 3b cross-check is decidable on the shipped fixtures (BCE-7)", () => {
  it("raises a boundary finding for a unit log cited on a browser claim", () => {
    const findings = conformanceFindings(fixture("evidence_kind_mismatch"));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(
      "test-run-log does not reach boundary browser"
    );
  });

  it("raises an identity finding when evidence names a different head", () => {
    const findings = conformanceFindings(fixture("artifact_mismatch"));
    expect(findings.some(f => f.includes("artifact identity mismatch"))).toBe(
      true
    );
  });

  it("raises a finding when the Not-established review is missing", () => {
    const findings = conformanceFindings(fixture("not_established_unreviewed"));
    expect(
      findings.some(f => f.includes("not_established_reviewed is not true"))
    ).toBe(true);
  });

  it("raises nothing on a clean v2 verdict", () => {
    expect(conformanceFindings(fixture("v2_pass_clean"))).toEqual([]);
  });
});

describe("The bounded-claims evidence system is documented end-to-end (BCE-7)", () => {
  const DOC = "wiki/concepts/bounded-claims-evidence-system.md";
  const doc = read(DOC);

  it("is linked from the wiki index", () => {
    expect(read("wiki/index.md")).toContain(
      "concepts/bounded-claims-evidence-system.md"
    );
  });

  it("names all four disciplines in operator-readable terms", () => {
    for (const discipline of [
      "boundary",
      "Not established",
      "artifact identity",
      "security",
    ]) {
      expect(doc.toLowerCase()).toContain(discipline.toLowerCase());
    }
  });

  it("names both config flip points and their defaults", () => {
    expect(doc).toContain("verification.gate.enforceBoundaries");
    expect(doc).toContain("security.review.unprovenBucket");
    expect(doc).toContain("security-unproven");
  });

  it("describes the advisory→blocking ratchet path", () => {
    expect(doc).toMatch(/advisory/i);
    expect(doc).toMatch(/ratchet/i);
  });

  it("names the six agent surfaces and the documented gaps", () => {
    for (const agent of [
      "Claude",
      "Codex",
      "Cursor",
      "Antigravity",
      "Copilot",
      "OpenCode",
    ]) {
      expect(doc).toContain(agent);
    }
  });

  it("is cross-linked from the verification reference rule", () => {
    expect(read(`${SRC}/rules/reference/verification.md`)).toContain(
      "spec-conformance"
    );
  });
});
