/**
 * The OpenCode plugin catalog — which Lisa-shipped `.opencode/plugin/lisa-*.ts`
 * templates ship, and for which project types.
 *
 * Extracted from `hooks-installer.ts` so the closed registry stays one
 * auditable list that can grow without pushing the installer past its
 * line budget. The installer consumes it; nothing else should.
 * @module opencode/plugin-catalog
 */
import type { ProjectType } from "../core/config.js";

/** One Lisa-shipped OpenCode plugin template. */
export interface PluginCatalogEntry {
  /** Stable identifier (also the basename without the `lisa-`/`.ts`) */
  readonly id: string;
  /** Template filename in `plugin-templates/` and the dest filename verbatim */
  readonly templateFilename: string;
  /** Project types this plugin ships for. `["*"]` ships for every stack. */
  readonly forProjectTypes: readonly (ProjectType | "*")[];
}

/**
 * Plugin catalog — the OpenCode counterpart of the Codex HOOK_CATALOG. Adding a
 * plugin? Drop a template in `plugin-templates/`, add an entry here, add tests.
 */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  {
    id: "parity-safety-net",
    templateFilename: "lisa-parity-safety-net.ts",
    forProjectTypes: ["*"],
  },
  {
    id: "block-no-verify",
    templateFilename: "lisa-block-no-verify.ts",
    forProjectTypes: ["*"],
  },
  {
    id: "session-bootstrap",
    templateFilename: "lisa-session-bootstrap.ts",
    forProjectTypes: ["*"],
  },
  {
    id: "block-instruction-file-edits",
    templateFilename: "lisa-block-instruction-file-edits.ts",
    forProjectTypes: ["*"],
  },
  {
    id: "block-managed-file-edits",
    templateFilename: "lisa-block-managed-file-edits.ts",
    forProjectTypes: ["*"],
  },
  {
    id: "block-direct-issue-create",
    templateFilename: "lisa-block-direct-issue-create.ts",
    forProjectTypes: ["*"],
  },
  {
    id: "block-suppress-directives",
    templateFilename: "lisa-block-suppress-directives.ts",
    forProjectTypes: ["typescript"],
  },
  {
    id: "lint-on-edit",
    templateFilename: "lisa-lint-on-edit.ts",
    forProjectTypes: ["typescript"],
  },
  {
    id: "sg-scan-on-edit",
    templateFilename: "lisa-sg-scan-on-edit.ts",
    forProjectTypes: ["typescript", "rails"],
  },
  {
    id: "block-migration-edits",
    templateFilename: "lisa-block-migration-edits.ts",
    forProjectTypes: ["nestjs"],
  },
  {
    id: "rubocop-on-edit",
    templateFilename: "lisa-rubocop-on-edit.ts",
    forProjectTypes: ["rails"],
  },
];
