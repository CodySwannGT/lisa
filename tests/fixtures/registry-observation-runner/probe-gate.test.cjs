const assert = require("node:assert/strict");
const { test } = require("node:test");
const { existsSync, readFileSync } = require("node:fs");

test("gate executes with the installed registry available", () => {
  assert.ok(
    existsSync(
      "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs"
    )
  );
  assert.equal(
    JSON.parse(readFileSync("node_modules/@codyswann/lisa/package.json"))
      .version,
    "4.60.9"
  );
  console.log("REGISTRY_OBSERVATION_GATE_EXECUTED");
});
