# frozen_string_literal: true

# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# -----------------------------------------------------------------------------
# Crystalball map recorder for `quality-rails.yml` (CodySwannGT/lisa#4612).
#
# Loaded into CI's full RSpec run (and into every shard leg) with
# `rspec --require`, so the host's own spec_helper needs no edit. It runs
# gitlab-crystalball's map generator with its coverage strategy and writes
# which application files each spec file executed, as JSON:
#
#   { "meta": { "baseSha", "createdAt", "runId", "job", "tool", ... },
#     "map": { "spec/models/user_spec.rb": ["app/models/user.rb", ...] },
#     "alwaysRun": ["spec/requests/js_spec.rb", ...] }
#
# The push-time selector (scripts/lisa-rspec-select.mjs) downloads that JSON
# and runs only the specs a change can reach. The map never decides what CI
# runs: CI always runs every spec.
#
# Two Crystalball strategies feed the map:
#
# - the coverage strategy: the files whose lines an example executed. It
#   starts at `before(:suite)`, after the project's spec_helper has started
#   SimpleCov, and reads the same `Coverage` measurement SimpleCov does, so
#   the coverage numbers are unchanged.
# - the described-class strategy: the files that define the class a spec
#   describes (`RSpec.describe User` -> app/models/user.rb and its
#   ancestors'). Line coverage cannot see what runs only when a class loads,
#   such as `validates`, `scope`, `has_many`, `attr_reader` or a one-line
#   `def x = y`, so without it a model spec would not be linked to its model
#   file. Its class-definition tracer starts when this file is required,
#   before the application loads.
#
# A spec that relies on such a declaration of a class it does not describe
# can still be missing from the map. CI runs every spec, so that gap costs
# push-time feedback, never merge protection; tag the spec
# `lisa_always_run: true` to run it on every partial push.
#
# When nothing measures coverage at `before(:suite)` (no SimpleCov, or
# coverage started in legacy array mode), it records nothing and
# says why: application files loaded before a late `Coverage.start` would be
# missing from the map, and a map that misses files would let a push skip
# specs that can see a change. No map means pushes run the full suite.
#
# Crystalball's ActionView strategy is deliberately not registered: it sees a
# view only when the view is first compiled, so a view rendered by several
# specs would be linked to the first one alone. Views are left out of the map,
# and a changed view therefore runs the full suite.
#
# Loaded from inside the project, this file would itself be measured; the
# workflow copies it outside the project root first, as it does the shard
# recorder.
#
# ENVIRONMENT
#   LISA_CRYSTALBALL_MAP_OUT   Path of the JSON map to write. Unset = no-op.
#   LISA_CRYSTALBALL_BASE_SHA  The pull request's base commit the map is for.
#   LISA_CRYSTALBALL_JOB       Optional label of the job or shard leg.
# -----------------------------------------------------------------------------

require 'fileutils'
require 'json'
require 'pathname'
require 'set'
require 'time'

# Records a Crystalball execution map as the JSON the push selector reads.
module LisaCrystalballRecorder
  SCHEMA_VERSION = 1

  # Crystalball map storage that folds example ids into spec files as the
  # generator dumps them, so memory stays bounded on a large suite.
  class FileMapStorage
    attr_reader :map

    def initialize
      @map = Hash.new { |hash, key| hash[key] = Set.new }
    end

    def clear!; end

    # Crystalball dumps its metadata (a Hash with :type) first, then example
    # groups: `{ "./spec/x_spec.rb[1:2]" => ["app/x.rb", ...] }`.
    def dump(data)
      return if data.key?(:type) || data.key?('type')

      data.each do |example_id, files|
        spec = LisaCrystalballRecorder.spec_file(example_id)
        @map[spec].merge(Array(files).map(&:to_s))
      end
    end
  end

  module_function

  def out_path
    ENV.fetch('LISA_CRYSTALBALL_MAP_OUT', '')
  end

  def enabled?
    !out_path.empty?
  end

  # "./spec/models/user_spec.rb[1:2]" -> "spec/models/user_spec.rb"
  def spec_file(example_id)
    example_id.to_s.sub(/\[[\d:]*\]\z/, '').sub(%r{\A\./}, '')
  end

  def relative(path)
    absolute = Pathname.new(File.expand_path(path.to_s))
    absolute.relative_path_from(Pathname.new(Dir.pwd)).to_s
  end

  def note(message)
    warn "lisa-crystalball-recorder: #{message}"
  end

  # The reason no map can be recorded, or nil when one can.
  def unusable_reason
    return 'gitlab-crystalball is not installed (Lisa\'s Gemfile.lisa adds it)' unless load_crystalball

    require 'coverage'
    return 'nothing measures coverage at the start of the suite (start SimpleCov in spec_helper)' unless ::Coverage.running?

    sample = ::Coverage.peek_result.each_value.first
    return 'coverage runs in legacy array mode, which Crystalball cannot read' if sample && !sample.is_a?(Hash)

    nil
  end

  def load_crystalball
    require 'crystalball'
    true
  rescue LoadError
    false
  end

  # Start tracing class definitions now, while this file is required and the
  # application has not loaded yet; a tracer started at `before(:suite)` would
  # miss every class an eager-loading test environment already defined.
  def arm_definition_tracer!
    return unless enabled? && load_crystalball

    @sources = ::Crystalball::MapGenerator::ObjectSourcesDetector.new(root_path: Dir.pwd)
    @sources.after_register
  end

  def start!
    return unless enabled?

    reason = unusable_reason
    if reason
      @sources&.before_finalize
      note("no map recorded: #{reason}. Pushes will run the full suite.")
      return
    end

    @storage = FileMapStorage.new
    @always_run = Set.new
    sources = @sources
    @generator = ::Crystalball::MapGenerator.new do |config|
      config.map_storage = @storage
      config.compact_map = false
      config.register ::Crystalball::MapGenerator::CoverageStrategy.new
      config.register ::Crystalball::MapGenerator::DescribedClassStrategy.new(execution_detector: sources)
    end
    @generator.start!
  end

  def before_example(example)
    @generator&.execute_before(example)
  end

  def after_example(example)
    return unless @generator

    @generator.execute_after(example)
    metadata = example.metadata
    return unless metadata[:js] || metadata[:lisa_always_run]

    @always_run << relative(metadata[:rerun_file_path] || example.file_path)
  end

  def finish!
    return unless @generator

    @generator.finalize!
    write_map
  end

  def write_map
    path = File.expand_path(out_path)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "#{JSON.pretty_generate(document)}\n")
    note("wrote #{@storage.map.size} spec file(s) to #{path}")
  end

  def document
    {
      'meta' => {
        'version' => SCHEMA_VERSION,
        'tool' => 'gitlab-crystalball',
        'toolVersion' => defined?(::Crystalball::VERSION) ? ::Crystalball::VERSION : nil,
        'baseSha' => ENV.fetch('LISA_CRYSTALBALL_BASE_SHA', ''),
        'runId' => ENV.fetch('GITHUB_RUN_ID', ''),
        'job' => ENV.fetch('LISA_CRYSTALBALL_JOB', ''),
        'createdAt' => Time.now.utc.iso8601
      },
      'map' => @storage.map.keys.sort.to_h { |spec| [spec, @storage.map[spec].to_a.sort] },
      'alwaysRun' => @always_run.to_a.sort
    }
  end
end

if LisaCrystalballRecorder.enabled?
  LisaCrystalballRecorder.arm_definition_tracer!
  RSpec.configure do |config|
    config.before(:suite) { LisaCrystalballRecorder.start! }
    config.prepend_before(:example) { |example| LisaCrystalballRecorder.before_example(example) }
    config.append_after(:example) { |example| LisaCrystalballRecorder.after_example(example) }
    config.after(:suite) { LisaCrystalballRecorder.finish! }
  end
end
