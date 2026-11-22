import { realpath } from "node:fs/promises";
import * as path from "node:path";

import { harnessIncludesAgent } from "../core/config.js";
import { loadConfigState } from "../health/deterministic-inputs.js";
import { pluginFinding } from "../health/governance-probes.js";
import {
  configuredHarness,
  readInstalledClaudePlugins,
  type InstalledPluginReader,
} from "../health/plugin-inspection.js";
import { projectPathKind } from "../health/read-only-fs.js";
import { detectHealthProjectShape } from "../health/template-inspection.js";
import type { DoctorCheck } from "./doctor.js";

const PLUGIN_REGISTRATION_CHECK_NAME = "Claude Code plugins registered here?";
const PLUGIN_LIST_TIMEOUT_MS = 15_000;

/**
 * Report whether the `@lisa` Claude Code plugins this project enables are
 * registered for THIS folder (CodySwannGT/lisa#4504).
 *
 * Dependency install deliberately registers no plugin (#4135) and its notice
 * points operators here, so doctor has to answer the question. It does so
 * through health's `pluginFinding` rather than a second implementation: one
 * definition of "registered here", one `lisa apply .` remedy.
 *
 * Quiet wherever the answer cannot be had — Claude not in the harness, no
 * `.claude/settings.json`, or no `claude` CLI to ask (CI). The CLI is asked
 * BEFORE the marker/settings comparison so a CI checkout, whose gitignored
 * marker is always absent, is skipped instead of warned about.
 *
 * Severity is `warn`, like the apply-freshness and enforcement-coverage
 * checks whose remedy is also an explicit `lisa apply`: it never changes the
 * exit code on its own.
 * @param targetPath - Project path to inspect
 * @param reader - Installed-plugin reader (`claude plugin list --json`)
 * @returns Doctor check result
 */
export async function checkPluginRegistration(
  targetPath: string,
  reader: InstalledPluginReader = readInstalledClaudePlugins
): Promise<DoctorCheck> {
  const skip = (detail: string): DoctorCheck => ({
    name: PLUGIN_REGISTRATION_CHECK_NAME,
    status: "ok",
    detail,
  });
  const root = await realpath(targetPath).catch(() => undefined);
  if (root === undefined) return skip("Project path unavailable; not checked");
  const { config } = await loadConfigState(root);
  const harness = configuredHarness(config);
  if (harness === undefined || !harnessIncludesAgent(harness, "claude")) {
    return skip("Claude Code is not in this project's harness; not checked");
  }
  if (
    (await projectPathKind(root, path.join(".claude", "settings.json"))) !==
    "file"
  ) {
    return skip("No .claude/settings.json; not checked");
  }
  const controller = new AbortController();
  const installed = await reader(
    root,
    PLUGIN_LIST_TIMEOUT_MS,
    controller.signal
  ).catch(() => undefined);
  if (installed === undefined) {
    return skip("Claude Code CLI unavailable; plugin registration not checked");
  }
  const { types } = await detectHealthProjectShape(root);
  const finding = await pluginFinding(
    root,
    config,
    types,
    async () => installed,
    PLUGIN_LIST_TIMEOUT_MS,
    controller.signal
  );
  return {
    name: PLUGIN_REGISTRATION_CHECK_NAME,
    status: finding.status === "pass" ? "ok" : "warn",
    detail: finding.reason,
  };
}
