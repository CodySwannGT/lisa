#!/bin/sh
# Generic Linux original-hook fixture; local emulation is not hosted acceptance.
set -eu
umask 077
export HOME=/proof/home
export BUNDLE_PATH=/proof/gems
export BUNDLE_APP_CONFIG=/proof/bundle-config
export GEM_HOME=/proof/bootstrap-gems
export GEM_PATH=/proof/bootstrap-gems:/usr/local/bundle

if [ "$1" = hook ]; then
  cd /proof/case
  exec git push origin HEAD:refs/heads/main
fi
[ "$1" = setup ]
mkdir -m 700 /proof/home /proof/bootstrap-gems
mkdir -p /proof/case/config /proof/case/bin /proof/case/app
cd /proof/case
ruby --version
uname -s
uname -m
gem install bundler --version 2.4.10 --no-document
cat > Gemfile <<'GEMFILE'
source "https://rubygems.org"
gem "rails", "8.1.4"
gem "mysql2", "0.5.7"
gem "lefthook", "2.1.16"
GEMFILE
bundle _2.4.10_ lock
export BUNDLE_FROZEN=true
bundle _2.4.10_ install --jobs 2 --retry 0
bundle _2.4.10_ exec ruby -e 'require "rails"; require "mysql2"; puts({ruby: RUBY_VERSION, rails: Rails.version, mysql2: Mysql2::VERSION, mysql_client: Mysql2::Client.info}.inspect)'
cat > config/application.rb <<'RUBY'
require "rails"
require "active_record/railtie"
module RuntimeFixture
  class Application < Rails::Application
    config.load_defaults 8.1
    config.eager_load = false
    config.secret_key_base = "synthetic-native-runtime-fixture-only"
  end
end
RUBY
cat > config/boot.rb <<'RUBY'
ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)
require "bundler/setup"
RUBY
cat > config/environment.rb <<'RUBY'
require_relative "boot"
require_relative "application"
Rails.application.initialize!
RUBY
cat > bin/rails <<'RUBY'
#!/usr/bin/env ruby
APP_PATH = File.expand_path("../config/application", __dir__)
require_relative "../config/boot"
require "rails/commands"
RUBY
chmod 700 bin/rails
cat > Rakefile <<'RUBY'
require_relative "config/application"
Rails.application.load_tasks
RUBY
cat > config/database.yml <<'YAML'
default: &default
  adapter: mysql2
  encoding: utf8mb4
  collation: utf8mb4_0900_ai_ci
  host: <%= ENV.fetch("PRIMARY_DB_HOST") %>
  port: <%= Integer(ENV.fetch("DATABASE_PORT")) %>
  username: <%= ENV.fetch("DATABASE_USER") %>
  password: <%= ENV.fetch("DATABASE_PASSWORD") %>
test:
  primary:
    <<: *default
    database: <%= ENV.fetch("DATABASE_NAME") %>_test
    migrations_paths: db/primary_migrate
  queue:
    <<: *default
    database: <%= ENV.fetch("DATABASE_NAME") %>_queue_test
    migrations_paths: db/queue_migrate
  cache:
    <<: *default
    database: <%= ENV.fetch("DATABASE_NAME") %>_cache_test
    migrations_paths: db/cache_migrate
  cable:
    <<: *default
    database: <%= ENV.fetch("DATABASE_NAME") %>_cable_test
    migrations_paths: db/cable_migrate
YAML
for role in primary queue cache cable; do
  mkdir -p "db/${role}_migrate"
  cat > "db/${role}_migrate/20261008000000_create_runtime_witnesses.rb" <<'RUBY'
class CreateRuntimeWitnesses < ActiveRecord::Migration[8.1]
  def change
    create_table :runtime_witnesses do |table|
      table.string :payload, null: false
    end
  end
end
RUBY
done
cat > lefthook.yml <<'YAML'
pre-push:
  commands:
    rails-runtime:
      run: RAILS_ENV=test bundle exec rails db:prepare
YAML
git init --quiet
git config user.name "Synthetic native fixture"
git config user.email "fixture@example.invalid"
git add Gemfile Gemfile.lock config bin Rakefile lefthook.yml db
git commit --quiet -m 'test: establish original native Rails hook'
git init --bare --quiet /proof/remote.git
git remote add origin /proof/remote.git
bundle _2.4.10_ exec lefthook version
bundle _2.4.10_ exec lefthook install
printf 'LISA_NATIVE_FIXTURE_READY\n'
