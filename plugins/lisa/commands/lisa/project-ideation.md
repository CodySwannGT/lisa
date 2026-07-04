---
description: "Generate persona-grounded, verifiable product ideas for the host project, then create PRDs for the selected build-ready ideas via lisa-research. First derives the personas the project actually serves (from its docs, code, data model, and releases — never invented), ideates per persona, and gates each idea on an obtainable data/source path and an empirical verification plan. Creates one PRD by default (top-ranked idea); max_prds widens the batch. prd_ready=true creates them prd-ready for auto-pickup by lisa-intake; default is draft for human review."
argument-hint: "[target path | external product] [prd_ready=true|false] [max_prds=<n>|all]"
---

Use the /lisa-project-ideation skill to derive evidence-grounded personas, ideate per persona, gate the ideas, and create PRDs for the selected build-ready ideas via lisa-research — in draft state by default, or prd-ready when prd_ready=true; one PRD by default, more with max_prds. $ARGUMENTS
