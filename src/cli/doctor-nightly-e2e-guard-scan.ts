/**
 * Bounded, executable-field-only discovery for nightly bypass guard callers.
 *
 * A managed guard lying unused on disk proves nothing. Discovery starts at
 * workflows with repository events, follows only reachable local reusable
 * calls, and records the literal Node target the active job invokes. Dynamic
 * shell/YAML forms are unavailable evidence and fail closed.
 * @module cli/doctor-nightly-e2e-guard-scan
 */
/* eslint-disable functional/immutable-data, functional/no-let, max-lines, max-lines-per-function, sonarjs/cognitive-complexity -- one bounded graph-and-byte state machine keeps every fail-closed limit auditable together */
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import * as path from "node:path";

import { loadYaml } from "../utils/yaml.js";

/** Maximum workflow files inspected by one doctor run. */
export const MAX_NIGHTLY_GUARD_FILES = 256;
/** Maximum bypass-bearing caller jobs inspected by one doctor run. */
export const MAX_NIGHTLY_GUARD_CALLERS = 64;
/** Maximum distinct scripts behaviorally probed by one doctor run. */
export const MAX_NIGHTLY_GUARD_TARGETS = 8;

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_DEPTH = 8;
const WORKFLOWS = path.join(".github", "workflows");
const CANONICAL_TARGET = "scripts/check-nightly-e2e-health.mjs";
const OFFICIAL =
  /^CodySwannGT\/lisa\/\.github\/workflows\/nightly-e2e-health\.ya?ml@[^\s${}]+$/u;
const LOCAL = /^\.\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)$/u;
const TARGET = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs)$/u;
const LITERAL_NODE = /^node[ \t]+([^ \t]+)[ \t]*$/u;
const ENV_NODE =
  /^node[ \t]+["']?\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))["']?[ \t]*$/u;

/** One active job and the literal script it executes. */
export interface NightlyGuardCaller {
  /** Repo-relative workflow path. */
  readonly workflow: string;
  /** Stable job identifier, which participates in the check context. */
  readonly job: string;
  /** Whether the job calls Lisa's endpoint or invokes Node itself. */
  readonly kind: "official-reusable" | "direct";
  /** Literal, project-relative JavaScript target. */
  readonly target: string;
}

/** One reason discovery could not produce a trustworthy answer. */
export interface NightlyGuardScanFailure {
  /** Workflow involved, or the workflow directory for inventory failures. */
  readonly workflow: string;
  /** Bounded operator-readable refusal. */
  readonly reason: string;
}

/** Discovery distinguishes an examined zero from unavailable evidence. */
export type NightlyGuardScanResult =
  | { readonly state: "ok"; readonly callers: readonly NightlyGuardCaller[] }
  | {
      readonly state: "unavailable";
      readonly failures: readonly NightlyGuardScanFailure[];
    };

/** Parsed workflow retained with its deterministic display path. */
interface WorkflowRecord {
  readonly file: string;
  readonly name: string;
  readonly document: Readonly<Record<string, unknown>>;
}

const object = (
  value: unknown
): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const ordered = <T extends string>(values: readonly T[]): T[] =>
  [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
const unavailable = (
  workflow: string,
  reason: string
): NightlyGuardScanResult => ({
  state: "unavailable",
  failures: [{ workflow, reason }],
});
const isScanResult = (
  value: readonly WorkflowRecord[] | NightlyGuardScanResult
): value is NightlyGuardScanResult => !Array.isArray(value);

const triggerNames = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter(item => typeof item === "string");
  return Object.keys(object(value) ?? {});
};
const isRoot = (record: WorkflowRecord): boolean =>
  triggerNames(record.document.on).some(event => event !== "workflow_call");

const literalEnv = (
  ...levels: readonly unknown[]
): Readonly<Record<string, string>> =>
  Object.assign(
    {},
    ...levels.map(level =>
      Object.fromEntries(
        Object.entries(object(level) ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    )
  );

const bypassBearing = (...levels: readonly unknown[]): boolean =>
  levels.some(level =>
    Object.entries(object(level) ?? {}).some(
      ([key, value]) =>
        key === "GATE_BYPASS" ||
        key.startsWith("NIGHTLY_BYPASS_") ||
        (typeof value === "string" && value.includes("nightly-e2e-bypass"))
    )
  );

const safeTarget = (candidate: string): string | undefined => {
  const relative = candidate.startsWith("./") ? candidate.slice(2) : candidate;
  if (!TARGET.test(relative) || path.posix.isAbsolute(relative))
    return undefined;
  const segments = relative.split("/");
  return segments.includes(".") || segments.includes("..")
    ? undefined
    : relative;
};

const targetFromRun = (
  run: string,
  env: Readonly<Record<string, string>>
): { readonly target?: string; readonly reason?: string } => {
  const command = run.trim();
  if (!/(?:^|[ \t])node(?:[ \t]|$)/u.test(command)) return {};
  if (/ --(?:contract-version|report-issues)[ \t]*$/u.test(command)) return {};
  const literal = LITERAL_NODE.exec(command)?.[1];
  const variable = ENV_NODE.exec(command);
  const candidate = variable ? env[variable[1] ?? variable[2] ?? ""] : literal;
  if (candidate === undefined) {
    return {
      reason:
        "could not resolve the Node target from one literal environment level",
    };
  }
  const target = safeTarget(candidate);
  return target
    ? { target }
    : {
        reason:
          "Node target must be one literal contained relative ASCII .js/.mjs/.cjs path; expressions, substitutions, absolute/escaping paths, and multiple commands are unsupported",
      };
};

const directCaller = (
  workflow: WorkflowRecord,
  jobId: string,
  job: Readonly<Record<string, unknown>>
): NightlyGuardCaller | NightlyGuardScanFailure | undefined => {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const relevant = steps.filter(step => {
    const fields = object(step);
    return bypassBearing(workflow.document.env, job.env, fields?.env);
  });
  if (relevant.length === 0) return undefined;
  const resolved = relevant.map(step => {
    const fields = object(step) ?? {};
    return targetFromRun(
      text(fields.run),
      literalEnv(workflow.document.env, job.env, fields.env)
    );
  });
  const reason = resolved.find(item => item.reason)?.reason;
  if (reason) return { workflow: workflow.file, reason: `${jobId}: ${reason}` };
  const targets = resolved.flatMap(item => (item.target ? [item.target] : []));
  if (targets.length === 0) {
    const reportingOnly = relevant.some(step =>
      / --report-issues[ \t]*$/u.test(text(object(step)?.run))
    );
    return reportingOnly
      ? undefined
      : {
          workflow: workflow.file,
          reason: `${jobId}: bypass-bearing job has no supported literal Node guard target`,
        };
  }
  if (targets.length !== 1) {
    return {
      workflow: workflow.file,
      reason: `${jobId}: multiple Node guard targets are ambiguous`,
    };
  }
  return {
    workflow: workflow.file,
    job: jobId,
    kind: "direct",
    target: targets[0] ?? "",
  };
};

const officialCaller = (
  workflow: WorkflowRecord,
  jobId: string,
  job: Readonly<Record<string, unknown>>
): NightlyGuardCaller | NightlyGuardScanFailure | undefined => {
  const uses = text(job.uses);
  if (uses.startsWith("./")) return undefined;
  if (!uses.includes("nightly-e2e-health")) return undefined;
  if (!OFFICIAL.test(uses)) {
    return {
      workflow: workflow.file,
      reason: `${jobId}: official reusable reference is not a static literal`,
    };
  }
  const input = object(job.with)?.guard_script;
  const candidate = input === undefined ? CANONICAL_TARGET : text(input);
  const target = safeTarget(candidate);
  return target
    ? { workflow: workflow.file, job: jobId, kind: "official-reusable", target }
    : {
        workflow: workflow.file,
        reason: `${jobId}: with.guard_script must be one literal contained relative ASCII JavaScript path`,
      };
};

const readWorkflows = async (
  projectRoot: string
): Promise<readonly WorkflowRecord[] | NightlyGuardScanResult> => {
  const directory = path.join(projectRoot, WORKFLOWS);
  let names: readonly string[];
  try {
    names = ordered(
      (await readdir(directory)).filter(name => /\.ya?ml$/u.test(name))
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? []
      : unavailable(
          WORKFLOWS,
          `workflow directory unreadable (${code ?? "error"})`
        );
  }
  if (names.length > MAX_NIGHTLY_GUARD_FILES) {
    return unavailable(
      WORKFLOWS,
      `workflow file limit ${MAX_NIGHTLY_GUARD_FILES} exceeded`
    );
  }
  const records: WorkflowRecord[] = [];
  let total = 0;
  for (const name of names) {
    const file = path.posix.join(".github", "workflows", name);
    try {
      if ((await lstat(path.join(directory, name))).isSymbolicLink())
        return unavailable(file, "workflow is a symlink");
      const handle = await open(
        path.join(directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      let source: Buffer;
      try {
        const info = await handle.stat();
        if (!info.isFile())
          return unavailable(
            file,
            "workflow is not a regular non-symlink file"
          );
        if (info.size > MAX_FILE_BYTES)
          return unavailable(file, "workflow exceeds the 1 MiB file limit");
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        let used = 0;
        while (used < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            used,
            buffer.length - used,
            used
          );
          if (bytesRead === 0) break;
          used += bytesRead;
        }
        if (used > MAX_FILE_BYTES)
          return unavailable(file, "workflow exceeds the 1 MiB file limit");
        total += used;
        if (total > MAX_TOTAL_BYTES)
          return unavailable(
            file,
            "workflow scan exceeds the 8 MiB total limit"
          );
        source = buffer.subarray(0, used);
      } finally {
        await handle.close();
      }
      const document = object(loadYaml(source.toString("utf8")));
      if (!document)
        return unavailable(file, "workflow YAML root is not a mapping");
      records.push({ file, name, document });
    } catch (error) {
      return unavailable(
        file,
        `workflow is unreadable or malformed (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
  return records;
};

/**
 * Discover every bypass-bearing guard caller reachable from repository events.
 * @param projectRoot - Project root whose workflow tree is inspected
 * @returns Deterministic callers, or an explicit unavailable refusal
 */
export async function scanNightlyE2eGuardCallers(
  projectRoot: string
): Promise<NightlyGuardScanResult> {
  const loaded = await readWorkflows(projectRoot);
  if (isScanResult(loaded)) return loaded;
  const byName = new Map(loaded.map(record => [record.name, record]));
  const callers: NightlyGuardCaller[] = [];
  const visited = new Set<string>();
  const walk = (
    record: WorkflowRecord,
    depth: number,
    stack: readonly string[]
  ): NightlyGuardScanFailure | undefined => {
    if (stack.includes(record.name))
      return {
        workflow: record.file,
        reason: `reachable local workflow cycle: ${[...stack, record.name].join(" -> ")}`,
      };
    if (visited.has(record.name)) return undefined;
    const jobs = object(record.document.jobs) ?? {};
    visited.add(record.name);
    for (const jobId of ordered(Object.keys(jobs))) {
      const job = object(jobs[jobId]);
      if (!job) continue;
      const official = officialCaller(record, jobId, job);
      const direct = official ?? directCaller(record, jobId, job);
      if (direct && "reason" in direct) return direct;
      if (direct) callers.push(direct);
      const uses = text(job.uses);
      if (uses.startsWith("./")) {
        const local = LOCAL.exec(uses)?.[1];
        if (!local)
          return {
            workflow: record.file,
            reason: `${jobId}: local reusable path is unsupported or escapes .github/workflows`,
          };
        const child = byName.get(local);
        if (!child)
          return {
            workflow: record.file,
            reason: `${jobId}: local reusable ${local} is missing or unresolved`,
          };
        if (depth >= MAX_LOCAL_DEPTH)
          return {
            workflow: record.file,
            reason: `reachable local workflow depth exceeds ${MAX_LOCAL_DEPTH}`,
          };
        const failure = walk(child, depth + 1, [...stack, record.name]);
        if (failure) return failure;
      }
      if (callers.length > MAX_NIGHTLY_GUARD_CALLERS)
        return {
          workflow: record.file,
          reason: `bypass caller limit ${MAX_NIGHTLY_GUARD_CALLERS} exceeded`,
        };
      if (
        new Set(callers.map(caller => caller.target)).size >
        MAX_NIGHTLY_GUARD_TARGETS
      )
        return {
          workflow: record.file,
          reason: `guard target limit ${MAX_NIGHTLY_GUARD_TARGETS} exceeded`,
        };
    }
    return undefined;
  };
  for (const root of loaded.filter(isRoot)) {
    const failure = walk(root, 0, []);
    if (failure) return { state: "unavailable", failures: [failure] };
  }
  callers.sort((left, right) => {
    const leftKey = `${left.workflow}#${left.job}`;
    const rightKey = `${right.workflow}#${right.job}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return { state: "ok", callers };
}
/* eslint-enable functional/immutable-data, functional/no-let, max-lines, max-lines-per-function, sonarjs/cognitive-complexity -- restore repository defaults */
