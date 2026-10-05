// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file history-secret-policy.mjs
 * @description Resolve only this owned facade without changing unrelated declarations.
 * @module history-secrets
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readGates, projectScripts, resolveMoment } from "../lisa-gates.mjs";
import { HistorySecretError } from "./history-secret-git.mjs";
export const HISTORY_PROPERTY = "introduced-history-credential-leakage";
/** Unknown or malformed manifests cannot manufacture a required facade pass. */
export const historyPolicy = (cwd, moment) => {
  try {
    if (existsSync(join(cwd, "package.json")))
      JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const { gates, runner } = readGates(cwd);
    const policy = resolveMoment({
      gates,
      runner,
      scripts: projectScripts(cwd),
      moment,
      includeOff: true,
    }).find(entry => entry.id === HISTORY_PROPERTY);
    if (!policy || policy.level === "off") return null;
    if (policy.level !== "required" || policy.mode !== "builtin")
      throw new HistorySecretError(
        "The authored required history route is incompatible. Run full Lisa apply and review its required managed facade declaration."
      );
    return policy;
  } catch (error) {
    if (error instanceof HistorySecretError) throw error;
    throw new HistorySecretError(
      "Required history policy could not be resolved. Repair project JSON and run full Lisa apply; raw configuration errors are withheld."
    );
  }
};
