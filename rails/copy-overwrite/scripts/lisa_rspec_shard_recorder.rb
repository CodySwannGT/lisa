# frozen_string_literal: true

# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# -----------------------------------------------------------------------------
# RSpec shard recorder for `quality-rails.yml` `test_shards`.
#
# Loaded into one shard leg with `rspec --require`. It does two things, both at
# `before(:suite)`, when the project's own spec_helper / rails_helper has
# already required SimpleCov and loaded `.simplecov`:
#
#   1. Hands coverage off to the aggregate. `SimpleCov.finalize_merge false`
#      makes this process store its `.resultset.json` and stop there: no
#      report, and no minimum-coverage check against a slice of the suite,
#      which would fail any project whose floor is above what one shard
#      reaches. The aggregate job collates every shard and enforces the
#      project's thresholds once, on the merged result.
#   2. Writes a run record at the reporter's `close`: the files RSpec itself
#      loaded (`files_to_run`), each example's run time, and where SimpleCov
#      writes. The aggregate proves from these records that every spec file
#      ran exactly once, and folds the timings into the next run's plan.
#
# ENVIRONMENT
#   LISA_RSPEC_SHARD         "K/N" — this leg's shard. Required.
#   LISA_RSPEC_SHARD_RECORD  Path of the run record to write. Required.
# -----------------------------------------------------------------------------

require 'fileutils'
require 'json'
require 'pathname'

# Hands a shard's coverage to the aggregate and records what RSpec ran.
module LisaRspecShardRecorder
  SCHEMA_VERSION = 1

  # Collects example timings and writes the record when the reporter closes.
  class Listener
    def initialize(path:, shard:, configuration:)
      @path = path
      @shard = shard
      @configuration = configuration
      @examples = []
    end

    def example_finished(notification)
      example = notification.example
      @examples << {
        'file' => LisaRspecShardRecorder.relative(example.metadata[:rerun_file_path] || example.file_path),
        'run_time' => example.execution_result.run_time.to_f,
        'status' => example.execution_result.status.to_s
      }
    end

    def close(_notification)
      FileUtils.mkdir_p(File.dirname(@path))
      File.write(@path, "#{JSON.pretty_generate(record)}\n")
    end

    def record
      {
        'version' => SCHEMA_VERSION,
        'shard' => @shard,
        'files_to_run' => @configuration.files_to_run.map { |file| LisaRspecShardRecorder.relative(file) }.sort,
        'examples' => @examples,
        'simplecov' => LisaRspecShardRecorder.simplecov_state
      }
    end
  end

  module_function

  def fetch_env(name)
    value = ENV.fetch(name, '')
    raise ArgumentError, "lisa-rspec-shard-recorder: #{name} is not set" if value.empty?

    value
  end

  # Repo-relative, forward-slashed, with no leading "./" and no ":line" suffix.
  def relative(path)
    text = path.to_s.sub(/:\d+(?::\d+)*\z/, '')
    absolute = Pathname.new(File.expand_path(text))
    absolute.relative_path_from(Pathname.new(Dir.pwd)).to_s
  end

  def measuring?
    defined?(::SimpleCov) && defined?(::Coverage) && ::Coverage.running?
  end

  def simplecov_state
    return { 'active' => false } unless measuring?

    { 'active' => true, 'coverage_path' => ::SimpleCov.coverage_path }
  end

  # A shard that enforced the project's floor against its own slice would fail
  # every project whose floor is above one shard's reach, and a shard that does
  # not store its resultset leaves the aggregate nothing to merge. Both are
  # refused loudly rather than worked around.
  def hand_off_coverage(shard)
    return unless measuring?

    refuse_unsupported_simplecov
    refuse_measured_recorder
    ::SimpleCov.finalize_merge(false)
    ::SimpleCov.command_name("RSpec shard #{shard}")
  end

  def refuse_unsupported_simplecov
    unless ::SimpleCov.respond_to?(:finalize_merge)
      raise 'lisa-rspec-shard-recorder: this SimpleCov has no `finalize_merge`, so a shard cannot store its ' \
            'coverage without also checking the minimum against its own slice. test_shards above 1 needs ' \
            "simplecov >= 1.0 (Lisa's Gemfile.lisa pins it); upgrade it, or leave test_shards at 1."
    end
    return if ::SimpleCov.merging

    raise 'lisa-rspec-shard-recorder: SimpleCov merging is off (`merging false`), so this shard would write no ' \
          '.resultset.json for the aggregate to collate. Remove that setting, or leave test_shards at 1.'
  end

  # Loaded from inside the project, this file is itself measured and lands in
  # the shard's resultset as application code the unsharded run never had,
  # moving the merged percentage. The workflow copies it out first.
  def refuse_measured_recorder
    return unless File.expand_path(__FILE__).start_with?("#{File.expand_path(::SimpleCov.root)}/")

    raise 'lisa-rspec-shard-recorder: loaded from inside the project root, so SimpleCov would measure it as ' \
          'application code. Copy it outside the project (the workflow uses $RUNNER_TEMP) and --require that copy.'
  end

  def arm!(configuration)
    shard = fetch_env('LISA_RSPEC_SHARD')
    path = File.expand_path(fetch_env('LISA_RSPEC_SHARD_RECORD'))
    hand_off_coverage(shard)
    listener = Listener.new(path: path, shard: shard, configuration: configuration)
    configuration.reporter.register_listener(listener, :example_finished, :close)
    listener
  end
end

RSpec.configure do |config|
  config.before(:suite) { LisaRspecShardRecorder.arm!(config) }
end
