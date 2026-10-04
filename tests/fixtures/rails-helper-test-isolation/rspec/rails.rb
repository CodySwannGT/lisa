# frozen_string_literal: true

module FactoryBot
  module Syntax
    module Methods
    end
  end
end

module RSpec
  class Configuration
    attr_accessor :fixture_paths, :use_transactional_fixtures

    def infer_spec_type_from_file_location!
      File.open('events', 'a') { |file| file.puts 'rspec-infer' }
    end

    def filter_rails_from_backtrace!
      File.open('events', 'a') { |file| file.puts 'rspec-filter' }
    end

    def include(mod)
      raise 'FactoryBot missing' unless mod == FactoryBot::Syntax::Methods
      File.open('events', 'a') { |file| file.puts 'factory-bot' }
    end
  end

  def self.configure
    config = Configuration.new
    yield config
    raise 'transactional fixtures missing' unless config.use_transactional_fixtures
    raise 'fixture paths missing' unless config.fixture_paths == [Rails.root.join('spec/fixtures')]
    File.open('events', 'a') { |file| file.puts 'rspec-configured' }
  end
end

module Shoulda
  module Matchers
    def self.configure
      yield self
    end

    def self.integrate
      yield self
    end

    def self.test_framework(value)
      raise 'RSpec missing' unless value == :rspec
    end

    def self.library(value)
      raise 'Rails missing' unless value == :rails
      File.open('events', 'a') { |file| file.puts 'shoulda-configured' }
    end
  end
end
