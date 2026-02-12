# frozen_string_literal: true

# Reads application version from the VERSION file at project root.
# The VERSION file is managed by standard-version and bumped during releases.
APP_VERSION = Rails.root.join('VERSION').read.strip.freeze
