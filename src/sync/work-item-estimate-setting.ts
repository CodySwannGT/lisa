/**
 * The `workItem.estimate` synced setting (CodySwannGT/lisa#4954): every work
 * item carries a token estimate and recommended model, required by default.
 *
 * Its default and validator come from the shipped estimate module so the
 * value `lisa sync` writes and the value `scripts/lisa-estimate.mjs` reads
 * cannot drift. Semantics are documented in the work-item-definition-of-ready
 * reference (gate S21) and the lisa-usage-accounting estimate reference.
 * @module sync/work-item-estimate-setting
 */
import {
  DEFAULT_WORK_ITEM_ESTIMATE,
  validateEstimateConfig,
} from "../../all/copy-overwrite/scripts/lib/work-item-estimate-config.mjs";
import type { JsonValue } from "./json-path.js";
import type { SyncedSetting } from "./registry.js";

export const WORK_ITEM_ESTIMATE_SYNCED_SETTING: SyncedSetting = {
  key: "workItem.estimate",
  defaultValue: {
    required: DEFAULT_WORK_ITEM_ESTIMATE.required,
    models: [...DEFAULT_WORK_ITEM_ESTIMATE.models],
  },
  validate: value => {
    validateEstimateConfig(value);
    return value as JsonValue;
  },
  description:
    "Work-item token estimate: required or not, and allowed recommended models",
};
