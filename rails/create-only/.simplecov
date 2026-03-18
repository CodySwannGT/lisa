# frozen_string_literal: true

require 'json'

thresholds_path = File.join(File.dirname(__FILE__), 'simplecov.thresholds.json')
thresholds = if File.exist?(thresholds_path)
               JSON.parse(File.read(thresholds_path))
             else
               { 'line' => 80, 'branch' => 70 }
             end

SimpleCov.start 'rails' do
  enable_coverage :branch

  minimum_coverage line: thresholds['line'], branch: thresholds['branch']

  add_group 'Models', 'app/models'
  add_group 'Controllers', 'app/controllers'
  add_group 'Services', 'app/services'
  add_group 'Jobs', 'app/jobs'
  add_group 'Mailers', 'app/mailers'
  add_group 'Serializers', 'app/serializers'
  add_group 'Libraries', 'lib'

  add_filter '/spec/'
  add_filter '/config/'
  add_filter '/db/'
  add_filter '/vendor/'
end
