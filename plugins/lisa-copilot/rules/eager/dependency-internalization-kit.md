# Dependency Internalization Kit (load-bearing)

When a work item **removes, replaces, or internalizes** a material dependency,
ownership of that capability moves in-house. The risk moves with it: we stop
trusting an upstream project and start having to **prove we rebuilt the
capability correctly**. The confidence-rebuild kit is the standing acceptance
bar for that proof, so internalization work never has to guess at its own tests.

The kit is seven required evidence types. Each leads with the plain question it
answers:

1. **Real corpus** — did we test it on real inputs, not toy examples?
2. **Conformance fixtures** — does the new code do what the dependency did?
3. **Negative fixtures** — does it still reject what it should reject?
4. **Coverage as a gap detector** — what behavior is still untested?
5. **Provenance and license review** — where did this code come from, and are we
   allowed to use it?
6. **Migration and update plan** — how do existing call sites move, and how does
   the new code stay current?
7. **Rollback or replacement criteria** — what would make us go back, and to
   what?

All seven are required. A partial kit is the finding: dropping the corpus leaves
a toy-example pass, dropping negative fixtures leaves code that accepts garbage,
and dropping rollback criteria leaves nobody able to say the internalization
failed.

**When the kit applies:** ownership moves in-house — the dependency is removed,
replaced with our own code, vendored, or forked and maintained by us. That is
usually a move into the `thin wrapper suitable for in-house ownership` trust
class, or out of the dependency set entirely.

**When the kit does NOT apply:** a routine version bump of a trusted dependency
**within its existing trust class**. Ownership does not move, so there is no
rebuilt capability to prove. Applying the kit there is over-application — it
buys no confidence and makes ordinary upkeep expensive.

A work item that removes, replaces, or internalizes a material dependency
inherits all seven criteria unless it explicitly justifies why the dependency is
**non-material**. Silence is not a justification.

Full prose: [reference/dependency-internalization-kit.md](../reference/dependency-internalization-kit.md).
