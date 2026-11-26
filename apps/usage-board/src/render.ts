import type { Board } from "./board.ts";
import type { LiveSession, LiveSubagent } from "./live.ts";
import type { TokenCounts } from "./pricing.ts";
import type { RateWindowView } from "./rate-limits.ts";
import type { DayUsage, SessionUsage, UsageTotals } from "./usage.ts";

type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

const sessionStatuses: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: "入力待ち", tone: "warning" },
  busy: { label: "実行中", tone: "good" },
  idle: { label: "待機", tone: "neutral" },
};

const subagentStates: Record<string, { label: string; tone: Tone }> = {
  running: { label: "実行中", tone: "good" },
  completed: { label: "完了", tone: "neutral" },
  failed: { label: "失敗", tone: "critical" },
  killed: { label: "停止", tone: "serious" },
  stopped: { label: "停止", tone: "serious" },
  unknown: { label: "集計中", tone: "neutral" },
};

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] ?? char);
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "1分未満";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間${minutes % 60}分`;
  return `${Math.floor(hours / 24)}日${hours % 24}時間`;
}

function formatAgo(ms: number): string {
  const seconds = Math.max(Math.floor(ms / 1000), 0);
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}時間前`;
  return `${Math.floor(seconds / 86_400)}日前`;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${(count / 1_000_000_000).toFixed(2)}B`;
}

function formatUsd(amount: number): string {
  return amount > 0 && amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`;
}

function totalTokens(tokens: TokenCounts): number {
  return tokens.input + tokens.output + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;
}

function costLabel(totals: UsageTotals): string {
  const marker = totals.unpricedModels.length > 0 ? "+" : "";
  return `${formatUsd(totals.costUsd)}${marker}`;
}

function chip(label: string, tone: Tone): string {
  return `<span class="chip" data-tone="${tone}">${escapeHtml(label)}</span>`;
}

function clock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

function meter(title: string, window: RateWindowView, board: Board): string {
  if (window.state === "absent") {
    return `<section class="meter"><h3>${title}</h3><p class="muted">値なし（statusline の入力に入っていない）</p></section>`;
  }
  if (window.state === "reset") {
    return `<section class="meter"><h3>${title}</h3><p class="big">リセット済み</p><p class="muted">${clock(window.resetsAtMs, board.timeZone)} にリセット。新しい値は次の応答で届く</p></section>`;
  }
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercentage));
  const tone: Tone = remaining < 5 ? "critical" : remaining < 20 ? "warning" : "neutral";
  return `<section class="meter" data-tone="${tone}">
<h3>${title}</h3>
<p class="big">残り <strong>${Math.round(remaining)}%</strong>${tone === "neutral" ? "" : ` ${chip("残りわずか", tone)}`}</p>
<div class="gauge" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(remaining)}"><span style="width:${remaining}%"></span></div>
<p>リセットまで ${formatDuration(window.resetsAtMs - board.generatedAtMs)}（${clock(window.resetsAtMs, board.timeZone)}）</p>
</section>`;
}

function limitsPanel(board: Board): string {
  const { rateLimits } = board;
  if (rateLimits.status === "unavailable") {
    return `<section class="panel limits"><h2>プランの残り</h2><p class="big">取得できません</p><p class="muted">${escapeHtml(rateLimits.reason)}</p></section>`;
  }
  const age = board.generatedAtMs - rateLimits.capturedAtMs;
  return `<section class="panel limits">
<h2>プランの残り</h2>
<div class="meters">${meter("5時間枠", rateLimits.fiveHour, board)}${meter("週の枠", rateLimits.sevenDay, board)}</div>
<p class="muted"${age > 15 * 60_000 ? ' data-stale="true"' : ""}>${formatAgo(age)}に取得（statusline の rate_limits）</p>
</section>`;
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", weekday: "short" }).format(Date.parse(`${date}T00:00:00Z`));
}

function dayRow(day: DayUsage, maxCost: number): string {
  const width = maxCost > 0 ? (day.totals.costUsd / maxCost) * 100 : 0;
  const [, month, date] = day.date.split("-");
  return `<li title="${escapeHtml(`${day.date} 出力 ${formatTokens(day.totals.tokens.output)} / 合計 ${formatTokens(totalTokens(day.totals.tokens))}`)}">
<span class="date">${Number(month)}/${Number(date)}（${weekday(day.date)}）</span>
<span class="bar"><span style="width:${width}%"></span></span>
<span class="num">${costLabel(day.totals)}</span>
<span class="num muted">${formatTokens(totalTokens(day.totals.tokens))}</span>
</li>`;
}

function sessionRow(session: SessionUsage, board: Board): string {
  const label = session.title ?? session.project ?? session.sessionId.slice(0, 8);
  return `<tr>
<td><div class="title">${escapeHtml(label)}</div><div class="muted">${escapeHtml(session.project ?? "")}</div></td>
<td class="num muted">${formatAgo(board.generatedAtMs - session.lastActivityMs)}</td>
<td class="num">${formatTokens(totalTokens(session.totals.tokens))}</td>
<td class="num">${costLabel(session.totals)}</td>
</tr>`;
}

function usagePanel(board: Board): string {
  if (board.usage.status === "loading") {
    return `<section class="panel usage"><h2>トークンと金額</h2><p class="big">集計中</p><p class="muted">起動直後は過去の記録を読み込んでいる</p></section>`;
  }
  const { days, sessions } = board.usage.summary;
  const today = days.at(-1);
  const maxCost = Math.max(...days.map((day) => day.totals.costUsd));
  const unpriced = [...new Set(days.flatMap((day) => day.totals.unpricedModels))];
  const fortnight = days.reduce((sum, day) => sum + day.totals.costUsd, 0);
  return `<section class="panel usage">
<h2>トークンと金額</h2>
<p class="big">今日 <strong>${today ? costLabel(today.totals) : "-"}</strong> <span class="muted">${today ? formatTokens(totalTokens(today.totals.tokens)) : ""} tokens</span></p>
<p class="muted">${days.length}日間 ${formatUsd(fortnight)}。API の定価で換算した推定額で、サブスクリプションの請求額ではない</p>
<ol class="days">${[...days].reverse().map((day) => dayRow(day, maxCost)).join("")}</ol>
${unpriced.length > 0 ? `<p class="muted">単価不明: ${escapeHtml(unpriced.join(", "))}（金額に含めていない）</p>` : ""}
<h3>直近24時間のセッション</h3>
<table><thead><tr><th>セッション</th><th class="num">最終</th><th class="num">tokens</th><th class="num">金額</th></tr></thead>
<tbody>${sessions.map((session) => sessionRow(session, board)).join("")}</tbody></table>
</section>`;
}

function subagentRow(subagent: LiveSubagent, board: Board): string {
  const state = subagentStates[subagent.state] ?? { label: subagent.state, tone: "neutral" };
  const detail = [subagent.agentType, subagent.model].filter((part) => part !== null).join(" · ");
  return `<li>${chip(state.label, state.tone)} <span class="title">${escapeHtml(subagent.label)}</span>
<span class="muted">${escapeHtml(detail)} · ${formatAgo(board.generatedAtMs - subagent.lastWriteMs)}</span></li>`;
}

function liveRow(session: LiveSession, board: Board): string {
  const status = sessionStatuses[session.status] ?? { label: session.status, tone: "neutral" };
  const since = session.statusUpdatedAtMs === null ? "" : ` · ${formatAgo(board.generatedAtMs - session.statusUpdatedAtMs)}`;
  return `<li data-tone="${status.tone}">
<div>${chip(status.label, status.tone)} <span class="title">${escapeHtml(session.name ?? session.project ?? session.sessionId.slice(0, 8))}</span>
<span class="muted">${escapeHtml(session.project ?? "")}${since}</span></div>
${session.waitingFor === null ? "" : `<div class="waiting">${escapeHtml(session.waitingFor)}</div>`}
${session.subagents.length === 0 ? "" : `<ul class="subagents">${session.subagents.map((subagent) => subagentRow(subagent, board)).join("")}</ul>`}
</li>`;
}

function livePanel(board: Board): string {
  const busy = board.live.filter((session) => session.status !== "idle").length;
  return `<section class="panel live">
<h2>動いているセッション</h2>
<p class="muted">${board.live.length} 件（待機以外 ${busy} 件）</p>
<ul class="sessions">${board.live.map((session) => liveRow(session, board)).join("")}</ul>
</section>`;
}

const style = `
:root{color-scheme:light;--surface:#ffffff;--panel:#f6f6f6;--line:#e2e2e2;--text:#191919;--muted:#666666;--series:#257de0;--good:#0aac23;--warning:#fbb315;--serious:#f18a59;--critical:#dc3c3d}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#111111;--panel:#191919;--line:#2c2c2c;--text:#efefef;--muted:#9c9c9c;--series:#338ced}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif}
header{display:flex;justify-content:space-between;align-items:baseline;padding:12px 16px 0}
header h1{font-size:17px;margin:0}
body[data-offline="true"] header::after{content:"サーバーに接続できません";color:var(--critical)}
main{display:grid;gap:12px;padding:12px 16px 16px;grid-template-columns:1fr}
@media (min-width:900px){
body{height:100dvh;display:flex;flex-direction:column}
main{flex:1;min-height:0;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr}
.limits{grid-column:1;grid-row:1}
.live{grid-column:1;grid-row:2;overflow:auto}
.usage{grid-column:2;grid-row:1/3;overflow:auto}
}
.panel{background:var(--panel);border-radius:12px;padding:14px 16px;min-width:0}
h2{font-size:15px;margin:0 0 8px;color:var(--muted);font-weight:600}
h3{font-size:14px;margin:14px 0 6px}
.meters{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.meter h3{margin:0 0 4px}
.big{font-size:22px;margin:0 0 6px}
.big strong{font-size:40px;font-variant-numeric:tabular-nums}
.gauge{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:4px 0 8px}
.gauge span{display:block;height:100%;background:var(--series);border-radius:5px}
.meter[data-tone="warning"] .gauge span{background:var(--warning)}
.meter[data-tone="critical"] .gauge span{background:var(--critical)}
.muted{color:var(--muted)}
p{margin:0 0 4px}
[data-stale="true"]{color:var(--serious)}
.days{list-style:none;margin:8px 0;padding:0}
.days li{display:grid;grid-template-columns:5.5em 1fr 5.5em 4.5em;gap:8px;align-items:center;padding:2px 0}
.bar{height:12px}
.bar span{display:block;height:100%;background:var(--series);border-radius:0 4px 4px 0;min-width:1px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
table{width:100%;border-collapse:collapse}
th{font-weight:500;color:var(--muted);text-align:left;font-size:13px}
td,th{padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:top}
td .title{overflow-wrap:anywhere}
.sessions,.subagents{list-style:none;margin:0;padding:0}
.sessions>li{padding:8px 0;border-bottom:1px solid var(--line)}
.sessions>li[data-tone="neutral"]{opacity:.6}
.subagents{margin:4px 0 0 16px}
.subagents li{padding:2px 0}
.waiting{color:var(--warning);margin-top:2px}
.title{font-weight:600}
.chip{display:inline-block;padding:0 8px;border-radius:9px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.chip[data-tone="good"]{background:var(--good);color:#06290c;border-color:transparent}
.chip[data-tone="warning"]{background:var(--warning);color:#3a2700;border-color:transparent}
.chip[data-tone="serious"]{background:var(--serious);color:#3a1500;border-color:transparent}
.chip[data-tone="critical"]{background:var(--critical);color:#ffffff;border-color:transparent}
`;

const refreshScript = `
setInterval(async () => {
  try {
    const response = await fetch(location.pathname, { cache: "no-store" });
    const next = new DOMParser().parseFromString(await response.text(), "text/html");
    document.querySelector("main").replaceWith(next.querySelector("main"));
    document.querySelector("#updated").replaceWith(next.querySelector("#updated"));
    document.body.dataset.offline = "false";
  } catch {
    document.body.dataset.offline = "true";
  }
}, 15000);
`;

export function renderPage(board: Board): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Usage Board</title>
<style>${style}</style>
</head>
<body>
<header><h1>Claude Code の使用状況</h1><span id="updated" class="muted">更新 ${clock(board.generatedAtMs, board.timeZone)}</span></header>
<main>
${limitsPanel(board)}
${usagePanel(board)}
${livePanel(board)}
</main>
<script>${refreshScript}</script>
</body>
</html>`;
}
