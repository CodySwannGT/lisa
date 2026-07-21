# Dependency Decisions

<!-- lisa-dependency-decisions:v1 -->

Fixture: the host project's decision record AFTER the dependency-addition work
item in `tests/fixtures/dependency-trust-classes/dependency-addition-ticket.md`
has shipped. It is the scaffold Lisa ships
(`all/create-only/.lisa/DEPENDENCY_DECISIONS.md`) with one real entry appended,
so the nine fields and their order are the scaffold's, not this fixture's
invention.

The entry answers eight of its nine fields from evidence this fixture project
actually contains. The ninth — detection evidence — is deliberately left as an
honest gap, because this project ships no check that would catch a bad update
yet. Writing a check we do not have into the record would be exactly the failure
the whole layer exists to prevent: a confident answer nobody re-checks. For a
runtime-critical service client that gap is a blocker rather than a to-do, so
the entry says so in the field itself.

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
- **What would catch a bad update (detection evidence):** `_Not yet decided_`.
  The only automation this project runs against the payment client today is
  `scripts/install-payment-client.sh`, which installs the pinned version and
  asserts nothing about behavior — it would pass just as happily against a
  release that silently stopped charging cards. **Class requirement not
  currently met:** a runtime-critical service client may not be trusted blind,
  so the check this field will eventually name — a test-mode charge on every
  pull request, plus a production monitor on checkout success rate — has to
  exist before this entry can be signed off. Until it does, this line is an
  escalation, not a to-do.
- **Who owns this and how often we recheck (owner / review cadence):** The
  named payments engineer who owns the billing service — re-read at every
  version change, and at minimum every 6 months.
- **Last reviewed:** 2026-07-21
