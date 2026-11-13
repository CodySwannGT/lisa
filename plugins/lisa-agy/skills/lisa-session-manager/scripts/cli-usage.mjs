/**
 * The session-manager CLI's `--help` text: the single reference for every
 * subcommand, flag, stdin input and exit code. The manager and setup skills
 * use exactly what is written here, so a flag that is not listed does not
 * exist.
 * @module session-manager/cli-usage
 */

export const USAGE = `Usage: node session-manager.mjs <subcommand> [args] [--project-root <abs>]

Every subcommand accepts --project-root <absolute dir> (default: the current
directory) and -h/--help. Output is one line of JSON on stdout (repo-dir --raw
prints a bare path); errors go to stderr. Untrusted text (answers, questions,
reasons, Telegram messages, summaries) is read from STDIN, never from argv.

Exit codes: 0 ok; 1 a command failed (claude, tmux or gh error); 2 bad repo,
bad config or bad usage; 3 no capacity; 4 a live worker already holds the ref.

Workers and capacity
  capacity [--max-workers <n>]
      {running,cap,free_slots,avail_gb,load1,cores,overloaded,can_spawn,
       mem_source,paused}. Works without a sessionManager block (defaults).
      Cap precedence: ledger control.maxWorkers, then --max-workers, then config.
      (capacity and spawn also take --meminfo <file>, a TEST-ONLY flag that
      reads memory from a Linux meminfo file instead of this host. Skills
      never pass it.)
  spawn <ref> [--repo <key>] [--max-workers <n>]
      Checks, in order: repo dir resolves and has .lisa.config.json (exit 2);
      capacity (exit 3, stdout = capacity report); no live wk- worker for the
      ref (exit 4, stdout = {ref,worker,sessionId}); no pending question in
      the ledger for the ref (exit 2: clear it first). Then runs, with cwd = repo
      dir and every TELEGRAM_* variable removed:
        claude --bg -n wk-<token>-<MMDD-HHMM> --dangerously-skip-permissions
          --settings {"crossSessionInbound":"accept"}
          "/lisa:implement <ref> managedBy=<sessionManager.name>"
      Then reads the worker's transcript for up to 30s
      (LISA_SESSION_MANAGER_FIRST_PROMPT_MS overrides it): when the first
      prompt never ran (the command is unknown in that repo, or a
      UserPromptSubmit hook rejected it), stops the worker, records nothing
      and exits 2 (setup gap; no attempt counted).
      Records the ledger and sessions.jsonl. stdout {ref,name,sessionId,repo,
      cwd,firstPrompt}, firstPrompt "alive" or "unconfirmed" (the transcript
      did not resolve in time).
  resume <ref>                         STDIN: the message for the worker
      claude --bg --resume <full session id> --dangerously-skip-permissions
      --settings <worker settings> -- "<stdin>" (spawn's permission flags) in
      the worker's repo
      dir, TELEGRAM_* removed; the full id comes from claude agents --json --all
      (exit 2 when none does). Exit 2 when the ledger item finished (DONE or
      FAILED): a finished worker is never resumed.
      stdout {ref,worker,sessionId,resumed:true}.
  classify [<ref>]
      Classifies one ledger item (or all) from claude agents --json --all and
      a hash of claude logs <worker>, plus the worker's transcript; records
      the hash as progress. stdout
      [{ref,worker,sessionId,repo,classification,attempts,agentStatus,
        waitingFor,pendingQuestion,setupGap}], classification one of
      finished|waiting|requestion|setup-gap|blocked-on-prompt|working|
      stalled|dead|exhausted. setup-gap: the worker's first prompt never
      ran; setupGap is {kind:"unknown-command"|"prompt-blocked",detail},
      else null. blocked-on-prompt: the live worker's agent row reports a
      waitingFor other than a subagent (e.g. "permission prompt"), which
      nobody attached can answer. waitingFor is the agent row's text, else
      null.
  cycle
      Records that this session ran a cycle now: cyclers[<by>] = <at> in
      the ledger, by tmux:<session> when tmux names the caller's session,
      pid:<parent pid> outside tmux, tmux-unknown:pid:<parent pid> when tmux
      cannot name it. Prunes entries older than twice the interval.
      Run at the start of every cycle. stdout {by,at}.
  status
      stdout {manager:{name,running,self,otherCyclers:[{by,at}]},notify,
      control,workers:[{ref,worker,sessionId,repo,status,attempts,
      pendingQuestion,live}],untracked:[wk-names],pendingQuestions:[{ref,
      kind,text,askedAt,marked,answerQueued,answerCommand}]}. manager.self
      is true when the caller runs inside the manager's tmux session (any
      window of it), false outside tmux or in another session, null when
      tmux cannot say which session the caller is in or $TMUX_PANE is not
      a pane id.
      manager.otherCyclers lists, newest first, every cycle recorded within
      twice the interval by a session other than tmux:<manager name>,
      leaving out tmux-unknown entries; empty when only the manager
      cycles. notify is the configured
      channel: "telegram" or "none". pendingQuestions lists every item
      waiting on a human, oldest first; answerCommand is the answer line to
      run at this machine.

Manager
  start [--settle-ms <n>]
             With notify.provider "none" (or no notify block): no token, state
             dir or Telegram plugin is needed; launches with no --channels, no
             TELEGRAM_STATE_DIR and no plugin in --settings. With "telegram"
             and a secrets provider (secrets.provider set, not "env"): reads
             TELEGRAM_BOT_TOKEN_<NAME> from the provider once, before any tmux
             call, and passes it to tmux on stdin (tmux start-server ;
             source-file -), never in argv; tmux's stderr is never shown.
             Exit 2 when a plaintext <notify.stateDir>/.env is left over (the
             message names the store-token command that migrates it), when
             the secret is missing, or when secrets.require does not list it.
             Exit 1, "Nothing was started", when the provider cannot be
             reached, is rate-limited or times out: wait a minute and run
             start again. With "telegram" and no provider: refuses (exit 2)
             without <notify.stateDir>/.env (mode 0600). Either way exit 2 for
             the shared default state dir. "already-running" when the tmux
             session =<name> exists and was started in this project root;
             exit 2 naming the conflict when it was started anywhere else.
             Otherwise starts tmux new-session for the manager, then checks
             has-session -t =<name> every 250 ms for --settle-ms (default
             3000, at most 60000): exit 2, with the foreground command to run
             to see claude's error, when the session is gone.
             stdout {status:"started"|"already-running",name,notify,
             [stateDir,tokenSource:"provider"|"file",secret,]attach}.
  stop       tmux kill-session -t =<name> only, and only for a session started
             in this root (exit 2 otherwise); workers keep running.
             stdout {status:"stopped"|"not-running",name}.
  store-token [--replace] [--from-clipboard] [--vault-project <id>]
             Telegram only: exit 2 when notify.provider is "none".
             With a secrets provider: stores the token in it as
             TELEGRAM_BOT_TOKEN_<NAME> and writes nothing to disk. A
             plaintext <stateDir>/.env is migrated: stored, read back and
             compared, then deleted (refused, exit 2, when the file holds
             other keys or a different token than the stored one). An
             already-stored token is kept (exit 0, alreadyStored:true) unless
             --replace. --vault-project picks the provider project for a new
             secret (default: the one in secrets.narrow.projectIds, else the
             one every visible secret is in). stdout {stored:true,
             storage:"provider",provider,secret,verified,[migratedFrom,
             deleted]}. Provider unreachable or rate-limited: exit 1, nothing
             stored, the file kept.
             With no provider: prompts for the bot token on the terminal (echo
             off) and writes <stateDir>/.env. Exit 2 when a token is already
             there, unless --replace.
             Either way, with no TTY (an agent's Bash, and Claude Code's !
             prefix too): exit 0, stdout {stored:false,reason:"no-tty",
             message,command,clipboardCommand}; command is the line the
             operator runs in a separate terminal app.
             --from-clipboard reads the token from the clipboard instead
             (pbpaste; wl-paste, xclip or xsel on Linux), needs no TTY, and
             clears the clipboard after a successful store. stdout
             {stored:true,storage:"file",path,clipboardCleared} (with a
             provider, the provider shape plus clipboardCleared). The token
             is never printed.
             Bad input, empty clipboard or no clipboard tool: exit 2,
             {stored:false,reason,message}.

Config and routing
  repo-dir [--repo <key>] [--raw]
             stdout {repo,dir}; --raw prints the bare dir. Exit 2 for an
             unknown key or a dir without .lisa.config.json.
  validate   stdout {valid,errors[,warnings]}; exit 2 when invalid or absent.
             warnings (only when any, never fatal) names an ambiguous entry,
             such as a plain all-digit operatorIds entry.
  init-config [--slug <slug>] [--notify none|telegram] [--write]
             stdout {written,block[,reason:"exists",layer][,path]}. --notify picks
             the notification channel (default none): none writes
             notify {provider:"none"} and no state dir; telegram writes
             {provider:"telegram",stateDir:"~/.claude/channels/telegram-<slug>"}.
             Any other value: exit 2. Detects
             projects/*/.lisa.config.json, else root children with their own
             .lisa.config.json and .git (repos.root "."), skipping linked
             worktrees (.git is a file) and keeping one child per origin
             remote (the one named after the repo, else the first by name). Each repo's hints are a
             draft: its name, then one per well-known package.json dependency
             (e.g. @nestjs/* -> NestJS, expo -> Expo, aws-cdk-lib -> AWS CDK).
             Default slug: <github.repo or folder name>-<first 6 hex of
             sha256(realpath(root))>; --slug is used as given. --write adds
             the block to .lisa.config.json, never overwriting an existing one;
             a block in .lisa.config.local.json counts as existing too
             (layer "local"), so nothing is written under it.
  trust-status
             stdout {file,dirs:[{dir,trusted:true|false|"unknown"}],
             needsTrust:[dir]}: whether Claude Code has recorded workspace
             trust (hasTrustDialogAccepted in $CLAUDE_CONFIG_DIR/.claude.json,
             else ~/.claude.json) for each worker dir. "unknown" when that
             file cannot be read. Read-only; never accepts trust.
  coexistence
             stdout {windowHours,loops:[{loop,log,lastRun:{ts,outcome}|null,
             recent}],live:[loop]} for intake-tickets and intake-repair, from
             .lisa/automations/runs/<loop>.jsonl. recent = last run within
             windowHours (2 x stall.noOutputMinutes x stall.maxAttempts, at
             least 24h). Run logs only: the runtime's scheduler is the
             authority on whether a loop is still scheduled.

Per cycle
  queue --tracker github [--me <id>] [--label <name>] [--github-repo <o/r>]
      gh api --paginate --slurp repos/<o>/<r>/issues?state=open&labels=<ready>
      Label default: the configured ready role; repo default: github.org/repo.
  queue --tracker jira|linear --input <file> [--me <id>]
      <file> = {complete:true,pages,items:[raw vendor issues]}; exit 2 unless
      complete is exactly true.
      Both print {tracker,me,operators,total,pages,ordered,excluded:[{ref,
      reason}]}. An item with a pending question in the ledger is excluded
      (pending-question) from both tiers, and every other item still comes
      back, so one item waiting on a human never stops dispatch. ordered: items assigned to sessionManager.operatorIds
      first (a login: entry matches a GitHub assignee login, an id: entry
      an assignee account id, a plain entry as --me does), then to --me,
      then unassigned; each group by priority, then age.
      Items assigned to anyone else are excluded (assigned-to-other).
      --me defaults to the ledger's control.me.
      With sessionManager.backlogPickup true, also prints backlogTotal,
      backlogPages, backlogOrdered and backlogExcluded: open leaves in no
      lifecycle role, same order, always after every ready item; excluded
      also for blocked-by-open-item and failed-validation-unchanged (the
      ledger's validationFailures entry matches the item's updatedAt).
      GitHub fetches them itself; jira|linear need <file>.backlog =
      {complete:true,pages,items}, else exit 2.
  ledger get [<ref>]
  ledger record-spawn <ref> --worker <name> [--session-id <id>] [--repo <key>]
  ledger set-question <ref> [--kind <kind>] [--telegram-message-id <n>]
                           [--sender <name>]               STDIN: question
      --kind: worker-question (default) | repo-route | exhausted | decision.
      No message id with no channel. A re-ask keeps the item's marker
      fields (markerType, marker); markedAt and a queued answer survive only
      a re-ping of the same text, so a changed question must be marked again.
  ledger marked <ref> --marker-type label|role --marker <value>
                     --comment-id <id>
      Records that the human-needed marker was applied on the tracker and
      read back (markedAt). --comment-id (required): the id of the question
      comment the manager posted; item-answer anchors on it to find the
      answer after it, and never reads it as an answer. Exit 2 when it is
      missing or not a tracker comment id, or <ref> has no pending
      question.
  ledger clear-question <ref> [--reset-attempts] [--expect-answer-at <iso>]
      After the answer is delivered (or recorded on the item and read back,
      per answer-plan) and the marker removed. --reset-attempts
      zeroes the attempt count (an exhausted item a human has answered).
      --expect-answer-at: the answerAt answer-plan returned; exit 2 and
      nothing cleared when the queued answer's at differs (the operator
      replaced it since) or no answer is queued: record the new one first.
  ledger finish <ref> --status DONE|FAILED [--sender <name>] [--setup-gap]
                                                              STDIN: reason
      --sender: exit 2 unless the ledger's worker for <ref> is exactly <name>.
      --setup-gap (FAILED only): the worker's first prompt never ran
      (classify said setup-gap), so its spawn is not counted as an attempt.
  ledger validation-failed <ref> --updated-at <ts>     STDIN: failing gates
      Caches a backlog item's failed validation; queue skips it until the
      item's updatedAt changes.
  ledger validation-cleared <ref>
      Forgets that failure: after a promotion, or by hand to have the next
      cycle re-validate an item without editing it. stdout {cleared}.
  ledger control [--paused true|false] [--max-workers <n>|none] [--me <id>|none]
  route [--reply-to <telegram message id>] [--owner <name>] STDIN: message
      stdout {kind:"answer",ref,body[,message]} | {kind:"command",name,...}
      | {kind:"invalid-command",reason} | {kind:"ambiguous",candidates}.
      --owner adds message "<owner>'s answer: ...".
  blocked-plan [--input <file>] [--ref <ref>]  STDIN (without --input): JSON
      {labels,body,comments,humanNeededLabel?,edges,pendingQuestion?}.
      Trusted hold releasers are sessionManager.trustedAuthorIds (none when
      unset; plain and id: entries, compared as ids; login: entries never
      release); trustedHumanActorIds in the input is ignored. stdout
      {action:release|keep|escalate|skip-human-gate,reason,edges,gate}.
      --ref fills pendingQuestion from the ledger.
  mark-plan <ref> --kind <kind> [--cause <cause>] [--item-label <l>]...
                                                STDIN: question or reason
      Plans marking an item that needs a human; writes nothing. kind:
      worker-question | repo-route | exhausted | decision. cause: planning
      (default) | environment (outage, expired credential, flaky tool) |
      human-gate (a decision planning flagged as a human gate).
      --item-label (repeatable): the item's current labels. When one is the
      configured wrongly-escalated label, cause human-gate counts as a
      planning miss (stageHint filing, candidate signal wrongly-escalated).
      stdout
      {ref,kind,marker:{type:"label"|"role",value},[move:{role:"blocked",
      value},]comment,answerWith:{item,cli,channel},planningMiss:{counts,
      reason[,stageHint,candidate][,overruledMarker:{fingerprint,comment}]}}.
      overruledMarker is present only when candidate.signal is
      wrongly-escalated: post its comment after routing the candidate, so
      overruled-plan skips the item. planningMiss.counts is true for a
      worker-question, decision or repo-route with cause planning; never
      for exhausted. candidate is the persist-learning skeleton (signal,
      triggering_issue, provenance, scope_hint, kind, missing). marker is the tracker's
      configured human-needed label, else the configured blocked role;
      exhausted also moves to the blocked role. comment starts with
      [lisa-session-manager-question] and says, in plain words, how to
      answer: on the item (only when operatorIds or trustedAuthorIds is set;
      answerWith.item is null otherwise), with the answerCommand that status
      lists, or on Telegram when it is the channel. Exit 2 for an unknown
      kind, empty or credential-shaped text, no marker configured, or
      exhausted with no blocked role, or an unknown cause.
  overruled-plan [--input <file>] [--max <n>]   STDIN (without --input): JSON
                                                {items:[{ref,labels,body,comments}]}
      Plans this cycle's captures of escalations a human ruled wrong; writes
      nothing. An item counts when it carries the configured wrongly-escalated
      label (github/linear labels.build.wrongly_escalated,
      jira.labels.wrongly_escalated; default wrongly-escalated-to-human) and
      no comment starting [lisa-escalation-overruled] key=<fingerprint>.
      stdout {label,captures:[{ref,fingerprint,comment,candidate}],skipped,
      deferred}. candidate is the persist-learning candidate (signal
      wrongly-escalated, hold and release evidence, a draft
      Planning (filing) rule); comment is the marker to post afterwards.
      --max caps captures per cycle (default 3); the rest are deferred.
  answer <ref>                                  STDIN: the answer
      Queues an operator's answer (source "cli") for the next cycle to
      deliver to the worker, or record on the item when the worker has
      finished or the item is exhausted. stdout {queued:true,ref,source}.
      Exit 2 when <ref> has no pending question, or the text looks like a
      credential.
  item-answer <ref>          STDIN: {"comments":[{user|author,body,createdAt}]}
      Queues the human's answer from the item's comments (source "item"):
      the first comment after the latest [lisa-session-manager-question]
      comment whose author's STABLE id (GitHub login or numeric id, Jira
      accountId, Linear user id; never a name, displayName or email; a
      plain all-digit entry is a numeric id, never matched against a login;
      login:<v> matches only a login, id:<v> only an id) is in
      sessionManager.operatorIds or trustedAuthorIds, and that is not a
      machine comment, checked first (body starting with a bracketed tag
      such as [lisa-...] or [claude-sync]; [lisa- or <!-- lisa: anywhere;
      "Written by Claude"; the agent "Generated with Claude Code" footer;
      or an id in the ledger's managerCommentIds, so keep each comment's
      id). For GitHub, pipe the rows of
      gh api --paginate repos/<o>/<r>/issues/<n>/comments (user.login,
      user.id). stdout {queued:true,ref,source,author[,refused]} or
      {queued:false,ref,reason:no-question-comment|no-answer-yet|
      already-queued|not-marked|no-answerers-configured|credential-refused
      [,explanation][,refused,refusedExplanation]}. not-marked (exit 0):
      the question's mark was never read back (markedAt null, as after a
      changed question), so no reply is read; record it with ledger marked
      --comment-id <id> first. no-answerers-configured
      (exit 0): neither list is set, so nothing on the item is read, because
      the tracker identity is the one workers post as; answer with answer.
      A reply that looks like a credential is skipped, never queued, and
      listed in refused [{id,author,why}], so a later reply is still read;
      credential-refused (exit 0) means no other reply answers yet. Exit 2
      when <ref> has no pending question, the ledger is corrupt, or STDIN is
      not valid JSON.
  channel-answer <ref>                          STDIN: the answer
      Manager only: queues the operator's Telegram answer (source
      "channel"), so answer-plan can record it on the item. stdout
      {queued:true,ref,source}. Exit 2 when <ref> has no pending question,
      or the text looks like a credential.
  answer-plan <ref>
      Plans recording the queued answer on the item before clearing; writes
      nothing. stdout {ref,record:true,source,answerAt,comment} when no
      worker will receive the answer (the worker reported DONE or FAILED,
      the question is exhausted, or no worker was started) and the answer
      came from answer (source cli) or Telegram (source channel): post
      comment ([lisa-session-manager] The operator answered the question
      above (by answer|Telegram, <time>): <answer>) and read it back, then
      ledger clear-question --expect-answer-at <answerAt> (answerAt: the
      queued answer's at). A repo-route never records (the repo stamp carries
      it). Otherwise {ref,record:false,reason:no-pending-question|
      no-answer-queued|answered-on-item|worker-not-finished|
      routed-by-repo-stamp}. Either shape adds requeue:true for a FAILED
      worker's item (in the blocked role): move it to the ready role in the
      same update that removes the marker. Exit 2 when the answer it would post looks
      like a credential (nothing printed, nothing to post) or the ledger
      is corrupt.
  record-cycle --outcome <outcome> [--ref <url>]... [--run-id <id>]
      STDIN: one-line summary. Records loop session-manager with runbook
      .lisa/automations/session-manager.runbook.md. stdout {path,appended,
      loop_id,outcome,run_id}.
`;
