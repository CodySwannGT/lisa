/**
 * A killed provider CLI must not read as a missing binary (#4045).
 *
 * When a provider call exceeded its child budget, the ENTIRE operator-facing
 * output was:
 *
 *     spawnSync bws ETIMEDOUT
 *
 * A binary name and an errno. It does not say a deadline was reached, what the
 * deadline was, which operation was in flight, that the deadline is a Lisa
 * constant rather than anything the vault reported, or what to do next.
 *
 * Every reader so far drew the same wrong conclusion — that `bws` is missing or
 * broken — because "spawnSync + binary + errno" is exactly the shape Node
 * produces for `ENOENT`, and nothing in the string separates the two. MEASURED
 * in the report: `bws 2.1.0` was installed and working the whole time, a direct
 * `bws secret list` succeeded moments later, and normal timings are 365–725 ms.
 * The operator concluded Bitwarden was unreachable and was one step from
 * routing live work to `blocked` over a working credential path.
 *
 * ## Two defects that compound, and which one is load-bearing
 *
 * `run()` in `providers.mjs` passed no `timeout`, so it fell back to
 * `CHILD_BUDGET_MS` — the PROBE budget, documented as "a hang detector, not a
 * performance budget". Its sibling `SETUP_OPERATION_BUDGET_MS` names
 * "secret-provider calls" in its own docstring. So the wrong budget fires.
 *
 * But fixing only the budget makes the failure rarer without making it legible
 * — the same message, ten minutes later. The message is the load-bearing half,
 * which is why it is asserted here as a pure function: nothing in this suite
 * spawns a provider CLI, contacts a vault, or reads a real secret.
 * @module tests/unit/skills/secrets-provider-timeout-message
 */
import { describe, expect, it } from "vitest";

import {
  describeProviderTimeout,
  PROVIDER_BUDGET_MS,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/providers.mjs";

/** The provider executable every fixture below names. */
const BWS = "bws";

/** The operation most fixtures below describe. */
const READING = "reading secrets";

/** The shape Node hands back when it kills a child at its deadline. */
const KILLED = { code: "ETIMEDOUT" };

describe("the message names the deadline, not the binary", () => {
  it("says a deadline was reached", () => {
    const message = describeProviderTimeout(BWS, READING, KILLED);

    expect(message).toMatch(/deadline/i);
  });

  it("states the CLI RAN, rather than that it was missing", () => {
    // The whole defect: the old string is indistinguishable from ENOENT.
    const message = describeProviderTimeout(BWS, READING, KILLED);

    expect(message).toContain("ran");
    expect(message).toMatch(/not.*(missing|installed)/i);
  });

  it("names the operation that was in flight", () => {
    const message = describeProviderTimeout(
      BWS,
      "reading secrets from Bitwarden",
      KILLED
    );

    expect(message).toContain("reading secrets from Bitwarden");
  });

  it("names the deadline value, and says it is Lisa's", () => {
    // "What was the deadline" and "whose deadline was it" are different
    // questions, and an operator needs both: one tells them whether to retry,
    // the other tells them the vault reported nothing at all.
    const message = describeProviderTimeout(BWS, READING, KILLED);

    expect(message).toContain(String(Math.round(PROVIDER_BUDGET_MS / 1000)));
    expect(message).toMatch(/Lisa/);
  });

  it("offers a next step an operator can actually take", () => {
    const message = describeProviderTimeout(BWS, READING, KILLED);

    expect(message).toMatch(/retry|again|network/i);
  });

  it("still names the binary, so the message is greppable", () => {
    expect(describeProviderTimeout(BWS, READING, KILLED)).toContain(BWS);
  });
});

describe("rejection controls: what must NOT be relabelled", () => {
  it("returns null for a failure that is not a killed child", () => {
    // THE control. A formatter that described every error as a timeout would
    // satisfy every assertion above and turn a genuinely missing binary into a
    // confident wrong diagnosis pointing the other way — which is this defect
    // with the sign flipped.
    expect(
      describeProviderTimeout(BWS, READING, { code: "ENOENT" })
    ).toBeNull();
  });

  it("returns null for a non-zero exit that is not a timeout", () => {
    expect(describeProviderTimeout(BWS, READING, { code: 1 })).toBeNull();
  });

  it("does not crash on a thrown non-object", () => {
    // A `catch` binding is `unknown` and a thrown string is legal JavaScript.
    expect(describeProviderTimeout(BWS, READING, "boom")).toBeNull();
    expect(describeProviderTimeout(BWS, READING, null)).toBeNull();
  });
});

describe("the provider budget is the operation budget, not the probe budget", () => {
  it("is far longer than the 30s probe budget", () => {
    // `CHILD_BUDGET_MS` is documented as a hang detector. A round trip to a
    // hosted vault over someone's network is neither a hang nor a local probe.
    expect(PROVIDER_BUDGET_MS).toBeGreaterThan(30_000);
  });
});
