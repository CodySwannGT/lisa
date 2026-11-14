// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** What a TypeScript project gets when it does not say. */
export declare const TYPESCRIPT_PUSH_GATE_DEFAULTS: Readonly<{
  cache: true;
  admission: true;
  affectedTests: true;
  affectedCoverage: "changed-files";
}>;
export declare function isTypeScriptProject(root: string): boolean;
export declare function pushGateDefaultsFor(
  root: string
): Readonly<Record<string, unknown>>;
export declare function withPushGateDefaults<
  T extends Readonly<Record<string, unknown>>,
>(
  config: T | null | undefined,
  root: string
): T & { readonly pushGate?: unknown };
