/**
 * The two Ruby halves of `quality-rails.yml` `test_shards`
 * (CodySwannGT/lisa#4560), executed by a real Ruby against stand-ins for RSpec
 * and SimpleCov so the test needs no gems:
 *
 * - `lisa_rspec_shard_recorder.rb` hands coverage off (`finalize_merge false`,
 *   so a shard never checks the project's minimums against its own slice) and
 *   records what RSpec loaded, refusing every setup that would make the merged
 *   coverage wrong.
 * - `lisa_simplecov_collate.rb` hands every resultset to `SimpleCov.collate`
 *   and lets its threshold verdict be the process's exit status.
 *
 * The real-gem behaviour (a shard below the floor passes, its collated slice
 * alone fails, the merge equals the unsharded run) was measured against
 * simplecov 1.3.2 and rspec-core 3.13.6 when this shipped; the stand-ins pin
 * the calls that behaviour rests on.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { probeSucceeds, suiteDeferral } from "../support/ci-runtime.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RECORDER = path.join(
  REPO_ROOT,
  "rails/copy-overwrite/scripts/lisa_rspec_shard_recorder.rb"
);
const COLLATE = path.join(
  REPO_ROOT,
  "rails/copy-overwrite/scripts/lisa_simplecov_collate.rb"
);

const RECORDER_NAME = "lisa_rspec_shard_recorder.rb";

const deferred = suiteDeferral(
  () => probeSucceeds("ruby", ["-e", "exit 0"]),
  "Ruby",
  "Install any Ruby >= 3.2 on PATH."
);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A scratch directory removed after the test.
 * @returns Its path
 */
function scratch(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), "lisa-rspec-shard-ruby-"))
  );
  roots.push(root);
  return root;
}

/** Minimal RSpec: `configure`, suite hooks, a reporter and `files_to_run`. */
const RSPEC_STUB = `
module RSpec
  class StubReporter
    attr_reader :listeners
    def initialize; @listeners = []; end
    def register_listener(listener, *events); @listeners << [listener, events]; end
  end
  class StubConfiguration
    attr_accessor :files_to_run
    attr_reader :reporter, :suite_hooks
    def initialize; @reporter = StubReporter.new; @suite_hooks = []; @files_to_run = []; end
    def before(scope, &block); @suite_hooks << block if scope == :suite; end
  end
  def self.configuration; @configuration ||= StubConfiguration.new; end
  def self.configure; yield configuration; end
end
Example = Struct.new(:metadata, :file_path, :execution_result)
Result = Struct.new(:run_time, :status)
Notification = Struct.new(:example)
`;

/**
 * A SimpleCov stand-in recording what the recorder asks of it.
 * @param options - Which capabilities it has
 * @param options.finalize - Whether it answers `finalize_merge`
 * @param options.merging - Its `merging` setting
 * @param options.root - Its project root
 * @returns Ruby source
 */
function simplecovStub({
  finalize = true,
  merging = true,
  root,
}: {
  finalize?: boolean;
  merging?: boolean;
  root: string;
}): string {
  return `
module Coverage
  def self.running? = true
end
module SimpleCov
  CALLS = []
  def self.merging = ${merging}
  def self.root = ${JSON.stringify(root)}
  def self.coverage_path = File.join(root, "coverage")
  def self.command_name(name) = CALLS << ["command_name", name]
  ${finalize ? 'def self.finalize_merge(value) = CALLS << ["finalize_merge", value]' : ""}
end
`;
}

/**
 * Run the recorder through one stubbed suite: arm it, finish two examples,
 * close the reporter, and print what SimpleCov was told.
 * @param options - Scenario
 * @param options.simplecov - SimpleCov stand-in source, or none
 * @param options.recorder - Path the recorder is loaded from
 * @param options.env - Shard environment
 * @param options.cwd - Project root the run happens in
 * @returns The Ruby process outcome
 */
function runRecorder({
  simplecov,
  recorder,
  env,
  cwd,
}: {
  simplecov?: string;
  recorder: string;
  env: Record<string, string>;
  cwd: string;
}) {
  const driver = path.join(scratch(), "driver.rb");
  fs.writeFileSync(
    driver,
    `${RSPEC_STUB}
${simplecov ?? ""}
load ${JSON.stringify(recorder)}
config = RSpec.configuration
config.files_to_run = [File.join(Dir.pwd, "spec/a_spec.rb"), File.join(Dir.pwd, "spec/models/b_spec.rb")]
config.suite_hooks.each(&:call)
listener, events = config.reporter.listeners.fetch(0)
abort "wrong events #{events.inspect}" unless events == [:example_finished, :close]
listener.example_finished(Notification.new(Example.new({ rerun_file_path: "./spec/a_spec.rb" }, "./spec/support/shared.rb", Result.new(1.5, :passed))))
listener.example_finished(Notification.new(Example.new({ rerun_file_path: "./spec/models/b_spec.rb" }, "./spec/models/b_spec.rb", Result.new(0.25, :failed))))
listener.close(nil)
puts "CALLS=" + (defined?(SimpleCov) ? SimpleCov::CALLS.inspect : "none")
`
  );
  return boundedSpawnSync({
    label: "ruby recorder driver",
    command: "ruby",
    args: [driver],
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: cwd, ...env },
  });
}

/**
 * A recorder copy outside the project root, as the workflow makes it.
 * @returns Its path
 */
function recorderOutsideRoot(): string {
  const copy = path.join(scratch(), RECORDER_NAME);
  fs.copyFileSync(RECORDER, copy);
  return copy;
}

describe.skipIf(deferred)("lisa_rspec_shard_recorder.rb", () => {
  it("hands coverage off and records what RSpec loaded and how long it took", () => {
    const root = scratch();
    const record = path.join(root, "out", "record.json");
    const outcome = runRecorder({
      simplecov: simplecovStub({ root }),
      recorder: recorderOutsideRoot(),
      cwd: root,
      env: { LISA_RSPEC_SHARD: "2/4", LISA_RSPEC_SHARD_RECORD: record },
    });
    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(
      'CALLS=[["finalize_merge", false], ["command_name", "RSpec shard 2/4"]]'
    );
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual({
      version: 1,
      shard: "2/4",
      files_to_run: ["spec/a_spec.rb", "spec/models/b_spec.rb"],
      examples: [
        // A shared example counts against the spec that included it.
        { file: "spec/a_spec.rb", run_time: 1.5, status: "passed" },
        { file: "spec/models/b_spec.rb", run_time: 0.25, status: "failed" },
      ],
      simplecov: { active: true, coverage_path: path.join(root, "coverage") },
    });
  });

  it("records an unmeasured run when the project does not use SimpleCov", () => {
    const root = scratch();
    const record = path.join(root, "record.json");
    const outcome = runRecorder({
      recorder: recorderOutsideRoot(),
      cwd: root,
      env: { LISA_RSPEC_SHARD: "1/2", LISA_RSPEC_SHARD_RECORD: record },
    });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("CALLS=none");
    expect(JSON.parse(fs.readFileSync(record, "utf8")).simplecov).toEqual({
      active: false,
    });
  });

  it.each([
    [
      "a SimpleCov with no finalize_merge",
      { finalize: false },
      /has no `finalize_merge`/,
    ],
    ["SimpleCov merging turned off", { merging: false }, /merging is off/],
  ])("refuses %s", (_label, options, message) => {
    const root = scratch();
    const outcome = runRecorder({
      simplecov: simplecovStub({ root, ...options }),
      recorder: recorderOutsideRoot(),
      cwd: root,
      env: {
        LISA_RSPEC_SHARD: "1/2",
        LISA_RSPEC_SHARD_RECORD: path.join(root, "r.json"),
      },
    });
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toMatch(message);
    expect(fs.existsSync(path.join(root, "r.json"))).toBe(false);
  });

  it("refuses to be loaded from inside the project, where SimpleCov would measure it", () => {
    const root = scratch();
    const inside = path.join(root, "scripts", RECORDER_NAME);
    fs.mkdirSync(path.dirname(inside));
    fs.copyFileSync(RECORDER, inside);
    const outcome = runRecorder({
      simplecov: simplecovStub({ root }),
      recorder: inside,
      cwd: root,
      env: {
        LISA_RSPEC_SHARD: "1/2",
        LISA_RSPEC_SHARD_RECORD: path.join(root, "r.json"),
      },
    });
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toMatch(/loaded from inside the project root/);
  });

  it("refuses to run without its shard environment", () => {
    const root = scratch();
    const outcome = runRecorder({
      simplecov: simplecovStub({ root }),
      recorder: recorderOutsideRoot(),
      cwd: root,
      env: {},
    });
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toMatch(/LISA_RSPEC_SHARD is not set/);
  });
});

/**
 * Run the collate script against a SimpleCov stand-in on the load path.
 * @param args - Resultset arguments
 * @param exitWith - Status the stand-in's `collate` exits with, if any
 * @returns The process outcome and what `collate` received
 */
function runCollate(args: string[], exitWith?: number) {
  const root = scratch();
  const lib = path.join(root, "lib");
  const received = path.join(root, "received.json");
  const stub = `require "json"
module SimpleCov
  def self.collate(files)
    File.write(${JSON.stringify(received)}, JSON.generate(files))
    ${exitWith === undefined ? "" : `Kernel.exit(${exitWith})`}
  end
  def self.clear_result = File.write(${JSON.stringify(received)} + ".cleared", "1")
end
`;
  fs.mkdirSync(lib);
  fs.writeFileSync(path.join(lib, "simplecov.rb"), stub);
  return collateOutcome(root, lib, args);
}

/**
 * Run the collate script and read back what the stand-in received.
 * @param root - Scratch project root
 * @param lib - Load path holding the SimpleCov stand-in
 * @param args - Resultset arguments
 * @returns The process outcome, the files `collate` got, and whether the run stood down
 */
function collateOutcome(root: string, lib: string, args: string[]) {
  const received = path.join(root, "received.json");
  const outcome = boundedSpawnSync({
    label: "ruby collate",
    command: "ruby",
    args: ["-I", lib, COLLATE, ...args],
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: root },
  });
  return {
    outcome,
    files: fs.existsSync(received)
      ? (JSON.parse(fs.readFileSync(received, "utf8")) as string[])
      : undefined,
    cleared: fs.existsSync(`${received}.cleared`),
    root,
  };
}

describe.skipIf(deferred)("lisa_simplecov_collate.rb", () => {
  it("hands every resultset to SimpleCov.collate, then stands its own run down", () => {
    const dir = scratch();
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    fs.writeFileSync(a, "{}");
    fs.writeFileSync(b, "{}");
    const { outcome, files, cleared } = runCollate([a, b]);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("Collating 2 SimpleCov resultset(s).");
    expect(files).toEqual([a, b]);
    expect(cleared).toBe(true);
  });

  it("exits with SimpleCov's threshold verdict", () => {
    const dir = scratch();
    const a = path.join(dir, "a.json");
    fs.writeFileSync(a, "{}");
    const { outcome, files } = runCollate([a], 2);
    expect(files).toEqual([a]);
    expect(outcome.status).toBe(2);
  });

  it("refuses to collate nothing, or a resultset that is not there", () => {
    const empty = runCollate([]);
    expect(empty.outcome.status).not.toBe(0);
    expect(empty.outcome.stderr).toMatch(/no resultsets given/);
    expect(empty.files).toBeUndefined();

    const missing = runCollate(["/nonexistent/resultset.json"]);
    expect(missing.outcome.status).not.toBe(0);
    expect(missing.outcome.stderr).toMatch(/resultset\(s\) not found/);
    expect(missing.files).toBeUndefined();
  });
});
