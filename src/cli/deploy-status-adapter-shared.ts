/**
 * Leaf contract module for the deploy-status-sync tracker adapters: the
 * adapter interface, injectable-deps shape, and the executor/label helpers
 * shared by the vendor transports. Import-graph leaf by design — the vendor
 * adapters and the factory (`deploy-status-adapter.ts`) both import FROM
 * here one-way, so the factory can import the vendors without a cycle
 * (import/no-cycle). The factory re-exports this surface, so downstream
 * importers (engine, cmd, refs, tests) are unaffected.
 * @module cli/deploy-status-adapter-shared
 */
import { runKaneCommand } from "../core/kane-cli-process.js";
import type { TrackerItemState } from "../core/deploy-status-transition.js";
import { getProcessEnv } from "./update-check.js";

/** Result of a managed-comment upsert. */
export type CommentUpsertResult = "created" | "updated" | "unchanged";

/** Vendor adapter: dumb fetch/mutate over one tracker. */
export interface TrackerAdapter {
  /** Fetch the vendor-neutral state snapshot for one item. */
  readonly fetchItemState: (ref: string) => Promise<TrackerItemState>;
  /** Move the item to the given config-sourced done status. */
  readonly transitionToDone: (ref: string, doneStatus: string) => Promise<void>;
  /** Find-or-update the single marker-managed comment on the item. */
  readonly upsertManagedComment: (
    ref: string,
    body: string
  ) => Promise<CommentUpsertResult>;
  /** Close the item natively (terminal rung only; may be a vendor no-op). */
  readonly closeNatively: (ref: string) => Promise<void>;
}

/** Executes `gh` without a shell and returns stdout. */
export type ExecGh = (args: readonly string[]) => Promise<string>;

/** Injectable collaborators for the tracker-adapter factory. */
export interface TrackerAdapterDeps {
  /** gh executor (defaults to the runner from {@link createExecGh}) */
  readonly execGh?: ExecGh;
  /** Fetch implementation for Linear/Jira (defaults to global fetch) */
  readonly fetchImpl?: typeof fetch;
  /** Environment for credential sourcing (defaults to the process env) */
  readonly env?: Record<string, string | undefined>;
  /** Secret reader for the darwin keychain fallback */
  readonly readSecret?: (
    service: string,
    account: string
  ) => Promise<string | undefined>;
}

/**
 * Build a fixed-argv executor for one executable over the shared process
 * runner (no shell; credentials never appear in argv). Shared by the gh
 * adapter transport and the ref-extraction git/gh deps.
 * @param executable - Executable name resolved on PATH
 * @param cwd - Working directory
 * @param env - Optional environment override (tests point PATH at a fake)
 * @returns Fixed-argv executor returning stdout
 */
export function createExec(
  executable: string,
  cwd: string,
  env?: NodeJS.ProcessEnv
): (args: readonly string[]) => Promise<string> {
  return async args => {
    const result = await runKaneCommand(executable, [...args], {
      cwd,
      timeoutMs: 120_000,
      env: env ?? getProcessEnv(),
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `${executable} ${args[0] ?? ""} failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
      );
    }
    return result.stdout;
  };
}

/**
 * Build a gh executor (ambient gh auth).
 * @param cwd - Working directory
 * @param env - Optional environment override (tests point PATH at a fake)
 * @returns gh executor
 */
export function createExecGh(cwd: string, env?: NodeJS.ProcessEnv): ExecGh {
  return createExec("gh", cwd, env);
}

/**
 * Derive the vendor-neutral type and current status from an item's label
 * names — shared by the label-driven adapters (GitHub, Linear). The
 * highest-rung done label wins so at-or-beyond compares conservatively.
 * @param labels - Label names on the item
 * @param doneStatuses - Ladder done vocabulary, lowest rung first
 * @returns Optional type and currentStatus fields
 */
export function deriveLabelState(
  labels: readonly string[],
  doneStatuses: readonly string[]
): { readonly type?: string; readonly currentStatus?: string } {
  const type = labels.find(name => name.toLowerCase().startsWith("type:"));
  const currentStatus = [...doneStatuses]
    .reverse()
    .find(status => labels.includes(status));
  return {
    ...(type === undefined ? {} : { type }),
    ...(currentStatus === undefined ? {} : { currentStatus }),
  };
}
