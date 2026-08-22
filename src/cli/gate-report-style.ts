/**
 * The report's stylesheet, scoped so it cannot reach the console around it.
 *
 * Every selector is prefixed with `.lisa-gate-report` and every class with
 * `lgr-`, because this markup is injected into a 13,000-line page that already
 * owns names like `.chip`, `.state`, `.stat` and `.cols`. An unscoped rule
 * would silently restyle tabs that have nothing to do with this report — and
 * the report would in turn inherit whatever those pages define, which is the
 * same bug pointing the other way.
 *
 * Colours come from the console's own tokens with dark fallbacks, so the tab
 * follows the light/dark toggle rather than punching a dark rectangle into a
 * light page. The standalone document defines the same token names, which is
 * what lets one stylesheet serve both surfaces.
 * @module cli/gate-report-style
 */

/** The scoped stylesheet. */
export const GATE_REPORT_STYLE = `
.lisa-gate-report{
--lgr-ink:var(--ink,#e6e9f2);--lgr-dim:var(--muted,#98a0b5);--lgr-faint:var(--faint,#6b7280);
--lgr-panel:var(--surface,#161923);--lgr-panel2:var(--surface2,#1b2030);--lgr-line:var(--line,#252a38);
--lgr-accent:var(--accent,#58a6ff);--lgr-good:var(--good,#22773c);--lgr-good-soft:var(--good-soft,#123021);
--lgr-warn:var(--warn,#93610a);--lgr-warn-soft:var(--warn-soft,#3a2c12);
--lgr-crit:var(--crit,#b3372c);--lgr-crit-soft:var(--crit-soft,#3a1616);
--lgr-mono:var(--mono,ui-monospace,monospace);
color:var(--lgr-ink);font-size:14px;line-height:1.55}
.lisa-gate-report h2{font-size:18px;margin:34px 0 6px;padding-top:20px;border-top:1px solid var(--lgr-line)}
.lisa-gate-report h3{font-size:12.5px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em;color:var(--lgr-dim)}
.lisa-gate-report p{margin:0 0 14px}
.lisa-gate-report .lgr-lede,.lisa-gate-report .lgr-sub{color:var(--lgr-dim);max-width:86ch}
.lisa-gate-report .lgr-stats{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0 12px}
.lisa-gate-report .lgr-stat{background:var(--lgr-panel);border:1px solid var(--lgr-line);
border-radius:10px;padding:12px 16px;min-width:170px}
.lisa-gate-report .lgr-stat b{display:block;font-size:26px;line-height:1.1}
.lisa-gate-report .lgr-stat span{color:var(--lgr-dim);font-size:12.5px}
.lisa-gate-report .lgr-denominator{background:var(--lgr-panel);border:1px solid var(--lgr-line);
border-left:3px solid var(--lgr-accent);border-radius:8px;padding:12px 16px;max-width:100ch}
.lisa-gate-report .lgr-legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin:14px 0;
color:var(--lgr-dim);font-size:12.5px}
.lisa-gate-report .lgr-legend>span{display:flex;align-items:center;gap:6px}
.lisa-gate-report .lgr-scroll{overflow-x:auto;border:1px solid var(--lgr-line);border-radius:10px}
.lisa-gate-report table{border-collapse:collapse;width:100%;font-size:12.5px;background:var(--lgr-panel)}
.lisa-gate-report th,.lisa-gate-report td{text-align:left;padding:9px 11px;
border-bottom:1px solid var(--lgr-line);vertical-align:top}
.lisa-gate-report th{background:var(--lgr-panel2);font-size:11px;text-transform:uppercase;
letter-spacing:.05em;color:var(--lgr-dim)}
.lisa-gate-report th.lgr-m,.lisa-gate-report td.lgr-m{text-align:center;white-space:nowrap}
.lisa-gate-report td.lgr-illegal{background:repeating-linear-gradient(45deg,transparent,transparent 5px,
var(--lgr-panel2) 5px,var(--lgr-panel2) 10px)}
.lisa-gate-report .lgr-gid{display:block;font-family:var(--lgr-mono);font-size:12px;color:var(--lgr-accent)}
.lisa-gate-report .lgr-glabel{display:block;color:var(--lgr-dim);font-size:12px}
.lisa-gate-report .lgr-offaxis{margin-top:4px;color:var(--lgr-faint);font-size:11px;font-style:italic}
.lisa-gate-report .lgr-proves{color:var(--lgr-dim);max-width:34ch}
.lisa-gate-report code{font-family:var(--lgr-mono);font-size:11.5px;background:var(--lgr-panel2);
border:1px solid var(--lgr-line);border-radius:4px;padding:1px 5px}
.lisa-gate-report .lgr-prov{margin-top:5px;font-size:11px;color:var(--lgr-dim)}
.lisa-gate-report .lgr-provword{font-weight:700;color:var(--lgr-ink)}
.lisa-gate-report .lgr-under{margin-top:4px;font-size:11px;color:var(--lgr-dim)}
.lisa-gate-report .lgr-tier3{margin-top:5px;font-size:11px;color:var(--lgr-faint)}
.lisa-gate-report .lgr-state{display:inline-block;font-size:11px;border-radius:5px;padding:2px 7px;font-weight:600}
.lisa-gate-report .lgr-required{background:var(--lgr-good-soft);color:var(--lgr-good)}
.lisa-gate-report .lgr-optional{background:var(--lgr-warn-soft);color:var(--lgr-warn)}
.lisa-gate-report .lgr-off{background:var(--lgr-crit-soft);color:var(--lgr-crit)}
.lisa-gate-report .lgr-undeclared{background:var(--lgr-panel2);color:var(--lgr-faint);border:1px dashed var(--lgr-line)}
.lisa-gate-report .lgr-chip{display:inline-block;margin-left:5px;font-size:10.5px;border-radius:4px;
padding:1px 5px;font-weight:600;vertical-align:1px}
.lisa-gate-report .lgr-b-A,.lisa-gate-report .lgr-ok,.lisa-gate-report .lgr-yes-merge{
background:var(--lgr-good-soft);color:var(--lgr-good)}
.lisa-gate-report .lgr-b-B,.lisa-gate-report .lgr-other-merge{background:var(--lgr-warn-soft);color:var(--lgr-warn)}
.lisa-gate-report .lgr-b-C,.lisa-gate-report .lgr-bad{background:var(--lgr-crit-soft);color:var(--lgr-crit)}
.lisa-gate-report .lgr-b-D,.lisa-gate-report .lgr-none,.lisa-gate-report .lgr-no-merge{
background:var(--lgr-panel2);color:var(--lgr-faint)}
.lisa-gate-report .lgr-foreign{background:var(--lgr-panel2);color:var(--lgr-accent);border:1px solid var(--lgr-accent)}
.lisa-gate-report .lgr-unknown{background:repeating-linear-gradient(45deg,var(--lgr-panel2),
var(--lgr-panel2) 3px,var(--lgr-panel) 3px,var(--lgr-panel) 6px);
color:var(--lgr-dim);border:1px dashed var(--lgr-line)}
.lisa-gate-report .lgr-note{background:repeating-linear-gradient(45deg,var(--lgr-panel2),
var(--lgr-panel2) 4px,var(--lgr-panel) 4px,var(--lgr-panel) 8px);
border:1px dashed var(--lgr-line);border-radius:8px;padding:14px 16px;color:var(--lgr-ink)}
.lisa-gate-report .lgr-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-bottom:14px}
.lisa-gate-report .lgr-cols>div{background:var(--lgr-panel);border:1px solid var(--lgr-line);
border-radius:10px;padding:14px 16px}
.lisa-gate-report .lgr-sharp,.lisa-gate-report .lgr-origin-lisa-undeclared{border-color:var(--lgr-crit)}
.lisa-gate-report .lgr-origin-third-party{border-color:var(--lgr-accent)}
.lisa-gate-report .lgr-cols p{color:var(--lgr-dim);font-size:12px;margin:0 0 8px}
.lisa-gate-report .lgr-cols ul{margin:0;padding-left:18px}
.lisa-gate-report .lgr-cols li{margin:3px 0;font-size:12.5px}
.lisa-gate-report .lgr-count{float:right;color:var(--lgr-ink);font-size:13px}
.lisa-gate-report .lgr-upstream{background:var(--lgr-panel);border:1px solid var(--lgr-line);
border-left:3px solid var(--lgr-accent);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.lisa-gate-report .lgr-upstream h3{text-transform:none;letter-spacing:0;font-size:14px;color:var(--lgr-ink)}
.lisa-gate-report .lgr-upstream p{color:var(--lgr-dim);font-size:12.5px}
.lisa-gate-report .lgr-upstream-meta{margin:0}
.lisa-gate-report .lgr-foot{margin-top:32px;padding-top:16px;border-top:1px solid var(--lgr-line);
color:var(--lgr-faint);font-size:12px}
.lisa-gate-report .lgr-surface{margin:18px 0 8px;color:var(--lgr-ink);
text-transform:none;letter-spacing:0;font-size:14px}
.lisa-gate-report .lgr-why{color:var(--lgr-dim);font-size:11.5px;margin:3px 0 8px}
`;
