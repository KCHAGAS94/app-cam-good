import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import {canUseCamera, requireAdmin, requireUser} from '../auth.js';
import {config} from '../config.js';
import {audit, query} from '../db.js';

/** Photos and videos sent by the app, stored under MEDIA_DIR/<camera>/<yyyy-mm>/. */
export const mediaRoutes = express.Router();

const LINK_TTL = '10m';

async function sendMediaFile(res, m) {
  res.sendFile(path.join(config.mediaDir, m.file_path), {
    headers: {'Content-Type': m.mime, 'Cache-Control': 'private, max-age=86400'},
  });
}

/**
 * Temporary link (?t=...) so the phone's own video player / browser can open a file
 * without the login token. Signed for ONE file, valid for 10 minutes.
 * Without ?t= the request falls through to the normal logged-in route below.
 */
mediaRoutes.get('/:id/file', async (req, res, next) => {
  if (!req.query.t) {
    return next();
  }
  try {
    const payload = jwt.verify(String(req.query.t), config.jwtSecret, {audience: 'media'});
    if (payload.mid !== Number(req.params.id)) {
      return res.status(403).end();
    }
    const {rows} = await query('SELECT * FROM media WHERE id = $1', [payload.mid]);
    return rows[0] ? sendMediaFile(res, rows[0]) : res.status(404).end();
  } catch {
    return res.status(403).json({error: 'Link expirado. Abra o arquivo de novo pelo app.'});
  }
});

mediaRoutes.use(requireUser);

/** Creates the temporary link above for a file the user may see. */
mediaRoutes.post('/:id/link', async (req, res) => {
  const {rows} = await query('SELECT camera_id FROM media WHERE id = $1', [Number(req.params.id)]);
  const m = rows[0];
  if (!m || (m.camera_id && !(await canUseCamera(req.user, m.camera_id)))) {
    return res.status(404).json({error: 'Arquivo não encontrado.'});
  }
  const t = jwt.sign({mid: Number(req.params.id), sub: req.user.id}, config.jwtSecret, {
    audience: 'media',
    expiresIn: LINK_TTL,
  });
  res.json({path: `/api/media/${Number(req.params.id)}/file?t=${encodeURIComponent(t)}`});
});

const ALLOWED = {'image/jpeg': ['photo', '.jpg'], 'video/mp4': ['video', '.mp4']};

const upload = multer({
  dest: path.join(config.mediaDir, '_incoming'),
  limits: {fileSize: config.maxUploadBytes, files: 1},
  fileFilter: (_req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype])),
});

/** multipart/form-data: file (jpeg|mp4), cameraId, takenAt (ISO, optional), durationMs (optional) */
mediaRoutes.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({error: 'Envie uma foto (JPEG) ou vídeo (MP4).'});
  }
  const cameraId = Number(req.body.cameraId);
  if (!cameraId || !(await canUseCamera(req.user, cameraId))) {
    fs.rmSync(file.path, {force: true});
    return res.status(403).json({error: 'Sem acesso a essa câmera.'});
  }
  const {rows: cams} = await query('SELECT did FROM cameras WHERE id = $1', [cameraId]);
  const [kind, ext] = ALLOWED[file.mimetype];
  const takenAt = req.body.takenAt ? new Date(req.body.takenAt) : new Date();
  const when = Number.isNaN(takenAt.getTime()) ? new Date() : takenAt;
  const month = when.toISOString().slice(0, 7);
  const name = `${when.toISOString().replace(/[:.]/g, '-')}_${crypto.randomBytes(3).toString('hex')}${ext}`;
  const rel = path.join(cams[0].did, month, name);
  fs.mkdirSync(path.join(config.mediaDir, cams[0].did, month), {recursive: true});
  fs.renameSync(file.path, path.join(config.mediaDir, rel));

  const {rows} = await query(
    `INSERT INTO media (camera_id, user_id, kind, file_path, mime, size_bytes, duration_ms, taken_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [cameraId, req.user.id, kind, rel, file.mimetype, file.size, Number(req.body.durationMs) || null, when],
  );
  await audit(req, `upload_${kind}`, {cameraId, detail: {mediaId: rows[0].id, size: file.size}});
  res.json({id: rows[0].id});
});

/** List: ?cameraId=&kind=photo|video&before=<id> (pages of 60, newest first). */
mediaRoutes.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where.push(`m.camera_id IN (SELECT camera_id FROM camera_access WHERE user_id = $${params.length})`);
  }
  if (req.query.cameraId) {
    params.push(Number(req.query.cameraId));
    where.push(`m.camera_id = $${params.length}`);
  }
  if (req.query.kind === 'photo' || req.query.kind === 'video') {
    params.push(req.query.kind);
    where.push(`m.kind = $${params.length}`);
  }
  if (req.query.before) {
    params.push(Number(req.query.before));
    where.push(`m.id < $${params.length}`);
  }
  const {rows} = await query(
    `SELECT m.id, m.kind, m.mime, m.size_bytes, m.duration_ms, m.taken_at, m.camera_id,
            c.name AS camera_name, u.name AS user_name
       FROM media m LEFT JOIN cameras c ON c.id = m.camera_id LEFT JOIN users u ON u.id = m.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.id DESC LIMIT 60`,
    params,
  );
  res.json({media: rows});
});

/** The file itself (sendFile handles Range requests, so videos can be seeked). */
mediaRoutes.get('/:id/file', async (req, res) => {
  const {rows} = await query('SELECT * FROM media WHERE id = $1', [Number(req.params.id)]);
  const m = rows[0];
  if (!m || (m.camera_id && !(await canUseCamera(req.user, m.camera_id)))) {
    return res.status(404).end();
  }
  return sendMediaFile(res, m);
});

mediaRoutes.delete('/:id', requireAdmin, async (req, res) => {
  const {rows} = await query('DELETE FROM media WHERE id = $1 RETURNING file_path', [Number(req.params.id)]);
  if (rows[0]) {
    fs.rmSync(path.join(config.mediaDir, rows[0].file_path), {force: true});
  }
  await audit(req, 'media_deleted', {detail: {id: Number(req.params.id)}});
  res.json({ok: true});
});
