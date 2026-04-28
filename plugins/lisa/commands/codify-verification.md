---
description: "Convert empirical verification into a regression test (Playwright for UI, integration test for API/DB, benchmark for performance, etc.) so it doesn't regress. Mandatory step after verification passes — invoked from verification-lifecycle and from each Build/Fix/Improve flow."
argument-hint: "<verification-type> <what-was-verified>"
---

Use the /lisa:codify-verification skill to encode the empirical verification that just passed as a regression test, in the appropriate framework for the verification type. $ARGUMENTS
