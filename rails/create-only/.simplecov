# frozen_string_literal: true

require 'json'

thresholds_path = File.join(File.dirname(__FILE__), 'simplecov.thresholds.json')
thresholds = if File.exist?(thresholds_path)
               JSON.parse(File.read(thresholds_path))
             else
               { 'line' => 80, 'branch' => 70 }
             end

SimpleCov.load_profile 'rails'

SimpleCov.configure do
  deprecations :raise
  coverage :line, minimum: thresholds['line']
  coverage :branch, minimum: thresholds['branch']

  group 'Models', 'app/models'
  group 'Controllers', 'app/controllers'
  group 'Services', 'app/services'
  group 'Jobs', 'app/jobs'
  group 'Mailers', 'app/mailers'
  group 'Serializers', 'app/serializers'
  group 'Libraries', 'lib'

  skip '/spec/'
  skip '/config/'
  skip '/db/'
  skip '/vendor/'
end
