# [api] Add Stripe SDK to process subscription payments

**Labels:** `type:Task`, `priority:high`, `repo:api`

## Context / Business Value

Customers cannot pay us today. This work unit adds the payment client that
charges a card and records the result, which is the last blocker on launching
paid plans.

## Proposed material dependency

- **Dependency:** `stripe` (Node SDK)
- **Trust class:** runtime-critical service client
- **Why that class:** it runs on the production request path and reaches
  customer payment data and money directly. Maturity does not lower the class —
  blast radius sets it.

### Required evidence for this trust class

- **Capability owner:** a named accountable person, not a team — the payments
  engineer who owns the billing service.
- **Update cadence:** re-judged at every version change; the version is pinned
  exactly so upgrades are always deliberate.
- **Detection evidence:** an integration test that charges a card against
  Stripe's test mode, plus a production monitor on the checkout success rate.
  "Nothing would catch it" is not acceptable in this class.
- **Replacement cost:** written down, not `_Not yet decided_` — roughly three
  weeks to re-platform onto another processor, because webhook handling and
  stored payment methods would both have to move.
- **Product/human ratification:** **required** before this work starts, and
  again before any major version upgrade.

## Acceptance criteria

```gherkin
Scenario: A subscription charge succeeds
  Given a customer with a valid saved payment method
  When they confirm a subscription upgrade
  Then the charge is recorded and the plan changes within one request

Scenario: The dependency decision is recorded
  Given the Stripe SDK is added in this change
  When the change is reviewed
  Then .lisa/DEPENDENCY_DECISIONS.md contains an entry naming its trust class,
    its detection evidence, and its named accountable owner
```

- **Verification:** Integration test -- test-mode charge against the real SDK.
- **Dependencies:** none.
- **Skills:** lisa-tdd-implementation, lisa-test-strategy.
