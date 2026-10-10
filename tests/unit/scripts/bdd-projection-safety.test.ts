/** Projection ownership and evidence cannot be traded away for merge safety. */
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  LEGACY_OUTPUTS,
  git,
  successful,
} from "./bdd/projection-merge-support.js";
import {
  BURNDOWN_ROOT,
  FEATURE_ROOT,
  JSON_ROOT,
  MATRIX_ROOT,
  PROJECTION_SCHEMA,
  SAFETY_SPEC,
  featureLeaf,
  loadModule,
  parseIdentity,
  projectionInputs,
  safetyId,
  safetyMapping,
  safetyProject,
  treeSnapshot,
  updateContract,
} from "./bdd/projection-safety-support.js";
import type {
  Contract,
  Parser,
  Projection,
  ProjectionInputs,
} from "./bdd/projection-safety-support.js";
import {
  PLAYWRIGHT,
  WEB,
  codes,
  emptyProject,
  runGate,
} from "./bdd/support.js";

useIoLatencyBudget();

const SAFE_FEATURE = "safe.feature";
const KEEP_FEATURE = "keep.feature";

let parser: Parser;
let projection: Projection;
beforeAll(async () => {
  parser = (await loadModule("parse.mjs")) as unknown as Parser;
  projection = (await loadModule("projection.mjs")) as unknown as Projection;
});

/** A refusal must precede every file write, removal and directory creation. */
function unchangedRefusal(
  root: string,
  input: ProjectionInputs,
  reason: RegExp
): void {
  const before = treeSnapshot(root);
  expect(() => projection.writeFeatureArtifacts(root, input)).toThrow(reason);
  expect(treeSnapshot(root)).toEqual(before);
}

describe("BDD feature projection source identity", () => {
  it("retains nested Unicode source paths and separates identical display titles", () => {
    const { root, contract } = safetyProject([
      "account/café.feature",
      "settings/café.feature",
    ]);
    const artifacts = projection.buildFeatureArtifacts(
      root,
      projectionInputs(parser, root, contract)
    );
    for (const name of ["account/café.feature", "settings/café.feature"]) {
      const source = `${FEATURE_ROOT}/${name}`;
      const leaf = featureLeaf(artifacts, source);
      expect(leaf).toMatchObject({
        schemaVersion: PROJECTION_SCHEMA,
        generator: "lisa-bdd-feature-projection",
        sourceFile: source,
      });
      expect(leaf.scenarios).toHaveLength(1);
      expect(leaf).not.toHaveProperty("traceability");
      expect(leaf).not.toHaveProperty("testInventory");
      for (const directory of [MATRIX_ROOT, BURNDOWN_ROOT]) {
        const markdown = artifacts.get(`${directory}/${source}.md`)!;
        expect(markdown).toContain("\\| stays in its cell");
      }
    }
    expect(
      featureLeaf(artifacts, `${FEATURE_ROOT}/account/café.feature`)
        .scenarios[0]!.id
    ).toBe(safetyId(0));
    expect(
      featureLeaf(artifacts, `${FEATURE_ROOT}/settings/café.feature`)
        .scenarios[0]!.id
    ).toBe(safetyId(1));
    expect(
      projection.writeFeatureArtifacts(
        root,
        projectionInputs(parser, root, contract)
      )
    ).toBeGreaterThan(0);
    for (const [relative, body] of artifacts) {
      expect(fs.readFileSync(path.join(root, relative), "utf8")).toBe(body);
    }
    const written = treeSnapshot(root);
    expect(
      projection.writeFeatureArtifacts(
        root,
        projectionInputs(parser, root, contract)
      )
    ).toBe(0);
    expect(treeSnapshot(root)).toEqual(written);
  });

  it.each([
    { label: "case", left: "Account.feature", right: "account.feature" },
    { label: "NFC", left: "café.feature", right: "cafe\u0301.feature" },
  ])(
    "refuses portable $label collisions before mutation",
    ({ left, right }) => {
      const { root, contract } = safetyProject([
        "first.feature",
        "second.feature",
      ]);
      const input = projectionInputs(parser, root, contract);
      // Some filesystems alias these names. Real parser input preserves both raw
      // identities without pretending they coexist on this machine's filesystem.
      input.scenarios = [
        ...parseIdentity(
          parser,
          root,
          "first.feature",
          `${FEATURE_ROOT}/${left}`
        ),
        ...parseIdentity(
          parser,
          root,
          "second.feature",
          `${FEATURE_ROOT}/${right}`
        ),
      ];
      expect(() => projection.buildFeatureArtifacts(root, input)).toThrow(
        /collision/i
      );
      unchangedRefusal(root, input, /collision/i);
    }
  );

  it.each([
    "../escape.feature",
    "/escape.feature",
    "C:/escape.feature",
    "bdd\\features\\escape.feature",
  ])("refuses unsafe source identity %s before mutation", identity => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const input = projectionInputs(parser, root, contract);
    input.scenarios = parseIdentity(parser, root, SAFE_FEATURE, identity);
    unchangedRefusal(
      root,
      input,
      /BDD projection.*(?:path|source|relative|escape)/i
    );
  });
});

describe("BDD projection output ownership", () => {
  it("refreshes supported generated entrypoints after guidance changes", () => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const input = projectionInputs(parser, root, contract);
    projection.writeFeatureArtifacts(root, input);
    const before = treeSnapshot(root);
    for (const relative of LEGACY_OUTPUTS) {
      const file = path.join(root, relative);
      const body = fs.readFileSync(file, "utf8");
      if (relative.endsWith(".json")) {
        const value = JSON.parse(body);
        value.aggregate = "Previous generated guidance";
        fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
      } else {
        fs.writeFileSync(
          file,
          body.replace("CI publishes", "Previous guidance: CI publishes")
        );
      }
    }
    expect(projection.writeFeatureArtifacts(root, input)).toBe(3);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it.each([
    ...LEGACY_OUTPUTS.map(relative => ({
      label: `handwritten ${relative}`,
      relative,
      body: relative.endsWith(".json")
        ? '{"operatorNote":"preserve legacy notes"}\n'
        : "# Handwritten operator notes\n",
    })),
    {
      label: "unknown legacy JSON schema",
      relative: "bdd/coverage-report.json",
      body: '{"schemaVersion":"lisa-bdd-projection-index-v999","generator":"lisa-bdd-feature-projection"}\n',
    },
  ])("refuses $label before any migration write", ({ relative, body }) => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    unchangedRefusal(
      root,
      projectionInputs(parser, root, contract),
      /legacy|schema|ownership|unowned|generated/i
    );
  });

  it("is byte-idempotent and removes only owned obsolete feature leaves", () => {
    const { root, contract } = safetyProject(["old.feature", KEEP_FEATURE]);
    expect(
      projection.writeFeatureArtifacts(
        root,
        projectionInputs(parser, root, contract)
      )
    ).toBeGreaterThan(0);
    const before = treeSnapshot(root);
    expect(
      projection.writeFeatureArtifacts(
        root,
        projectionInputs(parser, root, contract)
      )
    ).toBe(0);
    expect(treeSnapshot(root)).toEqual(before);
    const notes = path.join(root, JSON_ROOT, "handwritten.json");
    fs.writeFileSync(notes, '{"operatorNote":"preserve me"}\n');
    fs.renameSync(
      path.join(root, FEATURE_ROOT, "old.feature"),
      path.join(root, FEATURE_ROOT, "renamed.feature")
    );
    projection.writeFeatureArtifacts(
      root,
      projectionInputs(parser, root, contract)
    );
    for (const [directory, suffix] of [
      [JSON_ROOT, "json"],
      [MATRIX_ROOT, "md"],
      [BURNDOWN_ROOT, "md"],
    ]) {
      expect(
        fs.existsSync(
          path.join(root, directory!, FEATURE_ROOT, `old.feature.${suffix}`)
        )
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(root, directory!, FEATURE_ROOT, `renamed.feature.${suffix}`)
        )
      ).toBe(true);
    }
    fs.unlinkSync(path.join(root, FEATURE_ROOT, "renamed.feature"));
    const remaining = { ...contract, mappings: [safetyMapping(1)] };
    updateContract(root, remaining);
    projection.writeFeatureArtifacts(
      root,
      projectionInputs(parser, root, remaining)
    );
    expect(
      fs.existsSync(
        path.join(root, JSON_ROOT, FEATURE_ROOT, "renamed.feature.json")
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, JSON_ROOT, FEATURE_ROOT, "keep.feature.json")
      )
    ).toBe(true);
    expect(fs.readFileSync(notes, "utf8")).toBe(
      '{"operatorNote":"preserve me"}\n'
    );
  });

  it("refuses handwritten content occupying a desired leaf without partial writes", () => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const occupied = path.join(
      root,
      JSON_ROOT,
      FEATURE_ROOT,
      "safe.feature.json"
    );
    fs.mkdirSync(path.dirname(occupied), { recursive: true });
    fs.writeFileSync(occupied, '{"operatorNote":"not generated"}\n');
    unchangedRefusal(
      root,
      projectionInputs(parser, root, contract),
      /ownership|unowned|generated/i
    );
  });

  it("refuses an unknown claimed schema before deleting obsolete or rewriting active leaves", () => {
    const { root, contract } = safetyProject([
      "obsolete.feature",
      KEEP_FEATURE,
    ]);
    projection.writeFeatureArtifacts(
      root,
      projectionInputs(parser, root, contract)
    );
    const claimed = path.join(
      root,
      JSON_ROOT,
      FEATURE_ROOT,
      "obsolete.feature.json"
    );
    const body = JSON.parse(fs.readFileSync(claimed, "utf8")) as Record<
      string,
      unknown
    >;
    body.schemaVersion = "lisa-bdd-feature-projection-v999";
    fs.writeFileSync(claimed, JSON.stringify(body));
    fs.unlinkSync(path.join(root, FEATURE_ROOT, "obsolete.feature"));
    const keep = path.join(root, FEATURE_ROOT, KEEP_FEATURE);
    fs.writeFileSync(
      keep,
      fs.readFileSync(keep, "utf8").replace("behavior 2", "changed behavior 2")
    );
    unchangedRefusal(
      root,
      projectionInputs(parser, root, contract),
      /schema|ownership/i
    );
  });

  it.each(["bdd/reports", MATRIX_ROOT, BURNDOWN_ROOT])(
    "refuses symlink ancestor %s before every planned write",
    directory => {
      const { root, contract } = safetyProject([SAFE_FEATURE]);
      const outside = emptyProject("projection-outside-");
      const sentinel = path.join(outside, "sentinel.txt");
      fs.writeFileSync(sentinel, "foreign content\n");
      const link = path.join(root, directory);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(outside, link, "dir");
      const foreign = treeSnapshot(outside);
      unchangedRefusal(
        root,
        projectionInputs(parser, root, contract),
        /symlink/i
      );
      expect(treeSnapshot(outside)).toEqual(foreign);
    }
  );
});

describe("BDD feature projection preserves genuine evidence semantics", () => {
  it("writes honest stale-evidence rows while the actual runtime gate stays red", () => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    successful(git(root, ["init", "-q"]));
    successful(git(root, ["add", "-A"]));
    successful(
      git(root, ["commit", "-q", "-m", "test: commit aligned evidence"])
    );
    const base = successful(git(root, ["rev-parse", "HEAD"]));
    fs.writeFileSync(
      path.join(root, SAFETY_SPEC),
      'test("renamed evidence", async () => {});\n'
    );
    const run = runGate(root, { BDD_BASE_SHA: base });
    expect(run.status).toBe(1);
    expect(codes(run)).toContain("mapping-evidence");
    expect(codes(run)).not.toContain("baseline");
    const input = projectionInputs(parser, root, contract);
    projection.writeFeatureArtifacts(root, input);
    const leaf = featureLeaf(
      projection.buildFeatureArtifacts(root, input),
      `${FEATURE_ROOT}/safe.feature`
    );
    expect(leaf.scenarios[0]!.mappings[0]!.evidenceResolution).toMatchObject({
      ok: false,
      code: "mapping-evidence",
    });
    expect(leaf.scenarios[0]!.obligations).toContainEqual(
      expect.objectContaining({ platform: WEB, covered: false, gap: true })
    );
  });

  it("keeps valid supplemental proof while retaining a stale mapping's defect", () => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const stale = {
      ...safetyMapping(0),
      evidence: "evidence no longer present",
    };
    const input = projectionInputs(parser, root, {
      ...contract,
      mappings: [stale, safetyMapping(0)],
    });
    const row = featureLeaf(
      projection.buildFeatureArtifacts(root, input),
      `${FEATURE_ROOT}/safe.feature`
    ).scenarios[0]!;
    expect(row.mappings.map(mapping => mapping.evidenceResolution.ok)).toEqual([
      false,
      true,
    ]);
    expect(row.obligations).toContainEqual(
      expect.objectContaining({ platform: WEB, covered: true, gap: false })
    );
  });

  it("preserves complete waiver records without treating a waiver as covered", () => {
    const { root, contract } = safetyProject([
      "waived.feature",
      "mapped.feature",
    ]);
    const waiver = {
      scenario: safetyId(0),
      platforms: [WEB],
      runner: PLAYWRIGHT,
      reason: "runner cannot decide A | B",
      owner: "operator@example.test",
      ticket: "TASK-9",
      recordedAt: "2026-08-01",
      expiresAt: "2099-01-01",
    };
    const changed: Contract = {
      ...contract,
      mappings: [safetyMapping(1)],
      platformWaivers: [waiver],
    };
    const artifacts = projection.buildFeatureArtifacts(
      root,
      projectionInputs(parser, root, changed)
    );
    const row = featureLeaf(artifacts, `${FEATURE_ROOT}/waived.feature`)
      .scenarios[0]!;
    expect(row.waivers).toEqual([waiver]);
    expect(row.obligations).toContainEqual(
      expect.objectContaining({
        platform: WEB,
        covered: false,
        waived: true,
        gap: false,
      })
    );
    const markdown = artifacts.get(
      `${BURNDOWN_ROOT}/${FEATURE_ROOT}/waived.feature.md`
    )!;
    for (const value of [
      "A \\| B",
      waiver.owner,
      waiver.ticket,
      waiver.recordedAt,
      waiver.expiresAt,
    ])
      expect(markdown).toContain(value);
  });

  it("shows the canonical retirement approver in both local documents", () => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const retirement = {
      scenario: safetyId(0),
      platforms: [WEB],
      reason: "behavior deliberately retired",
      ticket: "TASK-7",
      approvedBy: "approver@example.test",
      recordedAt: "2026-08-01",
    };
    const artifacts = projection.buildFeatureArtifacts(
      root,
      projectionInputs(parser, root, { ...contract, retirements: [retirement] })
    );
    expect(
      featureLeaf(artifacts, `${FEATURE_ROOT}/${SAFE_FEATURE}`).scenarios[0]
    ).toMatchObject({ retirements: [retirement] });
    for (const directory of [MATRIX_ROOT, BURNDOWN_ROOT]) {
      const markdown = artifacts.get(
        `${directory}/${FEATURE_ROOT}/${SAFE_FEATURE}.md`
      )!;
      expect(markdown).toContain("Approved by");
      expect(markdown).toContain(retirement.approvedBy);
      expect(markdown).toContain(retirement.ticket);
    }
  });

  it("retains worst retry outcomes and explicitly absent execution evidence", () => {
    const { root, contract } = safetyProject([SAFE_FEATURE]);
    const input = projectionInputs(parser, root, contract);
    const absent = featureLeaf(
      projection.buildFeatureArtifacts(root, input),
      `${FEATURE_ROOT}/safe.feature`
    ).scenarios[0]!.mappings[0]!.execution;
    expect(absent.supplied).toBe(false);
    expect(absent.status).not.toBe("passed");
    input.runs = ["failed", "passed"].map((status, index) => ({
      runner: PLAYWRIGHT,
      runId: `retry-${index}`,
      results: [
        { file: SAFETY_SPEC, evidence: `proves ${safetyId(0)}`, status },
      ],
    }));
    const execution = featureLeaf(
      projection.buildFeatureArtifacts(root, input),
      `${FEATURE_ROOT}/safe.feature`
    ).scenarios[0]!.mappings[0]!.execution;
    expect(execution).toMatchObject({ supplied: true, status: "failed" });
  });
});
