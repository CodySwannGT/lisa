---
name: block-env-branch-push
enabled: true
event: bash
action: block
pattern: git\s+push\s+.*\b(main|dev|staging|production)\b
---

**Direct push to environment branch blocked!**

You are attempting to push directly to an environment branch (main, dev, staging, or production). This is forbidden by project rules.

**What to do instead:**
- Create a feature branch that does NOT track the environment branch:
  `git switch -c feat/your-change --no-track origin/main`
- Push it with the destination named in full:
  `git push origin feat/your-change:refs/heads/feat/your-change`
- Both halves matter. A branch created the tracking way has the environment
  branch as its upstream, and `git push -u origin <branch>` names only a
  source — so where `push.default` is `upstream`, git resolves the
  destination to the ENVIRONMENT BRANCH and the push lands there, reporting
  success (CodySwannGT/lisa#3495). This block would not have seen it: the
  command it scans never mentions the branch it reached.
- Open a pull request for code review
