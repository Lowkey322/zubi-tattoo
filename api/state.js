import { wrap, send, hasRedis, r, getJ, KEYS, slotOwners } from './_lib.js';
import { DEF } from './_defaults.js';

export async function seed() {
  if (!hasRedis()) return;
  await r('SET', KEYS.content, JSON.stringify(DEF.content), 'NX');
  await r('SET', KEYS.artists, JSON.stringify(DEF.artists), 'NX');
  await r('SET', KEYS.works, JSON.stringify(DEF.works), 'NX');
}

export default wrap(async (req, res) => {
  if (!hasRedis()) return send(res, 200, { ...DEF, slots: [], bot: null, live: false });
  await seed();
  const [content, artists, works, bot, owners] = await Promise.all([getJ(KEYS.content), getJ(KEYS.artists, []), getJ(KEYS.works, []), getJ(KEYS.bot), slotOwners()]);
  const slots = Object.entries(owners).map(([k, bookingId]) => { const [artistId, date, time] = k.split('|'); return { artistId, date, time, bookingId }; });
  send(res, 200, { content, artists, works, slots, bot: bot && bot.username || null, live: true });
});
