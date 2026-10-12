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
      ref (exit 4, stdout = {ref,worker,sessionId}). Then runs, with cwd = repo
      dir and every TELEGRAM_* variable removed:
        claude --bg -n wk-<token>-<MMDD-HHMM> --dangerously-skip-permissions
          --settings {"crossSessionInbound":"accept"}
          "/lisa:implement <ref> managedBy=<sessionManager.name>"
      Records the ledger and sessions.jsonl. stdout {ref,name,sessionId,repo,cwd}.
  resume <ref>                         STDIN: the message for the worker
      claude --bg --resume <ledger sessionId> "<stdin>" in the worker's repo
      dir, TELEGRAM_* removed. stdout {ref,worker,sessionId,resumed:true}.
  classify [<ref>]
      Classifies one ledger item (or all) from claude agents --json --all and
      a hash of claude logs <worker>; records the hash as progress. stdout
      [{ref,worker,sessionId,repo,classification,attempts,agentStatus,
        pendingQuestion}], classification one of finished|waiting|requestion|
      working|stalled|dead|exhausted.
  status
      stdout {manager:{name,running},control,workers:[{ref,worker,sessionId,
      repo,status,attempts,pendingQuestion,live}],untracked:[wk- names]}.

Manager
  start      Refuses (exit 2) without <notify.stateDir>/.env (mode 0600) or for
             the shared default state dir. "already-running" when the tmux
             session exists. Otherwise starts tmux new-session for the manager.
             stdout {status:"started"|"already-running",name,...}.
  stop       tmux kill-session -t <name> only; workers keep running.
             stdout {status:"stopped"|"not-running",name}.
  store-token
             Prompts for the bot token on the terminal (echo off) and writes
             <stateDir>/.env. With no TTY: exit 0, stdout {stored:false,
             reason:"no-tty",command} where command is the line the operator
             runs in their own terminal. Bad input: exit 2.

Config and routing
  repo-dir [--repo <key>] [--raw]
             stdout {repo,dir}; --raw prints the bare dir. Exit 2 for an
             unknown key or a dir without .lisa.config.json.
  validate   stdout {valid,errors}; exit 2 when invalid or absent.
  init-config [--slug <slug>] [--write]
             stdout {written,block[,reason:"exists"][,path]}. Detects
             projects/*/.lisa.config.json. --write adds the block to
             .lisa.config.json, never overwriting an existing one.

Per cycle
  queue --tracker github [--me <id>] [--label <name>] [--github-repo <o/r>]
      gh api --paginate --slurp repos/<o>/<r>/issues?state=open&labels=<ready>
      Label default: the configured ready role; repo default: github.org/repo.
  queue --tracker jira|linear --input <file> [--me <id>]
      <file> = {complete:true,pages,items:[raw vendor issues]}; exit 2 unless
      complete is exactly true.
      Both print {tracker,me,total,pages,ordered,excluded:[{ref,reason}]}.
      --me defaults to the ledger's control.me.
  ledger get [<ref>]
  ledger record-spawn <ref> --worker <name> [--session-id <id>] [--repo <key>]
  ledger set-question <ref> [--telegram-message-id <n>]   STDIN: question
  ledger clear-question <ref>
  ledger finish <ref> --status DONE|FAILED                 STDIN: reason
  ledger control [--paused true|false] [--max-workers <n>|none] [--me <id>|none]
  route [--reply-to <telegram message id>] [--owner <name>] STDIN: message
      stdout {kind:"answer",ref,body[,message]} | {kind:"command",name,...}
      | {kind:"ambiguous",candidates}. --owner adds message "<owner>'s answer: ...".
  blocked-plan [--input <file>] [--ref <ref>]  STDIN (without --input): JSON
      {labels,body,comments,trustedHumanActorIds?,humanNeededLabel?,edges,
       pendingQuestion?}. stdout {action:release|keep|escalate|skip-human-gate,
       reason,edges,gate}. --ref fills pendingQuestion from the ledger.
  record-cycle --outcome <outcome> [--ref <url>]... [--run-id <id>]
      STDIN: one-line summary. Records loop session-manager with runbook
      .lisa/automations/session-manager.runbook.md. stdout {path,appended,
      loop_id,outcome,run_id}.
`;
