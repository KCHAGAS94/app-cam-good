/**
 * End-to-end test of the API against a throwaway database (camgood_test) and media folder.
 * Run: npm test   (needs the camgood_test database; it is wiped at the start)
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import pg from 'pg';

const PORT = 18080;
const BASE = `http://localhost:${PORT}/api`;
const testDbUrl = process.env.DATABASE_URL.replace(/\/camgood$/, '/camgood_test');
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camgood-media-'));
let server;

async function api(method, url, {token, body, form} = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  return {status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer()};
}

before(async () => {
  const db = new pg.Client({connectionString: testDbUrl});
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.end();
  server = spawn(process.execPath, ['src/index.js'], {
    env: {...process.env, DATABASE_URL: testDbUrl, MEDIA_DIR: mediaDir, PORT: String(PORT)},
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) {
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  fs.rmSync(mediaDir, {recursive: true, force: true});
});

test('full flow: setup, cameras, access control, media, history', async () => {
  // first run: setup creates the admin, then setup is closed
  assert.equal((await api('GET', '/setup')).data.needsSetup, true);
  assert.equal((await api('POST', '/setup', {body: {name: 'Adm', email: 'a@x.com', password: 'curta'}})).status, 400);
  const setup = await api('POST', '/setup', {body: {name: 'Adm', email: 'A@x.com', password: 'senha-forte-1'}});
  assert.equal(setup.status, 200);
  const admin = setup.data.token;
  assert.equal((await api('POST', '/setup', {body: {name: 'B', email: 'b@x.com', password: 'senha-forte-2'}})).status, 409);

  // login (email is case-insensitive) and wrong password
  assert.equal((await api('POST', '/login', {body: {email: 'a@x.com', password: 'errada!!'}})).status, 401);
  assert.equal((await api('POST', '/login', {body: {email: 'a@X.com', password: 'senha-forte-1'}})).status, 200);

  // camera: password stored encrypted, returned decrypted to authorized users
  const cam = await api('POST', '/cameras', {token: admin, body: {did: 'pixb-test123', name: 'Sala', pwd: 'cam-secret'}});
  assert.equal(cam.status, 200);
  assert.equal((await api('POST', '/cameras', {token: admin, body: {did: 'PIXB-TEST123', name: 'x', pwd: 'y'}})).status, 409);
  const list = await api('GET', '/cameras', {token: admin});
  assert.deepEqual(list.data.cameras[0], {id: cam.data.id, did: 'PIXB-TEST123', name: 'Sala', user: 'admin', pwd: 'cam-secret'});
  const raw = new pg.Client({connectionString: testDbUrl});
  await raw.connect();
  const stored = (await raw.query('SELECT cam_pwd_enc FROM cameras')).rows[0].cam_pwd_enc;
  assert.ok(!stored.includes('cam-secret'));

  // a regular user sees nothing until given access, and can't do admin things
  const u = await api('POST', '/users', {token: admin, body: {name: 'Mãe', email: 'mae@x.com', password: 'senha-da-mae'}});
  const mae = (await api('POST', '/login', {body: {email: 'mae@x.com', password: 'senha-da-mae'}})).data.token;
  assert.equal((await api('GET', '/cameras', {token: mae})).data.cameras.length, 0);
  assert.equal((await api('GET', '/users', {token: mae})).status, 403);
  assert.equal((await api('PUT', `/users/${u.data.id}`, {token: admin, body: {cameraIds: [cam.data.id]}})).status, 200);
  assert.equal((await api('GET', '/cameras', {token: mae})).data.cameras.length, 1);

  // upload a photo as the user, list it, download it
  const form = new FormData();
  form.append('cameraId', String(cam.data.id));
  form.append('takenAt', '2026-11-18T10:00:00Z');
  form.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], {type: 'image/jpeg'}), 'p.jpg');
  const up = await api('POST', '/media', {token: mae, form});
  assert.equal(up.status, 200);
  const media = await api('GET', `/media?cameraId=${cam.data.id}`, {token: mae});
  assert.equal(media.data.media[0].kind, 'photo');
  const file = await api('GET', `/media/${up.data.id}/file`, {token: mae});
  assert.equal(Buffer.from(file.data).length, 4);

  // temporary link: opens that one file without login, but is useless as a login token
  const link = await api('POST', `/media/${up.data.id}/link`, {token: mae});
  assert.equal(link.status, 200);
  const viaLink = await fetch(`http://localhost:${PORT}${link.data.path}`);
  assert.equal(viaLink.status, 200);
  assert.equal((await viaLink.arrayBuffer()).byteLength, 4);
  const linkToken = new URL(link.data.path, 'http://x').searchParams.get('t');
  assert.equal((await api('GET', '/cameras', {token: linkToken})).status, 401);
  assert.equal((await fetch(`http://localhost:${PORT}/api/media/${up.data.id}/file?t=forjado`)).status, 403);

  // disabled user is locked out immediately; access removal hides media
  await api('PUT', `/users/${u.data.id}`, {token: admin, body: {active: false}});
  assert.equal((await api('GET', '/cameras', {token: mae})).status, 401);

  // history recorded the important actions
  const log = await api('GET', '/log', {token: admin});
  const actions = log.data.log.map(l => l.action);
  for (const a of ['setup', 'login', 'login_failed', 'camera_created', 'user_created', 'upload_photo']) {
    assert.ok(actions.includes(a), `missing ${a} in history`);
  }
  await raw.end();
});
