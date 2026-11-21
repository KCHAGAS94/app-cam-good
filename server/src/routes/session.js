import express from 'express';
import rateLimit from 'express-rate-limit';
import {checkPassword, COOKIE, hashPassword, issueToken, passwordProblem, requireUser} from '../auth.js';
import {audit, query} from '../db.js';

export const sessionRoutes = express.Router();

// slow down password guessing
const loginLimiter = rateLimit({windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false});

const publicUser = u => ({id: u.id, name: u.name, email: u.email, role: u.role});

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // true behind HTTPS (Cloudflare Tunnel)
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

/** Is the system new (no users yet)? The panel shows the "create admin" screen. */
sessionRoutes.get('/setup', async (_req, res) => {
  const {rows} = await query('SELECT count(*)::int AS n FROM users');
  res.json({needsSetup: rows[0].n === 0});
});

/** First run only: creates the administrator account. */
sessionRoutes.post('/setup', loginLimiter, async (req, res) => {
  const {rows} = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) {
    return res.status(409).json({error: 'O sistema já foi configurado.'});
  }
  const {name, email, password} = req.body ?? {};
  if (!name || !email) {
    return res.status(400).json({error: 'Preencha nome e e-mail.'});
  }
  const problem = passwordProblem(password);
  if (problem) {
    return res.status(400).json({error: problem});
  }
  const {rows: created} = await query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, lower($2), $3, 'admin') RETURNING *",
    [name.trim(), email.trim(), await hashPassword(password)],
  );
  const token = issueToken(created[0]);
  setSessionCookie(req, res, token);
  await audit(req, 'setup', {userId: created[0].id});
  res.json({token, user: publicUser(created[0])});
});

sessionRoutes.post('/login', loginLimiter, async (req, res) => {
  const {email, password} = req.body ?? {};
  const {rows} = await query('SELECT * FROM users WHERE email = lower($1)', [String(email ?? '').trim()]);
  const user = rows[0];
  if (!user || !user.active || !(await checkPassword(String(password ?? ''), user.password_hash))) {
    await audit(req, 'login_failed', {detail: {email}});
    return res.status(401).json({error: 'E-mail ou senha incorretos.'});
  }
  const token = issueToken(user);
  setSessionCookie(req, res, token);
  await audit(req, 'login', {userId: user.id});
  res.json({token, user: publicUser(user)});
});

sessionRoutes.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ok: true});
});

sessionRoutes.get('/me', requireUser, (req, res) => res.json({user: publicUser(req.user)}));

/** Change my own login password. */
sessionRoutes.post('/me/password', requireUser, async (req, res) => {
  const {current, next} = req.body ?? {};
  const {rows} = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await checkPassword(String(current ?? ''), rows[0].password_hash))) {
    return res.status(400).json({error: 'Senha atual incorreta.'});
  }
  const problem = passwordProblem(next);
  if (problem) {
    return res.status(400).json({error: problem});
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), req.user.id]);
  await audit(req, 'password_changed');
  res.json({ok: true});
});
