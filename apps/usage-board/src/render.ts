import type { Board } from "./board.ts";
import type { LiveSession } from "./live.ts";
import type { RateWindowView } from "./rate-limits.ts";
import type { DayUsage, UsageTotals } from "./usage.ts";

type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

const sessionStatuses: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: "入力待ち", tone: "warning" },
  busy: { label: "実行中", tone: "good" },
  idle: { label: "待機", tone: "neutral" },
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

function formatUsd(amount: number): string {
  return amount > 0 && amount < 0.01 ? "<$0.01" : `$${amount.toFixed(2)}`;
}

function costLabel(totals: UsageTotals): string {
  const marker = totals.unpricedModels.length > 0 ? "+" : "";
  return `${formatUsd(totals.costUsd)}${marker}`;
}

function signal(label: string, tone: Tone): string {
  return `<span class="signal" data-tone="${tone}">${escapeHtml(label)}</span>`;
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

const dialSweep = 75;
const dialTicks = Array.from({ length: 51 }, (_, index) => {
  const angle = ((135 + (index * 270) / 50) * Math.PI) / 180;
  const major = index % 10 === 0;
  const inner = major ? 43 : 46;
  const point = (radius: number) => `${(60 + radius * Math.cos(angle)).toFixed(2)} ${(60 + radius * Math.sin(angle)).toFixed(2)}`;
  return `M${point(inner)}L${point(49)}`;
}).join("");

function dialFace(remaining: number | null): string {
  const filled = remaining === null ? 0 : (dialSweep * remaining) / 100;
  return `<svg class="face" viewBox="0 0 120 120" aria-hidden="true">
<path class="ticks" d="${dialTicks}"/>
<circle class="track" cx="60" cy="60" r="54" pathLength="100" stroke-dasharray="${dialSweep} 100" transform="rotate(135 60 60)"/>
${filled > 0 ? `<circle class="level" cx="60" cy="60" r="54" pathLength="100" stroke-dasharray="${filled.toFixed(2)} 100" transform="rotate(135 60 60)"/>` : ""}
</svg>`;
}

function dial(title: string, window: RateWindowView, board: Board): string {
  if (window.state === "absent") {
    return `<section class="dial" data-tone="neutral"><div class="gauge">${dialFace(null)}<p class="reading"><span class="unit">値なし</span></p></div>
<h3>${title}</h3><p class="note">statusline の入力に入っていない</p></section>`;
  }
  if (window.state === "reset") {
    return `<section class="dial" data-tone="neutral"><div class="gauge">${dialFace(100)}<p class="reading"><span class="unit">リセット済み</span></p></div>
<h3>${title}</h3><p class="note">${clock(window.resetsAtMs, board.timeZone)} にリセット</p></section>`;
  }
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercentage));
  const tone: Tone = remaining < 5 ? "critical" : remaining < 20 ? "warning" : "good";
  return `<section class="dial" data-tone="${tone}">
<div class="gauge" role="meter" aria-label="${title}の残り" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(remaining)}">${dialFace(remaining)}
<p class="reading"><span class="unit">残り</span><strong>${Math.round(remaining)}%</strong></p></div>
<h3>${title}</h3>
<p class="note">リセットまで ${formatDuration(window.resetsAtMs - board.generatedAtMs)}</p>
<p class="note faint">${clock(window.resetsAtMs, board.timeZone)}</p>
</section>`;
}

function footer(board: Board, captured: string): string {
  return `<p class="foot">${captured}<span id="updated">${clock(board.generatedAtMs, board.timeZone)} 更新</span></p>`;
}

function limitsPanel(board: Board): string {
  const { rateLimits } = board;
  if (rateLimits.status === "unavailable") {
    return `<section class="panel limits"><h2>プランの残り</h2><p class="lead">取得できません</p><p class="note">${escapeHtml(rateLimits.reason)}</p>${footer(board, "")}</section>`;
  }
  const age = board.generatedAtMs - rateLimits.capturedAtMs;
  return `<section class="panel limits">
<h2>プランの残り</h2>
<div class="dials">${dial("5時間枠", rateLimits.fiveHour, board)}${dial("週の枠", rateLimits.sevenDay, board)}</div>
${footer(board, `<span${age > 15 * 60_000 ? ' data-stale="true"' : ""}>${formatAgo(age)}に取得</span>`)}
</section>`;
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", weekday: "short" }).format(Date.parse(`${date}T00:00:00Z`));
}

function sparkBar(day: DayUsage, maxCost: number, isToday: boolean): string {
  const height = maxCost > 0 ? Math.max((day.totals.costUsd / maxCost) * 100, 3) : 3;
  const [, month, date] = day.date.split("-");
  return `<li${isToday ? ' data-today="true"' : ""} title="${Number(month)}/${Number(date)}（${weekday(day.date)}） ${costLabel(day.totals)}"><span style="height:${height.toFixed(1)}%"></span></li>`;
}

function usagePanel(board: Board): string {
  if (board.usage.status === "loading") {
    return `<section class="panel usage"><p class="figure"><span class="unit">今日</span><strong class="pending">集計中</strong></p><p class="note">起動直後は過去の記録を読み込んでいる</p></section>`;
  }
  const { days } = board.usage.summary;
  const today = days.at(-1);
  const maxCost = Math.max(...days.map((day) => day.totals.costUsd));
  const unpriced = [...new Set(days.flatMap((day) => day.totals.unpricedModels))];
  const total = days.reduce((sum, day) => sum + day.totals.costUsd, 0);
  return `<section class="panel usage">
<div class="today">
<p class="figure"><span class="unit">今日</span><strong>${today ? costLabel(today.totals) : "-"}</strong></p>
<div class="trend"><ol class="spark" aria-label="${days.length}日間の金額">${days.map((day) => sparkBar(day, maxCost, day === today)).join("")}</ol>
<p class="note faint">${days.length}日間で ${formatUsd(total)}</p></div>
</div>
<p class="note faint">API の定価で換算した推定額${unpriced.length > 0 ? `。単価不明: ${escapeHtml(unpriced.join(", "))}（含めていない）` : ""}</p>
</section>`;
}

function liveRow(session: LiveSession, board: Board): string {
  const status = sessionStatuses[session.status] ?? { label: session.status, tone: "neutral" };
  const running = session.subagents.filter((subagent) => subagent.state === "running").length;
  const since = session.statusUpdatedAtMs === null ? "" : formatAgo(board.generatedAtMs - session.statusUpdatedAtMs);
  return `<li data-tone="${status.tone}">
<div class="head"><span class="title">${escapeHtml(session.name ?? session.project ?? session.sessionId.slice(0, 8))}</span>${signal(status.label, status.tone)}</div>
<div class="meta">${since === "" ? "" : `<span>${since}</span>`}${running > 0 ? `<span>サブエージェント ${running}</span>` : ""}</div>
${session.waitingFor === null ? "" : `<div class="waiting">${escapeHtml(session.waitingFor)}</div>`}
</li>`;
}

function livePanel(board: Board): string {
  const shown = board.live.filter((session) => session.status === "waiting" || session.status === "busy");
  const rest = board.live.length - shown.length;
  return `<section class="panel live">
<ul class="sessions">${shown.map((session) => liveRow(session, board)).join("")}</ul>
${shown.length === 0 ? `<p class="note">動いているセッションはない</p>` : ""}
${rest > 0 ? `<p class="note faint rest">ほか ${rest}件（待機中など）</p>` : ""}
</section>`;
}

const style = `
:root{color-scheme:dark;--dial:#0f1b2d;--rim:#1a2b44;--line:#243650;--text:#ebe7dc;--muted:#8d9ab0;--faint:#5f6e86;--lume:#a6e3bf;--warning:#f0b252;--serious:#f0895e;--critical:#ff7466;--numeral:ui-rounded,"SF Pro Rounded",-apple-system,"Hiragino Sans",sans-serif}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--dial);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
main{height:100dvh;display:grid;grid-template-columns:288px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);padding:0 max(env(safe-area-inset-right),8px) 0 max(env(safe-area-inset-left),8px)}
.panel{min-width:0;padding:14px 12px}
.limits{grid-row:1/3;display:flex;flex-direction:column;padding-bottom:10px;border-right:1px solid var(--line)}
.usage{grid-column:2;grid-row:1;padding-bottom:10px;border-bottom:1px solid var(--line);margin:0 4px}
.live{grid-column:2;grid-row:2;overflow-y:auto;padding-top:10px;margin:0 4px}
h2{font-size:12px;font-weight:600;color:var(--muted);margin:0;letter-spacing:.04em}
h3{font-size:13px;font-weight:600;margin:0 0 2px}
p{margin:0}
.note{font-size:12px;color:var(--muted)}
.faint{color:var(--faint)}
[data-stale="true"]{color:var(--serious)}
.lead{font-size:20px;margin:8px 0 4px}
.dials{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;align-content:center}
.dial{text-align:center}
.dial .note{font-size:11px;white-space:nowrap}
.gauge{position:relative;width:100%;max-width:128px;margin:0 auto 4px}
.face{display:block;width:100%;height:auto}
.ticks{stroke:var(--faint);stroke-width:1;stroke-linecap:round}
.track{fill:none;stroke:var(--rim);stroke-width:5;stroke-linecap:round}
.level{fill:none;stroke:var(--lume);stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 3px color-mix(in srgb,var(--lume) 45%,transparent))}
.dial[data-tone="warning"] .level{stroke:var(--warning)}
.dial[data-tone="critical"] .level{stroke:var(--critical)}
.dial[data-tone="neutral"] .ticks{stroke:var(--line)}
.reading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:4px}
.reading .unit{font-size:11px;color:var(--muted)}
.reading strong{font:200 38px/1 var(--numeral);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.dial[data-tone="warning"] .reading strong{color:var(--warning)}
.dial[data-tone="critical"] .reading strong{color:var(--critical)}
.foot{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--faint);margin-top:8px}
.today{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:4px}
.figure{display:flex;flex-direction:column}
.figure .unit{font-size:11px;color:var(--muted)}
.figure strong{font:200 40px/1 var(--numeral);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.figure .pending{font-size:22px;margin:6px 0 4px}
.trend{text-align:right}
.spark{list-style:none;margin:0 0 4px;padding:0;display:flex;align-items:flex-end;gap:3px;height:34px}
.spark li{width:6px;height:100%;display:flex;align-items:flex-end}
.spark li span{display:block;width:100%;border-radius:1px;background:var(--faint)}
.spark li[data-today="true"] span{background:var(--lume);box-shadow:0 0 6px color-mix(in srgb,var(--lume) 60%,transparent)}
.sessions{list-style:none;margin:0;padding:0}
.sessions>li{padding:7px 0;border-top:1px solid var(--line)}
.sessions>li:first-child{border-top:0;padding-top:0}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.title{font-weight:600;overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;column-gap:10px;font-size:12px;color:var(--faint)}
.meta:empty{display:none}
.signal{flex:none;font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.signal::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--faint)}
.signal[data-tone="good"]{color:var(--lume)}
.signal[data-tone="good"]::before{background:var(--lume);box-shadow:0 0 6px var(--lume)}
.signal[data-tone="warning"]{color:var(--warning)}
.signal[data-tone="warning"]::before{background:var(--warning);box-shadow:0 0 6px var(--warning)}
.waiting{margin-top:4px;padding-left:9px;border-left:2px solid var(--warning);font-size:13px}
.rest{margin-top:8px}
body[data-offline="true"] #updated::after{content:" 更新できません";color:var(--critical)}
@media (min-width:960px){
main{grid-template-columns:360px minmax(0,1fr)}
.dials{grid-template-columns:1fr;gap:32px}
.gauge{max-width:200px}
.reading strong{font-size:58px}
.reading .unit{font-size:13px}
.dial h3{font-size:15px}
.dial .note{font-size:13px}
.figure strong{font-size:64px}
.spark{height:56px;gap:5px}
.spark li{width:10px}
body{font-size:16px}
}
`;

const refreshScript = `
setInterval(async () => {
  try {
    const response = await fetch(location.pathname, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const next = new DOMParser().parseFromString(await response.text(), "text/html");
    const main = next.querySelector("main");
    const updated = next.querySelector("#updated");
    if (main === null || updated === null) throw new Error("unexpected page");
    const current = document.querySelector("main");
    const scrollLeft = current.scrollLeft;
    const scrollTops = new Map(Array.from(current.querySelectorAll(".panel"), (panel) => [panel.className, panel.scrollTop]));
    current.replaceWith(main);
    main.scrollLeft = scrollLeft;
    for (const panel of main.querySelectorAll(".panel")) panel.scrollTop = scrollTops.get(panel.className) ?? 0;
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0f1b2d">
<title>Usage Board</title>
<style>${style}</style>
</head>
<body>
<main>
${limitsPanel(board)}
${livePanel(board)}
${usagePanel(board)}
</main>
<script>${refreshScript}</script>
</body>
</html>`;
}
