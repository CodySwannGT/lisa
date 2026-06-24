/**
 * Regression coverage for non-tracker MCP headless substrate guidance.
 *
 * Issue #1342: analyze-claude-remote must not classify every OAuth/stdio MCP
 * as a flat remote-routine gap. Documented CLI, PAT, and REST substrates should
 * become optional headless recovery paths that the generator can surface.
 *
 * @module tests/unit/strategies/claude-remote-substrates
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("analyze-claude-remote non-tracker MCP substrate guidance", () => {
  describe.each(ROOTS)("%s/analyze-claude-remote", root => {
    const content = readSkill(root, "analyze-claude-remote");

    it("checks documented substrates before finalizing an MCP as a flat GAP", () => {
      expect(content).toMatch(
        /Before finalizing any\s+OAuth\/interactive\/stdio MCP as a flat `GAP`/i
      );
      expect(content).toMatch(/vendor CLI/i);
      expect(content).toMatch(/token-authenticated\s+REST API/i);
      expect(content).toContain("headlessUsable: true");
      expect(content).toMatch(/check the vendor for a documented PAT/i);
    });

    it("seeds Jam as CLI plus JAM_PAT, not an MCP header substrate", () => {
      expect(content).toContain("Jam CLI (`jam`) authenticated by PAT");
      expect(content).toContain("JAM_PAT");
      expect(content).toContain("native.jam.dev");
      expect(content).toContain("api.jam.dev");
      expect(content).toContain(
        "https://jam.dev/docs/debug-a-jam/mcp/personal-access-tokens"
      );
      expect(content).toContain("setupSnippet");
      expect(content).toMatch(/Do \*\*not\*\* use that for Jam/i);
      expect(content).not.toContain("mcp.jam.dev`, `JAM_PAT` (`jam_pat_`");
    });

    it("seeds SonarCloud as SONAR_TOKEN plus REST", () => {
      expect(content).toContain("SonarCloud Web API");
      expect(content).toContain("SONAR_TOKEN");
      expect(content).toContain("https://sonarcloud.io/api/");
      expect(content).toContain(
        "https://docs.sonarsource.com/sonarqube-cloud/managing-your-account/generating-and-using-tokens/"
      );
      expect(content).toContain("sonarcloud.io");
    });
  });
});

describe("generate-claude-remote-build-script substrate output", () => {
  describe.each(ROOTS)("%s/generate-claude-remote-build-script", root => {
    const content = readSkill(root, "generate-claude-remote-build-script");

    it("renders optional substrate env vars without promoting them to required", () => {
      expect(content).toMatch(/OPTIONAL non-tracker MCP recovery entries/i);
      expect(content).toContain("JAM_PAT");
      expect(content).toContain("SONAR_TOKEN");
      expect(content).toMatch(
        /Never invent values or promote dormant substrates to required/i
      );
    });

    it("prints Jam CLI setup and reserves .mcp.json headers for true MCP bearer substrates", () => {
      expect(content).toContain(
        "curl -fsSL https://native.jam.dev/install | bash"
      );
      expect(content).toContain(
        "printf '%s' \"$JAM_PAT\" | jam auth login --token"
      );
      expect(content).toContain("jam skills install");
      expect(content).toMatch(
        /Do not print a Jam `.mcp\.json` header snippet/i
      );
      expect(content).toContain("mcpHeaders");
    });
  });
});
