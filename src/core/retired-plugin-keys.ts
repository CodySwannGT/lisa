/**
 * Plugin keys Lisa itself once wrote into hosts' `.claude/settings.json` and
 * later renamed.
 *
 * The exact keys are read from git history, never matched by pattern:
 * - `74981f5be1` (2026-03-01, #215) added `typescript@lisa`, `cdk@lisa`,
 *   `expo@lisa` and `nestjs@lisa` to the stacks' `merge/.claude/settings.json`;
 * - `ad53b79a52` (2026-03-02) added `rails@lisa` the same way;
 * - `9c3d871316` (2026-03-05) renamed all five to `lisa-<type>@lisa`.
 *
 * The merge strategy only adds keys, so hosts that applied Lisa in that window
 * still carry the old names. They name no plugin in the Lisa marketplace, so
 * every install attempt fails (CodySwannGT/lisa#4645).
 * @module core/retired-plugin-keys
 */
import type { ProjectType } from "./config.js";

/** One retired key's replacement and the stack type both belong to. */
export interface RetiredPluginKey {
  readonly successor: string;
  readonly type: ProjectType;
}

/** Retired key → its `lisa-<type>@lisa` successor and stack type. */
export const RETIRED_STACK_PLUGIN_KEYS: ReadonlyMap<string, RetiredPluginKey> =
  new Map<string, RetiredPluginKey>([
    [
      "typescript@lisa",
      { successor: "lisa-typescript@lisa", type: "typescript" },
    ],
    ["cdk@lisa", { successor: "lisa-cdk@lisa", type: "cdk" }],
    ["expo@lisa", { successor: "lisa-expo@lisa", type: "expo" }],
    ["nestjs@lisa", { successor: "lisa-nestjs@lisa", type: "nestjs" }],
    ["rails@lisa", { successor: "lisa-rails@lisa", type: "rails" }],
  ]);
