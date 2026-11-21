import AsyncStorage from '@react-native-async-storage/async-storage';

/** auto = best on Wi-Fi, lighter on mobile data. */
export type Quality = 'auto' | 'high' | 'low';

export type SavedCamera = {
  did: string;
  name: string;
  user: string;
  pwd: string;
  quality?: Quality;
  /** Picture rotation chosen on this phone: 0 / 90 / 180 / 270. */
  rotation?: number;
  /** Id on the central server when the camera came from (or was registered in) the account. */
  serverId?: number;
};

const FAVORITE_KEY = 'favorite.v1';

/** The camera that opens full screen when the app starts (only one). */
export async function getFavorite(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(FAVORITE_KEY);
  } catch {
    return null;
  }
}

export async function setFavorite(did: string | null): Promise<void> {
  if (did) {
    await AsyncStorage.setItem(FAVORITE_KEY, did);
  } else {
    await AsyncStorage.removeItem(FAVORITE_KEY);
  }
}

/** Replaces the whole list (used by the server sync). */
export async function saveAllCameras(list: SavedCamera[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

const KEY = 'cameras.v1';

export const DEFAULT_USER = 'admin';
export const DEFAULT_PWD = '6666';

export async function loadCameras(): Promise<SavedCamera[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveCamera(cam: SavedCamera): Promise<SavedCamera[]> {
  const list = (await loadCameras()).filter(c => c.did !== cam.did);
  list.push(cam);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

/** Updates fields of a saved camera (name, password…). Returns the updated camera. */
export async function updateCamera(did: string, patch: Partial<SavedCamera>): Promise<SavedCamera | null> {
  const list = await loadCameras();
  const i = list.findIndex(c => c.did === did);
  if (i < 0) {
    return null;
  }
  list[i] = {...list[i], ...patch, did};
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list[i];
}

/** The factory password anyone with the camera ID can use. */
export const isDefaultPassword = (cam: SavedCamera) => cam.pwd === DEFAULT_PWD;

/** Camera passwords: 4-31 chars; letters, digits and a few safe symbols (avoid JSON/URL issues). */
export function validateCameraPassword(pwd: string): string | null {
  if (pwd.length < 4 || pwd.length > 31) {
    return 'A senha precisa ter de 4 a 31 caracteres.';
  }
  if (!/^[A-Za-z0-9._@#*!-]+$/.test(pwd)) {
    return 'Use apenas letras, números e os símbolos . _ @ # * ! -';
  }
  if (pwd === DEFAULT_PWD) {
    return 'Escolha uma senha diferente da padrão (6666).';
  }
  return null;
}

export async function removeCamera(did: string): Promise<SavedCamera[]> {
  const list = (await loadCameras()).filter(c => c.did !== did);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
