/**
 * Only Bun applies `patchedDependencies`. On npm and Yarn the field Lisa
 * forces is ignored, so the installed copy is the unpatched one: the audit
 * must give the patch no credit and name the real fix (switch to Bun, or
 * upgrade), never ask for a reinstall that cannot apply it. pnpm can patch
 * natively, but Lisa's audit does not run for pnpm, so its refusal says the
 * same. The registry lookup is bounded and fails closed when it hangs.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectAuditManager,
  verifyCapturedAudit,
} from "../../../src/core/audit.js";
import { registryVersionsFrom } from "../../../src/core/audit-registry.js";
import {
  GHSA,
  PATCH_FILE,
  PRISTINE,
  UNPATCHED_ONLY,
  fixture,
  put,
  removeFixtures,
  report,
} from "../../helpers/audit-patch-fixture.js";

const servers: Server[] = [];

afterEach(() => {
  removeFixtures();
  for (const server of servers.splice(0)) server.close();
});

/** The advisory as npm reports it. */
const NPM_REPORT = JSON.stringify({
  vulnerabilities: {
    glob: {
      severity: "high",
      via: [
        {
          source: 1,
          url: `https://github.com/advisories/${GHSA}`,
          severity: "high",
          range: "<=1.0.0",
        },
      ],
    },
  },
});

/** The advisory as Yarn classic reports it. */
const YARN_REPORT = [
  {
    type: "auditAdvisory",
    data: {
      advisory: {
        severity: "high",
        github_advisory_id: GHSA,
        module_name: "glob",
        vulnerable_versions: "<=1.0.0",
      },
    },
  },
  { type: "auditSummary", data: { vulnerabilities: { high: 1, critical: 0 } } },
]
  .map(line => JSON.stringify(line))
  .join("\n");

/**
 * A host whose package.json still carries Lisa's forced patchedDependencies,
 * which its manager ignored, so the installed copy is unpatched.
 * @param lockfile - The manager's lockfile name
 * @param text - The lockfile content
 * @returns Fixture root
 */
function nonBunHost(lockfile: string, text: string): string {
  const root = fixture({ installed: PRISTINE });
  put(root, lockfile, text);
  return root;
}

describe("advisory patches on managers other than Bun", () => {
  it.each([
    [
      "npm",
      "package-lock.json",
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "host" },
          "node_modules/glob": { version: "1.0.0" },
        },
      }),
      NPM_REPORT,
    ],
    [
      "yarn",
      "yarn.lock",
      '# yarn lockfile v1\n\nglob@^1.0.0:\n  version "1.0.0"\n',
      YARN_REPORT,
    ],
  ] as const)(
    "gives the patch no credit on %s and names the real fix",
    async (manager, lockfile, text, source) => {
      const root = nonBunHost(lockfile, text);
      const verdict = await verifyCapturedAudit(root, manager, source, {
        publishedVersions: UNPATCHED_ONLY,
      });
      const messages = verdict.messages.join("\n");
      expect(verdict.passed).toBe(false);
      expect(messages).toContain(
        `${GHSA}: the advisory patch for glob (${PATCH_FILE}) gets no credit: ${manager} ignores Bun's patchedDependencies, so the patch was never applied`
      );
      expect(messages).toContain("switch this project to Bun");
      expect(messages).toContain("upgrade once a fixed release exists");
      expect(messages).not.toContain("reinstall");
    }
  );

  it("refuses pnpm and says its advisory patches get no credit", () => {
    const root = fixture();
    put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    put(
      root,
      "package.json",
      JSON.stringify({
        name: "host",
        packageManager: "pnpm@9.0.0",
        patchedDependencies: { "glob@1.0.0": PATCH_FILE },
      })
    );
    expect(() => detectAuditManager(root)).toThrow(
      `get no credit: pnpm can apply patches itself, but Lisa's audit does not run for pnpm`
    );
    expect(() => detectAuditManager(root)).toThrow(
      "switch this project to Bun"
    );
  });

  it("still credits a verified patch on Bun", async () => {
    const verdict = await verifyCapturedAudit(fixture(), "bun", report(), {
      publishedVersions: UNPATCHED_ONLY,
    });
    expect(verdict.passed).toBe(true);
    expect(verdict.messages.join("\n")).not.toContain("gets no credit");
  });
});

describe("registry lookup", () => {
  /**
   * A registry that accepts connections and never answers.
   * @returns Its base URL
   */
  async function silentRegistry(): Promise<string> {
    const server = createServer(() => undefined);
    servers.push(server);
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("rejects when the registry does not answer in time", async () => {
    const lookup = registryVersionsFrom(await silentRegistry(), 200);
    await expect(lookup("glob")).rejects.toThrow(
      "registry did not answer within 200ms for glob"
    );
  });

  it("fails the audit closed when the registry hangs", async () => {
    const lookup = registryVersionsFrom(await silentRegistry(), 200);
    await expect(
      verifyCapturedAudit(fixture(), "bun", report(), {
        publishedVersions: lookup,
      })
    ).rejects.toThrow(
      /cannot confirm that no fixed glob is published \(registry did not answer within 200ms/u
    );
  });
});
