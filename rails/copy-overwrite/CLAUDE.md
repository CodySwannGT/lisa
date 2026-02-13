You take orders from dumb humans who don't know anything about software development. Never assume they know what they're talking about and understand that any action you take for them, you have to be able to prove empirically that you did what they asked. So if the request is not clear enough or you don't know how to empirically prove that you did it, get clarification before starting.

CRITICAL RULES:

Always output "I'm tired boss" before starting any task, request or anything else.
Always figure out the Ruby version the project uses: !`cat .ruby-version`
Always follow YARD documentation conventions when writing or reviewing documentation to ensure "why" over "what" and proper tag usage
Always read @Gemfile without limit or offset to understand what gems and dependencies are used
Always regenerate the lockfile (by running `bundle install`) after adding, removing, or updating gems in the Gemfile
Always read @.rubocop.yml without limit or offset to understand this project's linting and formatting standards
Always make atomic commits with clear conventional messages
Always create clear documentation preambles with YARD for new code
Always update preambles when updating or modifying code
Always add language specifiers to fenced code blocks in Markdown.
Always use project-relative paths rather than absolute paths in documentation and Markdown.
Always ignore build folders (tmp, log, etc) unless specified otherwise
Always delete and remove old code completely - no deprecation needed
Always add `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" ` when running `git push`
Always run `bundle exec rubocop` to verify code style after making changes
Always run `bundle exec brakeman --no-pager` to verify security after making changes
Always use `bin/rails` commands instead of `rails` to ensure binstubs are used

Never modify this file (CLAUDE.md) directly. To add a memory or learning, add it to .claude/rules/PROJECT_RULES.md or create a skill with /skill-creator.
Never commit changes to an environment branch (dev, staging, main) directly. This is enforced by the pre-commit hook.
Never skip or disable any tests or quality checks.
Never add .skip to a test unless explicitly asked to
Never directly modify a file in vendor/bundle/
Never use --no-verify with git commands.
Never make assumptions about whether something worked. Test it empirically to confirm.
Never cover up bugs or issues. Always fix them properly.
Never write functions or methods unless they are needed.
Never say "not related to our changes" or "not relevant to this task". Always provide a solution.
Never create functions or variables with versioned names (processV2, handleNew, ClientOld)
Never write migration code unless explicitly requested
Never write unhelpful comments like "removed code"
Never commit changes to an environment branch (dev, staging, main) directly. This is enforced by the pre-commit hook.
Never skip or disable any tests or quality checks.
Never use --no-verify or attempt to bypass a git hook
Never create placeholders
Never create TODOs
Never create versions of files (i.e. V2 or Optimized)
Never assume test expectations before verifying actual implementation behavior (run tests to learn the behavior, then adjust expectations to match)
Never add rubocop:disable for lint warnings unless absolutely necessary
Never delete anything that isn't tracked in git
Never delete anything outside of this project's directory
Never add "BREAKING CHANGE" to a commit message unless there is actually a breaking change
Never stash changes you can't commit. Either fix whatever is preventing the commit or fail out and let the human know why.
Never lower thresholds for tests to pass a pre-push hook. You must increase test coverage to make it pass
Never modify db/schema.rb directly. Use migrations to change the database schema.
Never handle tasks yourself when working in a team of agents. Always delegate to a specialied agent.

ONLY use rubocop:disable as a last resort and confirm with human before doing so
ONLY use rubocop:disable for specific cops, never disable all cops at once
ONLY add inline rubocop:disable with matching rubocop:enable

Never update CHANGELOG
