# frozen_string_literal: true

# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# -----------------------------------------------------------------------------
# Coverage hand-off for a PARTIAL push-time RSpec run (CodySwannGT/lisa#4612).
#
# When scripts/lisa-rspec-select.mjs runs only the specs a change can reach,
# the project's SimpleCov minimums would be checked against that slice and
# fail. Loaded with `rspec --require`, this file does what the CI shard
# recorder does at `before(:suite)`, once the project's spec_helper has
# started SimpleCov:
#
#   1. `SimpleCov.finalize_merge false`: store the resultset and stop there,
#      with no report and no minimum check against the slice.
#   2. Write that resultset to a fresh directory the selector names, never to
#      the project's own coverage/, so a partial result cannot merge with or
#      replace a full run's.
#
# The selector then holds each CHANGED file to simplecov.thresholds.json on
# its own (pushGate.affectedCoverage "changed-files"). A file below its floor
# does not fail the push: the selector runs the full suite with whole-repo
# coverage and that verdict decides (CodySwannGT/lisa#4600: a push is never
# stricter than whole-repo coverage). CI still runs every spec and enforces
# the project's thresholds on the whole suite.
#
# It writes `status.json` beside the resultset, saying whether SimpleCov was
# measuring, so "this project measures no coverage" and "the run lost its
# coverage" cannot look alike. When it cannot hand off safely it writes
# `escalate` with the reason, and the selector runs the full suite.
#
# ENVIRONMENT
#   LISA_RSPEC_PARTIAL_COVERAGE_DIR  Fresh directory for the resultset. Required.
# -----------------------------------------------------------------------------

require 'fileutils'
require 'json'

# Moves a partial run's coverage out of the project's threshold check.
module LisaRspecPartialCoverage
  # Why a partial run asks for the full suite instead (status.json `escalate`).
  ESCALATE_NO_FINALIZE_MERGE = "this SimpleCov has no finalize_merge, so the slice cannot skip the project's minimums"

  module_function

  def directory
    value = ENV.fetch('LISA_RSPEC_PARTIAL_COVERAGE_DIR', '')
    raise ArgumentError, 'lisa-rspec-partial-coverage: LISA_RSPEC_PARTIAL_COVERAGE_DIR is not set' if value.empty?

    File.expand_path(value)
  end

  def measuring?
    defined?(::SimpleCov) && defined?(::Coverage) && ::Coverage.running?
  end

  def status(state)
    FileUtils.mkdir_p(directory)
    File.write(File.join(directory, 'status.json'), "#{JSON.generate(state)}\n")
  end

  def hand_off!
    return status('measuring' => false) unless measuring?

    unless ::SimpleCov.respond_to?(:finalize_merge)
      # Never stricter than whole-repo coverage (CodySwannGT/lisa#4600): the
      # slice cannot be measured safely, so ask the selector for the full
      # suite, whose verdict decides the push, and stop the slice here.
      status('measuring' => true, 'escalate' => ESCALATE_NO_FINALIZE_MERGE)
      raise "lisa-rspec-partial-coverage: #{ESCALATE_NO_FINALIZE_MERGE}; the selector runs the full suite instead. " \
            "Upgrade simplecov (Lisa's Gemfile.lisa pins >= 1.3.2) to keep partial pushes fast."
    end

    ::SimpleCov.coverage_path(directory)
    ::SimpleCov.finalize_merge(false)
    ::SimpleCov.command_name('Lisa partial push run')
    status('measuring' => true, 'resultset' => File.join(directory, '.resultset.json'))
  end
end

RSpec.configure do |config|
  config.before(:suite) { LisaRspecPartialCoverage.hand_off! }
end
