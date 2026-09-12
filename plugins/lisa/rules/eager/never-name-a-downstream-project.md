# Never Name a Downstream Project (load-bearing)

Refer to a downstream project by its **role in the argument** — never by organization, product, or repository name — in tracker items, pull requests, commits, rules, skills, anything that outlives the session.

Write the evidence, not the identity: "a caller repo", "repo A" / "repo B" when two are contrasted. **An argument never depends on which project proved it**; if it seems to, fix the argument.

Default-deny: it covers names nobody listed. `block-host-name-leak` catches some of them and is a rate reduction, never a proof.

Full prose: [reference/never-name-a-downstream-project.md](../reference/never-name-a-downstream-project.md).
