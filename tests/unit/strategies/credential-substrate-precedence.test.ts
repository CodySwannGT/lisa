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
    });

    it("orders the configured-provider substrate ahead of interactive MCP", () => {
      const provider = at(contract, /Tier 1 — configured-provider substrate/);
      const mcp = at(contract, /Tier 2 — interactive MCP/);
      expect(provider).toBeGreaterThan(-1);
      expect(mcp).toBeGreaterThan(provider);
    });

    it("names lisa-secrets-access as the chokepoint feeding tier 1", () => {
      expect(contract).toMatch(/lisa-secrets-access/);
      expect(contract).toMatch(/`tool:`/);
    });

    it("keeps the installed-package resolver in the config-resolution reference", () => {
      const reference = read(root, "rules/reference/config-resolution.md");
      expect(reference).toContain(
        'candidates+=("$repo_root/node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs")'
      );
    });
  });
});

describe("access skills conform to the precedence contract", () => {
  describe.each(ROOTS)("%s", root => {
    describe("lisa-linear-access", () => {
      const skill = readSkill(root, LINEAR);

      it("no longer advertises MCP-first in its description", () => {
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
        expect(skill).toMatch(/description:[^\n]*\(1\)[^\n]*token/i);
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
      });
    });
  });
});

describe("integration-access-layer rule reflects the reversed ordering", () => {
  describe.each(ROOTS)("%s", root => {
    // The eager head was folded into `config-resolution` in the 2026-11
    // eager-tier cut; the ordering contract lives in the reference body.
    const reference = read(root, "rules/reference/integration-access-layer.md");

    it("orders the token substrate ahead of MCP in the reference body", () => {
      const token = at(reference, /Configured-provider token\/CLI substrate/);
      const mcp = at(reference, /Interactive MCP/);
      expect(token).toBeGreaterThan(-1);
      expect(mcp).toBeGreaterThan(token);
    });
  });
});
