# frozen_string_literal: true
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# Reads application version from the VERSION file at project root.
# The VERSION file is managed by standard-version and bumped during releases.
APP_VERSION = Rails.root.join('VERSION').read.strip.freeze
