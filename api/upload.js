import { put } from '@vercel/blob';
import { wrap, send, HttpError, isAdmin } from './_lib.js';

export const config = { api: { bodyParser: false } };
const OK = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|quicktime))$/;

export default wrap(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  if (!isAdmin(req)) throw new HttpError(401, 'bad_password');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, 'no_blob');
  const type = String(req.headers['content-type'] || '');
  if (!OK.test(type)) throw new HttpError(415, 'type');
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 4.4 * 1024 * 1024) throw new HttpError(413, 'too_big'); chunks.push(c); }
  const ext = type.split('/')[1].replace('quicktime', 'mov').replace('jpeg', 'jpg');
  const name = String(req.headers['x-filename'] || 'file').replace(/[^\w.-]+/g, '-').replace(/\.[^.]*$/, '').slice(0, 40) || 'file';
  const blob = await put('zubi/' + name + '.' + ext, Buffer.concat(chunks), { access: 'public', contentType: type, addRandomSuffix: true });
  send(res, 200, { url: blob.url });
});
