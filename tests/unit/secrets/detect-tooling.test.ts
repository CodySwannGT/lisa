/**
 * Finding the tools a project needs but never declares.
 *
 * `remoteEnv.tools` is the only mechanism that puts a binary on `PATH`, and
 * nothing populated it. So a project could ship npm scripts invoking `maestro`,
 * wire an MCP server whose CLI it also shells out to, and configure Playwright
 * thresholds, while the manifest stayed empty — and every one of those failed at
 * the moment of use rather than at setup. This repository paid for that twice:
 * `gh` was declared nowhere and a cloud session could not commit, and `tar` was
 * needed by an install method and asserted by nothing.
 *
 * The detector's boundary is the part worth protecting: it proposes, and a
 * human decides. An auto-writing detector would become a second, unreviewed
 * install path, which is precisely what `assertPinned` exists to prevent.
 * @module tests/unit/secrets/detect-tooling
 */
import { describe, expect, it } from "vitest";

import {
  detectTooling,
  proposedEntry,
  toolsFromMcp,
  toolsFromScripts,
  toolsFromSecretNotes,
} from "../../../plugins/src/base/skills/lisa-detect-tooling/scripts/detect-tooling.mjs";

describe("signals", () => {
  it("reads the body of an npm script, not its name", () => {
    // A script NAMED maestro:test proves nothing; one that RUNS `maestro test`
    // is the project stating a dependency in executable form. The Expo template
    // ships exactly this, and nothing installs the binary.
    const found = toolsFromScripts({
      scripts: { "maestro:test": "maestro test .maestro/flows" },
    });

    expect([...found.keys()]).toContain("maestro");
    expect(found.get("maestro")).toMatch(/npm script/);
  });

  it("does not fire on a script that merely mentions a tool in its name", () => {
    const found = toolsFromScripts({
      scripts: { "maestro:studio": "echo no" },
    });

    expect([...found.keys()]).not.toContain("maestro");
  });

  it("treats an MCP server as evidence the CLI is needed", () => {
    // An MCP server is not a substitute for the binary: Linear authenticates by
    // browser OAuth, which a container cannot do at all, so a remote session has
    // no integration rather than a degraded one.
    const found = toolsFromMcp({ mcpServers: { "linear-server": {} } });

    expect([...found.keys()]).toContain("linear");
    expect(found.get("linear")).toMatch(/OAuth/i);
  });

  it("reads a credential usage note", () => {
    const found = toolsFromSecretNotes({
      SONAR_TOKEN: "Used by sonar-scanner in CI. Rotate quarterly.",
    });

    expect([...found.keys()]).toContain("sonar-scanner");
  });

  it("survives a malformed config instead of throwing", () => {
    // A detector that dies on a broken file blocks the very command someone
    // runs to find out what is broken.
    expect(() => toolsFromScripts(null)).not.toThrow();
    expect(() => toolsFromMcp(null)).not.toThrow();
    expect(() => toolsFromSecretNotes(null)).not.toThrow();
  });
});

describe("proposals", () => {
  it("leaves the pin and checksum for a human", () => {
    // The boundary that keeps this from becoming a second install path. A tool
    // reaches a machine because someone reviewed a pinned entry, never because
    // a detector was confident.
    const entry = proposedEntry({ name: "maestro" }) as Record<string, string>;

    expect(entry.version).toBe("<pin>");
    expect(entry.sha256).toMatch(/^</);
    expect(entry.url).toMatch(/^</);
  });

  it("proposes an npm install where the tool ships on npm", () => {
    const entry = proposedEntry({ name: "playwright" }) as Record<
      string,
      string
    >;

    expect(entry.install).toBe("npm-global");
    expect(entry.package).toBe("@playwright/test");
  });

  it("marks a pinned archive remote-only", () => {
    // A Linux release archive must never be offered to a laptop, which is the
    // concrete reason `surfaces` exists rather than a second config block.
    const entry = proposedEntry({ name: "maestro" }) as { surfaces: string[] };

    expect(entry.surfaces).toEqual(["remote"]);
  });
});

describe("against this repository", () => {
  it("never proposes something already declared", () => {
    // gh and bws are declared, so a detector that re-proposed them would train
    // the reader to skim its output.
    const names = detectTooling(process.cwd()).map(p => p.name);

    expect(names).not.toContain("gh");
    expect(names).not.toContain("bws");
  });

  it("gives evidence for everything it proposes", () => {
    // A proposal without evidence is an assertion, and this file is the one
    // place that must not make assertions about a machine.
    for (const proposal of detectTooling(process.cwd())) {
      expect(proposal.evidence.length).toBeGreaterThan(0);
      expect(proposal.why).not.toBe("");
    }
  });
});
