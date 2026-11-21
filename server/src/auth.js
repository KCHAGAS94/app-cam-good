import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {config} from './config.js';
import {query} from './db.js';

export const COOKIE = 'camgood_session';

export const hashPassword = pwd => bcrypt.hash(pwd, 12);
export const checkPassword = (pwd, hash) => bcrypt.compare(pwd, hash);

export function issueToken(user) {
  return jwt.sign({sub: user.id, role: user.role}, config.jwtSecret, {expiresIn: config.tokenTtl});
}

/** Rules for user (login) passwords. Returns an error message or null. */
export function passwordProblem(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 8) {
    return 'A senha precisa ter pelo menos 8 caracteres.';
  }
  return null;
}

/**
 * Reads the token from "Authorization: Bearer" (app) or the session cookie (web panel),
 * loads the user and puts it on req.user. Rejects inactive/removed users.
 */
export async function requireUser(req, res, next) {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.[COOKIE];
  if (!token) {
    return res.status(401).json({error: 'Faça login.'});
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    // tokens with an audience are single-purpose (e.g. a 10-minute media link): never a login
    if (payload.aud) {
      return res.status(401).json({error: 'Faça login.'});
    }
    const {rows} = await query('SELECT id, name, email, role, active FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0] || !rows[0].active) {
      return res.status(401).json({error: 'Usuário desativado.'});
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({error: 'Sessão expirada. Faça login de novo.'});
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({error: 'Só o administrador pode fazer isso.'});
  }
  next();
}

/** Can this user use this camera? Admins can use all. */
export async function canUseCamera(user, cameraId) {
  if (user.role === 'admin') {
    return true;
  }
  const {rowCount} = await query('SELECT 1 FROM camera_access WHERE user_id = $1 AND camera_id = $2', [
    user.id,
    cameraId,
  ]);
  return rowCount > 0;
}
