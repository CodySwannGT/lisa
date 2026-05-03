---
name: advisor-upsert
description: This skill should be used when creating or updating a financial advisor's record in the project's database. It treats FINRA BrokerCheck and AdvisorHub as the primary sources of truth, augments them with deep web research, then performs an idempotent upsert keyed on the advisor's CRD number (or a stable equivalent).
allowed-tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write", "WebFetch", "WebSearch", "Skill"]
---

# Upsert Financial Advisor Record

Input: $ARGUMENTS

The first argument is the advisor's **full legal name** (required). Any additional arguments are optional disambiguators — firm name, city/state, CRD number, AdvisorHub profile URL, BrokerCheck URL, etc. Use them to narrow the search when the name is common.

If no advisor name is supplied, stop and ask the user for one.

## Idempotency contract

This skill must be safe to run repeatedly with the same input and converge to the same database state:

- **Key on CRD number** when available (it is the canonical, immutable FINRA identifier). Fall back to `(normalized_full_name, firm_crd, primary_office_location)` only if no individual CRD can be resolved.
- **Update in place** when a record already exists; do not insert duplicates.
- **Only write fields that changed.** Compare incoming values to stored values and skip no-op writes so the operation is cheap on re-runs.
- **Never overwrite a present, verified field with `null`/empty** sourced from a research gap. Treat missing research data as "no new information," not "clear the field."
- Record `source`, `source_url`, and `fetched_at` on every field you write so subsequent runs can reason about freshness.

## Step 1 — Resolve the database target

Detect the project's data layer before touching anything. In order of preference, look for:

1. ORM schema files: `prisma/schema.prisma`, `drizzle.config.*`, `**/schema.ts`, `**/models/*.{ts,js,rb,py}`, `db/schema.rb`
2. Migrations directory: `migrations/`, `db/migrate/`, `prisma/migrations/`
3. Repository/DAO layer: `**/repositories/`, `**/dao/`, `src/db/`
4. Connection config: `DATABASE_URL` in `.env*`, `database.yml`, `knexfile.*`

From what you find, identify:
- The advisor table/model name (e.g., `Advisor`, `advisors`, `FinancialAdvisor`)
- The CRD identifier column (commonly `crd_number`, `crdNumber`, `crd`)
- The available columns (so you only attempt to write fields that exist)

If you cannot confidently identify an advisor table, **stop and ask the user** which table to write to and which column holds the CRD. Do not invent a schema.

If the schema exists but is missing fields the research returned (e.g., disclosures, exam history), surface them in the final summary as "fields available but not stored" — do not silently drop them and do not add columns without being asked.

## Step 2 — Pull from primary sources

### 2a. FINRA BrokerCheck (authoritative for licensing)

Search BrokerCheck for the advisor. The public site is `https://brokercheck.finra.org/`; individual records live at `https://brokercheck.finra.org/individual/summary/<CRD>`.

1. Use `WebSearch` with a query like `"<full name>" site:brokercheck.finra.org` plus any disambiguator the user gave (firm, city).
2. Use `WebFetch` to retrieve the candidate profile page(s).
3. Confirm identity using at least two of: name, firm, location, CRD, years of experience.
4. Extract:
   - CRD number (individual)
   - Current employer / firm CRD
   - Years of experience, first registered date
   - Registered states and SROs
   - Industry exams passed (Series 7, 63, 65, 66, etc.)
   - Disclosure count and types (customer disputes, regulatory events, criminal, financial, employment-separation)
   - Previous registrations (firm name, CRD, dates)

If BrokerCheck returns multiple candidates and the user-supplied disambiguators are insufficient to choose one, **stop and ask the user to confirm** which CRD is correct. Never guess between two real people.

### 2b. AdvisorHub (authoritative for moves, news, profile context)

Search AdvisorHub for the advisor. The public site is `https://www.advisorhub.com/`.

1. `WebSearch` with `"<full name>" site:advisorhub.com`.
2. `WebFetch` the most relevant articles and any profile/leaderboard pages.
3. Extract anything BrokerCheck won't have: recent firm moves, AUM (if reported), team affiliation, leaderboard rankings, quoted commentary, notable transitions.

AdvisorHub is editorial — treat AUM and team-size figures as reported-by-source, not authoritative. Always store with `source: "advisorhub"` and the article URL.

## Step 3 — Deep research for everything else

Once the primary sources are exhausted, run targeted web research to fill remaining gaps. Use `WebSearch` and `WebFetch` for, in roughly this priority:

1. The advisor's **firm bio page** (often at `<firm-domain>/team/<slug>` or similar) — credentials (CFP, CFA, CIMA, ChFC), specialties, education, languages, contact info
2. **SEC IAPD** (`https://adviserinfo.sec.gov/`) for IA-side registration, AUM disclosed on Form ADV
3. **LinkedIn** public profile (career history, education, certifications) — fetch only the public-visible portion
4. Press releases announcing hires/transitions
5. Industry awards lists (Forbes/Barron's Top Advisors, etc.) where independently verifiable

For every field you intend to write, record the source URL. If two sources disagree, prefer the order: BrokerCheck > SEC IAPD > firm bio > AdvisorHub > other press > LinkedIn. Note conflicts in a `notes` field rather than silently picking a winner.

Stop researching when you've either filled every column the schema supports or made three consecutive fetches that yielded no new fields.

## Step 4 — Diff and upsert

1. Look up the existing record by CRD (or fallback key). Use the project's existing repository/DAO/ORM API — do not write raw SQL unless the project itself does.
2. Build a field-by-field diff: `existing` vs `incoming`.
3. Drop fields where `incoming` is empty/unknown and `existing` is populated (Idempotency contract rule 4).
4. Drop fields where `incoming === existing` (no-op).
5. If the resulting diff is empty, **do not write** — report "no changes" and exit.
6. Otherwise, perform a single `upsert` (or `update` if the record exists) within a transaction if the ORM supports one.

If the project has a script runner pattern (e.g., a `scripts/` dir with a runnable file, a Rails runner, an `npm run` script for one-off jobs), prefer adding/using that pattern over executing ad-hoc database calls from the shell.

## Step 5 — Report

Output to the user:

- The CRD that was used as the key
- Whether the operation was an `insert`, `update`, or `no-op`
- A bullet list of fields written, each annotated with its source
- Any conflicts found between sources (with both values and both URLs)
- Any research findings that the schema cannot store (so the user can decide whether to extend the schema)
- Any disambiguation questions you had to resolve (and how)

Keep the report tight — this is a status, not a research dossier. Persist the dossier in the database, not the chat.

## What this skill does not do

- It does not create database migrations. If a needed column is missing, surface it in the report and stop.
- It does not delete advisor records.
- It does not paginate through every BrokerCheck disclosure document — store the count and the disclosure-summary URL; deep-dive disclosure parsing is out of scope.
- It does not bypass robots.txt or paywalls. If a source is gated, note "source unavailable" and move on.
