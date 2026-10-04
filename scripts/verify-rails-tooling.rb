# frozen_string_literal: true

# Run with the consumer bundle, Ruby 3.4, and an empty owned scratch directory:
# bundle exec ruby scripts/verify-rails-tooling.rb MODE TEMPLATE_ROOT SCRATCH
# Modes: bounds, configuration, coverage, coverage-negative,
# coverage-line-negative, matchers, matchers-negative, security,
# security-negative, lint, lint-negative, helper-lint.
# This bounded probe never boots Rails or connects to a database. The packaged
# Rails/MySQL journey remains a separate acceptance check.
require "fileutils"
require "json"

SELECTED = {
  "brakeman" => "8.1.0",
  "database_consistency" => "3.0.14",
  "rack-mini-profiler" => "5.0.0",
  "rspec-rails" => "8.0.4",
  "rubocop-capybara" => "3.0.0",
  "rubocop-yard" => "1.3.0",
  "shoulda-matchers" => "8.0.1",
  "simplecov" => "1.3.2"
}.freeze

mode, template_root, scratch = ARGV
abort "Expected MODE TEMPLATE_ROOT SCRATCH" unless ARGV.length == 3
template_root = File.realpath(template_root)
scratch = File.realpath(scratch)
abort "Scratch must be empty" unless Dir.children(scratch).empty?

def copy_template(root, relative, destination)
  FileUtils.mkdir_p(File.dirname(destination))
  FileUtils.cp(File.join(root, relative), destination)
end

Dir.chdir(scratch) do
  case mode
  when "bounds"
    require "bundler"
    definition = Bundler::Dsl.evaluate(File.join(template_root, "rails/copy-overwrite/Gemfile.lisa"), nil, {})
    failures = SELECTED.filter_map do |name, selected|
      dependency = definition.dependencies.find { |item| item.name == name }
      abort "Missing family #{name}" unless dependency
      actual = Gem.loaded_specs.fetch(name).version
      abort "Wrong selected version #{name}: #{actual}" unless actual.to_s == selected
      next_major = Gem::Version.new("#{actual.segments.first + 1}.0.0")
      abort "Untested next major admitted for #{name}" if dependency.requirement.satisfied_by?(next_major)
      "#{name}: #{dependency.requirement} rejects #{actual}" unless dependency.requirement.satisfied_by?(actual)
    end
    abort failures.join("\n") unless failures.empty?
    { "shoulda-matchers" => "8.0.0", "simplecov" => "1.3.1" }.each do |name, old_patch|
      requirement = definition.dependencies.find { |item| item.name == name }.requirement
      abort "Pre-fix patch admitted for #{name}" if requirement.satisfied_by?(Gem::Version.new(old_patch))
    end
    puts JSON.generate(marker: "RAILS_TOOL_BOUNDS_ACCEPTED", versions: SELECTED)
  when "configuration"
    copy_template(template_root, "rails/create-only/.simplecov", ".simplecov")
    require "simplecov/no_defaults"
    require "simplecov"
    SimpleCov.deprecations :raise
    load ".simplecov"
    abort "Configuration must not start coverage" if Coverage.running?
    puts "SIMPLECOV_CONFIGURATION_ACCEPTED"
  when "coverage", "coverage-negative", "coverage-line-negative"
    copy_template(template_root, "rails/create-only/.simplecov", ".simplecov")
    copy_template(template_root, "rails/create-only/spec/spec_helper.rb", "spec/spec_helper.rb")
    FileUtils.mkdir_p("app/models")
    File.write("app/models/coverage_probe.rb", <<~RUBY)
      class CoverageProbe
        def greeting(value)
          if value == :hello
            "welcome"
          else
            "goodbye"
          end
        end
        def detail
          text = "detail"
          text.upcase
          text.reverse
        end
      end
    RUBY
    require "rspec/core"
    load "spec/spec_helper.rb"
    SimpleCov.deprecations :raise
    abort "Coverage must start in the helper" unless Coverage.running?
    SimpleCov.merging false
    require File.join(scratch, "app/models/coverage_probe")
    probe = CoverageProbe.new
    abort "Wrong exercised result" unless probe.greeting(:hello) == "welcome"
    if mode != "coverage-negative"
      abort "Wrong second branch" unless probe.greeting(:other) == "goodbye"
    end
    abort "Wrong line-control result" unless probe.detail == "liated" if mode == "coverage"
    puts "COVERAGE_PROBE_EXECUTED"
  when "matchers", "matchers-negative"
    copy_template(template_root, "rails/create-only/.simplecov", ".simplecov")
    copy_template(template_root, "rails/create-only/spec/spec_helper.rb", "spec/spec_helper.rb")
    FileUtils.mkdir_p("app/models")
    FileUtils.mkdir_p("spec/models")
    File.write("app/models/matcher_probe.rb", <<~RUBY)
      class MatcherProbe
        include ActiveModel::Model
        attr_accessor :name
        #{'validates :name, presence: true' if mode == "matchers"}
      end
    RUBY
    File.write("spec/models/matcher_probe_spec.rb", <<~RUBY)
      require "spec_helper"
      require "active_model"
      require "shoulda/matchers"
      Shoulda::Matchers.configure do |config|
        config.integrate do |with|
          with.test_framework :rspec
          with.library :active_model
        end
      end
      require File.join(Dir.pwd, "app/models/matcher_probe")
      RSpec.describe MatcherProbe, type: :model do
        it { is_expected.to validate_presence_of(:name) }
      end
    RUBY
    require "rspec/core"
    exit RSpec::Core::Runner.run(["--format", "documentation", "spec/models/matcher_probe_spec.rb"])
  when "security", "security-negative"
    FileUtils.mkdir_p(["app/controllers", "app/models", "config"])
    File.write("Gemfile", "source 'https://rubygems.org'\ngem 'rails', '= 8.1.4'\n")
    File.write("config/application.rb", "require 'rails/all'\nmodule ToolingProbe\nclass Application < Rails::Application\nconfig.load_defaults 8.1\nend\nend\n")
    File.write("config/routes.rb", "Rails.application.routes.draw { resources :probe_records }\n")
    File.write("app/controllers/application_controller.rb", "class ApplicationController < ActionController::Base\nend\n")
    File.write("app/models/probe_record.rb", "class ProbeRecord < ActiveRecord::Base\nend\n")
    query = if mode == "security-negative"
              'ProbeRecord.where("name = \'#{params[:name]}\'")'
            else
              "ProbeRecord.where(name: params[:name])"
            end
    File.write("app/controllers/probe_records_controller.rb", "class ProbeRecordsController < ApplicationController\n def index\n #{query}\n end\nend\n")
    require "brakeman"
    tracker = Brakeman.run(app_path: scratch, quiet: true, print_report: false, run_checks: ["CheckSQL"])
    abort "No SQL check executed" unless tracker.checks.checks_run.include?("SQL")
    abort "No model/controller inspected" if tracker.models.empty? || tracker.controllers.empty?
    warnings = tracker.checks.all_warnings.select { |warning| warning.warning_type == "SQL Injection" }
    puts JSON.generate(marker: "BRAKEMAN_SQL_CONTROL", checks: tracker.checks.checks_run, warnings: warnings.length, models: tracker.models.length, controllers: tracker.controllers.length)
    exit(warnings.empty? ? 0 : 1)
  when "helper-lint"
    copy_template(template_root, "rails/copy-overwrite/.rubocop.yml", ".rubocop.yml")
    [".rubocop_todo.yml", "rubocop.thresholds.yml", ".rubocop.local.yml"].each do |name|
      copy_template(template_root, "rails/create-only/#{name}", name)
    end
    ["spec/spec_helper.rb", "spec/rails_helper.rb"].each do |name|
      copy_template(template_root, "rails/create-only/#{name}", name)
    end
    require "rubocop"
    exit RuboCop::CLI.new.run(["--format", "json", "--cache", "false", "spec/spec_helper.rb", "spec/rails_helper.rb"])
  when "lint", "lint-negative"
    copy_template(template_root, "rails/copy-overwrite/.rubocop.yml", ".rubocop.yml")
    [".rubocop_todo.yml", "rubocop.thresholds.yml", ".rubocop.local.yml"].each do |name|
      copy_template(template_root, "rails/create-only/#{name}", name)
    end
    FileUtils.mkdir_p("spec/features")
    negative = mode == "lint-negative"
    File.write("spec/features/tooling_probe_spec.rb", <<~RUBY)
      #{negative ? 'all(".thing").first' : 'find(".thing")'}

      # @param #{negative ? "wrong" : "name"} [String] the name
      def greeting(name)
        name
      end
    RUBY
    require "rubocop"
    exit RuboCop::CLI.new.run(["--only", "Capybara/FindAllFirst,YARD/MismatchName", "--format", "json", "--cache", "false", "spec/features/tooling_probe_spec.rb"])
  else
    abort "Unknown mode #{mode}"
  end
end
