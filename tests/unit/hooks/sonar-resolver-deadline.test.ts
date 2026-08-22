/**
 * The hook's own resolver deadline: enforced, seam-able, and unchanged for a
 * consumer.
 *
 * CodySwannGT/lisa#2905. Three cases in the wrapper suite failed intermittently
 * under fleet load against a bound NO test budget can reach — `read -r -t 10`
 * inside the shipped hook. On a box where starting `node` costs more than ten
 * seconds the read returns nothing, the stub CLI reports inactive, the hook
 * correctly warns, and the case then compares an empty string to a JSON blob.
 * An empty stdout standing in for a timing failure.
 * @module tests/unit/hooks/sonar-resolver-deadline
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  FINDING,
  INACTIVE_MARKER,
  SOURCE,
  assertResolverDelivered,
  checkoutWithResolver,
  resolverScriptPath,
  run,
  stubSonar,
} from "./support/sonar-secrets-fixtures.js";

// Every case here starts `/bin/bash` against the real shim, which spawns a real
// `node`. The same reason the wrapper suite calls this.
useIoLatencyBudget();

describe("the resolver deadline is enforced, not just declared", () => {
  it("kills and reaps a resolver that outlives the ceiling", async () => {
    // `read -t` bounds how long the hook WAITS; on its own it does not bound
    // the work. A resolver blocked on the network otherwise outlives the hook
    // that started it, and this runs in front of every prompt and file read —
    // so the ceiling has to terminate the child, not merely stop listening.
    // Never writes and never exits: the read times out with nothing, which is
    // exactly the case where an unreaped child lingers.
    const slow = checkoutWithResolver(
      "setTimeout(() => {}, 600000);\n",
      "lisa-sonar-hang-"
    );

    // One second, not the scaled default. This case is about the hook killing
    // and reaping a resolver that never answers, and every millisecond of the
    // deadline is spent doing nothing at all. Measured cost of this case,
    // serialised on a fresh TMPDIR at load ~29: 38,043ms — of which the wait was
    // a fixed ten seconds. Shrinking it is REDUCING THE WORK, the remedy
    // tests/helpers/io-latency-budget.ts asks for, and it changes nothing about
    // what is proved: the read times out with nothing either way.
    run({
      bin: stubSonar(""),
      projectDir: slow,
      env: { LISA_SONAR_RESOLVER_TIMEOUT_S: "1" },
    });

    // The hook has returned. Anything still running the stub resolver is a
    // child it failed to reap.
    const survivors = boundedSpawnSync({
      label: "ps for surviving resolvers",
      command: "/bin/sh",
      args: [
        "-c",
        `ps -eo pid,args | grep -F ${JSON.stringify(resolverScriptPath(slow))} | grep -v grep`,
      ],
    });

    expect(survivors.stdout.trim()).toBe("");
    // No per-case budget here on purpose. This case carried `}, 40_000)`, and a
    // per-case literal OVERRIDES the file-level budget silently — so the one
    // case in this file that most needs `useIoLatencyBudget()`'s scaling was
    // the only one it could not reach. That is the failure mode #2822 recorded
    // as a carry-forward, still live in the file that owns the helper.
    //
    // Deleting the literal is not a raise. The helper's budget is
    // `base x measured spawn slowdown`, so a quiet box still fails a hang in
    // roughly `base` while a loaded one gets proportionate room; a literal can
    // do neither. Measured cost of this case, serialised on a fresh TMPDIR at
    // load ~29: 38,043ms against the old 40,000ms cap — 4.9% of headroom, which
    // is not a margin, it is a coin toss. It lost three times in one night, on
    // three branches with unrelated diffs (62,350ms / 50,965ms / timeout),
    // blocking all three from pushing at all.
    //
    // The cost USED to have a hard floor at the hook's own `read -r -t 10`
    // ceiling — a fixed wall-clock wait that neither shrank on a fast box nor
    // scaled on a slow one. CodySwannGT/lisa#2905 made that ceiling a seam, and
    // this case now spends one second there instead of ten. What remains is a
    // `bash` spawn whose cost on this hardware is unbounded: the identical
    // single-`run()` operation ranged 1,109ms to 38,711ms WITHIN one run of this
    // file. Sharing fixtures across cases was measured and rejected rather than
    // skipped: `stubSonar` is one mkdtemp, one write and one chmod, about 1ms,
    // so hoisting all six repeats would recover ~6ms out of 38,000. That is
    // theatre, and it would have made this file look addressed.
  });

  it("still gives a consumer the ten seconds it always gave them", () => {
    // The default is a literal in the source, so asserting the literal IS
    // asserting the default — and it is the honest proof here, because proving
    // "exactly ten" by observation costs an eleven-second wait to learn what one
    // line of the file already says. The byte-identity case above carries it to
    // every copy-overwrite copy, so no consumer can receive a different number.
    const code = readFileSync(SOURCE, "utf8");

    expect(code).toContain('-t "${LISA_SONAR_RESOLVER_TIMEOUT_S:-10}"');
    expect(code).not.toMatch(/read -r -t 10\b/u);
  });
});

describe("the seam is live, not decorative", () => {
  // A seam nothing reads is a comment. These two cases hand the SAME resolver
  // two different deadlines and get opposite verdicts, which is the only
  // evidence that the variable reaches `read -t` at all. A test that merely
  // sets it and watches the suite stay green proves nothing: the suite was
  // green before the seam existed.

  /**
   * A resolver that answers, but not immediately.
   *
   * Two seconds: comfortably inside the scaled default (ten seconds on a quiet
   * box, more on a slow one) and comfortably outside the one-second deadline
   * the negative arm sets. The negative arm is robust in the direction load
   * pushes — a slower box only makes the answer later, never earlier.
   * @returns Path to the fake checkout.
   */
  const slowResolver = (): string =>
    checkoutWithResolver(
      'setTimeout(() => process.stdout.write("late-token"), 2000);\n',
      "lisa-sonar-late-"
    );

  it("waits for a late token when the deadline allows it", () => {
    const result = run({
      bin: stubSonar(FINDING),
      projectDir: slowResolver(),
    });

    assertResolverDelivered(result);
    expect(result.stdout).toBe(FINDING);
  });

  it("gives up on the same token when the deadline is shortened", () => {
    const result = run({
      bin: stubSonar(FINDING),
      projectDir: slowResolver(),
      env: { LISA_SONAR_RESOLVER_TIMEOUT_S: "1" },
    });

    // The warn path, reached by the deadline and nothing else — same resolver,
    // same stub, same everything but the number.
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(INACTIVE_MARKER);
    expect(result.status).toBe(0);
  });
});
