import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadCameras, saveAllCameras, SavedCamera} from '../storage';

/**
 * Login to the CamGood central server (the user's PC, later their domain).
 * Without an account the app keeps working with cameras saved only on the phone.
 */

export type Account = {
  serverUrl: string; // e.g. http://192.168.0.10:8080 or https://cam.example.com
  token: string;
  user: {id: number; name: string; email: string; role: 'admin' | 'user'};
};

const KEY = 'account.v1';
let current: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();

export class ServerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** "192.168.0.10:8080" -> "http://192.168.0.10:8080" (no trailing slash). */
export function normalizeUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    u = 'http://' + u;
  }
  return u;
}

export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    current = raw ? JSON.parse(raw) : null;
  } catch {
    current = null;
  }
  return current;
}

export const getAccount = () => current;

export function onAccountChange(cb: (a: Account | null) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function setAccount(a: Account | null) {
  current = a;
  if (a) {
    await AsyncStorage.setItem(KEY, JSON.stringify(a));
  } else {
    await AsyncStorage.removeItem(KEY);
  }
  listeners.forEach(cb => cb(a));
}

/** JSON request to the server with the saved token. Times out after 15 s. */
export async function serverFetch<T>(method: string, path: string, body?: unknown, account = current): Promise<T> {
  if (!account) {
    throw new ServerError('Sem conta conectada.', 0);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(account.serverUrl + '/api' + path, {
      method,
      headers: {
        Authorization: `Bearer ${account.token}`,
        ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401 && account === current) {
      await setAccount(null); // token expired or user disabled: back to the login screen
    }
    if (!res.ok) {
      throw new ServerError(data?.error ?? `Erro ${res.status}`, res.status);
    }
    return data as T;
  } catch (e: any) {
    if (e instanceof ServerError) {
      throw e;
    }
    throw new ServerError('Não foi possível falar com o servidor. Confira o endereço e a internet.', 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function login(serverUrl: string, email: string, password: string): Promise<Account> {
  const url = normalizeUrl(serverUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url + '/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: email.trim(), password}),
      signal: ctrl.signal,
    });
  } catch {
    throw new ServerError('Não foi possível falar com o servidor. Confira o endereço e se o PC está ligado.', 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ServerError(data?.error ?? `Erro ${res.status}`, res.status);
  }
  const account: Account = {serverUrl: url, token: data.token, user: data.user};
  await setAccount(account);
  return account;
}

/** Logs out and removes the cameras that came from the server (keeps phone-only ones). */
export async function logout() {
  const local = (await loadCameras()).filter(c => c.serverId === undefined);
  await saveAllCameras(local);
  await setAccount(null);
}

export type ServerCamera = {id: number; did: string; name: string; user: string; pwd: string};

/**
 * Brings the camera list from the server: adds/updates the cameras this user may use and
 * removes server cameras whose access was revoked. Phone-only cameras are kept.
 * Per-phone preferences (quality) are preserved.
 */
export async function syncCameras(): Promise<SavedCamera[]> {
  const {cameras} = await serverFetch<{cameras: ServerCamera[]}>('GET', '/cameras');
  const merged = mergeServerCameras(await loadCameras(), cameras);
  await saveAllCameras(merged);
  return merged;
}

/**
 * Pure merge used by syncCameras: server cameras win (name/login), phone-only cameras stay,
 * server cameras no longer returned (access revoked) are dropped, per-phone quality is kept.
 */
export function mergeServerCameras(local: SavedCamera[], server: ServerCamera[]): SavedCamera[] {
  const byDid = new Map(local.map(c => [c.did.toUpperCase(), c]));
  const fromServer: SavedCamera[] = server.map(s => {
    const prev = byDid.get(s.did.toUpperCase());
    return {
      did: s.did,
      name: s.name,
      user: s.user,
      pwd: s.pwd,
      serverId: s.id,
      quality: prev?.quality,
      rotation: prev?.rotation,
    };
  });
  const serverDids = new Set(server.map(s => s.did.toUpperCase()));
  const phoneOnly = local.filter(c => c.serverId === undefined && !serverDids.has(c.did.toUpperCase()));
  return [...fromServer, ...phoneOnly];
}

/** Registers a phone-only camera in the account (admins only). */
export async function registerCamera(cam: SavedCamera): Promise<number> {
  const {id} = await serverFetch<{id: number}>('POST', '/cameras', {did: cam.did, name: cam.name, pwd: cam.pwd});
  return id;
}

/** Keeps the server in sync after the camera password was changed in the app. */
export async function pushCameraPassword(cam: SavedCamera, pwd: string) {
  if (cam.serverId !== undefined && current) {
    await serverFetch('PUT', `/cameras/${cam.serverId}`, {pwd});
  }
}

// ---------------------------------------------------------------- gallery (server media)

export type ServerMedia = {
  id: number;
  kind: 'photo' | 'video';
  mime: string;
  size_bytes: number;
  duration_ms: number | null;
  taken_at: string;
  camera_id: number | null;
  camera_name: string | null;
  user_name: string | null;
};

/** Pages of 60, newest first; pass the last id as `before` for the next page. */
export async function listMedia(q: {cameraId?: number; kind?: 'photo' | 'video'; before?: number}) {
  const p: string[] = [];
  if (q.cameraId) {
    p.push(`cameraId=${q.cameraId}`);
  }
  if (q.kind) {
    p.push(`kind=${q.kind}`);
  }
  if (q.before) {
    p.push(`before=${q.before}`);
  }
  return (await serverFetch<{media: ServerMedia[]}>('GET', `/media?${p.join('&')}`)).media;
}

/** Image source for a photo (the login token goes in a header, never in the URL). */
export function mediaImageSource(id: number) {
  const a = current;
  return a ? {uri: `${a.serverUrl}/api/media/${id}/file`, headers: {Authorization: `Bearer ${a.token}`}} : undefined;
}

/** 10-minute link to open a file in the phone's video player / browser. */
export async function mediaOpenUrl(id: number) {
  const {path} = await serverFetch<{path: string}>('POST', `/media/${id}/link`);
  return current!.serverUrl + path;
}

export const deleteMedia = (id: number) => serverFetch('DELETE', `/media/${id}`);

/** Fire-and-forget history entry (live_view, talk, playback…). */
export function logAction(cam: SavedCamera, action: string, detail?: Record<string, unknown>) {
  if (cam.serverId === undefined || !current) {
    return;
  }
  serverFetch('POST', `/cameras/${cam.serverId}/log`, {action, detail}).catch(() => {});
}
