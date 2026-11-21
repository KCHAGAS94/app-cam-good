import express from 'express';
import {canUseCamera, requireAdmin, requireUser} from '../auth.js';
import {audit, query} from '../db.js';
import {decrypt, encrypt} from '../secrets.js';

export const cameraRoutes = express.Router();
cameraRoutes.use(requireUser);

/**
 * Cameras this user may use. Includes the camera login (decrypted) because the app needs it
 * to open the P2P session; only sent over the authenticated API (HTTPS when public).
 */
cameraRoutes.get('/', async (req, res) => {
  const {rows} =
    req.user.role === 'admin'
      ? await query('SELECT * FROM cameras ORDER BY name')
      : await query(
          `SELECT c.* FROM cameras c JOIN camera_access ca ON ca.camera_id = c.id
            WHERE ca.user_id = $1 ORDER BY c.name`,
          [req.user.id],
        );
  res.json({
    cameras: rows.map(c => ({
      id: c.id,
      did: c.did,
      name: c.name,
      user: c.cam_user,
      pwd: decrypt(c.cam_pwd_enc),
    })),
  });
});

cameraRoutes.post('/', requireAdmin, async (req, res) => {
  const {did, name, user = 'admin', pwd} = req.body ?? {};
  if (!did || !name || !pwd) {
    return res.status(400).json({error: 'Preencha ID, nome e senha da câmera.'});
  }
  try {
    const {rows} = await query(
      'INSERT INTO cameras (did, name, cam_user, cam_pwd_enc) VALUES (upper($1), $2, $3, $4) RETURNING id',
      [String(did).trim(), String(name).trim(), user, encrypt(pwd)],
    );
    await audit(req, 'camera_created', {cameraId: rows[0].id, detail: {did}});
    res.json({id: rows[0].id});
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({error: 'Essa câmera já está cadastrada.'});
    }
    throw e;
  }
});

/**
 * Edit name / login. Any user with access may update the password (e.g. after changing it
 * in the app), so everyone keeps connecting; renaming is admin-only.
 */
cameraRoutes.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await canUseCamera(req.user, id))) {
    return res.status(403).json({error: 'Sem acesso a essa câmera.'});
  }
  const {name, pwd} = req.body ?? {};
  if (name !== undefined) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({error: 'Só o administrador pode renomear.'});
    }
    await query('UPDATE cameras SET name = $1 WHERE id = $2', [String(name).trim(), id]);
  }
  if (pwd) {
    await query('UPDATE cameras SET cam_pwd_enc = $1 WHERE id = $2', [encrypt(pwd), id]);
  }
  await audit(req, 'camera_updated', {cameraId: id, detail: {name, passwordChanged: !!pwd}});
  res.json({ok: true});
});

cameraRoutes.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM cameras WHERE id = $1', [id]);
  await audit(req, 'camera_deleted', {detail: {id}});
  res.json({ok: true});
});

/** The app reports what the user did with a camera (live view, talk…) for the history. */
cameraRoutes.post('/:id/log', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await canUseCamera(req.user, id))) {
    return res.status(403).json({error: 'Sem acesso a essa câmera.'});
  }
  const action = String(req.body?.action ?? '').slice(0, 40);
  if (!action) {
    return res.status(400).json({error: 'action obrigatória'});
  }
  await audit(req, action, {cameraId: id, detail: req.body?.detail ?? null});
  res.json({ok: true});
});
