import type { Board } from "./board.ts";
import type { LiveSession } from "./live.ts";
import type { RateWindowView } from "./rate-limits.ts";
import type { DayUsage, UsageTotals } from "./usage.ts";

type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] ?? char);
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

function remainingClock(ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60_000), 0);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}日${hours % 24}時間`;
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

function dial(title: string, window: RateWindowView, board: Board): string {
  if (window.state === "absent") {
    return `<section class="dial" data-tone="neutral"><div class="gauge">${dialFace(null)}<p class="reading"><span class="unit">値なし</span></p></div><h3>${title}</h3></section>`;
  }
  if (window.state === "reset") {
    return `<section class="dial" data-tone="neutral"><div class="gauge">${dialFace(100)}<p class="reading"><span class="unit">リセット済み</span></p></div><h3>${title}</h3></section>`;
  }
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercentage));
  const tone: Tone = remaining < 5 ? "critical" : remaining < 20 ? "warning" : "good";
  return `<section class="dial" data-tone="${tone}" title="${clock(window.resetsAtMs, board.timeZone)} にリセット">
<div class="gauge" role="meter" aria-label="${title}の残り" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(remaining)}">${dialFace(remaining)}
<p class="reading"><span class="value"><strong>${Math.round(remaining)}</strong><span class="pct">%</span></span></p></div>
<h3>${title}</h3>
<p class="note">あと ${remainingClock(window.resetsAtMs - board.generatedAtMs)}</p>
</section>`;
}

function clockFace(board: Board): string {
  const time = new Intl.DateTimeFormat("ja-JP", { timeZone: board.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(board.generatedAtMs);
  const date = new Intl.DateTimeFormat("ja-JP", { timeZone: board.timeZone, month: "numeric", day: "numeric", weekday: "short" }).format(board.generatedAtMs);
  return `<p class="clock"><time id="clock" data-time-zone="${escapeHtml(board.timeZone)}">${time}</time><span class="date">${date}</span></p>`;
}

function systemMeter(label: string, percentage: number | null): string {
  const tone: Tone = percentage === null ? "neutral" : percentage >= 95 ? "critical" : percentage >= 85 ? "warning" : "good";
  return `<p class="meter" data-tone="${tone}"><span class="unit">${label}</span><span class="track"><span style="width:${percentage ?? 0}%"></span></span><strong>${percentage === null ? "-" : `${percentage}%`}</strong></p>`;
}

function systemPanel(board: Board): string {
  return `<div class="system">${systemMeter("メモリ", board.system.memoryUsedPercentage)}${systemMeter("CPU", board.system.cpuBusyPercentage)}</div>`;
}

function limitsPanel(board: Board): string {
  const { rateLimits } = board;
  if (rateLimits.status === "unavailable") {
    return `<section class="panel limits">${clockFace(board)}<div class="dials"><div><p class="lead">残りを取得できません</p><p class="note">${escapeHtml(rateLimits.reason)}</p></div></div>${systemPanel(board)}</section>`;
  }
  const age = board.generatedAtMs - rateLimits.capturedAtMs;
  return `<section class="panel limits">
${clockFace(board)}
<div class="dials">${dial("5時間枠", rateLimits.fiveHour, board)}${dial("週の枠", rateLimits.sevenDay, board)}</div>
${age > 15 * 60_000 ? `<p class="note" data-stale="true">${formatAgo(age)}のデータ</p>` : ""}
${systemPanel(board)}
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
    return `<section class="panel usage"><p class="figure"><span class="unit">今日</span><strong class="pending">集計中</strong></p></section>`;
  }
  const { days } = board.usage.summary;
  const today = days.at(-1);
  const maxCost = Math.max(...days.map((day) => day.totals.costUsd));
  const unpriced = [...new Set(days.flatMap((day) => day.totals.unpricedModels))];
  const hint = `API の定価で換算した推定額${unpriced.length > 0 ? `。単価不明: ${unpriced.join(", ")}（含めていない）` : ""}`;
  return `<section class="panel usage">
<p class="figure" title="${escapeHtml(hint)}"><span class="unit">今日</span><strong>${today ? costLabel(today.totals) : "-"}</strong></p>
<ol class="spark" aria-label="${days.length}日間の金額">${days.map((day) => sparkBar(day, maxCost, day === today)).join("")}</ol>
</section>`;
}

function waitingRow(session: LiveSession): string {
  return `<li>
<span class="title">${escapeHtml(session.name ?? session.project ?? session.sessionId.slice(0, 8))}</span>
${session.waitingFor === null ? "" : `<span class="waiting">${escapeHtml(session.waitingFor)}</span>`}
</li>`;
}

function livePanel(board: Board): string {
  const waiting = board.live.filter((session) => session.status === "waiting");
  const busy = board.live.filter((session) => session.status === "busy").length;
  return `<section class="panel live">
<p class="busy"><strong>${busy}</strong> <span class="unit">実行中</span></p>
${waiting.length === 0 ? "" : `<ul class="sessions" aria-label="入力待ち">${waiting.map(waitingRow).join("")}</ul>`}
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
h3{font-size:13px;font-weight:600;margin:0 0 2px}
p{margin:0}
.note{font-size:12px;color:var(--muted)}
.faint{color:var(--faint)}
[data-stale="true"]{color:var(--serious)}
.dials{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;align-content:center}
.dial{text-align:center}
.gauge{position:relative;width:100%;max-width:128px;margin:0 auto 4px}
.face{display:block;width:100%;height:auto}
.ticks{stroke:var(--faint);stroke-width:1;stroke-linecap:round}
.track{fill:none;stroke:var(--rim);stroke-width:5;stroke-linecap:round}
.level{fill:none;stroke:var(--lume);stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 3px color-mix(in srgb,var(--lume) 45%,transparent))}
.dial[data-tone="warning"] .level{stroke:var(--warning)}
.dial[data-tone="critical"] .level{stroke:var(--critical)}
.dial[data-tone="neutral"] .ticks{stroke:var(--line)}
.reading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:4px}
.dial[data-tone="warning"] .reading strong{color:var(--warning)}
.dial[data-tone="critical"] .reading strong{color:var(--critical)}
.spark li span{display:block;width:100%;border-radius:1px;background:var(--faint)}
.spark li[data-today="true"] span{background:var(--lume);box-shadow:0 0 6px color-mix(in srgb,var(--lume) 60%,transparent)}
.sessions{list-style:none;margin:0;padding:0}
.lead{font-size:18px;margin-bottom:4px}
.dial .note{font:300 13px/1.3 var(--numeral);color:var(--muted);font-variant-numeric:tabular-nums}
.reading strong{font:200 40px/1 var(--numeral);font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.value{display:inline-flex;align-items:flex-start}
.reading .pct{font:300 14px/1 var(--numeral);color:var(--muted);margin:3px 0 0 2px}
.reading .unit{font-size:12px;color:var(--muted)}
.figure{display:flex;align-items:baseline;gap:10px}
.unit{font-size:12px;color:var(--muted)}
.figure strong{font:200 44px/1 var(--numeral);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.figure .pending{font-size:22px}
.spark{list-style:none;margin:10px 0 0;padding:0;display:flex;align-items:flex-end;gap:3px;height:28px}
.spark li{flex:1;max-width:10px;height:100%;display:flex;align-items:flex-end}
.busy{display:flex;align-items:baseline;gap:6px;margin-bottom:10px}
.busy strong{font:200 32px/1 var(--numeral);color:var(--lume);font-variant-numeric:tabular-nums}
.sessions>li{display:flex;flex-direction:column;padding:8px 0 8px 10px;border-left:2px solid var(--warning);margin-bottom:8px}
.title{font-weight:600;overflow-wrap:anywhere}
.waiting{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.clock{display:flex;align-items:baseline;gap:8px}
.clock time{font:200 30px/1 var(--numeral);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.clock .date{font-size:12px;color:var(--muted)}
.system{display:grid;gap:6px;margin-top:8px}
.meter{display:grid;grid-template-columns:3.2em 1fr 2.8em;align-items:center;gap:8px}
.meter .track{height:3px;border-radius:2px;background:var(--rim);overflow:hidden}
.meter .track span{display:block;height:100%;background:var(--muted)}
.meter[data-tone="warning"] .track span{background:var(--warning)}
.meter[data-tone="critical"] .track span{background:var(--critical)}
.meter strong{font:300 13px/1 var(--numeral);text-align:right;font-variant-numeric:tabular-nums}
.meter[data-tone="warning"] strong{color:var(--warning)}
.meter[data-tone="critical"] strong{color:var(--critical)}
body[data-offline="true"] .limits::after{content:"更新できません";font-size:12px;color:var(--critical)}
@media (min-width:960px){
main{grid-template-columns:360px minmax(0,1fr)}
.dials{grid-template-columns:1fr;gap:32px}
.gauge{max-width:200px}
.dial h3{font-size:15px}
.dial .note{font-size:15px}
.reading strong{font-size:64px}
.figure strong{font-size:72px}
.spark{height:48px;gap:5px}
.spark li{max-width:14px}
body{font-size:16px}
}
`;

const refreshScript = `
function tick() {
  const clock = document.querySelector("#clock");
  if (clock === null) return;
  clock.textContent = new Intl.DateTimeFormat("ja-JP", { timeZone: clock.dataset.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.now());
}
setInterval(tick, 5000);
setInterval(async () => {
  try {
    const response = await fetch(location.pathname, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const next = new DOMParser().parseFromString(await response.text(), "text/html");
    const main = next.querySelector("main");
    if (main === null) throw new Error("unexpected page");
    const current = document.querySelector("main");
    const scrollLeft = current.scrollLeft;
    const scrollTops = new Map(Array.from(current.querySelectorAll(".panel"), (panel) => [panel.className, panel.scrollTop]));
    current.replaceWith(main);
    main.scrollLeft = scrollLeft;
    for (const panel of main.querySelectorAll(".panel")) panel.scrollTop = scrollTops.get(panel.className) ?? 0;
    tick();
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
