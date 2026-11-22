import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decideConfigureRoad } from "../../../src/controls/configure-road.js";
import { generateControlRegister } from "../../../src/controls/register.js";
import {
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { removeFixtures } from "./support/report-check-run.js";
import { CONFIG, repository, seeded } from "./support/seed-run.js";

const TYPES = "type-correctness";
const BUILD = "build-integrity";
const APP = JSON.stringify({
  name: "app",
  scripts: { typecheck: "tsc --noEmit", build: "tsc" },
  devDependencies: { typescript: "^5.9.3" },
});
const SMALL_APP = JSON.stringify({
  name: "app",
  scripts: { typecheck: "tsc --noEmit" },
  devDependencies: { typescript: "^5.9.3" },
});

afterEach(removeFixtures);

describe("configuring folders with shipped tasks", () => {
  it("chooses paved only when every audited folder has a supported type", () => {
    const parts = [".", "app-a", "app-b"];
    const supported = { "app-a": ["typescript"], "app-b": ["typescript"] };
    const decision = decideConfigureRoad({
      projectTypes: [],
      parts,
      partTypes: supported,
    });
    expect(decision.road).toBe("paved");
    expect(decision.reason).toMatch(/app-a.*typescript.*app-b.*typescript/);
    expect(
      decideConfigureRoad({
        projectTypes: ["typescript"],
        parts,
        partTypes: { ...supported, "app-b": [] },
      })
    ).toMatchObject({
      road: "discovery",
      reason: expect.stringContaining("app-b"),
    });
  });

  it("seeds each task in its own folder with that folder's runner", async () => {
    const target = repository("F-empty", {
      "app-a/package.json": APP,
      "app-a/bun.lock": "{}\n",
      "app-b/package.json": SMALL_APP,
    });
    writeAuditReport(target, completeAuditReport([".", "app-a", "app-b"]));

    const initial = await seeded(target);
    expect(initial).toMatchObject({
      road: "paved",
      wrote: true,
      declared_gates: 2,
    });
    const file = path.join(target, CONFIG);
    const bytes = readFileSync(file, "utf8");
    expect(JSON.parse(bytes)).toEqual({
      gates: {
        [TYPES]: {
          push: "required",
          "pull-request": "required",
          parts: [
            { scope: "app-a", command: ["bun", "run", "typecheck"] },
            { scope: "app-b", command: ["npm", "run", "typecheck"] },
          ],
        },
        [BUILD]: {
          "pull-request": "required",
          parts: [{ scope: "app-a", command: ["bun", "run", "build"] }],
        },
      },
    });
    expect(await seeded(target)).toMatchObject({ wrote: false, seeded: [] });
    expect(readFileSync(file, "utf8")).toBe(bytes);
  });

  it("declares nothing when an audited folder has no supported type", async () => {
    const target = repository("F-empty", {
      "api/package.json": APP,
      "tools/README.md": "# Tools\n",
    });
    writeAuditReport(target, completeAuditReport([".", "api", "tools"]));

    expect(await seeded(target)).toMatchObject({
      road: "discovery",
      reason: expect.stringContaining("tools"),
      wrote: false,
    });
    expect(existsSync(path.join(target, CONFIG))).toBe(false);
  });

  it("seeds missing gates and preserves previously declared gates", async () => {
    const existing = { "pull-request": "off" };
    const target = repository("F-empty", {
      "app-a/package.json": APP,
      "app-b/package.json": SMALL_APP,
      [CONFIG]: JSON.stringify({ gates: { [TYPES]: existing } }),
    });
    writeAuditReport(target, completeAuditReport([".", "app-a", "app-b"]));

    expect(await seeded(target)).toMatchObject({
      road: "paved",
      seeded: [{ gate: BUILD, moment: "pull-request", run: null }],
    });
    expect(
      JSON.parse(readFileSync(path.join(target, CONFIG), "utf8"))
    ).toMatchObject({
      gates: { [TYPES]: existing },
    });
  });

  it("requires audit evidence when a folder command differs from the shipped check", async () => {
    const target = repository("F-empty", {
      "app-a/package.json": APP,
      "app-b/package.json": SMALL_APP,
    });
    writeAuditReport(target, completeAuditReport([".", "app-a", "app-b"]));
    await seeded(target);
    expect((await generateControlRegister(target)).problems).toBeNull();

    const file = path.join(target, CONFIG);
    const bytes = readFileSync(file, "utf8");
    writeFileSync(file, bytes.replace('"typecheck"', '"build"'));
    expect((await generateControlRegister(target)).problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /type-correctness.*app-a.*says nothing about what supports it/
        ),
      ])
    );
  });
});
