/**
 * @file ensure-required-history-secret-gate.ts
 * @description Full Rails apply declares the new required history property without changing other policies.
 * @module migrations
 */
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const PROPERTY = "introduced-history-credential-leakage";
const CONFIG = ".lisa.config.json";
/** Only the new property is owned; all other config fields survive verbatim. */
interface HistoryConfig {
  readonly gates?: Record<string, unknown>;
  readonly [key: string]: unknown;
}
/** Only a concrete single caller chain can name the required emitted check. */
interface HistoryCaller {
  readonly jobs?: Record<
    string,
    { readonly uses?: string; readonly name?: string }
  >;
}
/** Declare an authored required property only during deliberate full Rails apply. */
export class EnsureRequiredHistorySecretGateMigration implements Migration {
  readonly name = "ensure-required-history-secret-gate";
  readonly description =
    "Declare required introduced-history credential scanning for Rails pushes and shared CI";

  /**
   * Rails owns this route; other stacks may opt in without hook migration.
   * @param ctx - Actual apply context
   * @returns Whether the Rails route requires inspection
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return ctx.detectedTypes.includes("rails");
  }

  /**
   * Refuse conflicts instead of rewriting an unrelated or reviewed choice silently.
   * @param ctx - Actual full or safe install context
   * @returns Idempotent declaration result
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    if (ctx.postinstallSafe)
      return {
        name: this.name,
        action: "skipped",
        message:
          "Required history policy is withheld during dependency install. Run a full Lisa apply to review and declare the Rails route.",
      };
    const configPath = path.join(ctx.projectDir, CONFIG);
    const config = await readJsonOrNull<HistoryConfig>(configPath);
    if (config === null)
      throw new Error(
        "Rails required history scanning needs a readable .lisa.config.json. Repair project configuration and run full Lisa apply."
      );
    const gates = config.gates ?? {};
    const caller = load(
      await readFile(
        path.join(ctx.projectDir, ".github/workflows/ci.yml"),
        "utf8"
      )
    ) as HistoryCaller;
    const callers = Object.entries(caller.jobs ?? {}).filter(([, job]) =>
      /(?:^|\/)quality-rails\.yml@/u.test(job.uses ?? "")
    );
    if (callers.length !== 1)
      throw new Error(
        "Required Rails history check needs exactly one concrete quality-rails caller in ci.yml. Resolve its caller chain before full Lisa apply."
      );
    const [id, job] = callers[0] as [string, { readonly name?: string }];
    const declaration = {
      push: "required",
      "pull-request": {
        level: "required",
        caller_chain: [job.name ?? id, "History Secrets"],
      },
    };
    if (gates[PROPERTY] !== undefined) {
      if (JSON.stringify(gates[PROPERTY]) !== JSON.stringify(declaration))
        throw new Error(
          "The required introduced-history property conflicts with the managed Rails route. Review its required push/pull-request declaration and managed scanner facade before applying; other policies were preserved."
        );
      return { name: this.name, action: "noop" };
    }
    if (!ctx.dryRun)
      await writeJson(configPath, {
        ...config,
        gates: { ...gates, [PROPERTY]: declaration },
      });
    return {
      name: this.name,
      action: "applied",
      changedFiles: [CONFIG],
      message:
        "Declared required introduced-history scanning at push and pull-request; existing gate policies were preserved.",
    };
  }
}
