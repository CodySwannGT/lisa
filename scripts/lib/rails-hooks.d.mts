export interface RailsHooksOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
}
export interface RailsHookInspection {
  readonly status: "pass" | "fail";
  readonly drift: readonly string[];
  readonly directory?: string;
}
export declare const RAILS_HOOK_INSTALL_COMMAND: "bundle exec lefthook install";
export declare const RAILS_HOOK_ENGINE_FILES: readonly [
  "rails-hooks.mjs",
  "rails-hooks-inspection.mjs",
  "rails-hooks-command.mjs",
];
export declare function inspectRailsHooks(
  projectRoot: string,
  options?: RailsHooksOptions
): Promise<RailsHookInspection>;
export declare function ensureRailsHooks(
  projectRoot: string,
  options?: RailsHooksOptions
): Promise<{
  readonly status:
    | "not-applicable"
    | "already-installed"
    | "installed"
    | "failed";
  readonly detail?: string;
}>;
