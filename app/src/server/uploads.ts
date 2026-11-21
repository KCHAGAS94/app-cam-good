import AsyncStorage from '@react-native-async-storage/async-storage';
import {CameraModule} from '../camera/native';
import {getAccount} from './account';

/**
 * Upload queue for photos/videos made in the app. Items stay queued (and the file stays
 * in the phone gallery) until the server accepts them, so nothing is lost when the phone
 * is offline or the PC is off.
 */

export type PendingUpload = {
  id: string;
  /** content:// (copy in the phone gallery) or file:// (app outbox, server-only) */
  uri: string;
  kind: 'photo' | 'video';
  cameraServerId: number;
  takenAt: string;
  durationMs?: number;
  tries: number;
  /** Only copy is in the app outbox: delete after upload, never give up on it. */
  serverOnly?: boolean;
};

const KEY = 'uploads.v1';
/** Give up on an item after this many failed attempts (e.g. file deleted from the gallery). */
const MAX_TRIES = 20;
let running = false;
const listeners = new Set<(pending: number) => void>();

async function load(): Promise<PendingUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function save(list: PendingUpload[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  listeners.forEach(cb => cb(list.length));
}

/** Items still waiting to reach the server (shown in the app gallery as "enviando…"). */
export const listPending = () => load();

export function onPendingChange(cb: (pending: number) => void) {
  listeners.add(cb);
  load().then(l => cb(l.length));
  return () => {
    listeners.delete(cb);
  };
}

export async function enqueueUpload(item: Omit<PendingUpload, 'id' | 'tries'>) {
  const list = await load();
  list.push({...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tries: 0});
  await save(list);
  processUploads();
}

async function sendOne(item: PendingUpload): Promise<'ok' | 'retry' | 'drop'> {
  const account = getAccount();
  if (!account) {
    return 'retry';
  }
  const form = new FormData();
  form.append('cameraId', String(item.cameraServerId));
  form.append('takenAt', item.takenAt);
  if (item.durationMs) {
    form.append('durationMs', String(Math.round(item.durationMs)));
  }
  const isPhoto = item.kind === 'photo';
  // FormData needs file:// or content:// URIs; both kinds are produced by CameraModule
  form.append('file', {
    uri: item.uri,
    type: isPhoto ? 'image/jpeg' : 'video/mp4',
    name: isPhoto ? 'foto.jpg' : 'video.mp4',
  } as any);
  try {
    const res = await fetch(account.serverUrl + '/api/media', {
      method: 'POST',
      headers: {Authorization: `Bearer ${account.token}`},
      body: form,
    });
    if (res.ok) {
      return 'ok';
    }
    // 403: no access to that camera anymore; 400: file refused -> no point retrying
    return res.status === 403 || res.status === 400 ? 'drop' : 'retry';
  } catch {
    return 'retry';
  }
}

/** Sends everything pending, oldest first. Safe to call often (runs one at a time). */
export async function processUploads() {
  if (running || !getAccount()) {
    return;
  }
  running = true;
  try {
    let list = await load();
    while (list.length > 0) {
      const item = list[0];
      const result = await sendOne(item);
      if (result === 'retry') {
        item.tries += 1;
        // gallery copies can be given up on; server-only files are kept until they get through
        if (item.tries >= MAX_TRIES && !item.serverOnly) {
          list.shift();
        }
        await save(list);
        break; // offline / server down: try again later
      }
      if (item.serverOnly) {
        if (result === 'ok') {
          await CameraModule.deleteLocalFile(item.uri).catch(() => {});
        } else {
          // refused by the server (e.g. access removed): keep it in the phone gallery instead
          await CameraModule.moveToGallery(item.uri).catch(() => {});
        }
      }
      list = list.slice(1);
      await save(list);
    }
  } finally {
    running = false;
  }
}
