/** Neither canonical writer may migrate an unsupported input schema. */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { cli, makeHistory } from "./bdd/projection-merge-support.js";
import { treeSnapshot } from "./bdd/projection-safety-support.js";
import { MAP_REL } from "./bdd/support.js";

useIoLatencyBudget();

describe("BDD canonical writer input admission", () => {
  it.each(["check-bdd-coverage.mjs", "bdd-matrix.mjs"])(
    "%s refuses an unsupported map schema before changing owned reports",
    script => {
      const { root, base } = makeHistory(true);
      const file = path.join(root, MAP_REL);
      const contract = JSON.parse(fs.readFileSync(file, "utf8"));
      contract.schemaVersion = 999;
      contract.mappings[0].evidence = "an unavailable proof";
      fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
      const before = treeSnapshot(root);
      const result = cli(root, base, script, ["--write"]);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("config-schema");
      expect(treeSnapshot(root)).toEqual(before);
    }
  );
});
