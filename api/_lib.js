import crypto from 'node:crypto';

/* ---------- Redis (Upstash REST) ---------- */
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasRedis = () => !!(RURL && RTOK);
export async function r(...cmd) {
  if (!hasRedis()) throw new HttpError(503, 'no_redis');
  const res = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
export async function rp(cmds) {
  if (!cmds.length) return [];
  const res = await fetch(RURL + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  const j = await res.json();
  return j.map(x => x.result);
}
export async function getJ(key, def = null) { const v = await r('GET', key); return v ? JSON.parse(v) : def; }
export async function setJ(key, val) { return r('SET', key, JSON.stringify(val)); }

/* ---------- http helpers ---------- */
export class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
export function send(res, status, obj) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
export async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8'); try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
export function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { if (e instanceof HttpError) return send(res, e.status, { error: e.code }); console.error(e); send(res, 500, { error: 'server' }); }
  };
}
export function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || ''; const got = String(req.headers['x-admin-key'] || '');
  if (!want) throw new HttpError(503, 'no_password');
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const host = req => 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
export const rid = (p = '') => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
export const secret = () => crypto.randomBytes(12).toString('hex');
const TG = process.env.TELEGRAM_BOT_TOKEN || '';
export const hasBot = () => !!TG;
export const hmac = (s) => crypto.createHmac('sha256', TG + '|' + (process.env.ADMIN_PASSWORD || 'zubi')).update(s).digest('hex');
export const artistSig = id => hmac('artist:' + id).slice(0, 10);
export const webhookSecret = () => hmac('webhook').slice(0, 32);

/* ---------- data ---------- */
export const KEYS = { content: 'zubi:content', artists: 'zubi:artists', works: 'zubi:works', all: 'zubi:bk:all', slots: 'zubi:slots', bot: 'zubi:bot' };
export const bkKey = id => 'zubi:bk:' + id;
export const slotKey = (a, d, t) => 'zubi:slot:' + a + ':' + d + ':' + t.replace(':', '');
export async function artists() { return (await getJ(KEYS.artists, [])) || []; }
export async function getBooking(id) { return getJ(bkKey(id)); }
export async function saveBooking(b) { b.updatedAt = new Date().toISOString(); await setJ(bkKey(b.id), b); }

/* ---------- time (Europe/Warsaw) ---------- */
export function nowWarsaw() { // "YYYY-MM-DD HH:MM"
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw', hour12: false }).slice(0, 16);
}
const pad = n => String(n).padStart(2, '0');
export const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
export function addDays(ds, n) { const [y, m, d] = ds.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); }
export function weekday(ds) { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export const NEED = { consult: 1, session: 3 };
export const times = (time, svc) => Array.from({ length: NEED[svc] || 1 }, (_, k) => fromMin(toMin(time) + k * 60));
function plus12h() { const [d, t] = nowWarsaw().split(' '); const m = toMin(t) + 12 * 60; return m >= 1440 ? addDays(d, 1) + ' ' + fromMin(m - 1440) : d + ' ' + fromMin(m); }
export function fitsSchedule(a, date, time, svc) {
  if (!a || a.booking === false) return false;
  if ((a.daysOff || []).includes(date)) return false;
  if ((date + ' ' + time) < plus12h()) return false;
  const ranges = (a.schedule || {})[String(weekday(date))] || [];
  const s = toMin(time), e = s + (NEED[svc] || 1) * 60;
  return ranges.some(rg => rg && rg[0] && rg[1] && s >= toMin(rg[0]) && e <= toMin(rg[1]) && (s - toMin(rg[0])) % 60 === 0);
}
export async function takenSet() { return new Set((await r('SMEMBERS', KEYS.slots)) || []); }
export function freeTimes(a, date, svc, taken, ignoreId, bookingsById) {
  const out = []; const ranges = (a.schedule || {})[String(weekday(date))] || [];
  for (const rg of ranges) { if (!rg || !rg[0] || !rg[1]) continue;
    for (let m = toMin(rg[0]); m + (NEED[svc] || 1) * 60 <= toMin(rg[1]); m += 60) {
      const t = fromMin(m); if (!fitsSchedule(a, date, t, svc)) continue;
      const ok = times(t, svc).every(x => { const k = a.id + '|' + date + '|' + x; if (!taken.has(k)) return true; return ignoreId && bookingsById && bookingsById[k] === ignoreId; });
      if (ok) out.push(t);
    } }
  return out;
}
/* claim all slot hours atomically-ish with SET NX; release on failure */
export async function claim(aid, date, time, svc, bid) {
  const got = [];
  for (const t of times(time, svc)) {
    const ok = await r('SET', slotKey(aid, date, t), bid, 'NX');
    if (ok !== 'OK') { const cur = await r('GET', slotKey(aid, date, t)); if (cur !== bid) { for (const g of got) { await r('DEL', slotKey(aid, date, g)); await r('SREM', KEYS.slots, aid + '|' + date + '|' + g); } return false; } }
    got.push(t); await r('SADD', KEYS.slots, aid + '|' + date + '|' + t);
  }
  return true;
}
export async function release(aid, date, time, svc, bid) {
  for (const t of times(time, svc)) { const k = slotKey(aid, date, t); const cur = await r('GET', k); if (cur === bid) { await r('DEL', k); await r('SREM', KEYS.slots, aid + '|' + date + '|' + t); } }
}
export async function slotOwners() { // map "a|d|t" -> bookingId (for moving own booking)
  const members = (await r('SMEMBERS', KEYS.slots)) || []; if (!members.length) return {};
  const vals = await rp(members.map(m => { const [a, d, t] = m.split('|'); return ['GET', slotKey(a, d, t)]; }));
  const o = {}; members.forEach((m, i) => { o[m] = vals[i]; }); return o;
}

/* ---------- i18n for bot messages ---------- */
const LOC = { pl: 'pl-PL', uk: 'uk-UA', en: 'en-GB', ru: 'ru-RU' };
export function dLong(ds, lang) { const [y, m, d] = ds.split('-').map(Number); return new Intl.DateTimeFormat(LOC[lang] || 'pl-PL', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); }
export const T = {
  pl: { newB: 'Nowa rezerwacja', movedB: 'Klient zmienił termin', cancelledByClient: 'Klient odwołał wizytę', consult: 'Konsultacja, 30 min', session: 'Sesja tatuażu, ok. 3 godz.', client: 'Klient', contact: 'Kontakt', lang: 'Język', idea: 'Pomysł', from: 'Wcześniej', confirm: 'Potwierdź', other: 'Inny termin', write: 'Napisz', cancel: 'Odwołaj', panel: 'Otwórz w panelu', confirmed: 'Potwierdzona', cancelled: 'Odwołana', pick: 'Wybierz nowy termin. Klient dostanie powiadomienie.', none: 'Brak wolnych terminów w najbliższych 2 tygodniach.', otherDay: 'Inny dzień w panelu', cancelQ: 'Odwołać tę wizytę? Termin zwolni się na stronie.', yes: 'Tak, odwołaj', no: 'Nie', movedTo: 'Przeniesiono na', linked: 'Gotowe. Tutaj będą przychodzić rezerwacje dla: {a}.', badLink: 'Ten link nie działa. Poproś studio o nowy.', digest: 'Jutro masz wizyty: {n}', noDigest: '', hello: 'To bot studia ZUBI Tattoo. Tatuatorzy łączą się przez link z panelu, klienci przez przycisk po rezerwacji.', for: 'Dla' },
  uk: { newB: 'Новий запис', movedB: 'Клієнт переніс запис', cancelledByClient: 'Клієнт скасував візит', consult: 'Консультація, 30 хв', session: 'Сеанс тату, близько 3 год', client: 'Клієнт', contact: "Зв'язок", lang: 'Мова', idea: 'Ідея', from: 'Було', confirm: 'Підтвердити', other: 'Інший час', write: 'Написати', cancel: 'Скасувати', panel: 'Відкрити в панелі', confirmed: 'Підтверджено', cancelled: 'Скасовано', pick: 'Оберіть новий час. Клієнт отримає сповіщення.', none: 'Найближчі 2 тижні вільного часу немає.', otherDay: 'Інший день у панелі', cancelQ: 'Скасувати цей візит? Час звільниться на сайті.', yes: 'Так, скасувати', no: 'Ні', movedTo: 'Перенесено на', linked: 'Готово. Сюди приходитимуть записи для: {a}.', badLink: 'Це посилання не працює. Попросіть у студії нове.', digest: 'Завтра у вас візитів: {n}', hello: 'Це бот студії ZUBI Tattoo. Майстри підключаються через посилання з панелі, клієнти через кнопку після запису.', for: 'Для' },
  en: { newB: 'New booking', movedB: 'Client rescheduled', cancelledByClient: 'Client cancelled', consult: 'Consultation, 30 min', session: 'Tattoo session, about 3 h', client: 'Client', contact: 'Contact', lang: 'Language', idea: 'Idea', from: 'Was', confirm: 'Confirm', other: 'Another time', write: 'Message', cancel: 'Cancel', panel: 'Open in panel', confirmed: 'Confirmed', cancelled: 'Cancelled', pick: 'Pick a new time. The client gets notified.', none: 'No free times in the next 2 weeks.', otherDay: 'Another day in the panel', cancelQ: 'Cancel this visit? The time frees up on the site.', yes: 'Yes, cancel', no: 'No', movedTo: 'Moved to', linked: 'Done. Bookings for {a} will arrive here.', badLink: "This link doesn't work. Ask the studio for a new one.", digest: 'Tomorrow you have visits: {n}', hello: 'This is the ZUBI Tattoo studio bot. Artists connect with a link from the panel, clients with the button after booking.', for: 'For' },
  ru: { newB: 'Новая запись', movedB: 'Клиент перенёс запись', cancelledByClient: 'Клиент отменил визит', consult: 'Консультация, 30 мин', session: 'Сеанс тату, около 3 ч', client: 'Клиент', contact: 'Связь', lang: 'Язык', idea: 'Идея', from: 'Было', confirm: 'Подтвердить', other: 'Другое время', write: 'Написать', cancel: 'Отменить', panel: 'Открыть в панели', confirmed: 'Подтверждена', cancelled: 'Отменена', pick: 'Выберите новое время. Клиент получит уведомление.', none: 'В ближайшие 2 недели свободного времени нет.', otherDay: 'Другой день в панели', cancelQ: 'Отменить этот визит? Время освободится на сайте.', yes: 'Да, отменить', no: 'Нет', movedTo: 'Перенесено на', linked: 'Готово. Сюда будут приходить записи для: {a}.', badLink: 'Эта ссылка не работает. Попросите у студии новую.', digest: 'Завтра у вас визитов: {n}', hello: 'Это бот студии ZUBI Tattoo. Мастера подключаются по ссылке из панели, клиенты кнопкой после записи.', for: 'Для' },
};
export const CT = {
  pl: { linked: 'Gotowe! Tutaj dostaniesz potwierdzenie i przypomnienie o wizycie.', confirmed: 'Twoja wizyta jest potwierdzona', moved: 'Twoja wizyta została przeniesiona', cancelled: 'Twoja wizyta została odwołana. Napisz do nas, jeśli chcesz inny termin.', remind: 'Przypomnienie: jutro masz wizytę w ZUBI Tattoo', manage: 'Zarządzaj rezerwacją' },
  uk: { linked: 'Готово! Тут ви отримаєте підтвердження й нагадування про візит.', confirmed: 'Ваш візит підтверджено', moved: 'Ваш візит перенесено', cancelled: 'Ваш візит скасовано. Напишіть нам, якщо хочете інший час.', remind: 'Нагадування: завтра у вас візит у ZUBI Tattoo', manage: 'Керувати записом' },
  en: { linked: "Done! You'll get the confirmation and a reminder here.", confirmed: 'Your visit is confirmed', moved: 'Your visit was moved', cancelled: 'Your visit was cancelled. Message us if you want another time.', remind: 'Reminder: tomorrow you have a visit at ZUBI Tattoo', manage: 'Manage booking' },
  ru: { linked: 'Готово! Здесь вы получите подтверждение и напоминание о визите.', confirmed: 'Ваш визит подтверждён', moved: 'Ваш визит перенесён', cancelled: 'Ваш визит отменён. Напишите нам, если хотите другое время.', remind: 'Напоминание: завтра у вас визит в ZUBI Tattoo', manage: 'Управлять записью' },
};
export const LNAME = { pl: 'polski', uk: 'українська', en: 'English', ru: 'русский' };
export const MNAME = { whatsapp: 'WhatsApp', telegram: 'Telegram', viber: 'Viber', phone: 'SMS / tel.', instagram: 'Instagram', email: 'E-mail' };
export const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function clientUrl(b) {
  const v = String(b.contact || '').trim(); const dg = v.replace(/[^\d]/g, '');
  if (b.method === 'whatsapp') return 'https://wa.me/' + dg;
  if (b.method === 'telegram') return /^@?[A-Za-z]/.test(v) ? 'https://t.me/' + v.replace(/^@/, '') : 'https://t.me/+' + dg;
  if (b.method === 'instagram') return 'https://ig.me/m/' + v.replace(/^@/, '');
  return null;
}

/* ---------- Telegram ---------- */
export async function tg(method, payload) {
  if (!TG) return null;
  const res = await fetch('https://api.telegram.org/bot' + TG + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await res.json(); if (!j.ok) console.error('tg', method, j.description); return j;
}
export function artistCard(b, a, lang, kind, site) {
  const t = T[lang] || T.pl; const head = kind === 'moved' ? t.movedB : kind === 'cancelled' ? t.cancelledByClient : t.newB;
  let s = '<b>' + esc(head) + '</b>\n' + esc(t.for) + ': ' + esc(a ? a.name : '') + '\n\n<b>' + esc(b.svc === 'session' ? t.session : t.consult) + '</b>\n' + esc(dLong(b.date, lang)) + ', ' + esc(b.time);
  if (kind === 'moved' && b.movedFrom) s += '\n' + esc(t.from) + ': ' + esc(b.movedFrom);
  s += '\n\n' + esc(t.client) + ': ' + esc(b.name) + '\n' + esc(t.contact) + ': ' + esc(MNAME[b.method] || b.method) + ' ' + esc(b.contact) + '\n' + esc(t.lang) + ': ' + esc(LNAME[b.clang] || b.clang);
  if (b.idea) s += '\n' + esc(t.idea) + ': ' + esc(b.idea);
  if (b.status === 'confirmed') s += '\n\n<b>' + esc(t.confirmed) + '</b>';
  if (b.status === 'cancelled') s += '\n\n<b>' + esc(t.cancelled) + '</b>';
  return s;
}
export function artistKeyboard(b, lang, site) {
  const t = T[lang] || T.pl; const rows = [];
  if (b.status === 'new') rows.push([{ text: t.confirm, callback_data: 'ok:' + b.id }, { text: t.other, callback_data: 'mv:' + b.id }]);
  else if (b.status === 'confirmed') rows.push([{ text: t.other, callback_data: 'mv:' + b.id }]);
  const u = clientUrl(b); const second = [];
  if (u) second.push({ text: t.write + ' ↗', url: u });
  if (b.status !== 'cancelled') second.push({ text: t.cancel, callback_data: 'cx:' + b.id });
  if (second.length) rows.push(second);
  rows.push([{ text: t.panel + ' ↗', url: site + '/#panel' }]);
  return { inline_keyboard: rows };
}
export async function notifyArtist(b, kind, site) {
  const list = await artists(); const a = list.find(x => x.id === b.artistId); if (!a) return;
  const chat = await r('GET', 'zubi:tg:artist:' + a.id); if (!chat) return;
  const lang = a.lang || 'pl';
  const j = await tg('sendMessage', { chat_id: chat, text: artistCard(b, a, lang, kind, site), parse_mode: 'HTML', reply_markup: kind === 'cancelled' ? undefined : artistKeyboard(b, lang, site), disable_web_page_preview: true });
  if (j && j.ok) { b.tgMsg = { chat: chat, id: j.result.message_id }; await saveBooking(b); }
}
export async function notifyClient(b, kind, site) {
  const chat = await r('GET', 'zubi:tg:client:' + b.id); if (!chat) return;
  const c = CT[b.clang] || CT.pl; const list = await artists(); const a = list.find(x => x.id === b.artistId);
  const line = esc(dLong(b.date, b.clang)) + ', ' + esc(b.time) + (a ? ' · ' + esc(a.name) : '');
  const text = (kind === 'linked' ? c.linked + '\n\n' + line : kind === 'cancelled' ? c.cancelled + '\n\n<s>' + line + '</s>' : kind === 'remind' ? c.remind + '\n\n' + line : (kind === 'moved' ? c.moved : c.confirmed) + ':\n\n<b>' + line + '</b>');
  await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: c.manage + ' ↗', url: site + '/?b=' + b.id + '.' + b.t }]] } });
}
