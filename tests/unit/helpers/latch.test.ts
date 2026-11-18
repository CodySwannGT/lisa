import { describe, expect, it } from "vitest";
import { latch } from "../../helpers/latch.js";

describe("latch", () => {
  it("reads the fallback while nothing has been recorded", async () => {
    await expect(latch<number | null>().read(null)).resolves.toBeNull();
  });

  it("keeps the first recorded value and ignores later ones", async () => {
    const entered = latch<number | null>();
    entered.set(1);
    entered.set(2);
    await expect(entered.read(null)).resolves.toBe(1);
    await expect(entered.read(null)).resolves.toBe(1);
  });

  it("records a value set after an earlier read", async () => {
    const timedOut = latch<boolean>();
    await expect(timedOut.read(false)).resolves.toBe(false);
    timedOut.set(true);
    await expect(timedOut.read(false)).resolves.toBe(true);
  });

  it("treats a recorded falsy value as recorded", async () => {
    const failure = latch<unknown>();
    failure.set(undefined);
    failure.set(new Error("later"));
    await expect(failure.read("fallback")).resolves.toBeUndefined();
  });
});
