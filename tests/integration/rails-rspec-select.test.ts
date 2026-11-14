/**
 * Push-time spec selection on a Rails host (CodySwannGT/lisa#4612), end to
 * end: the real `lisa-rspec-select.mjs` in a throwaway Rails-shaped git
 * repository, through the shipped lefthook `rspec` command, against stand-ins
 * for `bundle` and `gh` that record what they were asked to do.
 *
 * Pinned, each against its control:
 * - a model change runs only the specs the map links to it plus the
 *   always-run groups, and prints them with why;
 * - a failing selected spec still fails the push;
 * - a trigger file, an unmapped file, a missing map and a stale map each run
 *   the full suite unchanged and print the reason;
 * - selection explicitly off, or a CI run, runs the full suite unchanged;
 * - the map is downloaded from the newest `crystalball-map-<base>-<run>`
 *   artifact when none is on disk;
 * - in `changed-files` mode each changed Ruby file is held to
 *   simplecov.thresholds.json on its own.
 * @module tests/integration/rails-rspec-select
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  ALWAYS,
  FULL,
  POST,
  USER,
  calls,
  change,
  fixture,
  git,
  lefthookRspec,
  mapDocument,
  partial,
  removeFixtures,
  select,
  write,
  writeMap,
} from "./rails-rspec-select-fixture.js";

afterAll(removeFixtures);

/** A one-line change to {@link POST}. */
const POST_CHANGE = { [POST]: "class Post\nend\n" };

/** The coverage the stand-in `bundle` reports. */
const COVERAGE = "coverage.json";

describe("Rails pre-push spec selection", () => {
  it("runs only the specs the map links to a changed model, plus the always-run groups, and says why", () => {
    const { root } = fixture();
    change(root, { [POST]: "class Post\n  def title\n    'q'\n  end\nend\n" });
    const result = lefthookRspec(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([
      partial(["spec/models/post_spec.rb", ...ALWAYS]),
    ]);
    expect(result.output).toContain(`spec/models/post_spec.rb  (map: ${POST})`);
    expect(result.output).toContain("spec/system/login_spec.rb  (always run)");
    expect(result.output).toContain("CI still runs every spec before merge.");
  });

  it("runs every spec that reads a shared model", () => {
    const { root } = fixture();
    change(root, { [USER]: "class User\nend\n" });
    const [call] = select(root).calls;
    expect(call).toEqual(
      partial([
        "spec/models/user_spec.rb",
        "spec/requests/users_spec.rb",
        "spec/system/login_spec.rb",
        "spec/requests/js_spec.rb",
      ])
    );
  });

  it("fails the push when a selected spec fails", () => {
    const { root } = fixture();
    change(root, { "app/models/flaky.rb": "class Flaky\nend\n" });
    const result = select(root);
    expect(result.status).toBe(1);
    expect(result.calls[0]).toContain("spec/models/failing_spec.rb");
  });

  it.each([
    ["Gemfile.lock", "GEM\n  rails\n", "a lockfile changed"],
    [
      "config/routes.rb",
      "Rails.application.routes.draw {}\n",
      "application configuration under config/",
    ],
    [
      "db/schema.rb",
      "ActiveRecord::Schema.define {}\n",
      "the database schema changed",
    ],
    ["spec/support/auth.rb", "module Auth; end\n", "shared spec support"],
    [
      "spec/rails_helper.rb",
      "require 'spec_helper'\n",
      "a spec helper changed",
    ],
    [
      "app/views/users/show.html.erb",
      "<p></p>\n",
      "unmapped file: app/views/users/show.html.erb",
    ],
  ])(
    "runs the full suite and prints the trigger when %s changes",
    (file, body, reason) => {
      const { root } = fixture();
      change(root, { ...POST_CHANGE, [file]: body });
      const result = lefthookRspec(root);
      expect(result.calls).toEqual([FULL]);
      expect(result.output).toContain(`Running the full suite: ${reason}`);
    }
  );

  it('runs the full suite with the reason "missing map" when no map exists for the merge-base', () => {
    const { root } = fixture({ map: "none" });
    change(root, POST_CHANGE);
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain("Running the full suite: missing map");
    expect(result.output).toContain("No new map: no crystalball map for");
    expect(calls(root, ".gh-calls")[0]?.[0]).toBe("api");
  });

  it("runs the full suite for a stale map: too old, or recorded off this branch's history", () => {
    const old = fixture();
    change(old.root, POST_CHANGE);
    const aged = select(old.root, { LISA_ACCESS_MAP_MAX_AGE_DAYS: "0" });
    expect(aged.calls).toEqual([FULL]);
    expect(aged.output).toContain("Running the full suite: stale map");

    const elsewhere = fixture();
    change(elsewhere.root, POST_CHANGE);
    writeMap(elsewhere.root, elsewhere.base, "f".repeat(40));
    const foreign = select(elsewhere.root);
    expect(foreign.calls).toEqual([FULL]);
    expect(foreign.output).toContain("not this branch's base or an ancestor");
  });

  it("downloads the newest crystalball map for the merge-base and selects from it", () => {
    const { root, base } = fixture({ map: "none" });
    change(root, POST_CHANGE);
    write(
      root,
      "gh-artifacts.ndjson",
      `${JSON.stringify({ name: `crystalball-map-${base}-77`, runId: 77, createdAt: new Date().toISOString(), expired: false })}\n`
    );
    write(root, "gh-map.json", JSON.stringify(mapDocument(base)));
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([
      partial(["spec/models/post_spec.rb", ...ALWAYS]),
    ]);
    const download = calls(root, ".gh-calls").find(call => call[0] === "run");
    expect(download).toEqual(
      expect.arrayContaining([
        "download",
        "77",
        "--name",
        `crystalball-map-${base}-77`,
      ])
    );
  });

  it("runs the full suite unchanged and silently when pushGate.affectedTests is false", () => {
    const { root } = fixture({ pushGate: { affectedTests: false } });
    change(root, POST_CHANGE);
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).not.toContain("affected specs");
  });

  it("never selects in CI", () => {
    const { root } = fixture();
    change(root, POST_CHANGE);
    const result = select(root, { CI: "true" });
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain("this is a CI run");
  });

  it('keeps the full suite when pushGate.affectedCoverage is "full"', () => {
    const { root } = fixture({ pushGate: { affectedCoverage: "full" } });
    change(root, POST_CHANGE);
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain('pushGate.affectedCoverage is "full"');
  });

  it("refuses an invalid pushGate and runs nothing", () => {
    const { root } = fixture({ pushGate: { affectedTests: "yes" } });
    change(root, POST_CHANGE);
    const result = select(root);
    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
  });

  it("holds each changed Ruby file to simplecov.thresholds.json on its own by default", () => {
    const { root } = fixture();
    change(root, { [POST]: "class Post\n  def title\n    'q'\n  end\nend\n" });
    const fresh = (): void =>
      fs.rmSync(path.join(root, ".bundle-calls"), { force: true });

    write(root, COVERAGE, JSON.stringify({ [POST]: [1, 1, 1, 1, null] }));
    const high = select(root);
    expect(high.status, high.output).toBe(0);
    expect(high.output).toContain(
      "1 changed Ruby file(s) meet the coverage floor"
    );
    expect(high.calls, "no escalation when every file meets it").toHaveLength(
      1
    );

    // Push is never stricter than whole-repo coverage (CodySwannGT/lisa#4600):
    // a changed file short on its own escalates to the full suite, whose
    // SimpleCov minimums then decide the push.
    fresh();
    write(root, COVERAGE, JSON.stringify({ [POST]: [1, 0, 0, 0, null] }));
    const low = select(root);
    expect(low.status, low.output).toBe(0);
    expect(low.calls[1]).toEqual(FULL);
    expect(low.output).toContain(
      `${POST} is below its coverage floor on its own (line coverage 25.00% is below 80%), so the full suite is running now with whole-repo coverage, and that run decides this push.`
    );
    expect(low.output).not.toContain("❌");

    fresh();
    write(root, "whole-coverage.fail", "");
    const whole = select(root);
    expect(whole.status, "the full run's verdict stands").toBe(1);
    expect(whole.calls[1]).toEqual(FULL);
  });

  it("escalates when the coverage hand-off cannot keep the minimums off the slice", () => {
    const { root } = fixture();
    change(root, POST_CHANGE);
    write(root, "handoff-unavailable", "");
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls[1]).toEqual(FULL);
    expect(result.output).toContain(
      "this SimpleCov has no finalize_merge, so the full suite is running now with whole-repo coverage"
    );
  });

  it("escalates rather than fails when the partial run leaves no resultset", () => {
    const { root } = fixture();
    change(root, POST_CHANGE);
    // The hand-off never ran: no status, no resultset.
    write(root, "handoff-silent", "");
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls[1]).toEqual(FULL);
    expect(result.output).toContain(
      "the partial run left no SimpleCov resultset, so the full suite is running now with whole-repo coverage"
    );
  });

  it("leaves coverage to CI in skip mode", () => {
    const { root } = fixture({ pushGate: { affectedCoverage: "skip" } });
    change(root, POST_CHANGE);
    write(root, COVERAGE, JSON.stringify({ [POST]: [0, 0] }));
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("partial selection — enforced by CI");
  });

  it("runs the full suite as before when the selector is not installed yet", () => {
    const { root } = fixture();
    git(root, "rm", "-q", "scripts/lisa-rspec-select.mjs");
    git(root, "commit", "-q", "-m", "older lisa");
    change(root, POST_CHANGE);
    const result = lefthookRspec(root);
    expect(result.calls).toEqual([FULL]);
  });
});
