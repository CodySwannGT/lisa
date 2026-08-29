/**
 * Regression coverage for repo-scope vocabulary drift.
 *
 * `/lisa:validate-tracker-mapping` audits LIFECYCLE roles, and #3420 added
 * advisory smells for the OPEN scoping families. Neither walks `repo:`, which
 * is the one family whose drift silently narrows a build queue: a scan
 * filtering on the canonical spelling returns FEWER items rather than an
 * error, and an empty result reads as "nothing to do".
 *
 * The defect is checkable rather than heuristic. `assertRepoScope`
 * (`all/copy-overwrite/scripts/lisa-work-item.mjs`, #1957) accepts three
 * spellings as valid repo scope — `repo:<name>`, the bare `<name>` label, and
 * a Jira component equal to the bare name — while every build-intake scanner
 * filters on `repo:<name>` alone. An item carrying only an alias therefore
 * passes validation while being invisible to every scan looking for it. The
 * bare branch is load-bearing (Sentry-provenance items arrive with only the
 * bare name), so the fix is to observe the disagreement, not to tighten it away.
 *
 * The last test is the one that matters most: it asserts the invariant
 * directly — everything `assertRepoScope` accepts for a repository is
 * something a canonical-label filter finds — rather than trusting the
 * classifications above to imply it.
 * @module tests/unit/strategies/repo-scope-vocabulary-drift
 */
import { describe, expect, it } from "vitest";

import {
  auditRepoScopeVocabulary,
  canonicalRepoLabel,
  parseRepoMarker,
} from "../../../plugins/src/base/scripts/repo-scope-vocabulary-audit.mjs";

const BACKEND = "backend";
const FRONTEND = "frontend";
const INFRASTRUCTURE = "infrastructure";

const REPO_BACKEND = "repo:backend";
const REPO_FRONTEND = "repo:frontend";
const REPO_INFRASTRUCTURE = "repo:infrastructure";
const REPO_ADMIN_FRONTEND = "repo:admin-frontend";

const TYPE_BUG = "type:Bug";
const UNSTAMPED_ALIAS = "unstamped-alias";
const REPO_MOBILE = "repo:mobile";
const REPO_HYPHEN_FRONTEND = "repo-frontend";

const VOCABULARY = [BACKEND, FRONTEND, INFRASTRUCTURE, "admin-frontend"];

const DRIFTED = "DRIFTED";
const VALID = "VALID";
const UNRESOLVABLE = "UNRESOLVABLE";

/** A tracker whose every item carries the canonical marker and nothing else. */
const CONFORMING_ITEMS = [
  { ref: "SE-1", labels: [REPO_BACKEND, TYPE_BUG] },
  { ref: "SE-2", labels: [REPO_FRONTEND, "type:Story"] },
  { ref: "SE-3", labels: [REPO_INFRASTRUCTURE, "component:ci"] },
];

const CONFORMING_LABELS = [
  REPO_BACKEND,
  REPO_FRONTEND,
  REPO_INFRASTRUCTURE,
  REPO_ADMIN_FRONTEND,
  TYPE_BUG,
  "component:ci",
];

/**
 * The canonical-filter half of the invariant: what a build-intake scan finds
 * when it filters a tracker on one repository's canonical label.
 * @param items - The tracker's work items with their labels.
 * @param repo - The repository short name being scanned for.
 * @returns The refs of the items the scan returns.
 */
function scanByCanonicalLabel(
  items: readonly { ref: string; labels?: string[] }[],
  repo: string
): string[] {
  const wanted = canonicalRepoLabel(repo);
  return items
    .filter(item =>
      (item.labels ?? []).some(label => label.trim().toLowerCase() === wanted)
    )
    .map(item => item.ref);
}

/**
 * The validation half: `assertRepoScope`'s acceptance rule, transcribed from
 * `lisa-work-item.mjs` — canonical label, bare label, or Jira component,
 * matched case-insensitively on the exact repo short name.
 * @param item - A work item to validate.
 * @param item.labels - The item's label names.
 * @param item.components - The item's Jira component names.
 * @param repo - The repository short name being validated against.
 * @returns Whether repo-scope validation accepts the item for that repository.
 */
function passesAssertRepoScope(
  item: { labels?: string[]; components?: string[] },
  repo: string
): boolean {
  const bare = repo.toLowerCase();
  const labels = (item.labels ?? []).map(name => name.trim().toLowerCase());
  const components = (item.components ?? []).map(name =>
    name.trim().toLowerCase()
  );
  return (
    labels.includes(`repo:${bare}`) ||
    labels.includes(bare) ||
    components.includes(bare)
  );
}

describe("repo-scope vocabulary audit", () => {
  describe("a declared vocabulary is audited", () => {
    it("classifies the repo family alongside the lifecycle roles", () => {
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: CONFORMING_ITEMS,
        labels: CONFORMING_LABELS,
      });

      expect(result.vocabulary).toEqual(VOCABULARY);
      expect(result.findings.every(finding => finding.family === "repo")).toBe(
        true
      );
    });

    it("cannot report a passing verdict when the vocabulary is empty", () => {
      // The whole failure this audit exists to catch is a check that returns
      // "nothing wrong" having looked at nothing. An underived vocabulary must
      // never read as VALID.
      const result = auditRepoScopeVocabulary({
        knownRepos: [],
        items: CONFORMING_ITEMS,
        labels: CONFORMING_LABELS,
      });

      expect(result.verdict).toBe(UNRESOLVABLE);
      expect(result.verdict).not.toBe(VALID);
    });
  });

  describe("a conforming tracker still passes", () => {
    it("returns VALID with no findings", () => {
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: CONFORMING_ITEMS,
        labels: CONFORMING_LABELS,
      });

      expect(result.verdict).toBe(VALID);
      expect(result.findings).toEqual([]);
    });
  });

  describe("drift fails loudly in the live-to-config direction", () => {
    it("names an undeclared repo-family label", () => {
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: CONFORMING_ITEMS,
        labels: [...CONFORMING_LABELS, REPO_MOBILE],
      });

      expect(result.verdict).toBe(DRIFTED);
      const finding = result.findings.find(
        entry => entry.kind === "undeclared-scope"
      );
      expect(finding?.label).toBe(REPO_MOBILE);
      expect(finding?.repo).toBe("mobile");
    });

    it("names a marker whose separator drifted off the canonical form", () => {
      // The observed case: `repo-frontend` sitting beside `repo:frontend`,
      // carrying zero items — a vocabulary that had already split.
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: CONFORMING_ITEMS,
        labels: [...CONFORMING_LABELS, REPO_HYPHEN_FRONTEND],
      });

      expect(result.verdict).toBe(DRIFTED);
      const finding = result.findings.find(
        entry => entry.kind === "malformed-marker"
      );
      expect(finding?.label).toBe(REPO_HYPHEN_FRONTEND);
      expect(finding?.canonical).toBe(REPO_FRONTEND);
    });

    it("leaves an unrelated label whose name merely starts with repo alone", () => {
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: CONFORMING_ITEMS,
        labels: [...CONFORMING_LABELS, "repository-health"],
      });

      expect(result.verdict).toBe(VALID);
    });
  });

  describe("the vocabulary survives runtime ingestion", () => {
    it("catches an ingestion-created bare label and the items carrying it", () => {
      // Ingestion recreates a bare `backend` label after the cleanup freed the
      // name. `assertRepoScope` accepts it; no `repo:backend` scan finds it.
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: [
          ...CONFORMING_ITEMS,
          { ref: "SE-9", labels: [BACKEND, TYPE_BUG] },
          { ref: "SE-10", labels: [BACKEND] },
        ],
        labels: [...CONFORMING_LABELS, BACKEND],
      });

      expect(result.verdict).toBe(DRIFTED);
      const finding = result.findings.find(
        entry => entry.kind === UNSTAMPED_ALIAS
      );
      expect(finding?.label).toBe(BACKEND);
      expect(finding?.canonical).toBe(REPO_BACKEND);
      expect(finding?.items).toEqual(["SE-9", "SE-10"]);
    });

    it("catches a bare alias whose casing differs, as assertRepoScope does", () => {
      // The bare `Infrastructure` label doing double duty as an initiative tag
      // was accepted by validation and invisible to every canonical scan.
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: [{ ref: "SE-11", labels: ["Infrastructure"] }],
        labels: ["Infrastructure"],
      });

      expect(result.verdict).toBe(DRIFTED);
      expect(result.findings[0]?.kind).toBe(UNSTAMPED_ALIAS);
      expect(result.findings[0]?.items).toEqual(["SE-11"]);
    });

    it("catches a Jira component standing in for the canonical label", () => {
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: [{ ref: "SE-12", labels: [TYPE_BUG], components: [BACKEND] }],
        labels: [TYPE_BUG],
      });

      expect(result.verdict).toBe(DRIFTED);
      expect(result.findings[0]?.kind).toBe(UNSTAMPED_ALIAS);
      expect(result.findings[0]?.label).toBe("component:backend");
    });

    it("reports a declared alias as a known alias, not as drift", () => {
      // Same bare label — but the item also carries the canonical marker, so
      // every scan still finds it. Nothing is wrong here.
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: [{ ref: "SE-13", labels: [REPO_BACKEND, BACKEND] }],
        labels: [...CONFORMING_LABELS, BACKEND],
      });

      expect(result.verdict).toBe(VALID);
      expect(result.findings).toEqual([]);
      expect(result.knownAliases).toEqual([
        { label: BACKEND, canonical: REPO_BACKEND, items: ["SE-13"] },
      ]);
    });
  });

  describe("an undeclared label is never auto-repaired", () => {
    it("marks every finding non-repairable and keeps the project DRIFTED", () => {
      const result = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items: [{ ref: "SE-14", labels: [BACKEND] }],
        labels: [...CONFORMING_LABELS, REPO_MOBILE, REPO_HYPHEN_FRONTEND],
      });

      expect(result.verdict).toBe(DRIFTED);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(
        result.findings.every(finding => finding.autoRepairable === false)
      ).toBe(true);
      expect(
        result.findings.every(finding => finding.severity === "drift")
      ).toBe(true);
    });
  });

  describe("marker parsing", () => {
    it("reads the canonical separator and the malformed ones, and nothing else", () => {
      expect(parseRepoMarker(REPO_FRONTEND)).toEqual({
        separator: ":",
        value: FRONTEND,
      });
      expect(parseRepoMarker(REPO_HYPHEN_FRONTEND)).toEqual({
        separator: "-",
        value: FRONTEND,
      });
      expect(parseRepoMarker("component:frontend")).toBeNull();
      expect(parseRepoMarker(FRONTEND)).toBeNull();
      expect(parseRepoMarker("repo:")).toBeNull();
    });
  });

  describe("validation and filtering agree", () => {
    it("finds every item assertRepoScope accepts, once the audit is VALID", () => {
      // The invariant, asserted directly rather than inferred from the
      // classifications above: on a tracker the audit calls VALID, an item
      // that passes repo-scope validation for a repository is an item the
      // canonical scan for that repository returns.
      const items = [
        { ref: "SE-1", labels: [REPO_BACKEND] },
        { ref: "SE-2", labels: [REPO_FRONTEND, FRONTEND] },
        { ref: "SE-3", labels: [REPO_INFRASTRUCTURE] },
      ];

      const audit = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items,
        labels: CONFORMING_LABELS,
      });
      expect(audit.verdict).toBe(VALID);

      for (const repo of VOCABULARY) {
        const accepted = items
          .filter(item => passesAssertRepoScope(item, repo))
          .map(item => item.ref);
        expect(scanByCanonicalLabel(items, repo)).toEqual(accepted);
      }
    });

    it("is exactly what the audit reports when it does not hold", () => {
      // The same check on a drifted tracker: SE-4 passes validation for
      // `backend` and the canonical scan misses it. The audit must be DRIFTED
      // precisely because this disagreement exists.
      const items = [
        { ref: "SE-1", labels: [REPO_BACKEND] },
        { ref: "SE-4", labels: [BACKEND] },
      ];

      const accepted = items
        .filter(item => passesAssertRepoScope(item, BACKEND))
        .map(item => item.ref);
      const found = scanByCanonicalLabel(items, BACKEND);

      expect(accepted).toEqual(["SE-1", "SE-4"]);
      expect(found).toEqual(["SE-1"]);

      const audit = auditRepoScopeVocabulary({
        knownRepos: VOCABULARY,
        items,
        labels: CONFORMING_LABELS,
      });
      expect(audit.verdict).toBe(DRIFTED);
      expect(audit.findings[0]?.items).toEqual(["SE-4"]);
    });
  });
});
