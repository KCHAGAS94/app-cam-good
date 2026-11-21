import express from 'express';
import {requireAdmin, requireUser} from '../auth.js';
import {query} from '../db.js';

/** Admin: access history (logins, live views, uploads, changes). ?before=<id> for paging. */
export const logRoutes = express.Router();
logRoutes.use(requireUser, requireAdmin);

logRoutes.get('/', async (req, res) => {
  const before = Number(req.query.before) || null;
  const {rows} = await query(
    `SELECT l.id, l.action, l.detail, l.ip, l.created_at, u.name AS user_name, c.name AS camera_name
       FROM access_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN cameras c ON c.id = l.camera_id
      ${before ? 'WHERE l.id < $1' : ''}
      ORDER BY l.id DESC LIMIT 100`,
    before ? [before] : [],
  );
  res.json({log: rows});
});
