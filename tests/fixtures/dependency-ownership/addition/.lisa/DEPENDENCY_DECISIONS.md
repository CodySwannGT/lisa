# Dependency Decisions

<!-- lisa-dependency-decisions:v1 -->

Fixture: the host project's decision record AFTER the dependency-addition work
item in `tests/fixtures/dependency-trust-classes/dependency-addition-ticket.md`
has shipped. It is the scaffold Lisa ships
(`all/create-only/.lisa/DEPENDENCY_DECISIONS.md`) with one real entry appended,
so the nine fields and their order are the scaffold's, not this fixture's
invention.

The entry defers nothing. That is not the scaffold's general bar — an
unanswered field is honestly marked rather than guessed — it is what this
dependency's trust class demands of this particular entry.

Nothing after `## Records` is guidance, so appending stays safe.

## Records

### stripe

- **Why we keep it:** It is how the product takes money. Without it a customer
  can pick a paid plan but cannot pay for one, so every paid feature stays
  unreachable and no revenue is collected.
- **What it is (dependency):** `stripe` (Node SDK) `18.5.0`, pinned exactly in
  `package.json` and nowhere else.
- **What it does for us (owned capability):** Charging a saved payment method
  and recording the result of that charge.
- **Why we believe it's safe (trust basis):** Trust class:
  **runtime-critical service client**. It runs on the production request path
  and reaches customer payment data and money directly, so blast radius sets the
  class and maturity does not lower it. Published by the payment processor
  itself with a documented release and security-disclosure process; the version
  is pinned exactly, so every upgrade is a deliberate decision. Human review is
  triggered by any version change and by any change to what the client is
  allowed to reach.
- **What breaks if this is compromised (exposure):** Production runtime. It
  reaches customer payment methods, charge amounts, and the API credential that
  can move money. A bad update can take payments down or misroute them.
- **What it would take to replace (replacement cost):** Roughly three weeks.
  Webhook handling and stored payment methods would both have to move to another
  processor, and the migration cannot be done silently because saved cards do
  not transfer on their own.
- **What would catch a bad update (detection evidence):** The `payments`
  integration test, which charges a card against the processor's test mode on
  every pull request, plus the production monitor on checkout success rate.
  "Nothing would catch it" is not an acceptable answer in this class.
- **Who owns this and how often we recheck (owner / review cadence):** The
  named payments engineer who owns the billing service — re-read at every
  version change, and at minimum every 6 months.
- **Last reviewed:** 2026-07-21
