---
name: improve-code-complexity
description: "reducing the code complexity…"
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
---

# Lower Code Complexity

Reduces the CyclomaticComplexity threshold by 2 and fixes all violations.

## Step 1: Gather Requirements

1. **Read current threshold** from `.rubocop.yml` (`Metrics/CyclomaticComplexity` Max)
2. **Calculate new threshold**: current - 2 (e.g., 10 -> 8)
3. **Run RuboCop and flog** to find violations:
   ```bash
   bundle exec rubocop --only Metrics/CyclomaticComplexity,Metrics/PerceivedComplexity --format json 2>&1
   ```
   ```bash
   bundle exec flog --all --group app/ >flog.log 2>&1; status=$?
   head -50 flog.log; echo "exit=$status"
   ```
   The status is captured before the pipe, because a pipeline reports its LAST stage's exit code — `head` always succeeds, so a failing run reads as `exit=0` (`falsifiable-checks`, pager-shadowed status).
4. **Note for each violation**:
   - File path and line number
   - Method name
   - Current complexity score (RuboCop and/or flog)

If no violations at new threshold, report success and exit.

## Step 2: Compile Brief and Delegate

Compile the gathered information into a structured brief:

```
Reduce CyclomaticComplexity threshold from [current] to [new].

Methods exceeding threshold (ordered by complexity):
1. [file:method_name] (complexity: X, target: [new]) - Line Y
   - flog score: Z
2. ...

Configuration change: .rubocop.local.yml, Metrics/CyclomaticComplexity Max from [current] to [new]

Refactoring strategies: extract methods, early returns, extract conditions, use lookup hashes, replace conditionals with polymorphism

Verification: `bundle exec rubocop --only Metrics/CyclomaticComplexity --format simple 2>&1 | grep "offense" | wc -l` -> Expected: 0
```

Invoke `/implement` with this brief to create the implementation plan.
