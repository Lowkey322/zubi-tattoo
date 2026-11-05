import { wrap, send, r, rp, KEYS, bkKey, artists, nowWarsaw, addDays, tg, T, esc, MNAME, notifyClient, getJ, hasRedis } from './_lib.js';

export default wrap(async (req, res) => {
  const want = process.env.CRON_SECRET;
  if (!want || req.headers.authorization !== 'Bearer ' + want) return send(res, 401, { ok: false });
  if (!hasRedis()) return send(res, 200, { ok: true, skipped: 'no_redis' });
  const bot = await getJ(KEYS.bot); const site = (bot && bot.site) || '';
  const tomorrow = addDays(nowWarsaw().slice(0, 10), 1);
  const ids = (await r('SMEMBERS', KEYS.all)) || [];
  const raw = ids.length ? await rp(ids.map(id => ['GET', bkKey(id)])) : [];
  const list = raw.filter(Boolean).map(v => JSON.parse(v)).filter(b => b.date === tomorrow && b.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));
  let artistMsgs = 0, clientMsgs = 0;
  for (const a of await artists()) {
    const mine = list.filter(b => b.artistId === a.id); if (!mine.length) continue;
    const chat = await r('GET', 'zubi:tg:artist:' + a.id); if (!chat) continue;
    const L = T[a.lang] || T.pl;
    const lines = mine.map(b => '<b>' + esc(b.time) + '</b> ' + esc(b.svc === 'session' ? L.session : L.consult) + '\n' + esc(b.name) + ' · ' + esc(MNAME[b.method] || b.method) + ' ' + esc(b.contact) + (b.status === 'new' ? ' · <i>' + esc(L.confirm) + '?</i>' : ''));
    await tg('sendMessage', { chat_id: chat, text: '<b>' + esc(L.digest.replace('{n}', mine.length)) + '</b>\n\n' + lines.join('\n\n'), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: L.panel + ' ↗', url: site + '/#panel' }]] } });
    artistMsgs++;
  }
  for (const b of list) { if (b.status === 'confirmed' && await r('GET', 'zubi:tg:client:' + b.id)) { await notifyClient(b, 'remind', site); clientMsgs++; } }
  send(res, 200, { ok: true, date: tomorrow, bookings: list.length, artistMsgs, clientMsgs });
});
