import { wrap, send, body, HttpError, isAdmin, hasRedis, hasBot, r, rp, getJ, setJ, KEYS, bkKey, getBooking, artists, artistSig, webhookSecret, tg, notifyClient, host } from './_lib.js';
import { pub, doCancel, doMove, refreshArtistCard } from './_ops.js';
import { seed } from './state.js';

const clean = (o) => JSON.parse(JSON.stringify(o || {}));

async function botInfo() { return (await getJ(KEYS.bot)) || null; }

async function list() {
  const ids = (await r('SMEMBERS', KEYS.all)) || [];
  const raw = ids.length ? await rp(ids.map(id => ['GET', bkKey(id)])) : [];
  const linked = ids.length ? await rp(ids.map(id => ['EXISTS', 'zubi:tg:client:' + id])) : [];
  const items = raw.map((v, i) => v ? { ...pub(JSON.parse(v)), linked: !!linked[i] } : null).filter(Boolean);
  const arts = await artists(); const bot = await botInfo();
  const chats = arts.length ? await rp(arts.map(a => ['EXISTS', 'zubi:tg:artist:' + a.id])) : [];
  const tgs = {}, links = {};
  arts.forEach((a, i) => { tgs[a.id] = !!chats[i]; links[a.id] = bot ? 'https://t.me/' + bot.username + '?start=a-' + a.id + '-' + artistSig(a.id) : null; });
  return { items, tg: tgs, links, bot: bot && bot.username, botToken: hasBot() };
}

export default wrap(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  if (!isAdmin(req)) throw new HttpError(401, 'bad_password');
  const q = await body(req); const site = host(req);
  if (q.op === 'login') return send(res, 200, { ok: true, redis: hasRedis(), botToken: hasBot() });
  if (!hasRedis()) throw new HttpError(503, 'no_redis');
  await seed();
  switch (q.op) {
    case 'list': return send(res, 200, await list());
    case 'confirm': case 'move': case 'cancel': {
      const b = await getBooking(String(q.id || '')); if (!b) throw new HttpError(404, 'not_found');
      if (q.op === 'confirm') { b.status = 'confirmed'; const { saveBooking } = await import('./_lib.js'); await saveBooking(b); }
      if (q.op === 'move') await doMove(b, String(q.date || ''), String(q.time || ''), 'studio');
      if (q.op === 'cancel') await doCancel(b, 'studio');
      try { await notifyClient(b, q.op === 'confirm' ? 'confirmed' : q.op === 'move' ? 'moved' : 'cancelled', site); await refreshArtistCard(b, site); } catch (e) { console.error(e); }
      return send(res, 200, { item: pub(b) });
    }
    case 'content': await setJ(KEYS.content, clean(q.content)); return send(res, 200, { ok: true });
    case 'artist': case 'work': case 'flash': {
      const key = q.op === 'artist' ? KEYS.artists : q.op === 'flash' ? KEYS.flash : KEYS.works;
      const arr = (await getJ(key, [])) || []; const id = String(q.id || '').slice(0, 40);
      if (!/^[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, 'bad_id');
      const data = { ...clean(q.data), id }; const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = data; else arr.push(data);
      await setJ(key, arr); return send(res, 200, { ok: true });
    }
    case 'artistDel': case 'workDel': case 'flashDel': {
      const key = q.op === 'artistDel' ? KEYS.artists : q.op === 'flashDel' ? KEYS.flash : KEYS.works;
      const arr = (await getJ(key, [])) || []; const gone = arr.find(x => x.id === q.id);
      await setJ(key, arr.filter(x => x.id !== q.id));
      if (q.op === 'artistDel') await r('DEL', 'zubi:tg:artist:' + q.id);
      if ((q.op === 'workDel' || q.op === 'flashDel') && gone && gone.media && /blob\.vercel-storage\.com/.test(gone.media.asset || '')) { try { const { del } = await import('@vercel/blob'); await del(gone.media.asset); } catch (e) { console.error(e); } }
      return send(res, 200, { ok: true });
    }
    case 'unlinkArtist': await r('DEL', 'zubi:tg:artist:' + String(q.id || '')); return send(res, 200, { ok: true });
    case 'setupBot': {
      if (!hasBot()) throw new HttpError(503, 'no_bot_token');
      const me = await tg('getMe', {}); if (!me || !me.ok) throw new HttpError(502, 'bad_bot_token');
      const wh = await tg('setWebhook', { url: site + '/api/telegram', secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
      if (!wh || !wh.ok) throw new HttpError(502, 'webhook_failed');
      await setJ(KEYS.bot, { username: me.result.username, name: me.result.first_name, site });
      await tg('setMyDescription', { description: 'ZUBI Tattoo, Warszawa. Powiadomienia o wizytach · Сповіщення про візити · Visit notifications.' });
      return send(res, 200, await list());
    }
  }
  throw new HttpError(400, 'op');
});
