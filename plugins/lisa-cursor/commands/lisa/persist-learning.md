---
description: "Route a candidate learning through the hostile-default learning-judge gate and act on the verdict: leave a dropped-with-reason note on the triggering issue (drop), file the upstream Lisa ticket automatically with marker dedupe, evidence, and a per-run cap (lisa-upstream), or persist a durable learning via a confidence-routed PR that touches only the learnings surface — auto-merge on for high confidence, auto-merge off plus the learning:needs-triage label for low confidence (unless learnings.lowConfidence is auto-merge). Idempotent via marker dedupe."
argument-hint: "<candidate-json-or-fields>"
---

Use the /lisa-persist-learning skill to judge, fingerprint, and route the candidate learning. $ARGUMENTS
