/** Credential trust keys must never normalize an invalid explicit port away. */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const PARSER = path.resolve(
  "plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py"
);
const JIRA_ORIGIN = "https://jira.example";

describe("jira journey server origin", () => {
  it("rejects port zero while preserving valid HTTPS origins", () => {
    const program = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('parse_plan', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "print(json.dumps([module.server_origin(value) for value in sys.argv[2:]]))",
    ].join("; ");
    const result = boundedSpawnSync({
      args: [
        "-c",
        program,
        PARSER,
        "https://jira.example:0",
        JIRA_ORIGIN,
        "https://jira.example:443",
        "https://jira.example:8443",
      ],
      command: "python3",
      label: "parse Jira server origins",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      "",
      JIRA_ORIGIN,
      JIRA_ORIGIN,
      "https://jira.example:8443",
    ]);
  });
});
