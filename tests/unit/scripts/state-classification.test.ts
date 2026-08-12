/**
 * Tests for the state-classification drift check — the mechanical half of the
 * `reset-seed-coverage` rule.
 *
 * The motivating failure is concrete and has happened repeatedly: a flow
 * creates uniquely-marked records and deletes them only on its happy path, so
 * every early failure leaks one. Nothing sweeps the survivors and nothing
 * complains, and the leak surfaces months later as an unreproducible flake.
 * These tests pin the two answers that make that impossible to reintroduce
 * silently — an entity nobody classified fails closed, and an entity classified
 * `fixture-owned` that nothing sweeps fails too.
 * @module tests/unit/scripts/state-classification
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL = "all/copy-overwrite/scripts/check-state-classification.mjs";
const VALIDATOR_REL = "all/copy-overwrite/scripts/lisa-schema-validate.mjs";
const TEMPLATE_REL = "all/create-only/state/state-contract.example.json";
const FIXTURES = path.join(REPO_ROOT, "tests", "fixtures", "state-contract");
const STATE_DIR = "state";
const CONTRACT_FILE = "state-contract.json";
const UTF8 = "utf-8";
const FAILED = "failed";
const INCOMPLETE_FIXTURE = "inventory-incomplete";
const NOOP_CONTRADICTED_FIXTURE = "noop-contradicted";
const INVALID = "invalid";

/** One finding emitted by the check. */
interface Finding {
  readonly code: string;
  readonly subject: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

/** The check's result: a command envelope plus its findings. */
interface CheckResult {
  readonly envelope: Record<string, unknown> & {
    readonly status: string;
    readonly mode: string;
    readonly summary: Record<string, unknown>;
  };
  readonly findings: Finding[];
}

/**
 * Sort strings deterministically without relying on default ordering.
 * @param values - Strings to sort
 * @returns A new, sorted array
 */
const sorted = (values: readonly string[]): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

/**
 * Read and parse a JSON file.
 * @param file - Absolute path
 * @returns Parsed contents
 */
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, UTF8)) as Record<string, unknown>;

/**
 * Create a throwaway project root holding one contract document.
 * @param contents - Contract file contents, already serialized
 * @returns The project root
 */
const projectWithContract = (contents: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-contract-"));
  fs.mkdirSync(path.join(dir, STATE_DIR));
  fs.writeFileSync(path.join(dir, STATE_DIR, CONTRACT_FILE), contents, UTF8);
  return dir;
};

describe("check-state-classification", () => {
  let run: (options: Record<string, unknown>) => CheckResult;
  let bareName: (name: string) => string;
  let detectDeclaredEntities: (
    root: string,
    extra?: string[]
  ) => Map<string, string>;
  let detectPersistenceSignals: (
    root: string
  ) => { kind: string; file: string }[];
  let requiredAssurances: readonly string[];
  let stateContractSchema: Record<string, unknown>;
  let validateAgainstSchema: (
    document: unknown,
    schema: unknown
  ) => { valid: boolean; errors: string[] };

  beforeAll(async () => {
    const mod = await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    );
    run = mod.run;
    bareName = mod.bareName;
    detectDeclaredEntities = mod.detectDeclaredEntities;
    detectPersistenceSignals = mod.detectPersistenceSignals;
    requiredAssurances = mod.REQUIRED_ASSURANCES;
    stateContractSchema = mod.STATE_CONTRACT_SCHEMA;
    const validator = await import(
      pathToFileURL(path.join(REPO_ROOT, VALIDATOR_REL)).href
    );
    validateAgainstSchema = validator.validateAgainstSchema;
  });

  /**
   * Run the check against a checked-in fixture project.
   * @param name - Fixture directory name
   * @returns The check result
   */
  const checkFixture = (name: string): CheckResult =>
    run({ root: path.join(FIXTURES, name), correlationId: `test-${name}` });

  /**
   * Finding codes present in a result, for terse assertions.
   * @param result - Check result
   * @returns Sorted finding codes
   */
  const codes = (result: CheckResult): string[] =>
    sorted(result.findings.map(finding => finding.code));

  describe("the reference adopter", () => {
    it("passes when every entity the system holds is classified", () => {
      const result = checkFixture("adopter");
      expect(result.findings).toEqual([]);
      expect(result.envelope.status).toBe("completed");
    });

    it("classifies state that is not rows — identity, storage, search, queues", () => {
      const contract = readJson(
        path.join(FIXTURES, "adopter", STATE_DIR, CONTRACT_FILE)
      ) as unknown as { entities: { kind: string }[] };
      const kinds = new Set(contract.entities.map(entity => entity.kind));
      for (const kind of [
        "identity-group",
        "object-prefix",
        "search-index",
        "queue",
        "materialized-view",
      ]) {
        expect(kinds).toContain(kind);
      }
    });

    it("uses all four policies", () => {
      expect(checkFixture("adopter").envelope.summary.policies).toEqual({
        "fixture-owned": 6,
        preserve: 2,
        "derived-rebuild": 2,
        forbidden: 1,
      });
    });
  });

  describe("fails closed", () => {
    it("fails on an entity the running system holds but nobody classified", () => {
      const result = checkFixture("leaked-notes");
      expect(result.envelope.status).toBe(FAILED);
      expect(codes(result)).toContain("unclassified-entity");
      expect(result.findings[0].subject).toBe("public.notes");
    });

    it("fails a fixture-owned entity that nothing sweeps — the leak itself", () => {
      const result = checkFixture("unswept-fixture");
      expect(result.envelope.status).toBe(FAILED);
      expect(codes(result)).toEqual(["policy-obligation-unmet"]);
      expect(result.findings[0].message).toContain("sweptBy");
    });

    it("fails a classification whose entity no longer exists", () => {
      const result = checkFixture("stale-classification");
      expect(result.envelope.status).toBe(FAILED);
      expect(codes(result)).toEqual(["stale-classification"]);
    });

    it("fails when a schema source names an entity the inventory omitted", () => {
      const result = checkFixture(INCOMPLETE_FIXTURE);
      expect(result.envelope.status).toBe(FAILED);
      expect(codes(result)).toEqual([INCOMPLETE_FIXTURE]);
      expect(result.findings[0].subject).toBe("saved_searches");
    });
  });

  describe("adoption states", () => {
    it("reports not-adopted rather than passing a gate it never wired", () => {
      expect(
        run({ root: FIXTURES, correlationId: "root" }).envelope.status
      ).toBe("not-adopted");
    });

    it("never reports success when it could not observe the running system", () => {
      const result = run({
        root: path.join(FIXTURES, "adopter"),
        inventory: "state/absent.json",
        correlationId: "detect",
      });
      expect(result.envelope.status).toBe("detection-only");
      expect(
        result.findings.every(finding => finding.severity === "warning")
      ).toBe(true);
    });

    it("treats a malformed contract as broken, never as empty", () => {
      const root = projectWithContract("{ not json");
      expect(run({ root, correlationId: "malformed" }).envelope.status).toBe(
        INVALID
      );
    });

    it("rejects a contract that fails schema validation", () => {
      const root = projectWithContract(
        JSON.stringify({
          schemaVersion: "lisa-state-contract-v1",
          contractVersion: "x",
          mode: "contract",
          owner: "team",
          entities: [{ id: "public.a", kind: "table", policy: "nonsense" }],
        })
      );
      const result = run({ root, correlationId: "schema" });
      expect(result.envelope.status).toBe(INVALID);
      expect(codes(result)).toContain("contract-invalid");
    });
  });

  describe("declared noop", () => {
    it("accepts a verified noop and returns it machine-readably", () => {
      const result = checkFixture("noop-valid");
      expect(result.envelope.status).toBe("no-op");
      expect(result.envelope.mode).toBe("declared-noop");
      expect(result.envelope).toHaveProperty("owner");
      expect(result.envelope).toHaveProperty("capabilityManifest");
    });

    it("rejects a noop the repository contradicts", () => {
      const result = checkFixture(NOOP_CONTRADICTED_FIXTURE);
      expect(result.envelope.status).toBe(INVALID);
      expect(codes(result)).toEqual([NOOP_CONTRADICTED_FIXTURE]);
    });
  });

  describe("assurances", () => {
    it("requires every golden-state property to carry evidence", () => {
      expect(sorted(requiredAssurances)).toEqual(
        sorted([
          "converges-on-second-apply",
          "enumerates-before-mutating",
          "guard-at-the-choke-point",
          "preserves-non-fixture-data",
          "production-fails-closed",
          "rejects-foreign-references",
          "rejects-reserved-id-collision",
          "requires-write-acknowledgment",
          "verifies-exact-counts",
        ])
      );
    });

    it("fails when an assurance is declared without an evidence pointer", () => {
      const contract = readJson(
        path.join(FIXTURES, "adopter", STATE_DIR, CONTRACT_FILE)
      ) as unknown as { assurances: Record<string, unknown> };
      delete contract.assurances["production-fails-closed"];
      const root = projectWithContract(JSON.stringify(contract));
      fs.copyFileSync(
        path.join(FIXTURES, "adopter", STATE_DIR, "inventory.json"),
        path.join(root, STATE_DIR, "inventory.json")
      );
      const result = run({ root, correlationId: "assurance" });
      expect(result.envelope.status).toBe(FAILED);
      expect(
        result.findings.some(
          finding =>
            finding.code === "assurance-unevidenced" &&
            finding.subject === "production-fails-closed"
        )
      ).toBe(true);
    });
  });

  describe("subtraction is a detector, not the safety model", () => {
    it("reads entity names out of schema sources", () => {
      const declared = detectDeclaredEntities(path.join(FIXTURES, "adopter"));
      expect(sorted([...declared.keys()])).toEqual(
        sorted([
          "cards",
          "notes",
          "onboarding_options",
          "payments",
          "player_season_rollup",
          "user_cards",
          "watchlists",
        ])
      );
    });

    it("normalizes quoting and namespaces before comparing", () => {
      expect(bareName('"public"."User_Cards"')).toBe("user_cards");
      expect(bareName("ledger.payments")).toBe("payments");
    });

    it("never turns a detection into a deletion decision", () => {
      // The detector's only output is a finding; no policy is inferred from it.
      const result = checkFixture(INCOMPLETE_FIXTURE);
      const detected = result.findings.find(
        finding => finding.code === INCOMPLETE_FIXTURE
      );
      expect(detected?.message).toContain("inventory is incomplete");
      expect(result.envelope.summary.policies).toEqual({
        "fixture-owned": 6,
        preserve: 2,
        "derived-rebuild": 2,
        forbidden: 1,
      });
    });

    it("finds persistence signals that contradict a claimed noop", () => {
      expect(
        detectPersistenceSignals(path.join(FIXTURES, NOOP_CONTRADICTED_FIXTURE))
          .length
      ).toBeGreaterThan(0);
      expect(
        detectPersistenceSignals(path.join(FIXTURES, "noop-valid"))
      ).toEqual([]);
    });
  });

  describe("the published schema", () => {
    it("names all four policies and no others", () => {
      const policy = (
        stateContractSchema as unknown as {
          properties: {
            entities: { items: { properties: { policy: { enum: string[] } } } };
          };
        }
      ).properties.entities.items.properties.policy.enum;
      expect(policy).toEqual([
        "fixture-owned",
        "preserve",
        "derived-rebuild",
        "forbidden",
      ]);
    });

    it("requires waivers to be dated IOUs with an owner and a ticket", () => {
      const required = (
        stateContractSchema as unknown as {
          properties: { waivers: { items: { required: string[] } } };
        }
      ).properties.waivers.items.required;
      expect(sorted(required)).toEqual(
        sorted(["id", "owner", "reason", "recordedAt", "ticket"])
      );
    });

    it("validates the create-only template Lisa ships to adopters", () => {
      const result = validateAgainstSchema(
        readJson(path.join(REPO_ROOT, TEMPLATE_REL)),
        stateContractSchema
      );
      expect(result.errors).toEqual([]);
    });
  });
});
