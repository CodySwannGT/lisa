#!/usr/bin/env bash
# Fixture: a governed script that derives the payment-client version from the
# canonical manifest rather than copying the pin. One edit site, one truth.
#
# It INSTALLS and nothing more. It never loads the client, makes a test-mode
# request, or asserts anything about behavior, so it is NOT detection evidence
# and the decision record must not cite it as such — a green run here would say
# nothing about whether charging a card still works. The record's
# detection-evidence field records that gap honestly instead.
set -euo pipefail

STRIPE_VERSION="$(node -p "require('./package.json').dependencies.stripe.replace(/^[^0-9]*/, '')")"
npm install -g "stripe@${STRIPE_VERSION}"
