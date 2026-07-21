import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runSetupReadiness,
  SETUP_READINESS_CHECKS,
} from "../../../src/health/index.js";

const CONFIG_FILE = ".lisa.config.json";

/** Mutable resources owned by each setup-readiness test. */
interface Resources {
  dir: string;
}

const resources: Resources = { dir: "" };
const lisaRoot = path.resolve(import.meta.dirname, "../../..");

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-setup-readiness-"));
  await writeFile(
    path.join(resources.dir, "package.json"),
    `${JSON.stringify({ private: true, devDependencies: { typescript: "latest" } }, null, 2)}\n`
  );
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
});

describe("runSetupReadiness", () => {
  it("returns exactly one stable finding for every setup checklist row", async () => {
    await writeFile(
      path.join(resources.dir, CONFIG_FILE),
      `${JSON.stringify({ tracker: "github", source: "github", github: { org: "example", repo: "demo" }, monitor: {}, intake: {}, exploration: {}, starter: {} }, null, 2)}\n`
    );
    await mkdir(path.join(resources.dir, "wiki/schema"), { recursive: true });
    await mkdir(path.join(resources.dir, "wiki/state/agent-ready"), {
      recursive: true,
    });
    await Promise.all([
      writeFile(path.join(resources.dir, "wiki/lisa-wiki.config.json"), "{}\n"),
      writeFile(
        path.join(resources.dir, "wiki/schema/llm-wiki-contract.md"),
        "# Contract\n"
      ),
      writeFile(path.join(resources.dir, "wiki/index.md"), "# Wiki\n"),
      writeFile(
        path.join(resources.dir, "wiki/state/agent-ready/sources.json"),
        "{}\n"
      ),
      writeFile(path.join(resources.dir, "wiki/gaps.md"), "# Gaps\n\nNone.\n"),
    ]);

    const result = await runSetupReadiness(resources.dir, {
      lisaRoot,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
      environment: { GH_TOKEN: "present" },
    });

    expect(result.schemaVersion).toBe(1);
    expect(result.mode).toBe("deterministic");
    expect(result.findings.map(finding => finding.check)).toEqual(
      SETUP_READINESS_CHECKS
    );
    expect(new Set(result.findings.map(finding => finding.check)).size).toBe(
      SETUP_READINESS_CHECKS.length
    );
    expect(
      result.findings.find(finding => finding.check === "setup.tracker")
    ).toMatchObject({ status: "pass" });
    expect(
      result.findings.find(finding => finding.check === "setup.prd-source")
    ).toMatchObject({ status: "pass" });
  });

  it("keeps tracker and PRD-source readiness independent", async () => {
    await writeFile(
      path.join(resources.dir, CONFIG_FILE),
      `${JSON.stringify({ tracker: "github" }, null, 2)}\n`
    );

    const result = await runSetupReadiness(resources.dir, { lisaRoot });

    expect(
      result.findings.find(finding => finding.check === "setup.tracker")
    ).toMatchObject({ status: "pass" });
    expect(
      result.findings.find(finding => finding.check === "setup.prd-source")
    ).toMatchObject({ status: "fail" });
  });

  it("does not mark missing optional capabilities complete", async () => {
    await writeFile(
      path.join(resources.dir, CONFIG_FILE),
      `${JSON.stringify({ tracker: "github", source: "github" }, null, 2)}\n`
    );

    const result = await runSetupReadiness(resources.dir, {
      lisaRoot,
      environment: {},
    });

    expect(
      result.findings.find(finding => finding.check === "setup.secrets")
    ).toMatchObject({ status: "warn" });
    expect(
      result.findings.find(finding => finding.check === "setup.wiki")
    ).toMatchObject({ status: "warn" });
    expect(
      result.findings.find(
        finding => finding.check === "setup.starter-provenance"
      )
    ).toMatchObject({ status: "warn" });
  });
});
