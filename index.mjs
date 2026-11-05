// "Estimated bot traffic" for a client campaign. Pure: daily snapshot rows in,
// one conservative estimate out.
//
// Built to stay at zero for real growth. A day's new views count as suspect
// only when ALL of these hold at once:
//   1. a jump    — at least JUMP_FACTOR x the post's previous daily rate and
//                  at least MIN_JUMP_VIEWS new views;
//   2. no engagement — likes+comments+shares per new view under a quarter of
//                  the channel's own usual rate (a tenth when the platform
//                  gives us no watch-time figure to check);
//   3. watch time collapsed — the post's average watch figure fell by at
//                  least WATCH_DROP (skipped only when the platform omits it,
//                  which is why rule 2 tightens in that case).
// A video that takes off on merit brings likes, comments, shares and watch
// time with it, so rule 2 or 3 fails and nothing is counted. Even on a flagged
// day only the views the channel's normal engagement cannot explain are
// counted, never the whole jump. Missing or inconsistent data never counts.
export const BOT_RULES = Object.freeze({
  minPostViews: 1000,
  minJumpViews: 1000,
  jumpFactor: 5,
  engagementFloor: 0.25,
  engagementFloorWithoutWatch: 0.10,
  watchDrop: 0.15,
  minChannelPosts: 5,
});

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const DAY_MS = 86_400_000;
const ENGAGEMENT = ['likes', 'comments', 'shares'];

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Interactions gained between two captures, using only the fields both carry.
function interactionGain(a, b) {
  let gain = null;
  for (const k of ENGAGEMENT) {
    const x = num(a[k]), y = num(b[k]);
    if (x == null || y == null) continue;
    gain = (gain || 0) + Math.max(0, y - x);
  }
  return gain;
}

function totalInteractions(r) {
  const parts = ENGAGEMENT.map((k) => num(r[k])).filter((v) => v != null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

function watchFigure(r) {
  const avp = num(r.average_view_percentage);
  if (avp != null && avp > 0) return { kind: 'avp', value: avp };
  const awt = num(r.avg_watch_time_seconds);
  if (awt != null && awt > 0) return { kind: 'awt', value: awt };
  return null;
}

// rows: [{base, platform, account_id, published_at, day:'YYYY-MM-DD', views,
//         likes, comments, shares, average_view_percentage, avg_watch_time_seconds}]
// One row per post per UTC day (the latest capture that day), covering the
// report window. Views in the window are the views each post gained in it: a
// post published inside the window counts from zero, an older one from its
// first capture in the window.
export function estimateBotTraffic(rows, { rules = BOT_RULES, now = new Date(), windowStart = null } = {}) {
  const posts = new Map();
  for (const r of rows || []) {
    if (num(r.views) == null || !r.day) continue;
    const key = JSON.stringify([r.base, r.platform, r.account_id]);
    if (!posts.has(key)) posts.set(key, { base: r.base, platform: r.platform, accountId: r.account_id, series: [] });
    posts.get(key).series.push(r);
  }
  for (const p of posts.values()) {
    p.series.sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const last = p.series.at(-1);
    p.views = num(last.views);
    const publishedInside = windowStart && last.published_at && Date.parse(last.published_at) >= Date.parse(windowStart);
    p.gained = Math.max(0, p.views - (publishedInside ? 0 : num(p.series[0].views)));
    const inter = totalInteractions(last);
    p.rate = p.views >= rules.minPostViews && inter != null ? inter / p.views : null;
  }

  // The usual engagement rate: per channel, else per platform within this
  // campaign. Too few posts to know what normal looks like = not judged.
  const ratesBy = (keyOf) => {
    const groups = new Map();
    for (const p of posts.values()) if (p.rate != null) {
      const k = keyOf(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p.rate);
    }
    return new Map([...groups].filter(([, v]) => v.length >= rules.minChannelPosts).map(([k, v]) => [k, median(v)]));
  };
  const channelRates = ratesBy((p) => p.platform + '\u0000' + p.accountId);
  const platformRates = ratesBy((p) => p.platform);

  let totalViews = 0, checkedViews = 0, checkedPosts = 0, estimated = 0;
  const flagged = [];
  for (const p of posts.values()) {
    totalViews += p.gained;
    const usual = channelRates.get(p.platform + '\u0000' + p.accountId) ?? platformRates.get(p.platform);
    if (!(p.views >= rules.minPostViews) || !(usual > 0)) continue;
    checkedPosts++; checkedViews += p.gained;
    let bot = 0;
    const s = p.series;
    for (let i = 2; i < s.length; i++) {
      const [a, b, c] = [s[i - 2], s[i - 1], s[i]];
      const d1 = Math.max(1, (Date.parse(b.day) - Date.parse(a.day)) / DAY_MS);
      const d2 = Math.max(1, (Date.parse(c.day) - Date.parse(b.day)) / DAY_MS);
      const gain = num(c.views) - num(b.views);
      const prevRate = Math.max(0, num(b.views) - num(a.views)) / d1;
      if (!(gain >= rules.minJumpViews) || gain / d2 < rules.jumpFactor * Math.max(prevRate, 1)) continue;
      const interactions = interactionGain(b, c);
      if (interactions == null) continue;
      const w1 = watchFigure(b), w2 = watchFigure(c);
      const hasWatch = w1 && w2 && w1.kind === w2.kind;
      if (hasWatch && (w1.value - w2.value) / w1.value < rules.watchDrop) continue;
      const floor = hasWatch ? rules.engagementFloor : rules.engagementFloorWithoutWatch;
      if (interactions / gain >= floor * usual) continue;
      bot += Math.max(0, Math.min(gain, gain - interactions / usual));
    }
    bot = Math.min(Math.round(bot), p.gained);
    if (bot > 0) {
      estimated += bot;
      flagged.push({ base: p.base, platform: p.platform, accountId: p.accountId, views: p.views, estimatedBotViews: bot });
    }
  }
  flagged.sort((a, b) => b.estimatedBotViews - a.estimatedBotViews);
  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? new Date(windowStart).toISOString() : null,
    totalViews, checkedViews, posts: posts.size, checkedPosts,
    estimatedBotViews: estimated,
    share: totalViews > 0 ? estimated / totalViews : 0,
    label: botShareLabel(totalViews > 0 ? estimated / totalViews : 0),
    flagged: flagged.slice(0, 10),
    rules: { ...rules },
  };
}

// The figure a client sees: exactly 0 reads "0%", anything under 1% "<1%".
export function botShareLabel(share) {
  if (!(share > 0)) return '0%';
  if (share < 0.01) return '<1%';
  return `${(share * 100).toFixed(1)}%`;
}
