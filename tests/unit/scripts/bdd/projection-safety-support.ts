/** Real parser, mapping files and filesystem snapshots for projection safety. */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  HEALTHY_MAP,
  MAP_REL,
  PLAYWRIGHT,
  RATIFIED,
  REPO_ROOT,
  WEB,
  featureSource,
  makeProject,
} from "./support.js";

export const PROJECTION_SCHEMA = "lisa-bdd-feature-projection-v1";
export const SAFETY_SPEC = "e2e/safety.spec.ts";
export const FEATURE_ROOT = "bdd/features";
export const JSON_ROOT = "bdd/reports/v1/features";
export const MATRIX_ROOT = "docs/bdd-scenario-matrix";
export const BURNDOWN_ROOT = "docs/e2e-bdd-coverage";

/** The parser's actual object is kept intact, rather than reconstructed in tests. */
export type ParsedScenario = Record<string, unknown>;
export type Contract = Record<string, unknown>;

/** Authoritative Gherkin entrypoints imported from the shipped source. */
export interface Parser {
  loadScenarios: (root: string, platforms: Set<string>) => ParsedScenario[];
  parseFeatureSource: (
    source: string,
    file: string,
    platforms: Set<string>
  ) => ParsedScenario[];
}

/** Shared writer input uses original parser objects and real evidence files. */
export interface ProjectionInputs {
  contract: Contract;
  scenarios: ParsedScenario[];
  runs: Record<string, unknown>[];
  cache: Map<string, string>;
}

/** The actual public projection API; no passing implementation is supplied here. */
export interface Projection {
  buildFeatureArtifacts: (
    root: string,
    input: ProjectionInputs
  ) => Map<string, string>;
  writeFeatureArtifacts: (root: string, input: ProjectionInputs) => number;
}

/** Only fields these tests inspect, preserving the rest of the actual leaf. */
export interface FeatureLeaf {
  schemaVersion: string;
  generator: string;
  sourceFile: string;
  scenarios: {
    id: string;
    mappings: {
      evidenceResolution: { ok: boolean; code?: string };
      execution: { supplied: boolean; status: string | null };
    }[];
    obligations: {
      platform: string;
      covered: boolean;
      waived: boolean;
      gap: boolean;
    }[];
    waivers: Record<string, unknown>[];
  }[];
}

/** Every invocation receives a fresh evidence cache, so edits cannot be hidden. */
export function projectionInputs(
  parser: Parser,
  root: string,
  contract: Contract
): ProjectionInputs {
  return {
    contract,
    scenarios: parser.loadScenarios(root, new Set([WEB])),
    runs: [],
    cache: new Map(),
  };
}

/** Full source identity, not a title or a basename, selects the JSON leaf. */
export function featureLeaf(
  artifacts: Map<string, string>,
  source: string
): FeatureLeaf {
  const body = artifacts.get(`${JSON_ROOT}/${source}.json`);
  if (body === undefined)
    throw new Error(`Expected generated feature leaf: ${source}`);
  return JSON.parse(body) as FeatureLeaf;
}

/** Load the actual ESM module using the same native loader as existing suites. */
export function loadModule(name: string): Promise<Record<string, unknown>> {
  return import(
    pathToFileURL(path.join(REPO_ROOT, "expo/copy-overwrite/scripts/bdd", name))
      .href
  ) as Promise<Record<string, unknown>>;
}

/** A fixture scenario ID independent of source-path spelling. */
export function safetyId(index: number): string {
  return `BDD-SAFE-${String(index + 1).padStart(3, "0")}`;
}

/** One real aligned mapping for each fixture scenario. */
export function safetyMapping(index: number): Record<string, unknown> {
  return {
    scenario: safetyId(index),
    runner: PLAYWRIGHT,
    platforms: [WEB],
    file: SAFETY_SPEC,
    evidence: `proves ${safetyId(index)}`,
    level: "behavioral",
  };
}

/** Real nested feature sources and evidence, under an unchanged positive floor. */
export function safetyProject(files: readonly string[]): {
  root: string;
  contract: Contract;
} {
  const contract = {
    ...HEALTHY_MAP,
    trackers: { keys: ["TASK"] },
    coverageFloor: { [WEB]: 100 },
    mappings: files.map((_, index) => safetyMapping(index)),
  };
  const root = makeProject({
    map: contract,
    files: {
      [SAFETY_SPEC]: files
        .map(
          (_, index) => `test("proves ${safetyId(index)}", async () => {});\n`
        )
        .join(""),
    },
  });
  files.forEach((file, index) => {
    const target = path.join(root, FEATURE_ROOT, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      featureSource("Shared | feature", [
        {
          id: safetyId(index),
          name: `behavior ${index + 1} | stays in its cell`,
          tags: [WEB, RATIFIED, "TASK-123"],
        },
      ])
    );
  });
  return { root, contract };
}

/** Read a real file and let the parser interpret its explicit raw path identity. */
export function parseIdentity(
  parser: Parser,
  root: string,
  source: string,
  identity: string
): ParsedScenario[] {
  return parser.parseFeatureSource(
    fs.readFileSync(path.join(root, FEATURE_ROOT, source), "utf8"),
    identity,
    new Set([WEB])
  );
}

/** Capture files, directories and links without following an adversarial symlink. */
export function treeSnapshot(root: string): Record<string, string> {
  const rows: [string, string][] = [];
  const walk = (directory: string): void => {
    for (const name of fs
      .readdirSync(directory)
      .sort((left, right) => left.localeCompare(right, "en"))) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink())
        rows.push([relative, `link:${fs.readlinkSync(absolute)}`]);
      else if (stat.isDirectory()) {
        rows.push([relative, "directory"]);
        walk(absolute);
      } else
        rows.push([relative, fs.readFileSync(absolute).toString("base64")]);
    }
  };
  walk(root);
  return Object.fromEntries(rows);
}

/** Write only the owned fixture input, preserving genuine on-disk contract reads. */
export function updateContract(root: string, contract: Contract): void {
  fs.writeFileSync(
    path.join(root, MAP_REL),
    `${JSON.stringify(contract, null, 2)}\n`
  );
}
