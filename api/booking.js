import { wrap, send, body, HttpError, getBooking, notifyArtist, host, r } from './_lib.js';
import { pub, hoursLeft, doCancel, doMove } from './_ops.js';

async function load(key) {
  const [id, t] = String(key || '').split('.');
  if (!id || !t) return null;
  const b = await getBooking(id);
  return b && b.t === t ? b : null;
}

export default wrap(async (req, res) => {
  if (req.method === 'GET') {
    const keys = String(new URL(req.url, 'http://x').searchParams.get('k') || '').split(',').filter(Boolean).slice(0, 30);
    const items = [];
    for (const k of keys) { const b = await load(k); if (b) items.push({ ...pub(b), key: k, linked: !!(await r('GET', 'zubi:tg:client:' + b.id)) }); }
    return send(res, 200, { items });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const q = await body(req);
  const b = await load(q.key);
  if (!b) throw new HttpError(404, 'not_found');
  if (b.status === 'cancelled') throw new HttpError(409, 'cancelled');
  if (hoursLeft(b) < 24) throw new HttpError(403, 'too_late');
  const site = host(req);
  if (q.op === 'cancel') {
    await doCancel(b, 'client');
    try { await notifyArtist(b, 'cancelled', site); } catch (e) { console.error(e); }
    return send(res, 200, { item: pub(b) });
  }
  if (q.op === 'move') {
    await doMove(b, String(q.date || ''), String(q.time || ''), 'client');
    try { await notifyArtist(b, 'moved', site); } catch (e) { console.error(e); }
    return send(res, 200, { item: pub(b) });
  }
  throw new HttpError(400, 'op');
});
