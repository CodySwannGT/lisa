/**
 * Workflow contract for the crystalball map (CodySwannGT/lisa#4612): on a pull
 * request, every full RSpec run of the shipped `quality-rails.yml` (the
 * unsharded `Test (PostgreSQL)` / `Test (MySQL)` run and each shard leg) loads
 * `lisa_crystalball_recorder.rb` with `--require`, still runs every spec, and
 * the map is uploaded as `crystalball-map-<base sha>-<run id>` — merged from
 * the legs when the suite is sharded — the names the pre-push selector parses.
 *
 * The shell bodies that decide something are executed, not string-matched.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseMapArtifacts } from "../../all/copy-overwrite/scripts/lib/rspec-selection.mjs";
import {
  DATABASES,
  execute as executeIn,
  job,
  step,
} from "./quality-rails-test-shards-fixture.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASE = "${{ github.event.pull_request.base.sha }}";
const WHOLE = `crystalball-map-${BASE}-\${{ github.run_id }}`;
const ARM = "🔮 Arm the crystalball map recorder";
const MERGE = "🔮 Merge the shards' crystalball maps";
const MERGED_UPLOAD = "📤 Upload the merged crystalball map";
const RECORDER_REQUIRE =
  '${LISA_CRYSTALBALL_REQUIRE:+--require "$LISA_CRYSTALBALL_REQUIRE"}';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Run a step body after a setup prelude, in a registered scratch directory.
 * @param prelude - Shell run first
 * @param body - The step's `run:`
 * @param env - Step environment
 * @returns The outcome
 */
function execute(
  prelude: string,
  body: string | undefined,
  env: Record<string, string> = {}
) {
  return executeIn(root => roots.push(root), prelude, body, env);
}

/** A stand-in `bundle` on PATH that prints its arguments. */
const FAKE_BUNDLE = [
  "mkdir -p fakebin",
  "cat > fakebin/bundle <<'EOF'",
  "#!/bin/sh",
  'echo "ARGS:$*"',
  "EOF",
  "chmod +x fakebin/bundle",
  'export PATH="$PWD/fakebin:$PATH"',
].join("\n");

/**
 * Index of a named step in a job.
 * @param id - Job id
 * @param name - Step name
 * @returns Its position
 */
function indexOf(id: string, name: string): number {
  return (job(id).steps ?? []).findIndex(entry => entry.name === name);
}

describe.each(DATABASES)(
  "quality-rails.yml crystalball map ($label)",
  ({ db }) => {
    const aggregate = `test-${db}`;
    const leg = `test-${db}-shard`;

    it("arms the recorder before the unsharded run, only on a pull request", () => {
      const arm = step(aggregate, ARM);
      expect(arm.if).toBe(
        "inputs.test_shards == 1 && github.event.pull_request.base.sha != ''"
      );
      expect(arm.env).toMatchObject({ BASE_SHA: BASE, JOB_LABEL: "unsharded" });
      expect(indexOf(aggregate, ARM)).toBeLessThan(
        indexOf(aggregate, "🧪 Run tests")
      );
    });

    it("arms the recorder in every shard leg before its run", () => {
      const arm = step(leg, ARM);
      expect(arm.if).toBe("github.event.pull_request.base.sha != ''");
      expect(indexOf(leg, ARM)).toBeLessThan(
        indexOf(leg, "🧪 Run this shard's tests")
      );
      expect(step(leg, "🧪 Run this shard's tests").run).toContain(
        `bundle exec rspec --require "$RUNNER_TEMP/lisa_rspec_shard_recorder.rb" ${RECORDER_REQUIRE} "\${SPEC_FILES[@]}"`
      );
    });

    it("runs every spec in the unsharded run, with or without the recorder", () => {
      const body = step(aggregate, "🧪 Run tests").run;
      const plain = execute(FAKE_BUNDLE, body);
      expect(plain.status).toBe(0);
      expect(plain.stdout.trim()).toBe("ARGS:exec rspec");
      const recorded = execute(FAKE_BUNDLE, body, {
        LISA_CRYSTALBALL_REQUIRE: "recorder/rec.rb",
      });
      expect(recorded.stdout.trim()).toBe(
        "ARGS:exec rspec --require recorder/rec.rb"
      );
    });

    it("uploads the unsharded map keyed by the pull request's base commit", () => {
      const upload = step(aggregate, "📤 Upload the crystalball map");
      expect(upload.uses).toBe("actions/upload-artifact@v7");
      expect(upload.if).toContain("always()");
      expect(upload.with).toMatchObject({
        name: WHOLE,
        path: "${{ runner.temp }}/lisa-crystalball-map/map.json",
        "if-no-files-found": "ignore",
      });
      const rendered = `crystalball-map-${"c".repeat(40)}-123`;
      expect(
        parseMapArtifacts(JSON.stringify({ name: rendered, runId: 123 }))
      ).toHaveLength(1);
    });

    it("uploads each leg's map and the aggregate's merge of them", () => {
      expect(
        step(leg, "📤 Upload this shard's crystalball map").with
      ).toMatchObject({
        name: `${WHOLE}-shard-\${{ matrix.shard }}`,
      });
      expect(
        step(aggregate, "📥 Download every shard's crystalball map").with
      ).toMatchObject({
        pattern: `${WHOLE}-shard-*`,
      });
      const merge = step(aggregate, MERGE);
      expect(merge.if).toContain("inputs.test_shards != 1");
      expect(indexOf(aggregate, MERGE)).toBeLessThan(
        indexOf(aggregate, MERGED_UPLOAD)
      );
      expect(step(aggregate, MERGED_UPLOAD).with).toMatchObject({
        name: WHOLE,
        "retention-days": 30,
      });
    });
  }
);

describe("the shared step bodies", () => {
  const arm = step("test-postgres", ARM).run;
  const merge = step("test-postgres", MERGE).run;
  const install = [
    "mkdir -p scripts/lib",
    ...[
      [
        "all/copy-overwrite/scripts/lisa-rspec-select.mjs",
        "scripts/lisa-rspec-select.mjs",
      ],
      [
        "all/copy-overwrite/scripts/lib/rspec-selection.mjs",
        "scripts/lib/rspec-selection.mjs",
      ],
      [
        "all/copy-overwrite/scripts/lib/affected-tests.mjs",
        "scripts/lib/affected-tests.mjs",
      ],
      [
        "all/copy-overwrite/scripts/lib/invoked-as-script.mjs",
        "scripts/lib/invoked-as-script.mjs",
      ],
      [
        "rails/copy-overwrite/scripts/lisa_crystalball_recorder.rb",
        "scripts/lisa_crystalball_recorder.rb",
      ],
    ].map(
      ([from = "", to = ""]) =>
        `cp ${JSON.stringify(path.join(REPO_ROOT, from))} ${to}`
    ),
  ].join("\n");

  it("arms the recorder from outside the project root", () => {
    const outcome = execute(install, arm, {
      BASE_SHA: "a".repeat(40),
      JOB_LABEL: "unsharded",
    });
    expect(outcome.status).toBe(0);
    expect(outcome.env).toContain(
      `LISA_CRYSTALBALL_REQUIRE=${outcome.runnerTemp}/lisa_crystalball_recorder.rb`
    );
    expect(outcome.env).toContain(
      `LISA_CRYSTALBALL_BASE_SHA=${"a".repeat(40)}`
    );
    expect(
      fs.existsSync(
        path.join(outcome.runnerTemp, "lisa_crystalball_recorder.rb")
      )
    ).toBe(true);
  });

  it("records nothing, and says so, before lisa has installed the recorder", () => {
    const outcome = execute("", arm, {
      BASE_SHA: "a".repeat(40),
      JOB_LABEL: "unsharded",
    });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("crystalball map not recorded");
    expect(outcome.env).toBe("");
  });

  it("merges every leg's map into one", () => {
    const legs = [
      {
        meta: {
          baseSha: "a".repeat(40),
          createdAt: "2026-11-02T00:00:00Z",
          job: "shard-1",
        },
        map: { "spec/a_spec.rb": ["app/a.rb"] },
      },
      {
        meta: {
          baseSha: "a".repeat(40),
          createdAt: "2026-11-01T00:00:00Z",
          job: "shard-2",
        },
        map: { "spec/b_spec.rb": ["app/b.rb"] },
        alwaysRun: ["spec/b_spec.rb"],
      },
    ];
    const prelude = [
      install,
      ...legs.map(
        (document, index) =>
          `mkdir -p "$RUNNER_TEMP/lisa-crystalball-legs/leg-${index}" && printf '%s' ${JSON.stringify(JSON.stringify(document))} > "$RUNNER_TEMP/lisa-crystalball-legs/leg-${index}/map.json"`
      ),
    ].join("\n");
    const outcome = execute(prelude, merge);
    expect(outcome.status, outcome.stdout).toBe(0);
    const merged = JSON.parse(
      fs.readFileSync(
        path.join(outcome.runnerTemp, "lisa-crystalball-map", "map.json"),
        "utf8"
      )
    );
    expect(merged.map).toEqual({
      "spec/a_spec.rb": ["app/a.rb"],
      "spec/b_spec.rb": ["app/b.rb"],
    });
    expect(merged.alwaysRun).toEqual(["spec/b_spec.rb"]);
    expect(merged.meta).toMatchObject({
      baseSha: "a".repeat(40),
      createdAt: "2026-11-01T00:00:00Z",
      legs: ["shard-1", "shard-2"],
    });
  });

  it("merges nothing, and says so, when no leg recorded a map", () => {
    const outcome = execute(install, merge);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("no crystalball map to merge");
  });
});
