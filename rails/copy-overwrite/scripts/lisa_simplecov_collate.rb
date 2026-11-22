# frozen_string_literal: true

# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# -----------------------------------------------------------------------------
# Merge the RSpec shards' SimpleCov resultsets and enforce the project's
# coverage thresholds once, on the whole suite.
#
#   bundle exec ruby scripts/lisa_simplecov_collate.rb <resultset.json>...
#
# `require 'simplecov'` loads the project's own `.simplecov`, so the merged
# result is filtered, grouped and checked exactly as an unsharded run would
# be: the same `minimum_coverage` / `coverage ..., minimum:` and every other
# limit it sets. This file sets no threshold of its own. `SimpleCov.collate`
# exits non-zero when a threshold fails.
# -----------------------------------------------------------------------------

require 'simplecov'

# Collates shard resultsets and lets SimpleCov's threshold verdict decide.
module LisaSimplecovCollate
  module_function

  def resultsets(argv)
    abort 'lisa-simplecov-collate: no resultsets given; nothing to collate.' if argv.empty?

    missing = argv.reject { |path| File.file?(path) }
    abort "lisa-simplecov-collate: resultset(s) not found: #{missing.join(', ')}" unless missing.empty?

    argv.map { |path| File.expand_path(path) }
  end

  # A `.simplecov` that calls `SimpleCov.start` itself has also started
  # measuring THIS process. Left running, SimpleCov's own at_exit would format
  # and check a second time. Stopping it and dropping the result leaves
  # `collate` the only verdict.
  def stand_down_own_measurement
    ::Coverage.result(stop: true, clear: true) if defined?(::Coverage) && ::Coverage.running?
    ::SimpleCov.clear_result if ::SimpleCov.respond_to?(:clear_result)
  end

  def run(argv)
    files = resultsets(argv)
    puts "Collating #{files.length} SimpleCov resultset(s)."
    ::SimpleCov.collate(files)
  ensure
    stand_down_own_measurement
  end
end

LisaSimplecovCollate.run(ARGV) if $PROGRAM_NAME == __FILE__
