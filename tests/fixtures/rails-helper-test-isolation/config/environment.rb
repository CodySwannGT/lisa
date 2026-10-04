# frozen_string_literal: true

require 'active_record'
require 'active_support/configuration_file'
require 'pathname'

module Rails
  def self.env
    @env ||= ActiveSupport::StringInquirer.new(ENV.fetch('RAILS_ENV', 'development'))
  end

  def self.root
    Pathname.new(Dir.pwd)
  end
end

File.open('events', 'a') { |file| file.puts 'application-boot' }
raw = ActiveSupport::ConfigurationFile.parse('config/database.yml')
shared = raw.delete('shared')
if shared
  raw.each_value do |config|
    if config.values.all? { |value| value.is_a?(Hash) }
      config.each do |name, database|
        defaults = shared.is_a?(Hash) && shared.values.all?(Hash) ? shared[name] : shared
        database.reverse_merge!(defaults) if defaults
      end
    else
      shared.each { |key, value| config[key] = value unless config.key?(key) }
    end
  end
end
ActiveRecord::Base.configurations = raw
File.open('events', 'a') { |file| file.puts 'connection-spy' }
ActiveRecord::Base.configurations.configs_for(env_name: Rails.env.to_s, include_hidden: true).each do |config|
  File.open('events', 'a') { |file| file.puts "database:#{config.name}:#{config.database}" }
end

module ActiveRecord
  class Migration
    def self.maintain_test_schema!
      File.open('events', 'a') { |file| file.puts 'schema-spy' }
    end
  end
end
