/**
 * Contract coverage for the vendor-neutral credential-substrate-precedence rule.
 *
 * The `*-access` skills are markdown contracts, so their tier ordering is only as
 * real as the prose that documents it. These assertions pin the settled policy
 * (decision record 2026-08-12): the configured-provider token/CLI substrate is
 * tier 1, interactive MCP is a preserved fallback, and identity-match is mandatory
 * on every tier. They exist because the divergence they replace — Linear and
 * Notion resolving MCP-first while Atlassian writes resolved token-first — was
 * invisible at the call site and only failed in headless environments nobody
 * watches.
 * @module tests/unit/strategies/credential-substrate-precedence
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const CONTRACT = "rules/reference/credential-substrate-precedence.md";

const ATLASSIAN = "lisa-atlassian-access";
const LINEAR = "lisa-linear-access";
const NOTION = "lisa-notion-access";
const JAM = "lisa-jam-access";
const SENTRY = "lisa-sentry-access";
const POSTHOG = "lisa-posthog-access";

/**
 * Access skills that resolve a real multi-tier ladder.
 *
 * Sonar is absent deliberately and NOT because it has one substrate — it prefers
 * the token-authed MCP and falls back to the Sonar Web API for reads. It is absent
 * because it documents a preference rather than the numbered `Tier 1`/`Tier 2`
 * ladder these assertions read.
 */
const TIERED_SKILLS = [
  ATLASSIAN,
  LINEAR,
  NOTION,
  JAM,
  SENTRY,
  POSTHOG,
] as const;

/** Access skills that must cite the shared contract instead of restating it. */
const CITING_SKILLS = [
  ...TIERED_SKILLS,
  "lisa-sonarcloud-access",
  "lisa-secrets-access",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

const readSkill = (root: string, skill: string): string =>
  read(root, `skills/${skill}/SKILL.md`);

/**
 * Index of the first match, or -1. Used to assert documented tier ordering.
 * @param doc - Markdown contract body to search.
 * @param pattern - Marker identifying the tier.
 * @returns Character offset of the marker, or -1 when absent.
 */
const at = (doc: string, pattern: RegExp): number => doc.search(pattern);

describe("credential-substrate-precedence contract", () => {
  describe.each(ROOTS)("%s", root => {
    const contract = read(root, CONTRACT);

    it("ships one shared vendor-neutral slug with a non-trivial body", () => {
      expect(contract.length).toBeGreaterThan(2000);
      expect(contract).toMatch(/vendor-neutral/i);
    });

    it("follows the one-shared-slug precedent instead of per-skill prose", () => {
      expect(contract).toMatch(/leaf-only-lifecycle/);
      expect(contract).toMatch(/repo-scope-split/);
      expect(contract).toMatch(/never divergent\s+per-skill prose/i);
    });

    it("orders the configured-provider substrate ahead of interactive MCP", () => {
      const provider = at(contract, /Tier 1 — configured-provider substrate/);
      const mcp = at(contract, /Tier 2 — interactive MCP/);
      expect(provider).toBeGreaterThan(-1);
      expect(mcp).toBeGreaterThan(provider);
    });

    it("gates tier 1 on both bootstrap availability and identity match", () => {
      expect(contract).toMatch(/bootstrap\s+credential is available/i);
      expect(contract).toMatch(
        /identity-match(es)?\s+the configured\s*tenant\/workspace\/site/i
      );
    });

    it("names lisa-secrets-access as the chokepoint feeding tier 1", () => {
      expect(contract).toMatch(/lisa-secrets-access/);
      expect(contract).toMatch(/`tool:`/);
    });

    it("keeps the installed-package resolver in the config-resolution reference", () => {
      const reference = read(root, "rules/reference/config-resolution.md");
      expect(reference).toMatch(
        /candidates\+=\(node_modules\/@codyswann\/lisa\/plugins\/lisa\/skills\/lisa-secrets-access\/scripts\/resolve-secret\.mjs\)/
      );
    });

    it("makes identity-match mandatory on every tier, in both directions", () => {
      expect(contract).toMatch(/mandatory on every substrate/i);
      expect(contract).toMatch(/both directions/i);
      expect(contract).toMatch(/skipped, never used/i);
    });

    it("preserves MCP as a genuine first-class fallback, not a removal", () => {
      expect(contract).toMatch(/first-class fallback/i);
      expect(contract).toMatch(/re-ordering, not a removal/i);
      expect(contract).toMatch(/no bootstrap/i);
      expect(contract).toMatch(/no adapter for the operation/i);
      expect(contract).toMatch(/outage/i);
    });

    it("carries the three rationales the decision settled", () => {
      expect(contract).toMatch(/headless parity/i);
      expect(contract).toMatch(/tenant safety/i);
      expect(contract).toMatch(/determinism/i);
    });

    it("generalizes the Atlassian write-tenant-safety rationale, vendor-neutrally", () => {
      expect(contract).toMatch(/per-invocation/i);
      expect(contract).toMatch(/ambient/i);
      expect(contract).toMatch(/TOCTOU/);
      // The generalization must cover reads too, not just writes.
      expect(contract).toMatch(/read through the wrong tenant/i);
    });

    it("specifies the guarded-fallback protocol for ambient-bound substrates", () => {
      expect(contract).toMatch(/post-write tenant assertion/i);
      expect(contract).toMatch(/roll ?back/i);
    });

    it("states the intended consequence for stale or wrong tokens", () => {
      expect(contract).toMatch(/stale or wrong/i);
      expect(contract).toMatch(/fails? identity-match/i);
      expect(contract).toMatch(/[Ii]ntended/);
    });

    it("is cited by every access skill rather than restated", () => {
      for (const skill of CITING_SKILLS) {
        expect(readSkill(root, skill)).toMatch(
          /credential-substrate-precedence/
        );
      }
    });
  });
});

describe("access skills conform to the precedence contract", () => {
  describe.each(ROOTS)("%s", root => {
    it("keeps identity-match mandatory in every tiered access skill", () => {
      for (const skill of TIERED_SKILLS) {
        expect(readSkill(root, skill)).toMatch(/identity-match/i);
      }
    });

    describe("lisa-linear-access", () => {
      const skill = readSkill(root, LINEAR);

      it("no longer advertises MCP-first in its description", () => {
        expect(skill).not.toMatch(/Resolves Linear MCP first/);
        expect(skill).toMatch(
          /description:[^\n]*LINEAR_API_KEY[^\n]*(before|first|ahead)/i
        );
      });

      it("probes LINEAR_API_KEY + GraphQL before the Linear MCP", () => {
        const token = at(skill, /1\. \*\*Tier 1[^\n]*LINEAR_API_KEY/);
        const mcp = at(skill, /2\. \*\*Tier 2[^\n]*Linear MCP/);
        expect(token).toBeGreaterThan(-1);
        expect(mcp).toBeGreaterThan(token);
      });

      it("states token-first plus preserved MCP fallback in its invariants", () => {
        expect(skill).toMatch(/credential-substrate-precedence/);
        expect(skill).not.toMatch(
          /MCP is preferred when it is present and already authenticated/
        );
        expect(skill).toMatch(/MCP[^\n]*fallback/i);
      });

      it("requires identity-match against the configured workspace/team", () => {
        expect(skill).toMatch(/identity-match/i);
        expect(skill).toMatch(/skipped, never used/i);
      });
    });

    describe("lisa-notion-access", () => {
      const skill = readSkill(root, NOTION);

      it("makes the internal-integration token tier 1 and the MCP tier 2", () => {
        const token = at(skill, /# Tier 1: curl \+ API token/);
        const mcp = at(skill, /# Tier 2: Notion MCP/);
        expect(token).toBeGreaterThan(-1);
        expect(mcp).toBeGreaterThan(token);
      });

      it("no longer advertises MCP-first in its description", () => {
        expect(skill).not.toMatch(/\(1\) Notion MCP/);
        expect(skill).toMatch(/description:[^\n]*\(1\)[^\n]*token/i);
      });

      it("keeps the workspace identity assertion mandatory at every tier", () => {
        expect(skill).toMatch(/mandatory at every tier/i);
        expect(skill).toMatch(/skipped, not used/i);
      });

      it("cites the contract and preserves the MCP fallback tier", () => {
        expect(skill).toMatch(/credential-substrate-precedence/);
        // The MCP tier is re-ordered, not removed: it still resolves as a
        // substrate and stays available for ops curl has no adapter for.
        expect(skill).toMatch(/\$\{substrate:=mcp\}/);
        expect(skill).toMatch(/mcp_available=true/);
      });
    });

    describe("lisa-atlassian-access", () => {
      const skill = readSkill(root, ATLASSIAN);

      it("resolves the token substrate first for reads as well as writes", () => {
        const token = at(skill, /# Tier 1: curl \+ API token/);
        const acli = at(skill, /# Tier 2: acli/);
        const mcp = at(skill, /# Tier 3: Atlassian MCP/);
        expect(token).toBeGreaterThan(-1);
        expect(acli).toBeGreaterThan(token);
        expect(mcp).toBeGreaterThan(acli);
      });

      it("no longer describes acli as the preferred read substrate", () => {
        expect(skill).not.toMatch(
          /\*\*`acli`\*\*: routes through `acli`\. Preferred when available/
        );
        expect(skill).toMatch(/try curl, then acli, then MCP/i);
      });

      it("cites the shared contract instead of restating the write rationale", () => {
        expect(skill).toMatch(/credential-substrate-precedence/);
      });

      it("keeps the guarded acli fallback with post-write tenant assertions", () => {
        expect(skill).toMatch(/guarded fallback/);
        expect(skill).toMatch(/roll back/i);
      });

      it("keeps identity-match mandatory and MCP available as a fallback", () => {
        expect(skill).toMatch(/[Cc]onnection match is mandatory/);
        expect(skill).toMatch(/mcp_available=true/);
      });
    });
  });
});

/**
 * Every access skill whose tier 1 credential must be reachable through the
 * `lisa-secrets-access` chokepoint, paired with the variable it resolves.
 *
 * Without this rung the ladder stops at rung one — a bare `$VAR` read — so a
 * project keeping its credentials in Bitwarden, Doppler, or AWS has no tier 1
 * path at all and silently resolves through the interactive MCP instead. That
 * is the precise failure the precedence contract exists to remove, and it is
 * why `/lisa:setup:linear` had nowhere to migrate its keychain read to.
 */
const RESOLVER_RUNG_SKILLS = [
  [SENTRY, "SENTRY_AUTH_TOKEN"],
  [POSTHOG, "POSTHOG_PERSONAL_API_KEY"],
  [JAM, "JAM_PAT"],
  ["lisa-sonarcloud-access", "SONARQUBE_CLI_TOKEN"],
] as const;

/** Date the legacy OS-keychain fallbacks stop being read. */
const KEYCHAIN_REMOVAL_DATE = "2026-11-01";

describe("access skills resolve tier 1 through lisa-secrets-access", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(RESOLVER_RUNG_SKILLS)("%s", (skillName, variable) => {
      const skill = readSkill(root, skillName);

      it("reads the credential through the resolve-secret chokepoint", () => {
        expect(skill).toMatch(
          /\$CLAUDE_PLUGIN_ROOT\/skills\/lisa-secrets-access\/scripts\/resolve-secret\.mjs/
        );
        expect(skill).toMatch(
          /node_modules\/@codyswann\/lisa\/plugins\/lisa\/skills\/lisa-secrets-access\/scripts\/resolve-secret\.mjs/
        );
        expect(skill).toMatch(
          new RegExp(
            `resolve-secret[\\s\\S]{0,400}${variable}|${variable}[\\s\\S]{0,400}resolve-secret`,
            "u"
          )
        );
      });

      it("keeps the bare environment variable as a documented fallback", () => {
        expect(skill).toMatch(new RegExp(`\\$\\{?${variable}`, "u"));
        expect(skill).toMatch(/fallback/i);
      });

      it("states the mutation boundary rather than leaving it implicit", () => {
        // None of these four expose a mutating operation, so the contract's
        // guarded-fallback / read-back reconciliation protocol is not engaged
        // today — but that must be an asserted property, not an accident a
        // future operation quietly breaks.
        expect(skill).toMatch(/read-only/i);
        expect(skill).toMatch(/guarded fallback|reconcil/i);
      });
    });
  });
});

describe("legacy OS-keychain fallbacks carry a removal date", () => {
  describe.each(ROOTS)("%s", root => {
    const contract = read(root, CONTRACT);

    it("publishes one shared removal date in the precedence contract", () => {
      expect(contract).toMatch(/legacy OS-keychain fallback/i);
      expect(contract).toContain(KEYCHAIN_REMOVAL_DATE);
      expect(contract).toMatch(/removal date/i);
    });

    it("carries the date in the eager summary too, where the ban is stated", () => {
      // An agent that loads only the eager rule reads "never read an OS keychain
      // a second time"; the dated exception has to travel with it or the two
      // surviving rungs look like a contradiction rather than a ramp.
      const eager = read(
        root,
        "rules/eager/credential-substrate-precedence.md"
      );
      expect(eager).toContain(KEYCHAIN_REMOVAL_DATE);
      expect(eager).toMatch(/removal date/i);
    });

    it.each([ATLASSIAN, NOTION])(
      "dates the %s keychain fallback",
      skillName => {
        const skill = readSkill(root, skillName);
        expect(skill).toContain(KEYCHAIN_REMOVAL_DATE);
        expect(skill).toMatch(
          /keychain[\s\S]{0,600}(removal date|removed on)|(removal date|removed on)[\s\S]{0,600}keychain/i
        );
      }
    );
  });
});

describe("integration-access-layer rule reflects the reversed ordering", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/integration-access-layer.md");
    const reference = read(root, "rules/reference/integration-access-layer.md");

    it("no longer documents MCP as the first resolution tier", () => {
      for (const doc of [eager, reference]) {
        expect(doc).not.toMatch(
          /Resolution order is MCP when available and authenticated/
        );
        expect(doc).not.toMatch(
          /^1\. MCP, when the tool is available and already authenticated/m
        );
      }
    });

    it("breadcrumbs both halves to the shared precedence contract", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/credential-substrate-precedence/);
      }
    });

    it("orders the token substrate ahead of MCP in the reference body", () => {
      const token = at(reference, /Configured-provider token\/CLI substrate/);
      const mcp = at(reference, /Interactive MCP/);
      expect(token).toBeGreaterThan(-1);
      expect(mcp).toBeGreaterThan(token);
    });
  });
});
