/**
 * Confined, bounded collection of the project evidence an agentic Health
 * evaluator is shown. Every read stays inside the project root and every
 * artifact is size-capped; the content itself is untrusted host material.
 * @module health/agentic-evidence
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import type {
  AgenticArtifactKind,
  AgenticConfigProjection,
  AgenticHealthArtifact,
} from "./agentic-contract.js";
import type { HealthResult } from "./contract.js";
import {
  projectPathKind,
  readProjectJsonObject,
  readProjectText,
  resolveProjectPath,
} from "./read-only-fs.js";
import { workflowExcerpt } from "./workflow-excerpt.js";

const MAX_AGENTIC_ARTIFACTS = 67;
const MAX_WORKFLOW_FILES = 64;
const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 512 * 1024;
const WORKFLOW_DIRECTORY = path.join(".github", "workflows");
const CONFIG_PATH = ".lisa.config.json";
const LOCAL_CONFIG_PATH = ".lisa.config.local.json";
const OVERRIDE_PATHS = [
  {
    kind: "eslint-override",
    path: "eslint.config.local.ts",
  },
  {
    kind: "eslint-ignore-override",
    path: "eslint.ignore.config.local.json",
  },
] as const;

/** One path-specific config read, distinguishing absence from invalid values. */
interface MutationGateRead {
  readonly present: boolean;
  readonly enabled: boolean | null;
}

/**
 * Read one optional fixed-path override artifact.
 * @param projectRoot - Canonical host project root
 * @param descriptor - Artifact kind and its fixed project-relative path
 * @returns The bounded artifact, or undefined when the file is absent
 */
async function readOptionalArtifact(
  projectRoot: string,
  descriptor: Readonly<{ kind: AgenticArtifactKind; path: string }>
): Promise<AgenticHealthArtifact | undefined> {
  const kind = await projectPathKind(projectRoot, descriptor.path);
  if (kind === "missing") return undefined;
  if (kind !== "file") throw new Error("Unsafe agentic evidence path");
  const content = await readProjectText(
    projectRoot,
    descriptor.path,
    MAX_ARTIFACT_BYTES
  );
  if (content === undefined) return undefined;
  return Object.freeze({ ...descriptor, content });
}

/**
 * Enumerate bounded regular workflow files without following special paths.
 * @param projectRoot - Canonical host project root
 * @returns Sorted project-relative workflow paths
 */
async function workflowPaths(projectRoot: string): Promise<readonly string[]> {
  const kind = await projectPathKind(projectRoot, WORKFLOW_DIRECTORY);
  if (kind === "missing") return [];
  if (kind !== "directory") throw new Error("Unsafe workflow evidence path");
  const directory = resolveProjectPath(projectRoot, WORKFLOW_DIRECTORY);
  const entries = await readdir(directory, { withFileTypes: true });
  const workflows = entries
    .filter(entry => /\.ya?ml$/u.test(entry.name))
    .map(entry => {
      if (!entry.isFile()) throw new Error("Unsafe workflow evidence file");
      return path.join(WORKFLOW_DIRECTORY, entry.name);
    })
    .sort((left, right) => left.localeCompare(right));
  if (workflows.length > MAX_WORKFLOW_FILES) {
    throw new Error("Agentic workflow evidence exceeds file limit");
  }
  return workflows;
}

/**
 * Read current managed ESLint content only when deterministic drift names it.
 * @param projectRoot - Canonical host project root
 * @param deterministic - Completed deterministic result
 * @returns The drifted `eslint.config.ts` artifact, or undefined when not drifted
 */
async function readManagedDriftArtifact(
  projectRoot: string,
  deterministic: HealthResult
): Promise<AgenticHealthArtifact | undefined> {
  const finding = deterministic.findings.find(
    candidate =>
      candidate.check === "templates.managed" &&
      candidate.status === "fail" &&
      /(?:^|[ :,])eslint\.config\.ts(?:$|[ ,])/u.test(candidate.reason)
  );
  if (finding === undefined) return undefined;
  return readOptionalArtifact(projectRoot, {
    kind: "managed-drift",
    path: "eslint.config.ts",
  });
}

/**
 * Walk one fixed config path, distinguishing an absent key from a present
 * value of the wrong shape.
 * @param current - The value reached so far
 * @param fields - Path segments still to walk
 * @returns Whether the path is present and its boolean value, if it is one
 */
function readGatePath(
  current: unknown,
  fields: readonly string[]
): MutationGateRead {
  const [field, ...rest] = fields;
  if (field === undefined) {
    return Object.freeze({
      present: true,
      enabled: typeof current === "boolean" ? current : null,
    });
  }
  if (
    current === null ||
    typeof current !== "object" ||
    Array.isArray(current)
  ) {
    return Object.freeze({ present: true, enabled: null });
  }
  if (!Object.prototype.hasOwnProperty.call(current, field)) {
    return Object.freeze({ present: false, enabled: null });
  }
  return readGatePath(
    (current as Readonly<Record<string, unknown>>)[field],
    rest
  );
}

/**
 * Resolve the allowlisted path without retaining unrelated config values.
 * @param config - One parsed config file
 * @returns Whether this file declares the mutation gate, and its value
 */
function mutationGateRead(
  config: Readonly<Record<string, unknown>>
): MutationGateRead {
  return readGatePath(config, ["quality", "mutation", "gate", "enabled"]);
}

/**
 * Read the effective mutation-gate boolean with local-config precedence.
 * @param projectRoot - Canonical host project root
 * @returns The frozen config projection disclosed to the evaluator
 */
export async function readAgenticConfig(
  projectRoot: string
): Promise<AgenticConfigProjection> {
  const [committed, local] = await Promise.all([
    readProjectJsonObject(projectRoot, CONFIG_PATH),
    readProjectJsonObject(projectRoot, LOCAL_CONFIG_PATH),
  ]);
  const localGate = mutationGateRead(local ?? {});
  const committedGate = mutationGateRead(committed ?? {});
  const enabled = localGate.present ? localGate.enabled : committedGate.enabled;
  return Object.freeze({
    quality: Object.freeze({
      mutation: Object.freeze({
        gate: Object.freeze({ enabled }),
      }),
    }),
    gates: Object.freeze({
      traceability: Object.freeze({
        level: traceabilityLevel(local) ?? traceabilityLevel(committed),
      }),
    }),
  });
}

/**
 * The declared pull-request level of the traceability gate, or null.
 *
 * Local config wins over committed, matching how the mutation gate above
 * resolves — a developer's local override is the effective answer, and
 * reporting the committed value while the local one governs would describe a
 * configuration nobody is running.
 * @param config - A parsed config object, or null when the file is absent
 * @returns The declared level, or null when this file does not declare it
 */
function traceabilityLevel(
  config: Readonly<Record<string, unknown>> | null | undefined
): string | null {
  const gates = config?.gates;
  if (!isJsonObject(gates) || !isJsonObject(gates.traceability)) {
    return null;
  }
  const declared = gates.traceability["pull-request"];
  if (typeof declared === "string") return declared;
  if (isJsonObject(declared) && typeof declared.level === "string") {
    return declared.level;
  }
  return null;
}

/**
 * Collect confined project evidence with hard per-file and aggregate bounds.
 * @param projectRoot - Canonical host project root
 * @param deterministic - Completed deterministic result
 * @returns Frozen artifacts sorted by path
 */
export async function collectAgenticArtifacts(
  projectRoot: string,
  deterministic: HealthResult
): Promise<readonly AgenticHealthArtifact[]> {
  const [overrides, managedDrift] = await Promise.all([
    Promise.all(
      OVERRIDE_PATHS.map(descriptor =>
        readOptionalArtifact(projectRoot, descriptor)
      )
    ),
    readManagedDriftArtifact(projectRoot, deterministic),
  ]);
  const workflows = (
    await Promise.all(
      (await workflowPaths(projectRoot)).map(async relativePath => {
        const content = await readProjectText(
          projectRoot,
          relativePath,
          MAX_ARTIFACT_BYTES
        );
        if (content === undefined) {
          throw new Error("Workflow evidence disappeared during collection");
        }
        const excerpt = workflowExcerpt(content);
        if (excerpt.length === 0) return undefined;
        if (Buffer.byteLength(excerpt, "utf8") > MAX_ARTIFACT_BYTES) {
          throw new Error("Workflow excerpt exceeds artifact size limit");
        }
        return Object.freeze({
          kind: "workflow" as const,
          path: relativePath.split(path.sep).join("/"),
          content: excerpt,
        });
      })
    )
  ).filter(item => item !== undefined);
  const artifacts = [
    ...overrides.filter(item => item !== undefined),
    ...(managedDrift === undefined ? [] : [managedDrift]),
    ...workflows,
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (artifacts.length > MAX_AGENTIC_ARTIFACTS) {
    throw new Error("Agentic evidence exceeds artifact limit");
  }
  const totalBytes = artifacts.reduce(
    (total, artifact) => total + Buffer.byteLength(artifact.content, "utf8"),
    0
  );
  if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
    throw new Error("Agentic evidence exceeds aggregate size limit");
  }
  return Object.freeze(artifacts);
}
