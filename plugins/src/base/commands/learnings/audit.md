---
description: "Run one learnings-gardener cycle: audit the ledger, rules, skills, wiki, and checks, and file tickets for promotions, demotions, confirmations, and retirements. Build-ready by default; human-gated for eager-rule promotions, human-authored files, or strict humanGate.mode."
argument-hint: "[max_candidates=10] [surface=ledger|rules|skills|wiki|all] [dry_run=true]"
---

Use the /lisa-learnings-audit skill (the gardener) to run one audit cycle: inventory the knowledge surfaces, gather per-item evidence, classify candidates through the ladder router, and emit marker-deduped tracker tickets (build-ready under the default `humanGate.mode: "access-only"`, human-gated under `"strict"`), reporting the terminal state. $ARGUMENTS
