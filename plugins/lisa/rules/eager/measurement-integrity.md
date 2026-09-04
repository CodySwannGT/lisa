# Measurement Integrity (load-bearing)

**Before you report a count, a population, or "N items affected", run the checks — because every way this goes wrong produces output that looks exactly like an answer.** No exception, no warning, no partial flag: the wrong number is indistinguishable from the right one by reading it.

That is why "be careful about scope" is not a remedy. **Every check below is performed or not performed**, never noticed:

1. **State the population boundary** before enumerating — what is in, and what is adjacent and out.
2. **Prove the enumeration complete** — paginate, and *assert* the end-of-pages signal rather than trusting it. A silent cap looks exactly like a population.
3. **Validate the detector against known-true items.** If it cannot find the examples you already have, its total means nothing.
4. **Treat search results as candidates, never members** — read each one directly and confirm the literal.
5. **Control the instrument in both directions** — it must report a real absence, and must not invent one.
6. **Report pattern-derived totals as floors**, and **state the unit** beside any count whose argument rests on how many *independent* observations you have.

No single check covers the others: validating against known items is blind to truncation, and reading every candidate can only ever see what enumeration handed it.

**And one that fires while reading rather than measuring:** a filter built from the failure shapes you already expect cannot show you a shape you did not. Read gate and tool output **unfiltered** on a refusal — the diagnosis is usually already in it.

Full method (six modes in two families, the membership test for adding a seventh, and which check is blind to what): [reference/measurement-integrity.md](../reference/measurement-integrity.md).
