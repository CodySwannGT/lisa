# History Audit — Before Removing or Changing Existing Behavior (load-bearing)

Before you remove, gate, skip, or weaken existing behavior because it looks redundant, slow, or wrong to you, audit its history. Changes a ticket or spec requires can cite that requirement instead.

Run `git log --follow` on the files and `git log --grep` for related terms. Read full commit bodies, comments, and covering tests, because the reason usually lives there. Then give a verdict with the change: either **defended by <commit/comment/test>**, and adapt the change to keep that reason, or **no defense found**. Treat behavior that looks redundant as defended until you have checked. Diagnosis needs no audit; a recommendation to change behavior does.

Full prose: [reference/history-audit.md](../reference/history-audit.md).
