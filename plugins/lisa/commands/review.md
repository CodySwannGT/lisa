---
description: "Review code changes. Runs quality, security, performance, product, and test reviews in parallel, then consolidates findings."
argument-hint: "[pr-link-or-branch]"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Review** sub-flow.

This sub-flow is also invoked automatically by the Implement flow. It runs `quality-specialist`, `security-specialist`, and `performance-specialist` in parallel, followed by `product-specialist` and `test-specialist`. Consolidates all findings ranked by severity.

$ARGUMENTS
