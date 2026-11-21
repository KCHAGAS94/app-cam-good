import express from 'express';
import {hashPassword, passwordProblem, requireAdmin, requireUser} from '../auth.js';
import {audit, query} from '../db.js';

/** Admin: manage the people who can log in. */
export const userRoutes = express.Router();
userRoutes.use(requireUser, requireAdmin);

userRoutes.get('/', async (_req, res) => {
  const {rows} = await query(`
    SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
           COALESCE(array_agg(ca.camera_id) FILTER (WHERE ca.camera_id IS NOT NULL), '{}') AS camera_ids
      FROM users u LEFT JOIN camera_access ca ON ca.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at`);
  res.json({users: rows});
});

userRoutes.post('/', async (req, res) => {
  const {name, email, password, role = 'user'} = req.body ?? {};
  if (!name || !email) {
    return res.status(400).json({error: 'Preencha nome e e-mail.'});
  }
  const problem = passwordProblem(password);
  if (problem) {
    return res.status(400).json({error: problem});
  }
  try {
    const {rows} = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, lower($2), $3, $4) RETURNING id',
      [name.trim(), email.trim(), await hashPassword(password), role === 'admin' ? 'admin' : 'user'],
    );
    await audit(req, 'user_created', {detail: {id: rows[0].id, email}});
    res.json({id: rows[0].id});
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({error: 'Já existe um usuário com esse e-mail.'});
    }
    throw e;
  }
});

userRoutes.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const {name, role, active, password, cameraIds} = req.body ?? {};
  if (id === req.user.id && (active === false || role === 'user')) {
    return res.status(400).json({error: 'Você não pode desativar nem rebaixar a si mesmo.'});
  }
  if (name !== undefined) {
    await query('UPDATE users SET name = $1 WHERE id = $2', [String(name).trim(), id]);
  }
  if (role !== undefined) {
    await query('UPDATE users SET role = $1 WHERE id = $2', [role === 'admin' ? 'admin' : 'user', id]);
  }
  if (active !== undefined) {
    await query('UPDATE users SET active = $1 WHERE id = $2', [Boolean(active), id]);
  }
  if (password) {
    const problem = passwordProblem(password);
    if (problem) {
      return res.status(400).json({error: problem});
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), id]);
  }
  if (Array.isArray(cameraIds)) {
    await query('DELETE FROM camera_access WHERE user_id = $1', [id]);
    for (const cid of cameraIds) {
      await query('INSERT INTO camera_access (user_id, camera_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        id,
        Number(cid),
      ]);
    }
  }
  await audit(req, 'user_updated', {detail: {id, name, role, active, cameraIds, passwordChanged: !!password}});
  res.json({ok: true});
});

userRoutes.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({error: 'Você não pode remover a si mesmo.'});
  }
  await query('DELETE FROM users WHERE id = $1', [id]);
  await audit(req, 'user_deleted', {detail: {id}});
  res.json({ok: true});
});
