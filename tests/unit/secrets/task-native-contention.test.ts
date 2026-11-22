/** Registered-hook component controls; no historical-refusal cause attribution. */
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentionFixture,
  contendedOrdinary,
  readyAgent,
  nativeStateHashes,
} from "../../helpers/task-native-contention.js";
import { startNativeHook } from "../../helpers/task-native-contention-process.js";
const roots: string[] = [];
/** Register the existing owned fixture for terminal cleanup.
 * @returns Owned fixture and instrumentation.
 */
function fixture() {
  const f = contentionFixture();
  roots.push(f.root);
  return f;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("legitimate same-key native state contention", () => {
  it("serializes an established ordinary action after real EEXIST without resetting independent agents", async () => {
    const f = fixture(),
      r = await contendedOrdinary(f);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({ case: "ordinary-real-contention", ...r })
    );
    expect(r.initial.status).toBe(0);
    expect(r.contended).toBe("EEXIST");
    expect(r.independent.status).toBe(0);
    expect(r.independent.effects).toBe(1);
    expect(r.result.status).toBe(0);
    expect(r.result.effects).toBe(1);
    expect(r.holderExit).toBe(0);
    expect(r.after).toEqual(r.afterB);
  });
  it("denies exhausted waiting without removing the legitimate holder lock", async () => {
    const f = fixture(),
      r = await contendedOrdinary(f, true);
    expect(r.contended).toBe("EEXIST");
    expect(r.result.status).toBe(2);
    expect(r.result.effects).toBe(0);
    expect(r.heldAfter).toBe(true);
    expect(r.holderExit).toBe(0);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "contention-exhausted",
        result: r.result,
        contended: r.contended,
        heldAfter: r.heldAfter,
        holderExit: r.holderExit,
      })
    );
  });
  it.each(["missing", "wrong", "api-failure"])(
    "does not release ordinary work with %s primary",
    async mode => {
      const f = fixture(),
        event = { ...f.action(), agent_id: "A" };
      const env =
        mode === "missing"
          ? f.env
          : {
              ...f.primary,
              ...(mode === "wrong"
                ? { FIXTURE_NOTION_WRONG: "1" }
                : { FIXTURE_NOTION_UNAVAILABLE: "1" }),
            };
      const r = await startNativeHook(f, event, env).terminal;
      expect(r.status).toBe(2);
      expect(r.effects).toBe(0);
      console.info(
        "QUALIFICATION_OBSERVATION",
        JSON.stringify({ case: `contention-primary-${mode}`, result: r })
      );
    }
  );
  it("atomically consumes a completed native proof at most once across two ordinary hooks", async () => {
    const f = fixture(),
      event = readyAgent(f),
      before = nativeStateHashes(f);
    const first = startNativeHook(f, event, f.env),
      second = startNativeHook(
        f,
        { ...event, tool_use_id: "second-consumer" },
        f.env
      );
    const results = await Promise.all([first.terminal, second.terminal]);
    expect(results.filter(r => r.status === 0)).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(path.join(f.root, "effects-B.json"), "utf8"))
        .calls
    ).toBe(1);
    expect(before).not.toEqual(nativeStateHashes(f));
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({ case: "concurrent-native-consume", results })
    );
  });
});
