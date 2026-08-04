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
  declaredTools,
  satisfiedByNpm,
  detectTooling,
  proposedEntries,
  toolsFromMcp,
  toolsFromQuality,
  toolsFromScripts,
  toolsFromSecretNotes,
} from "../../../plugins/src/base/skills/lisa-detect-tooling/scripts/detect-tooling.mjs";

/** The Expo template's own script body — the strongest usage signal. */
const MAESTRO_SCRIPT = "maestro test .maestro/flows";

/** A root with no artifacts, so only the explicit inputs decide. */
const NO_PROJECT = "/nonexistent-project";

describe("signals", () => {
  it("reads the body of an npm script, not its name", () => {
    // A script NAMED maestro:test proves nothing; one that RUNS `maestro test`
    // is the project stating a dependency in executable form. The Expo template
    // ships exactly this, and nothing installs the binary.
    const found = toolsFromScripts({
      scripts: { "maestro:test": MAESTRO_SCRIPT },
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

  it("does not invent a Linear CLI when the access layer owns headless auth", () => {
    // Linear's headless substrate is LINEAR_API_KEY through lisa-linear-access.
    // There is no official Linear CLI to pin; turning MCP into CLI evidence
    // would make the detector propose an arbitrary third-party binary.
    const found = toolsFromMcp({ mcpServers: { "linear-server": {} } });

    expect([...found.keys()]).not.toContain("linear");
  });

  it("reads a credential usage note", () => {
    const found = toolsFromSecretNotes({
      SONAR_TOKEN: "Used by sonar-scanner in CI. Rotate quarterly.",
    });

    expect([...found.keys()]).toContain("sonar-scanner");
  });

  it("asks about a remote path for an MCP server with no known substrate", () => {
    // The substrate allowlist fixes Linear. It does not fix the class: every
    // other interactively authenticated MCP server was still told "browser
    // OAuth cannot run remotely", which asserts a conclusion the evidence does
    // not support.
    const found = toolsFromMcp({ mcpServers: { maestro: {} } });

    expect(found.get("maestro")).toMatch(/confirm this integration has one/i);
  });

  it("still proposes a binary for a tool that has one, however detected", () => {
    // The regression this replaces: keying "propose nothing" on the EVIDENCE
    // being an MCP server suppressed exactly the wrong case. The substrate
    // allowlist already removes Linear before it becomes evidence, so the only
    // tools reaching that branch were ones like Maestro that genuinely do have
    // a CLI — the binary the Expo template invokes and nothing installs.
    const proposal = proposedEntries({
      name: "maestro",
      evidence: ['MCP server "maestro" - interactive auth'],
    });

    expect(proposal.install).toHaveLength(1);
    expect(proposal.require).toHaveLength(1);
  });

  it("asks instead of proposing where no CLI exists to name", () => {
    // Linear has no official CLI, so no proposal can name one — and a pinned
    // binary is expensive to be wrong about, since its checksum moves with
    // every version bump. Asserted directly rather than relying on the
    // substrate allowlist to keep Linear out of proposals.
    const proposal = proposedEntries({
      name: "linear",
      evidence: ['MCP server "linear-server" - interactive auth'],
    });

    expect(proposal.install).toHaveLength(0);
    expect(proposal.require).toHaveLength(0);
    expect(proposal.question).toMatch(/key-authenticated API call/);
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
    const [entry] = proposedEntries({ name: "maestro" }).install as Record<
      string,
      string
    >[];

    expect(entry?.version).toBe("<pin>");
    expect(entry?.sha256).toMatch(/^</);
    expect(entry?.url).toMatch(/^</);
  });

  it("proposes an npm install where the tool ships on npm", () => {
    const proposal = proposedEntries({ name: "playwright" });
    const [entry] = proposal.install as Record<string, string>[];

    expect(entry?.install).toBe("npm-global");
    expect(entry?.package).toBe("@playwright/test");
    // npm resolves per platform, so no local `require` companion is needed.
    expect(proposal.require).toHaveLength(0);
  });

  it("pairs a remote-only archive with a local require entry", () => {
    // A Linux release archive must never be offered to a laptop — the concrete
    // reason `surfaces` exists. But narrowing the install to remote without a
    // local `require` would stop checking for the tool locally at all, trading
    // one silent gap for another. Both halves or neither.
    const proposal = proposedEntries({ name: "maestro" });
    const [install] = proposal.install as { surfaces: string[] }[];
    const [required] = proposal.require as { surfaces: string[] }[];

    expect(install?.surfaces).toEqual(["remote"]);
    expect(required?.surfaces).toEqual(["local"]);
  });

  it("does not let a local-only declaration hide a missing remote tool", () => {
    // declaredTools() filtered by name alone, so a `require` entry scoped to
    // local reported the tool as covered on remote, where it was absent.
    const config = {
      remoteEnv: {
        tools: { require: [{ name: "maestro", surfaces: ["local"] }] },
      },
    };

    expect([...declaredTools(config, "local")]).toContain("maestro");
    expect([...declaredTools(config, "remote")]).not.toContain("maestro");
  });
});

describe("against this repository", () => {
  it("never proposes something already declared", () => {
    // gh, bws, and Playwright are declared, so a detector that re-proposed them
    // would train the reader to skim its output.
    const names = detectTooling(process.cwd()).map(p => p.name);

    expect(names).not.toContain("gh");
    expect(names).not.toContain("bws");
    expect(names).not.toContain("playwright");
    expect(names).not.toContain("linear");
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

describe("quality signals", () => {
  it("stays quiet for a threshold nothing corroborates", () => {
    // quality.e2eCoverage defaults are synced into every project by
    // src/sync/registry.ts. This repository carries a maestro entry while
    // having no .maestro directory and no script that invokes it — treating
    // that as evidence proposed pinning a 300MB JVM application into a
    // container for a tool nothing runs.
    //
    // Evidence that a tool is CONFIGURED is not evidence that it is NEEDED.
    const found = toolsFromQuality(
      { quality: { e2eCoverage: { maestro: {} } } },
      { scripts: { test: "vitest" } },
      NO_PROJECT
    );

    expect([...found.keys()]).toHaveLength(0);
  });

  it("fires when a script actually invokes the runner", () => {
    // A real Expo project: the template ships `maestro test` scripts, so the
    // threshold is corroborated and the gap is still reported.
    const found = toolsFromQuality(
      { quality: { e2eCoverage: { maestro: {} } } },
      { scripts: { "maestro:test": MAESTRO_SCRIPT } },
      NO_PROJECT
    );

    expect([...found.keys()]).toContain("maestro");
  });

  it("surfaces every configured e2e runner, not a hardcoded one", () => {
    // quality.e2eCoverage.maestro is configured in this repository and produced
    // no signal, so the detector reported "nothing outstanding" while maestro —
    // the tool whose absence started this work — was undeclared and invisible.
    const found = toolsFromQuality(
      { quality: { e2eCoverage: { playwright: {}, maestro: {} } } },
      {
        scripts: {
          e2e: "playwright test",
          "maestro:test": MAESTRO_SCRIPT,
        },
      },
      NO_PROJECT
    );

    expect([...found.keys()]).toEqual(
      expect.arrayContaining(["playwright", "maestro"])
    );
  });

  it("ignores a runner it knows nothing about", () => {
    // A signal for an unknown name would propose a manifest entry naming a
    // tool the detector cannot describe or pin.
    const found = toolsFromQuality(
      { quality: { e2eCoverage: { somethingElse: {} } } },
      { scripts: { x: "somethingElse run" } },
      NO_PROJECT
    );

    expect([...found.keys()]).toHaveLength(0);
  });
});

describe("tools the package manager already provides", () => {
  // The false positive this removes: `quality.e2eCoverage.playwright` is
  // configured, so the detector proposed pinning a playwright binary — while
  // `@playwright/test` is a declared devDependency and `playwright test`
  // resolves from node_modules/.bin. It never needs to be on PATH.
  //
  // Noise is how a detector teaches people to skim it, which is the failure
  // this skill's own documentation warns about.
  it("recognises a tool declared as a devDependency", () => {
    expect(
      satisfiedByNpm(
        { devDependencies: { "@playwright/test": "^1.57.0" } },
        "playwright"
      )
    ).toBe(true);
  });

  it("recognises one declared as a runtime dependency too", () => {
    expect(
      satisfiedByNpm(
        { dependencies: { "@playwright/test": "^1.57.0" } },
        "playwright"
      )
    ).toBe(true);
  });

  it("does not claim to cover a tool npm cannot deliver", () => {
    // Maestro ships no npm package, so a devDependency list says nothing about
    // whether its binary is present.
    expect(
      satisfiedByNpm(
        { devDependencies: { "@playwright/test": "1" } },
        "maestro"
      )
    ).toBe(false);
  });

  it("still proposes when the package is absent", () => {
    expect(satisfiedByNpm({ devDependencies: {} }, "playwright")).toBe(false);
  });
});
