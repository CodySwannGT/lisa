/** Controlled advisory/lock fixtures exercise the canonical matcher, not live registry state. */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateAuditReport } from "../../../src/core/audit.js";
import {
  auditExceptionObservations,
  auditExceptionViolations,
} from "../../../src/cli/doctor-readiness-audit-allowlist.js";

const GHSA = "GHSA-aaaa-bbbb-cccc";
const CVE = "CVE-2026-1234";
const roots: string[] = [];
const advisory = (name = "zod") =>
  JSON.stringify({
    [name]: [
      {
        id: 123,
        severity: "high",
        url: `https://github.com/advisories/${GHSA}`,
        vulnerable_versions: "<4.6.6",
      },
    ],
  });
const devPath = "lint-plugin/zod";
const BUN_LOCK = "bun.lock";
const VULNERABLE_ZOD = "zod@3.25.76";
const exclusion = {
  id: GHSA,
  package: "zod",
  versions: "3.x",
  paths: [devPath],
  reason: "Controlled lint-tool exception",
};

/**
 * Make an isolated fixture with exact resolved names, including aliases.
 * @param entry - Exclusion fields to validate or match
 * @param packages - Controlled Bun packages map
 * @returns The validated result described above
 */
function fixture(
  entry: unknown = exclusion,
  packages: Record<string, unknown> = {
    zod: ["zod@4.6.7"],
    [devPath]: [VULNERABLE_ZOD],
  }
) {
  const root = mkdtempSync(join(tmpdir(), "lisa-audit-scopes-"));
  roots.push(root);
  writeFileSync(
    join(root, "audit.ignore.local.json"),
    JSON.stringify({ exclusions: [entry] })
  );
  writeFileSync(
    join(root, BUN_LOCK),
    `// JSONC fixture\n${JSON.stringify({ packages }).replace(/}$/, ",}")}`
  );
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("canonical audit exclusion scope", () => {
  it("excludes every vulnerable copy only on listed paths and prints the decision", () => {
    const result = evaluateAuditReport(fixture(), "bun", advisory());
    expect(result.passed).toBe(true);
    expect(result.messages.join("\n")).toContain(
      `excluded ${GHSA} for ${devPath} (Controlled lint-tool exception)`
    );
  });

  it.each(["production/zod", "legacy-zod", "@app/alias"])(
    "fails and names an unlisted vulnerable copy at %s",
    path => {
      const result = evaluateAuditReport(
        fixture(exclusion, {
          [devPath]: [VULNERABLE_ZOD],
          [path]: [VULNERABLE_ZOD],
        }),
        "bun",
        advisory()
      );
      expect(result.passed).toBe(false);
      expect(result.messages.join("\n")).toContain(`${path} (zod@3.25.76)`);
    }
  );

  it("covers multiple listed vulnerable copies and ignores fixed copies", () => {
    const result = evaluateAuditReport(
      fixture(
        { ...exclusion, paths: [devPath, "other/alias"] },
        {
          [devPath]: [VULNERABLE_ZOD],
          "other/alias": ["zod@3.22.0"],
          zod: ["zod@4.6.7"],
        }
      ),
      "bun",
      advisory()
    );
    expect(result.passed).toBe(true);
  });

  it("keeps advisory-only exclusions working without any lockfile", () => {
    const root = fixture({ id: GHSA, reason: "Legacy decision" });
    rmSync(join(root, BUN_LOCK));
    expect(evaluateAuditReport(root, "bun", advisory()).passed).toBe(true);
  });

  it("retains numeric advisory ids and CVE identity matching", () => {
    expect(
      evaluateAuditReport(fixture({ id: 123 }), "bun", advisory()).passed
    ).toBe(true);
    const report = JSON.stringify({
      zod: [{ severity: "critical", id: 123, cves: [CVE] }],
    });
    expect(
      evaluateAuditReport(fixture({ id: "other", cve: CVE }), "bun", report)
        .passed
    ).toBe(true);
  });

  it("enforces package even when advisory id matches", () => {
    const result = evaluateAuditReport(
      fixture({ id: GHSA, package: "different" }),
      "bun",
      advisory()
    );
    expect(result.passed).toBe(false);
    expect(result.messages.join("\n")).toContain(
      "outside exclusion package different"
    );
  });

  it("retains scalar CVE identity for a legacy exclusion without a lockfile", () => {
    const root = fixture({ id: "different", cve: CVE });
    rmSync(join(root, BUN_LOCK));
    const report = JSON.stringify({
      zod: [{ severity: "high", id: 123, cve: CVE }],
    });
    expect(evaluateAuditReport(root, "bun", report).passed).toBe(true);
  });

  it.each(["high", "critical"])(
    "rejects a Yarn %s summary with no concrete advisory",
    level => {
      const root = fixture({ id: GHSA });
      const report = JSON.stringify({
        type: "auditSummary",
        data: { vulnerabilities: { high: 0, critical: 0, [level]: 1 } },
      });
      expect(() => evaluateAuditReport(root, "yarn", report)).toThrow(
        "without concrete advisory data"
      );
    }
  );

  it("accepts an actual clean Yarn summary shape without advisory records", () => {
    const root = fixture({ id: GHSA });
    const report = JSON.stringify({
      type: "auditSummary",
      data: { vulnerabilities: { high: 0, critical: 0 } },
    });
    expect(evaluateAuditReport(root, "yarn", report).passed).toBe(true);
  });

  it.each([{}, { high: "0", critical: 0 }, { high: -1, critical: 0 }])(
    "fails closed on unknown Yarn summary counts %j",
    vulnerabilities => {
      const root = fixture({ id: GHSA });
      const report = JSON.stringify({
        type: "auditSummary",
        data: { vulnerabilities },
      });
      expect(() => evaluateAuditReport(root, "yarn", report)).toThrow(
        "Unknown Yarn audit summary"
      );
    }
  );

  it("does not suppress zod4.5.0 with a zod3 versions scope on a listed path", () => {
    const result = evaluateAuditReport(
      fixture(exclusion, { [devPath]: ["zod@4.5.0"] }),
      "bun",
      advisory()
    );
    expect(result.passed).toBe(false);
    expect(result.messages.join("\n")).toContain("zod@4.5.0");
  });

  it("honors versions without paths", () => {
    const root = fixture({ id: GHSA, package: "zod", versions: "3.x" });
    expect(evaluateAuditReport(root, "bun", advisory()).passed).toBe(true);
  });

  describe("#4509: a package+versions scope without paths (GHSA-mrhx-c7xc-m3w5)", () => {
    const MRHX = "GHSA-mrhx-c7xc-m3w5";
    const mrhxReport = JSON.stringify({
      zod: [
        {
          id: 1,
          severity: "high",
          url: `https://github.com/advisories/${MRHX}`,
          vulnerable_versions: "<4.6.6",
        },
      ],
    });
    const versionsOnly = {
      id: MRHX,
      package: "zod",
      versions: ">=3.0.0 <4.0.0",
    };

    it("suppresses zod 3.25.76", () => {
      const result = evaluateAuditReport(
        fixture(versionsOnly, { [devPath]: [VULNERABLE_ZOD] }),
        "bun",
        mrhxReport
      );
      expect(result.passed).toBe(true);
      expect(result.messages.join("\n")).toContain(`excluded ${MRHX}`);
    });

    it("does NOT suppress zod 4.5.0 for the same advisory", () => {
      const result = evaluateAuditReport(
        fixture(versionsOnly, { [devPath]: ["zod@4.5.0"] }),
        "bun",
        mrhxReport
      );
      expect(result.passed).toBe(false);
      expect(result.messages.join("\n")).toContain(`${devPath} (zod@4.5.0)`);
    });

    it("does NOT suppress a mixed tree and names only the zod 4.5.0 copy", () => {
      const result = evaluateAuditReport(
        fixture(versionsOnly, {
          [devPath]: [VULNERABLE_ZOD],
          "app/zod": ["zod@4.5.0"],
        }),
        "bun",
        mrhxReport
      );
      const text = result.messages.join("\n");
      expect(result.passed).toBe(false);
      expect(text).toContain("app/zod (zod@4.5.0)");
      expect(text).not.toContain("3.25.76");
    });
  });

  it.each([[], null, "lint-plugin/zod", [""], [1]])(
    "rejects invalid paths %j before even a clean report",
    paths => {
      expect(() =>
        evaluateAuditReport(fixture({ ...exclusion, paths }), "bun", "{}")
      ).toThrow("paths must be a non-empty array");
    }
  );

  it.each(["", "not-a-range", null])(
    "rejects invalid versions %j",
    versions => {
      expect(() =>
        evaluateAuditReport(
          fixture({ ...exclusion, versions }),
          "bun",
          advisory()
        )
      ).toThrow("versions must be a non-empty valid semver range");
    }
  );

  it("cannot silently scope an advisory with missing vulnerable range", () => {
    expect(() =>
      evaluateAuditReport(
        fixture(),
        "bun",
        JSON.stringify({ zod: [{ severity: "high", id: GHSA }] })
      )
    ).toThrow("cannot determine vulnerable versions");
  });

  it("cannot infer coverage from an empty or unrelated copy set", () => {
    expect(() =>
      evaluateAuditReport(fixture(exclusion, {}), "bun", advisory())
    ).toThrow("no resolved vulnerable copies found");
  });

  it.each(["missing", "directory", "invalid", "unknown"])(
    "fails closed with a clear diagnostic for %s lockfile data even with a clean report",
    kind => {
      const root = fixture();
      rmSync(join(root, BUN_LOCK));
      if (kind === "directory") mkdirSync(join(root, BUN_LOCK));
      if (kind === "invalid")
        writeFileSync(join(root, BUN_LOCK), '{"packages": broken}');
      if (kind === "unknown")
        writeFileSync(
          join(root, BUN_LOCK),
          JSON.stringify({ packages: { zod: ["zod@unknown"] } })
        );
      expect(() => evaluateAuditReport(root, "bun", "{}")).toThrow(
        /Cannot evaluate scoped audit exclusions from bun.lock/u
      );
    }
  );

  it("doctor rejects the exact invalid empty-path scope", async () => {
    const result = await auditExceptionViolations(
      fixture({ ...exclusion, paths: [] })
    );
    expect(result.join("\n")).toContain("paths must be a non-empty array");
  });

  it("doctor warns about an otherwise documented legacy advisory-wide exclusion", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = fixture({ id: GHSA, reason: "Legacy decision" });
    expect(await auditExceptionViolations(root)).toEqual([]);
    const observations = await auditExceptionObservations(root);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toContain(GHSA);
    expect(observations[0]).toContain("hides this advisory for every copy");
    // The warning belongs in the doctor's returned report, not on stderr.
    expect(warning).not.toHaveBeenCalled();
  });

  it("doctor raises no advisory-wide warning for a paths/versions-scoped exclusion", async () => {
    expect(await auditExceptionObservations(fixture(exclusion))).toEqual([]);
  });
});
