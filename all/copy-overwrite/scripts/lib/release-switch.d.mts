// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** The effective `release.*` setting for a project. */
export interface ReleaseSetting {
  readonly liveUsers: boolean;
  readonly liveUsersSource: "declared" | "default" | "invalid";
  readonly mechanism: string;
  readonly mechanismSource: "declared" | "default";
  readonly guide: string | null;
  readonly problems: readonly string[];
}
/** A parsed `## Release Switch` declaration. */
export type ReleaseDeclaration =
  | { readonly mode: "live" }
  | {
      readonly mode: "off";
      readonly switchName: string;
      readonly removedBy: string;
    }
  | { readonly mode: "invalid"; readonly problems: readonly string[] };
/** A gate S22 result. */
export interface ReleaseCheck {
  readonly verdict: "PASS" | "FAIL" | "N/A";
  readonly lines: readonly string[];
}
/** Heading of the work-item section that carries the declaration. */
export declare const RELEASE_SWITCH_HEADING: string;
/** Decision class a project lists in `humanGate.humanOnly` to reserve the production turn-on for a person. */
export declare const RELEASE_DECISION_CLASS: string;
/** Mechanism used when a project names none. */
export declare const FALLBACK_MECHANISM: string;
/** The exact text of the live declaration. */
export declare const LIVE_DECLARATION: string;
/** A switch-removal owner written as the item itself. */
export declare const THIS_ITEM: string;
/** Input this module cannot act on. */
export declare class ReleaseSwitchError extends Error {}
/** The project's Lisa config with `.lisa.config.local.json` layered on top. */
export function readProjectConfig(cwd: string): unknown;
/** Who turns a finished, switched-off feature on in production. */
export function turnOnOwner(config?: unknown): "agent" | "human";
/** Problems with `humanGate.humanOnly` that affect the production turn-on. */
export function turnOnProblems(config?: unknown): string[];
/** Every problem with how a project set this rule up. */
export function setupProblems(config?: unknown): string[];
/** Resolve `release.*` from an effective project config. */
export function resolveReleaseSetting(config?: unknown): ReleaseSetting;
/** Whether an item changes runtime behavior, from its stored declaration. */
export function runtimeScope(body: string): "runtime" | "none" | "underivable";
/** Parse an item's `## Release Switch` declaration; `null` when absent. */
export function parseDeclaration(body: string): ReleaseDeclaration | null;
/** Gate S22: does this item say how it is safe to promote? */
export function checkDeclaration(
  body: string,
  setting: { readonly liveUsers: boolean },
  options?: { readonly existing?: boolean }
): ReleaseCheck;
/** Render the `## Release Switch` section. */
export function renderDeclaration(input: {
  readonly mode?: string;
  readonly switchName?: string;
  readonly removedBy?: string;
}): string;
/** Put a rendered declaration into a body, replacing the one that is there. */
export function upsertDeclaration(body: string, section: string): string;
/** The switch this item must remove before it can finish, if any. */
export function removalObligation(
  body: string,
  ref?: string
): { readonly switchName: string } | null;
/** Tracked files that still reference a switch. */
export function switchReferences(
  switchName: string,
  options?: {
    readonly cwd?: string;
    readonly revision?: string;
    readonly run?: (args: readonly string[], cwd: string) => string;
  }
): string[];
/** The branch that deploys to production, from `deploy.branches`. */
export function productionBranch(config?: unknown): string | null;
/** The notice for a production deployment in a project without live users. */
export function productionNotice(config: unknown, base: string): string | null;
