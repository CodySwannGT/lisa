/**
 * Exercise four ordinary local proof producers through the built attest command.
 * @module control-exercise-fixture
 */
import {
  createHash,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "vitest";

import type { EvidenceDocument } from "../../src/controls/evidence-types.js";
import { EXERCISE_DECLARATION_PATH } from "../../src/controls/exercise-declaration.js";
import { HOST_PROOF_TRUST_FILE } from "../../src/controls/host-proof-trust.js";
import { isJsonObject } from "../../src/sync/json-path.js";
import { runControlAuditGit } from "../helpers/control-audit-fixtures.js";
import {
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  provedGates,
  VIOLATION_MARK,
  workspaceCopy,
} from "../helpers/control-proofs.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { operatorEnv } from "./carrier-install.js";

const CLI = path.resolve("dist/index.js");
const GATE_RUNNER = path.resolve(
  "all/copy-overwrite/scripts/lisa-run-gates.mjs"
);
const ORIGIN = "https://gitlab.example.test/team/exercises.git";
export const ENVIRONMENT = "production-representative";
export const PRODUCER = "exercise-operator";
const ADJUDICATOR = "independent-reviewer";
const MOMENT = "pull-request";
const GATE = "code-style";
export const GATE_TARGET = "lint-refusal";
const RELEASE_TRACK = "staging-representative";
const RELEASE_OPERATOR = "release-operator";
const PREVIOUS_GENERATION = "generation-a";
export const CREDENTIAL_TARGET = "local-console";
export const WORKER_TARGET = "local-worker";
export const STALE = "2000-01-01T00:00:00.000Z";
const CLEANUPS: Array<() => void> = [];
const COMMON = { scope: ".", producer: PRODUCER, adjudicator: ADJUDICATOR };
export const TARGETS = [
  {
    ...COMMON,
    id: GATE_TARGET,
    criterion: "AC5.5",
    gate: GATE,
    moment: MOMENT,
  },
  {
    ...COMMON,
    id: CREDENTIAL_TARGET,
    criterion: "AC6.4",
    connection: "registry",
    surface: "console",
  },
  {
    ...COMMON,
    id: WORKER_TARGET,
    criterion: "AC6.4",
    scope: "api",
    connection: "registry",
    surface: "worker",
  },
  {
    ...COMMON,
    id: "rollback",
    criterion: "AC7.2",
    release_track: RELEASE_TRACK,
  },
  {
    ...COMMON,
    id: "qualification",
    criterion: "AC8.9",
    role: RELEASE_OPERATOR,
    minimum_shadow_seconds: 60,
  },
] as const;

/** Fixture repository and protected reviewer outside it. */
interface Setting {
  readonly root: string;
  readonly outside: string;
  readonly trust: string;
  readonly reviewer: KeyObject;
}

/**
 * Put the plan in the repository and both public authorities outside it.
 * @returns A clean proof fixture and its ephemeral reviewing authority
 */
export function setting(): Setting {
  const proved = provedGates([{ command: checks(F_NONE_SOURCE) }], GATE, [
    "commit",
    MOMENT,
  ]);
  const gate = proved[GATE];
  if (!isJsonObject(gate))
    throw new TypeError("Expected a declared fixture gate.");
  const fixture = buildProofFixture({
    ...proved,
    [GATE]: { ...gate, tier: "authoritative", owner: PRODUCER },
  });
  const root = fixture.repoPath;
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-exercise-attest-"));
  const reviewer = generateKeyPairSync("ed25519");
  const attestor = generateKeyPairSync("ed25519");
  const trust = path.join(outside, "trust.json");
  CLEANUPS.push(fixture.cleanup, () =>
    rmSync(outside, { recursive: true, force: true })
  );
  mkdirSync(path.join(root, "api"), { recursive: true });
  writeFileSync(
    path.join(root, "api", "surface.txt"),
    "Registry worker fixture\n"
  );
  writeFileSync(
    path.join(root, EXERCISE_DECLARATION_PATH),
    JSON.stringify({
      schema_version: 1,
      environment: ENVIRONMENT,
      targets: TARGETS,
    })
  );
  runControlAuditGit(root, [
    "add",
    EXERCISE_DECLARATION_PATH,
    "api/surface.txt",
  ]);
  runControlAuditGit(root, ["commit", "-q", "-m", "declare local exercises"]);
  runControlAuditGit(root, ["remote", "add", "origin", ORIGIN]);
  writeFileSync(
    trust,
    JSON.stringify({
      schema_version: 1,
      repository: ORIGIN,
      environment: ENVIRONMENT,
      adjudicator: {
        id: ADJUDICATOR,
        public_key: reviewer.publicKey.export({ type: "spki", format: "pem" }),
      },
      attestor: {
        id: "attest-writer",
        public_key: attestor.publicKey.export({ type: "spki", format: "pem" }),
      },
    })
  );
  return { root, outside, trust, reviewer: reviewer.privateKey };
}

/**
 * Run the built CLI with the repository's real local proof controls.
 * @param where - The disposable fixture
 * @param args - Command and flags under controls
 * @returns The subprocess result
 */
export function controls(where: Setting, ...args: string[]) {
  return boundedSpawnSync({
    command: process.execPath,
    args: [CLI, "--no-update-check", "controls", ...args],
    cwd: where.root,
    env: {
      ...operatorEnv(),
      LISA_SKIP_UPDATE_CHECK: "1",
      TMPDIR: where.outside,
      [HOST_PROOF_TRUST_FILE]: where.trust,
    },
    label: "attest typed artifact exercises",
    baseMs: 30_000,
  });
}

/**
 * Run the built attest command in the fixture.
 * @param where - The disposable repository
 * @param args - The attest options
 * @returns The subprocess result
 */
export function attest(where: Setting, ...args: string[]) {
  return controls(where, "attest", ...args);
}

/**
 * Read the stored evidence or verdict from the built command.
 * @param where - The disposable repository
 * @param file - Repository-relative path
 * @returns The parsed file
 */
export function stored<Shape>(where: Setting, file: string): Shape {
  return JSON.parse(readFileSync(path.join(where.root, file), "utf8")) as Shape;
}

/**
 * Observe a local service challenge on the named credential surface.
 * @param surface - The console or worker identity used for this exercise
 * @returns The verified public principal and the result of the challenge
 */
function identityOn(surface: string) {
  const key = generateKeyPairSync("ed25519");
  const challenge = Buffer.from(`registry exercises on ${surface}`);
  const reply = sign(null, challenge, key.privateKey);
  return {
    connection: "registry",
    surface,
    principal: `registry-${surface}@fixture`,
    identity_verified: verify(null, challenge, key.publicKey, reply),
  };
}

/**
 * Activate a release fixture and read back what the local environment serves.
 * @param active - File holding the active generation
 * @param generation - Release identity to activate
 * @returns The observed generation
 */
function observeGeneration(active: string, generation: string): string {
  writeFileSync(active, `${generation}\n`);
  return readFileSync(active, "utf8").trim();
}

/**
 * Restore the old generation in a disposable release directory and read it back.
 * @param where - The operator's temporary artifact directory
 * @param stamp - Recorded incident timestamps
 * @returns An incident with the observed restoration result
 */
function rollback(where: Setting, stamp: string) {
  const active = path.join(where.outside, "active-generation");
  const rolledBackFrom = observeGeneration(active, "generation-b");
  const restored = observeGeneration(active, PREVIOUS_GENERATION);
  return {
    release_track: RELEASE_TRACK,
    incident: "fixture-incident",
    actor: PRODUCER,
    finding: "fixture-finding",
    previous_generation: PREVIOUS_GENERATION,
    rolled_back_from: rolledBackFrom,
    restored_generation: restored,
    detected_at: stamp,
    rolled_back_at: stamp,
    verified_at: stamp,
    recovery_verified: restored === PREVIOUS_GENERATION,
  };
}

/**
 * Run the authoritative pull-request gate's command on both controlled edits.
 * @param where - The disposable repository whose configured job runs the gate
 * @returns The observed clean result and declared refusal
 */
function gateEvidence(where: Setting) {
  const copy = workspaceCopy(where.root);
  try {
    const run = () =>
      boundedSpawnSync({
        command: process.execPath,
        args: [
          GATE_RUNNER,
          `--moment=${MOMENT}`,
          "--builtins=none",
          "--parts=all",
          `--gate=${GATE}`,
        ],
        cwd: copy.directory,
        env: operatorEnv(),
        label: "local authoritative pull-request gate",
        baseMs: 30_000,
      });
    const clean = run();
    const source = path.join(copy.directory, F_NONE_SOURCE);
    writeFileSync(
      source,
      `${readFileSync(source, "utf8")}\n# ${VIOLATION_MARK}\n`
    );
    const violation = run();
    expect(clean.status).toBe(0);
    expect(violation.status).toBe(1);
    return {
      gate: GATE,
      moment: MOMENT,
      violation_exit: violation.status,
      violation_output: violation.stdout,
      clean_exit: clean.status,
    };
  } finally {
    copy.cleanup();
  }
}

/**
 * Capture the actual gate refusal and the independently evaluated local exercises.
 * @param where - The disposable setting and reviewing key
 * @param evidence - Baseline record from the authoritative gate runner
 * @returns Five typed statements across four criteria
 */
export function statements(where: Setting, evidence: EvidenceDocument) {
  const stamp = new Date(Date.now() - 1_000).toISOString();
  const shadow = new Date(Date.parse(stamp) - 60_000).toISOString();
  const roster = [RELEASE_OPERATOR, ADJUDICATOR];
  const allowed = (role: string): boolean => roster.includes(role);
  const compare = [RELEASE_OPERATOR, "contractor"].every(
    role => allowed(role) === (role === RELEASE_OPERATOR)
  );
  const outcomes = [
    gateEvidence(where),
    identityOn("console"),
    identityOn("worker"),
    rollback(where, stamp),
    {
      role: RELEASE_OPERATOR,
      actor: PRODUCER,
      roster_sha256: createHash("sha256")
        .update(roster.join("\n"))
        .digest("hex"),
      shadow_started_at: shadow,
      shadow_completed_at: stamp,
      comparisons: 2,
      shadow_agreed: compare,
      adversarial_passed: !allowed("unqualified-operator"),
      qualification: "qualified",
    },
  ];
  return TARGETS.map((target, index) => ({
    schema_version: 1,
    repository: ORIGIN,
    environment: ENVIRONMENT,
    checks_digest: evidence.checks.digest,
    criterion: target.criterion,
    scope: target.scope,
    target_id: target.id,
    producer: target.producer,
    adjudicator: target.adjudicator,
    artifact: {
      sha256: createHash("sha256")
        .update(JSON.stringify(outcomes[index]))
        .digest("hex"),
    },
    completed_at: stamp,
    outcome: outcomes[index],
  }));
}

/** Clean up the temporary checkouts and authority files for one test. */
export function cleanupExercises(): void {
  CLEANUPS.splice(0).forEach(cleanup => cleanup());
}
