/**
 * Tier 1 — what the shipped ruleset templates require, read offline.
 *
 * The declaration-versus-live half of this comparison needs the network and
 * degrades to `unknown`; this half needs nothing but the Lisa package and the
 * project's settings file, so it answers in a repository with no credentials,
 * no `gh`, and no network at all. That matters because the template is what a
 * repository's protection is provisioned FROM: a declaration that disagrees
 * with the template is drift the moment anyone runs the provisioner, whether or
 * not the live ruleset has caught up yet.
 *
 * Every failure lands on `unknown` carrying a reason. In particular an empty
 * template set is `unknown`, never an empty pass: a comparison against nothing
 * would report every declaration as enforcing nothing, which is a false claim
 * rather than a missing one.
 * @module cli/gate-report-templates
 */
import { readFile, realpath } from "node:fs/promises";
import * as path from "node:path";

import type { EnforcedContext } from "../core/gate-declaration-drift.js";
import { expectedRequiredContexts } from "../health/ruleset-inspection.js";
import { detectHealthProjectTypes } from "../health/template-inspection.js";
import { resolveLisaPackageRoot } from "./gate-report-registry.js";
import type { Finding } from "./gate-report-types.js";

/** Reads the contexts the shipped templates require. Injectable for tests. */
export type TemplateEnforcementReader = (
  projectRoot: string
) => Promise<readonly EnforcedContext[]>;

/**
 * Read `.lisa.config.json` as a plain record.
 *
 * The whole file rather than only its `gates` block, because the per-repo
 * `github.rulesets.requiredChecks` and `dropRequiredChecks` opt-ins change
 * which contexts a template actually ends up requiring.
 * @param projectRoot - Project root
 * @returns The parsed object, or null when it could not be read
 */
async function readRawConfig(
  projectRoot: string
): Promise<Record<string, unknown> | null> {
  const source = await readFile(
    path.join(projectRoot, ".lisa.config.json"),
    "utf8"
  ).catch(() => undefined);
  if (source === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The default reader: the shipped templates, normalized as apply normalizes.
 * @param projectRoot - Project root
 * @returns The contexts the templates require
 */
export const defaultTemplateEnforcementReader: TemplateEnforcementReader =
  async projectRoot => {
    const lisaRoot = resolveLisaPackageRoot();
    if (lisaRoot === null) throw new Error("LISA_PACKAGE_NOT_FOUND");
    // The health readers confine every read to a CANONICAL root and reject a
    // path that resolves outside it. A caller-supplied root that is merely
    // absolute — a symlinked temporary directory, a checkout reached through
    // one — resolves elsewhere and is refused, so it is canonicalized here
    // rather than at each of the reads it is threaded through.
    const canonical = await realpath(projectRoot).catch(() => projectRoot);
    const config = await readRawConfig(canonical);
    if (config === null) throw new Error("CONFIG_UNREADABLE");
    return await expectedRequiredContexts(
      lisaRoot,
      canonical,
      await detectHealthProjectTypes(canonical),
      config
    );
  };

/** Why a template read failed, in words an operator can act on. */
const REASONS: Readonly<Record<string, { reason: string; message: string }>> = {
  LISA_PACKAGE_NOT_FOUND: {
    reason: "lisa-package-not-found",
    message:
      "The running Lisa package could not be located, so the ruleset templates were not read. Nothing here claims a declaration does or does not match the protection it will be provisioned into.",
  },
  CONFIG_UNREADABLE: {
    reason: "config-unreadable",
    message:
      ".lisa.config.json could not be read, so the per-repo required-check opt-ins that change what a template requires are unknown. The comparison was not made.",
  },
};

/**
 * Read the templates, degrading to `unknown` and never to a pass.
 * @param options - Inputs
 * @param options.projectRoot - Project root
 * @param options.read - Injectable reader, so tests never touch the package
 * @returns The contexts, or an honest unknown
 */
export async function readTemplateEnforcement(options: {
  projectRoot: string;
  read?: TemplateEnforcementReader;
}): Promise<Finding<readonly EnforcedContext[]>> {
  const read = options.read ?? defaultTemplateEnforcementReader;
  try {
    const value = await read(options.projectRoot);
    if (value.length === 0) {
      return {
        state: "unknown",
        reason: "templates-not-found",
        message:
          "No shipped ruleset template named a required status check for this project, so there is nothing to hold the declarations against. An empty template set is reported as unread rather than as a project whose merges are blocked on nothing.",
      };
    }
    return { state: "verified", value };
  } catch (error) {
    const key = error instanceof Error ? error.message : String(error);
    return {
      state: "unknown",
      ...(REASONS[key] ?? {
        reason: "templates-unreadable",
        message:
          "Reading the shipped ruleset templates failed, so what the protection they provision would require is unknown for this run.",
      }),
    };
  }
}
