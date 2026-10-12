/** Exact shipped Rails inline qualification stays graph-bound; arbitrary eval gains no route. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { hookEntry } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs";

const cwd = resolve("tmp/owned-hook-entry-fixture");
const entry = join(cwd, "scripts/lisa-rails-prepush.mjs");
const context = { graph: { [entry]: "authenticated-helper-digest" } };
const loader = "--input-type=module";
const previousInline =
  'try { const { main } = await import("./scripts/lisa-rails-prepush.mjs"); process.exitCode = await main(process.argv.slice(1)); } catch { console.error("Managed Rails push tooling is unavailable or damaged. Run full Lisa apply and retry; raw bootstrap errors are withheld."); process.exitCode = 1; }';

/** Read the actual source-generated shell command so a future template drift fails this contract. */
function shippedInline() {
  const config = load(
    readFileSync("rails/copy-overwrite/lefthook.yml", "utf8")
  ) as {
    "pre-push": { commands: { "rails-prepush": { run: string } } };
  };
  const command = config["pre-push"].commands["rails-prepush"].run;
  const prefix = `node ${loader} -e '`;
  const suffix = "' {1}";
  expect(command.startsWith(prefix)).toBe(true);
  expect(command.endsWith(suffix)).toBe(true);
  return command.slice(prefix.length, -suffix.length);
}

describe("exact managed Rails inline hook entry", () => {
  it("qualifies the actual shipped refusal/status wrapper against its authenticated helper", () => {
    expect(
      hookEntry(context, [loader, "-e", shippedInline(), "origin"], cwd)
    ).toBe(entry);
  });

  it("preserves the previously accepted exact bootstrap for earlier managed hosts", () => {
    expect(hookEntry(context, [loader, "-e", previousInline], cwd)).toBe(entry);
  });

  it.each(["current", "previous"])(
    "requires authenticated graph membership and the original cwd for %s inline",
    selected => {
      const inline = selected === "current" ? shippedInline() : previousInline;
      expect(hookEntry({ graph: {} }, [loader, "-e", inline], cwd)).toBeNull();
      expect(
        hookEntry(context, [loader, "-e", inline], join(cwd, "foreign"))
      ).toBeNull();
    }
  );

  it.each([
    ["prefix code", (inline: string) => `process.exitCode = 0; ${inline}`],
    ["suffix code", (inline: string) => `${inline} process.exitCode = 0;`],
    ["leading whitespace", (inline: string) => ` ${inline}`],
    ["trailing whitespace", (inline: string) => `${inline} `],
    [
      "changed import",
      (inline: string) => inline.replace("lisa-rails-prepush", "foreign"),
    ],
    [
      "changed refusal status",
      (inline: string) =>
        inline.replace("process.exitCode = rc", "process.exitCode = 0"),
    ],
  ] as const)("leaves %s eval unqualified", (_label, alter) => {
    expect(
      hookEntry(context, [loader, "-e", alter(shippedInline())], cwd)
    ).toBeNull();
  });

  it.each([
    ["--input-type=commonjs", "-e"],
    [loader, "--eval"],
    ["--import=foreign", "-e"],
  ])("leaves alternate invocation %s/%s unqualified", (first, second) => {
    expect(
      hookEntry(context, [first, second, shippedInline()], cwd)
    ).toBeNull();
  });

  it("preserves direct authenticated script classification", () => {
    expect(hookEntry(context, [entry, "origin"], cwd)).toBe(entry);
    expect(hookEntry({ graph: {} }, [entry], cwd)).toBeNull();
  });
});
