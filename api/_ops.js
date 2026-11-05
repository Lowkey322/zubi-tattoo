import { r, KEYS, times, slotKey, claim, release, artists, fitsSchedule, saveBooking, nowWarsaw, tg, artistCard, artistKeyboard, freeTimes, takenSet, slotOwners, addDays, HttpError } from './_lib.js';

export const pub = b => ({ id: b.id, artistId: b.artistId, svc: b.svc, date: b.date, time: b.time, status: b.status, name: b.name, method: b.method, contact: b.contact, clang: b.clang, idea: b.idea, movedFrom: b.movedFrom || null, createdAt: b.createdAt });
const ms = s => { const [d, t] = s.split(' '); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi); };
export const hoursLeft = b => (ms(b.date + ' ' + b.time) - ms(nowWarsaw())) / 3600e3;

export async function doCancel(b, by) {
  b.status = 'cancelled'; b.cancelledBy = by;
  await release(b.artistId, b.date, b.time, b.svc, b.id); await saveBooking(b);
}

/* move: claim new hours, then free the old ones not reused. by = 'client' | 'studio' */
export async function doMove(b, date, time, by) {
  const a = (await artists()).find(x => x.id === b.artistId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, 'bad_time');
  if (by === 'client' && (!a || !fitsSchedule(a, date, time, b.svc))) throw new HttpError(409, 'slot_taken');
  if (!(await claim(b.artistId, date, time, b.svc, b.id))) throw new HttpError(409, 'slot_taken');
  const old = { date: b.date, time: b.time };
  b.movedFrom = old.date + ' ' + old.time; b.date = date; b.time = time;
  b.status = by === 'client' ? 'new' : 'confirmed';
  await saveBooking(b);
  const keep = new Set(times(b.time, b.svc).map(t => b.date + '|' + t));
  for (const t of times(old.time, b.svc)) {
    if (keep.has(old.date + '|' + t)) continue;
    const k = slotKey(b.artistId, old.date, t);
    if ((await r('GET', k)) === b.id) { await r('DEL', k); await r('SREM', KEYS.slots, b.artistId + '|' + old.date + '|' + t); }
  }
}

/* next free times for the artist, ignoring this booking's own hours */
export async function nextFree(b, count = 6) {
  const a = (await artists()).find(x => x.id === b.artistId); if (!a) return [];
  const taken = await takenSet(); const owners = await slotOwners();
  const out = []; const today = nowWarsaw().slice(0, 10);
  for (let i = 0; i < 21 && out.length < count; i++) {
    const d = addDays(today, i);
    for (const t of freeTimes(a, d, b.svc, taken, b.id, owners)) {
      if (d === b.date && t === b.time) continue;
      out.push({ date: d, time: t }); if (out.length >= count) break;
    }
  }
  return out;
}

/* update the artist's Telegram card after a change made elsewhere */
export async function refreshArtistCard(b, site, kind) {
  if (!b.tgMsg) return;
  const a = (await artists()).find(x => x.id === b.artistId); const lang = (a && a.lang) || 'pl';
  await tg('editMessageText', { chat_id: b.tgMsg.chat, message_id: b.tgMsg.id, text: artistCard(b, a, lang, kind || 'new', site), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: b.status === 'cancelled' ? { inline_keyboard: [] } : artistKeyboard(b, lang, site) });
}
