import { wrap, send, body, HttpError, r, artists, fitsSchedule, claim, rid, secret, saveBooking, KEYS, notifyArtist, host, NEED } from './_lib.js';

const METHODS = ['whatsapp', 'telegram', 'viber', 'phone', 'instagram', 'email'];
const LANGS = ['pl', 'uk', 'en', 'ru'];
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

export default wrap(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const n = await r('INCR', 'zubi:rl:' + ip); if (n === 1) await r('EXPIRE', 'zubi:rl:' + ip, 3600);
  if (n > 12) throw new HttpError(429, 'too_many');
  const q = await body(req);
  const b = {
    artistId: str(q.artistId, 40), svc: str(q.svc, 10), date: str(q.date, 10), time: str(q.time, 5),
    name: str(q.name, 80), method: str(q.method, 12), contact: str(q.contact, 80), clang: str(q.clang, 2), idea: str(q.idea, 1000),
  };
  if (!NEED[b.svc] || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.time)) throw new HttpError(400, 'bad_time');
  if (!b.name || !b.contact || !METHODS.includes(b.method)) throw new HttpError(400, 'bad_contact');
  if (!LANGS.includes(b.clang)) b.clang = 'pl';
  const a = (await artists()).find(x => x.id === b.artistId);
  if (!a || !fitsSchedule(a, b.date, b.time, b.svc)) throw new HttpError(409, 'slot_taken');
  b.id = rid('b'); b.t = secret(); b.status = 'new'; b.createdAt = new Date().toISOString();
  if (!(await claim(b.artistId, b.date, b.time, b.svc, b.id))) throw new HttpError(409, 'slot_taken');
  await saveBooking(b); await r('SADD', KEYS.all, b.id);
  try { await notifyArtist(b, 'new', host(req)); } catch (e) { console.error(e); }
  send(res, 200, { id: b.id, t: b.t });
});
