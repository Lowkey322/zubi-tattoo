import { wrap, send, body, r, artists, artistSig, webhookSecret, tg, T, esc, getBooking, saveBooking, dLong, artistCard, artistKeyboard, notifyClient, getJ, KEYS } from './_lib.js';
import { doCancel, doMove, nextFree } from './_ops.js';

const ymd = s => s.replace(/-/g, ''), unymd = s => s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
const hm = s => s.replace(':', ''), unhm = s => s.slice(0, 2) + ':' + s.slice(2, 4);

async function site() { const b = await getJ(KEYS.bot); return (b && b.site) || ''; }

async function handleStart(chatId, payload, from) {
  const arts = await artists();
  let m = /^a-([A-Za-z0-9]+)-([a-f0-9]{10})$/.exec(payload || '');
  if (m) {
    const a = arts.find(x => x.id === m[1]);
    if (a && artistSig(a.id) === m[2]) {
      await r('SET', 'zubi:tg:artist:' + a.id, String(chatId));
      return tg('sendMessage', { chat_id: chatId, text: (T[a.lang] || T.pl).linked.replace('{a}', a.name) });
    }
    return tg('sendMessage', { chat_id: chatId, text: T.pl.badLink + '\n' + T.uk.badLink });
  }
  m = /^c-([A-Za-z0-9]+)-([a-f0-9]{10})$/.exec(payload || '');
  if (m) {
    const b = await getBooking(m[1]);
    if (b && b.t.startsWith(m[2])) {
      await r('SET', 'zubi:tg:client:' + b.id, String(chatId));
      return notifyClient(b, 'linked', await site());
    }
    return tg('sendMessage', { chat_id: chatId, text: T.pl.badLink + '\n' + T.uk.badLink });
  }
  const lang = /^(uk|ru|en|pl)/.exec((from && from.language_code) || '');
  return tg('sendMessage', { chat_id: chatId, text: (T[lang ? lang[1] : 'pl'] || T.pl).hello });
}

async function handleCallback(cq) {
  const [act, id, d, t] = String(cq.data || '').split(':');
  const chatId = String(cq.message.chat.id), msgId = cq.message.message_id;
  const b = await getBooking(id);
  if (!b) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: '—' });
  const arts = await artists(); const a = arts.find(x => x.id === b.artistId); const lang = (a && a.lang) || 'pl'; const L = T[lang] || T.pl;
  const owner = await r('GET', 'zubi:tg:artist:' + b.artistId);
  if (owner !== chatId) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: L.badLink, show_alert: true });
  const s = await site();
  const card = (extra) => tg('editMessageText', { chat_id: chatId, message_id: msgId, text: artistCard(b, a, lang, 'new', s) + (extra ? '\n\n' + extra : ''), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: b.status === 'cancelled' ? { inline_keyboard: [] } : artistKeyboard(b, lang, s) });
  b.tgMsg = { chat: chatId, id: msgId };

  if (act === 'ok') {
    if (b.status === 'new') { b.status = 'confirmed'; await saveBooking(b); await notifyClient(b, 'confirmed', s); }
    await card(); return tg('answerCallbackQuery', { callback_query_id: cq.id, text: L.confirmed });
  }
  if (act === 'bk') { await saveBooking(b); await card(); return tg('answerCallbackQuery', { callback_query_id: cq.id }); }
  if (act === 'mv') {
    const opts = await nextFree(b, 6);
    const rows = []; for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2).map(o => ({ text: dLong(o.date, lang) + ', ' + o.time, callback_data: 'mt:' + b.id + ':' + ymd(o.date) + ':' + hm(o.time) })));
    rows.push([{ text: L.otherDay + ' ↗', url: s + '/#panel' }]); rows.push([{ text: '← ' + L.no, callback_data: 'bk:' + b.id }]);
    await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: artistCard(b, a, lang, 'new', s) + '\n\n<i>' + esc(opts.length ? L.pick : L.none) + '</i>', parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
    return tg('answerCallbackQuery', { callback_query_id: cq.id });
  }
  if (act === 'mt') {
    try { await doMove(b, unymd(d), unhm(t), 'studio'); } catch (e) { return tg('answerCallbackQuery', { callback_query_id: cq.id, text: '✕', show_alert: false }); }
    b.tgMsg = { chat: chatId, id: msgId }; await saveBooking(b);
    await notifyClient(b, 'moved', s);
    await card('<i>' + esc(L.movedTo) + ' ' + esc(dLong(b.date, lang)) + ', ' + esc(b.time) + '</i>');
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: L.movedTo + ' ' + b.time });
  }
  if (act === 'cx') {
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: L.yes, callback_data: 'cy:' + b.id }, { text: L.no, callback_data: 'bk:' + b.id }]] } });
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: L.cancelQ, show_alert: false });
  }
  if (act === 'cy') {
    if (b.status !== 'cancelled') { await doCancel(b, 'studio'); b.tgMsg = { chat: chatId, id: msgId }; await saveBooking(b); await notifyClient(b, 'cancelled', s); }
    await card(); return tg('answerCallbackQuery', { callback_query_id: cq.id, text: L.cancelled });
  }
  return tg('answerCallbackQuery', { callback_query_id: cq.id });
}

export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 200, { ok: true });
  if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret()) return send(res, 401, { ok: false });
  const u = await body(req);
  try {
    if (u.callback_query) await handleCallback(u.callback_query);
    else if (u.message && u.message.chat && u.message.chat.type === 'private') {
      const txt = String(u.message.text || '');
      const m = /^\/start(?:\s+(\S+))?/.exec(txt);
      await handleStart(u.message.chat.id, m ? m[1] : '', u.message.from);
    }
  } catch (e) { console.error(e); }
  send(res, 200, { ok: true });
});
