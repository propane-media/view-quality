#!/usr/bin/env node
// Rebuilds docs/surge-*.svg from made-up example data, run through the real
// estimator. Usage: node docs/make-charts.mjs
import { writeFileSync } from 'node:fs';
import { estimateBotTraffic } from '../index.mjs';

// ---- Example data -----------------------------------------------------------
const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
// Daily new views and new interactions (likes + comments + shares).
const VIRAL = { views: [1200, 1500, 1300, 9000, 26000, 14000, 6000, 3000], inter: [60, 75, 65, 460, 1350, 700, 300, 150], watch: [61, 60, 61, 63, 64, 63, 62, 62] };
const BOTTED = { views: [1200, 1500, 1300, 10000, 1400, 1200, 1100, 1000], inter: [60, 75, 65, 100, 70, 60, 55, 50], watch: [61, 60, 61, 40, 41, 41, 41, 41] };

function rows(base, s, account = 'example') {
  let v = 0, e = 0;
  return s.views.map((g, i) => {
    v += g; e += s.inter[i];
    return { base, platform: 'youtube', account_id: account, day: day(i), views: v, likes: Math.round(e * 0.8), comments: Math.round(e * 0.1), shares: e - Math.round(e * 0.8) - Math.round(e * 0.1), average_view_percentage: s.watch[i] };
  });
}
// Five ordinary posts give the channel its usual engagement rate (5%).
const baseline = [1, 2, 3, 4, 5].flatMap((n) => rows('usual-' + n, { views: [2000, 1500, 1000, 800], inter: [100, 75, 50, 40], watch: [60, 60, 60, 60] }));
const USUAL = 50; // interactions per 1,000 views

const viralReport = estimateBotTraffic([...baseline, ...rows('viral', VIRAL)]);
const bottedReport = estimateBotTraffic([...baseline, ...rows('botted', BOTTED)]);
const viralBot = viralReport.flagged.find((f) => f.base === 'viral')?.estimatedBotViews || 0;
const bottedBot = bottedReport.flagged.find((f) => f.base === 'botted')?.estimatedBotViews || 0;
if (viralBot !== 0 || bottedBot !== 8000) throw Error(`unexpected estimate: viral ${viralBot}, botted ${bottedBot}`);

// ---- Drawing ----------------------------------------------------------------
const THEMES = {
  light: { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', ink3: '#7a7974', grid: '#e6e5e0', axis: '#c9c8c1', views: '#2a78d6', bot: '#d03b3b', good: '#0ca30c' },
  dark: { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', ink3: '#9a9990', grid: '#2e2e2c', axis: '#4a4a46', views: '#3987e5', bot: '#e06666', good: '#0ca30c' },
};
const fmt = (n) => new Intl.NumberFormat('en-GB').format(n);
const W = 960, H = 580, PAD = 32, GAP = 48;
const PW = (W - PAD * 2 - GAP) / 2;
const BAR_TOP = 132, BAR_H = 200, LINE_TOP = 420, LINE_H = 90;
const MAX_VIEWS = 30000, MAX_RATE = 80;

// Bar with 4px rounded top corners, square base on the baseline.
function bar(x, y, w, h, fill, round = true) {
  if (h <= 0) return '';
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `<path d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z" fill="${fill}"/>`;
}

function panel(ox, title, subtitle, s, botViews, t) {
  const n = s.views.length, slot = PW / n, bw = Math.min(28, slot * 0.56);
  const yV = (v) => BAR_TOP + BAR_H - (v / MAX_VIEWS) * BAR_H;
  const yR = (r) => LINE_TOP + LINE_H - (Math.min(r, MAX_RATE) / MAX_RATE) * LINE_H;
  let out = `<text x="${ox}" y="84" font-size="17" font-weight="650" fill="${t.ink}">${title}</text>`;
  out += `<text x="${ox}" y="106" font-size="13" fill="${t.ink2}">${subtitle}</text>`;
  // Views grid + axis labels.
  for (const v of [0, 10000, 20000, 30000]) {
    const y = yV(v);
    out += `<line x1="${ox}" x2="${ox + PW}" y1="${y}" y2="${y}" stroke="${v ? t.grid : t.axis}" stroke-width="1"/>`;
    out += `<text x="${ox + PW}" y="${y - 5}" font-size="11" text-anchor="end" fill="${t.ink3}">${v ? fmt(v / 1000) + 'k' : '0'}</text>`;
  }
  s.views.forEach((v, i) => {
    const x = ox + i * slot + (slot - bw) / 2;
    const bot = i === 3 ? botViews : 0, real = v - bot;
    out += bar(x, yV(real), bw, yV(0) - yV(real), t.views, bot === 0);
    if (bot) {
      const top = yV(v), split = yV(real);
      out += bar(x, top, bw, split - top - 2, t.bot);
      out += `<text x="${x + bw + 8}" y="${top + 12}" font-size="12" font-weight="600" fill="${t.ink}">${fmt(bot)} counted as bot traffic</text>`;
      out += `<text x="${x + bw + 8}" y="${top + 28}" font-size="12" fill="${t.ink2}">${fmt(real)} explained by real engagement</text>`;
    }
    out += `<text x="${x + bw / 2}" y="${yV(0) + 16}" font-size="11" text-anchor="middle" fill="${t.ink3}">${i + 1}</text>`;
  });
  out += `<text x="${ox}" y="${yV(0) + 34}" font-size="11" fill="${t.ink3}">Day</text>`;
  // Engagement line.
  out += `<text x="${ox}" y="${LINE_TOP - 14}" font-size="13" font-weight="600" fill="${t.ink2}">Likes, comments and shares per 1,000 new views</text>`;
  out += `<line x1="${ox}" x2="${ox + PW}" y1="${yR(0)}" y2="${yR(0)}" stroke="${t.axis}"/>`;
  out += `<line x1="${ox}" x2="${ox + PW}" y1="${yR(USUAL)}" y2="${yR(USUAL)}" stroke="${t.ink3}" stroke-dasharray="4 4"/>`;
  out += `<text x="${ox + PW}" y="${yR(USUAL) - 5}" font-size="11" text-anchor="end" fill="${t.ink3}">channel's usual rate</text>`;
  out += `<line x1="${ox}" x2="${ox + PW}" y1="${yR(USUAL / 4)}" y2="${yR(USUAL / 4)}" stroke="${t.bot}" stroke-dasharray="2 4" opacity="0.8"/>`;
  out += `<text x="${ox + PW}" y="${yR(USUAL / 4) - 5}" font-size="11" text-anchor="end" fill="${t.ink3}">flag line (¼ of usual)</text>`;
  const pts = s.views.map((v, i) => [ox + i * slot + slot / 2, yR((s.inter[i] / v) * 1000)]);
  out += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${t.views}" stroke-width="2" stroke-linejoin="round"/>`;
  pts.forEach(([x, y], i) => {
    const low = i === 3 && botViews;
    out += `<circle cx="${x}" cy="${y}" r="4.5" fill="${low ? t.bot : t.views}" stroke="${t.surface}" stroke-width="2"/>`;
  });
  return out;
}

function svg(theme) {
  const t = THEMES[theme];
  const legendX = PAD + PW + GAP;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" role="img" aria-label="Two example posts. A real viral video gains 26,000 views in a day with engagement steady at the channel's usual rate: nothing is counted. A botted post gains 10,000 views in a day while engagement collapses: 8,000 views are counted as bot traffic.">
<rect width="${W}" height="${H}" rx="12" fill="${t.surface}"/>
<text x="${PAD}" y="44" font-size="20" font-weight="700" fill="${t.ink}">Two spikes in views, two different verdicts</text>
<g font-size="12" fill="${t.ink2}"><rect x="${legendX + 150}" y="33" width="12" height="12" rx="3" fill="${t.views}"/><text x="${legendX + 168}" y="43">New views</text><rect x="${legendX + 254}" y="33" width="12" height="12" rx="3" fill="${t.bot}"/><text x="${legendX + 272}" y="43">Counted as bot traffic</text></g>
${panel(PAD, 'A real viral video', 'Engagement keeps pace with views → 0 counted', VIRAL, 0, t)}
${panel(PAD + PW + GAP, 'A botted surge', 'Views jump, engagement and watch time collapse', BOTTED, 8000, t)}
<text x="${PAD}" y="${H - 18}" font-size="11" fill="${t.ink3}">Example data, scored by index.mjs. Rebuild with: node docs/make-charts.mjs</text>
</svg>
`;
}

for (const theme of ['light', 'dark']) writeFileSync(new URL(`./surge-${theme}.svg`, import.meta.url), svg(theme));
console.log(`viral: ${viralBot} counted · botted: ${fmt(bottedBot)} counted · charts written`);
