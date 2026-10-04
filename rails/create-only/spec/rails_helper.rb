# frozen_string_literal: true

# Seeded by Lisa on first setup — this file is YOURS.
# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)

# Every supplied environment must be exactly test, before loading host code.
# Customize this host-owned regexp here for an explicit isolated naming policy.
LISA_TEST_DATABASE_NAME = /(?:\A|[_-])test(?:\z|[_-]|\.)/ unless defined?(LISA_TEST_DATABASE_NAME)

# Preflight uses Rails' parser and Active Record's real URL/config resolution.
# Trusted ERB, boot code and initializers remain host-owned executable code.
module LisaTestIsolation
  module_function

  def refuse!
    abort 'Rails test isolation: use only test environment and isolated test database names. ' \
          'See docs/rails-test-isolation.md in Lisa.'
  end

  def environment!
    refuse! if %w[RAILS_ENV RACK_ENV].any? { |name| ENV.key?(name) && ENV[name] != 'test' }
    ENV['RAILS_ENV'] ||= 'test'
    refuse! if defined?(Rails) && Rails.respond_to?(:env) && Rails.env.to_s != 'test'
  end

  def merge_shared!(config, shared)
    return config unless shared

    config.each_value do |environment|
      if environment.is_a?(Hash) && environment.values.all?(Hash)
        merge_roles!(environment, shared)
      else
        environment.reverse_merge!(shared)
      end
    end
    config
  end

  def merge_roles!(environment, shared)
    environment.each do |name, database|
      defaults = shared.is_a?(Hash) && shared.values.all?(Hash) ? shared[name] : shared
      database.reverse_merge!(defaults) if defaults
    end
  end

  def databases!(configurations)
    databases = configurations.configs_for(env_name: 'test', include_hidden: true)
    refuse! if databases.empty? || !LISA_TEST_DATABASE_NAME.is_a?(Regexp)
    databases.each do |database|
      name = database.database
      refuse! unless name.is_a?(String) && LISA_TEST_DATABASE_NAME.match?(File.basename(name))
    end
  rescue StandardError
    refuse!
  end

  def preflight!
    raw = ActiveSupport::ConfigurationFile.parse(File.expand_path('../config/database.yml', __dir__))
    refuse! unless raw.is_a?(Hash) && raw.key?('test')
    shared = raw.delete('shared')
    databases!(ActiveRecord::DatabaseConfigurations.new(merge_shared!(raw, shared)))
  rescue StandardError
    refuse!
  end
end

LisaTestIsolation.environment!

require_relative '../config/boot'
LisaTestIsolation.environment!
require 'active_record'
require 'active_record/database_configurations'
require 'active_support/configuration_file'

LisaTestIsolation.preflight!

require 'spec_helper'

LisaTestIsolation.environment!
require_relative '../config/environment'

require 'rspec/rails'

LisaTestIsolation.environment!
LisaTestIsolation.databases!(ActiveRecord::Base.configurations)

begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => error
  raise error.to_s.strip
end

RSpec.configure do |config|
  config.fixture_paths = [Rails.root.join('spec/fixtures')]
  config.use_transactional_fixtures = true
  config.infer_spec_type_from_file_location!
  config.filter_rails_from_backtrace!

  config.include FactoryBot::Syntax::Methods
end

Shoulda::Matchers.configure do |config|
  config.integrate do |with|
    with.test_framework :rspec
    with.library :rails
  end
end
