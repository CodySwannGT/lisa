/**
 * The one door through which `lisa doctor` may declare a gate on a project's
 * behalf.
 *
 * ## Why this exists
 *
 * Measured 2026-08-20 on a repository upgrading to 3.46.3. `lisa doctor`
 * declared `gates.traceability: {"pull-request": "required"}`, that gate
 * resolves to the package script `check:work-item`, and Lisa shipped that
 * script to no template. The next CI run failed with `Missing script`. A
 * pipeline that was green before the operator ran doctor was red after — caused
 * by the tool they ran to avoid exactly that.
 *
 * The failure mode is asymmetric, which is why it survived a long time. A
 * project that already defines the script sees nothing wrong and never reports
 * it. Only a project lacking it discovers the defect, and it discovers it as a
 * red build mid-upgrade — the worst possible moment to be handed a broken
 * recommendation.
 *
 * ## What the guard is
 *
 * Doctor may not recommend a gate whose task it cannot verify resolves. Not
 * "the traceability gate": ANY gate. Shipping the missing script line fixes one
 * gate once; this fixes the class, so the next gate added to doctor's
 * recommendations cannot reintroduce it.
 *
 * ## Why the guard lives in the write path, not beside it
 *
 * A helper a caller is supposed to consult is a convention, and conventions
 * drift. {@link declareGate} performs the verification AND the write, so a
 * future doctor check that declares a gate gets the guard whether or not its
 * author knew the guard existed. A check that wants to bypass it has to
 * hand-roll a `writeFile`, which is visible in review.
 *
 * ## Turning a gate OFF is exempt
 *
 * A gate declared `off` runs nothing, so there is no task to resolve and no
 * pipeline to redden. The `skip_jobs` migration check emits exactly these, and
 * blocking them would stop a safe migration for no benefit.
 * @module cli/doctor-gate-recommendation
 */
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { importGateRegistry } from "./gate-registry-source.js";

/** The level at which a gate runs nothing, and so needs no task. */
const OFF = "off";

/** The subset of `.lisa.config.json` a gate declaration touches. */
export interface GateConfig {
  readonly gates?: Record<string, unknown>;
}

/** One registry entry, reduced to what deciding a recommendation needs. */
interface RegistryGate {
  readonly task?: string | null;
  readonly taskAt?: Record<string, string>;
}

/** The slice of the shipped registry this module reads. */
export interface GateTaskRegistry {
  readonly REGISTRY: Record<string, RegistryGate | undefined>;
}

/** Whether a gate may be recommended, and why not when it may not. */
export type GateRecommendation =
  | { readonly recommend: true; readonly task: string | null }
  | {
      readonly recommend: false;
      readonly task: string | null;
      readonly reason: string;
    };

/** The result of asking for a gate to be declared. */
export type GateDeclaration =
  | { readonly outcome: "declared"; readonly task: string | null }
  | {
      readonly outcome: "declined";
      readonly task: string | null;
      readonly reason: string;
    };

/** What a caller must say to have a gate declared. */
export interface GateDeclarationRequest {
  /** Project root holding `.lisa.config.json` and `package.json`. */
  readonly targetPath: string;
  /** The already-parsed `.lisa.config.json`. */
  readonly config: GateConfig;
  /** Gate id as the shipped registry spells it. */
  readonly gateId: string;
  /** The moment the gate would be declared at. */
  readonly moment: string;
  /** The level it would be declared at. */
  readonly level: string;
  /** Registry loader; injected by tests, never in production. */
  readonly loadRegistry?: () => Promise<GateTaskRegistry | null>;
}

/**
 * The declaration a gate id already carries, when it carries a usable one.
 *
 * A per-gate value must be an object — `lisa-gates.mjs` rejects anything else
 * as `gates."<id>" must be an object`. Spreading a malformed one would be
 * worse than replacing it: a string spreads into character-indexed keys, and
 * an array into numeric ones, neither of which any moment reads.
 * @param declaration - Whatever the config holds under that gate id
 * @returns The existing keys to preserve, or nothing when there are none
 */
function existingMoments(declaration: unknown): Record<string, unknown> {
  return typeof declaration === "object" &&
    declaration !== null &&
    !Array.isArray(declaration)
    ? (declaration as Record<string, unknown>)
    : {};
}

/**
 * Add one gate to a config without touching anything else.
 *
 * A gate is declared per MOMENT, and doctor declares one moment per call — so
 * the per-gate object is merged into, never replaced. Replacing it drops a
 * moment the project already declared while leaving the gate id in place, so
 * the config still reads as configured and the moment that stopped running is
 * invisible until something ships past it. The same goes for the gate-level
 * `run` override, a sibling of the moment keys rather than a moment: losing it
 * silently reverts the gate to its registry default task, which is a different
 * check than the project asked for.
 *
 * Returns a new object rather than mutating, so a caller that decides not to
 * write still holds the original.
 * @param config - Parsed `.lisa.config.json`
 * @param gateId - Gate id to declare
 * @param moment - Moment to declare it at
 * @param level - Level to declare it at
 * @returns A copy declaring the gate
 */
export function withGate<T extends GateConfig>(
  config: T,
  gateId: string,
  moment: string,
  level: string
): T {
  return {
    ...config,
    gates: {
      ...config.gates,
      [gateId]: {
        ...existingMoments(config.gates?.[gateId]),
        [moment]: level,
      },
    },
  };
}

/**
 * The task a gate resolves to at one moment, per the shipped registry.
 *
 * A gate may name a different prover per moment — traceability proves the
 * pull-request moment with `validate-pr` and the push moment with
 * `validate-push` — so the moment is part of the question, not a detail.
 * @param gate - The registry entry
 * @param moment - The moment being declared
 * @returns The task name, or null when the registry names none
 */
export function taskForMoment(
  gate: RegistryGate,
  moment: string
): string | null {
  return gate.taskAt?.[moment] ?? gate.task ?? null;
}

/**
 * Read a project's package scripts.
 * @param targetPath - Project root
 * @returns The scripts block, or null when there is no readable manifest
 */
async function readScripts(
  targetPath: string
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(targetPath, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return parsed.scripts ?? {};
  } catch {
    return null;
  }
}

/**
 * Whether the gate's task exists in the project as something runnable.
 * @param targetPath - Project root
 * @param task - Task name the gate resolves to
 * @returns A recommendation, declining with an operator-readable reason
 */
async function taskResolves(
  targetPath: string,
  task: string
): Promise<GateRecommendation> {
  const scripts = await readScripts(targetPath);
  if (scripts === null) {
    return {
      recommend: false,
      task,
      reason:
        `this project has no readable package.json, so Lisa cannot see ` +
        `whether the \`${task}\` task it needs would run.`,
    };
  }
  const command = scripts[task];
  if (typeof command !== "string" || command.trim() === "") {
    return {
      recommend: false,
      task,
      reason:
        `this project defines no \`${task}\` script, so the gate's check ` +
        `would fail with "Missing script" on the next build. Run ` +
        `\`npx lisa apply .\` to install it (or add the script yourself), ` +
        `then run \`lisa doctor\` again.`,
    };
  }
  return { recommend: true, task };
}

/**
 * Decide whether doctor may recommend a gate.
 *
 * Every decline is a decline: when Lisa cannot READ the registry it does not
 * assume the gate is fine. An unverifiable recommendation and a
 * known-bad recommendation cost a consumer the same red build.
 * @param request - The gate, moment, level, and project being considered
 * @returns Whether the gate may be recommended, and why not when it may not
 */
export async function canRecommendGate(
  request: GateDeclarationRequest
): Promise<GateRecommendation> {
  const registry = await (
    request.loadRegistry ?? (() => importGateRegistry<GateTaskRegistry>())
  )();
  if (registry === null) {
    return {
      recommend: false,
      task: null,
      reason:
        `Lisa could not read its own gate registry, so it cannot tell what ` +
        `the \`${request.gateId}\` gate would run.`,
    };
  }

  const gate = registry.REGISTRY[request.gateId];
  if (gate === undefined) {
    return {
      recommend: false,
      task: null,
      reason: `\`${request.gateId}\` is not a gate this version of Lisa knows.`,
    };
  }

  const task = taskForMoment(gate, request.moment);
  if (request.level === OFF) {
    // Off runs nothing. There is no command to be missing.
    return { recommend: true, task };
  }
  if (task === null) {
    return {
      recommend: false,
      task: null,
      reason:
        `the \`${request.gateId}\` gate names no task at the ` +
        `\`${request.moment}\` moment, so Lisa cannot prove it would run.`,
    };
  }

  return taskResolves(request.targetPath, task);
}

/**
 * Declare a gate in `.lisa.config.json` — but only when its task resolves.
 *
 * The verification and the write are one call on purpose. See the module note:
 * a guard that a caller must remember to invoke is a guard that a future caller
 * forgets.
 * @param request - The gate, moment, level, and project being declared
 * @returns Whether the declaration was written, and why not when it was not
 */
export async function declareGate(
  request: GateDeclarationRequest
): Promise<GateDeclaration> {
  const verdict = await canRecommendGate(request);
  if (!verdict.recommend) {
    return {
      outcome: "declined",
      task: verdict.task,
      reason: verdict.reason,
    };
  }

  // Two-space indent and a trailing newline: the convention every Lisa-written
  // JSON in a host project uses, so the repair does not show up as a whole-file
  // reformat in the diff that carries it.
  const next = withGate(
    request.config,
    request.gateId,
    request.moment,
    request.level
  );
  await writeFile(
    path.join(request.targetPath, ".lisa.config.json"),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf-8"
  );

  return { outcome: "declared", task: verdict.task };
}
