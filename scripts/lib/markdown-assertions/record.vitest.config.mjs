/**
 * Vitest config for recording Markdown assertions (CodySwannGT/lisa#4867):
 * the project's own config plus `record-setup.mjs`, coverage off. Used only
 * by `node scripts/classify-markdown-assertions.mjs record`.
 * @module scripts/lib/markdown-assertions/record.vitest.config
 */
import path from "node:path";

import base from "../../../vitest.config.ts";

const root = path.resolve(import.meta.dirname, "../../..");

export default {
  ...base,
  root,
  test: {
    ...base.test,
    coverage: { ...base.test?.coverage, enabled: false },
    setupFiles: [
      ...(base.test?.setupFiles ?? []),
      path.join(import.meta.dirname, "record-setup.mjs"),
    ],
  },
};
