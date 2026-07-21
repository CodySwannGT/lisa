#!/usr/bin/env bash
# Fixture: a governed script that derives the payment-client version from the
# canonical manifest rather than copying the pin. One edit site, one truth.
set -euo pipefail

STRIPE_VERSION="$(node -p "require('./package.json').dependencies.stripe.replace(/^[^0-9]*/, '')")"
npm install -g "stripe@${STRIPE_VERSION}"
