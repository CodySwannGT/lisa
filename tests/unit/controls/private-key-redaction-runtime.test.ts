/** Both executables redact ordinary and large private-key blocks. */
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { FAKE_CREDENTIALS } from "../../helpers/fake-credentials.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REDACTOR = pathToFileURL(
  path.resolve("all/copy-overwrite/scripts/lib/private-key-redaction.mjs")
).href;
const CODE = [
  'import { readFileSync } from "node:fs";',
  `import { redactPrivateKeyBlocks } from ${JSON.stringify(REDACTOR)};`,
  'import { createHash } from "node:crypto";',
  'const output = redactPrivateKeyBlocks(readFileSync(0, "utf8"));',
  'process.stdout.write(createHash("sha256").update(output).digest("hex"));',
].join("\n");

describe("private-key redaction in local runners", () => {
  it.each([
    ["Node", process.execPath],
    ["Bun", "bun"],
  ])(
    "redacts the complete body of each consecutive block under %s",
    (_runtime, program) => {
      const fixture = FAKE_CREDENTIALS.find(
        value => value.kind === "PRIVATE_KEY"
      );
      if (fixture === undefined) throw new Error("Missing private-key fixture");
      const key = fixture.make();
      const [opening] = key.split("\n");
      const payload = "fixtureKeyBodyLine\n".repeat(131_072);
      const largeKey = `${opening}\n${payload}${key.slice((opening?.length ?? 0) + 1)}`;
      const placeholder = "[REDACTED:PRIVATE_KEY]";
      const result = boundedSpawnSync({
        label: "redact complete private-key blocks with a large generated body",
        command: program,
        args: ["--input-type=module", "--eval", CODE],
        input: `Start\n${largeKey}\nBetween\n${key}\nEnd\n`,
        baseMs: 5_000,
      });

      const expected = createHash("sha256")
        .update(`Start\n${placeholder}\nBetween\n${placeholder}\nEnd\n`)
        .digest("hex");
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(expected);
    }
  );

  it("removes the visible body of an unfinished block and preserves later prose", () => {
    const opening = FAKE_CREDENTIALS.find(value => value.kind === "PRIVATE_KEY")
      ?.make()
      .split("\n")[0];
    if (opening === undefined) throw new Error("Missing private-key fixture");
    const data = Buffer.from("synthetic fixture bytes").toString("base64");
    const result = boundedSpawnSync({
      label: "redact a partial key while preserving prose",
      command: process.execPath,
      args: ["--input-type=module", "--eval", CODE],
      input: `Fixture output\n${opening}\n${data}\nOther fixture output.\n`,
    });

    const expected = createHash("sha256")
      .update("Fixture output\n[REDACTED:PRIVATE_KEY]\nOther fixture output.\n")
      .digest("hex");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
  });
});
