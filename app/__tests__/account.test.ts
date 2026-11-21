/** Camera list sync with the central server (pure merge + URL normalization). */
import {mergeServerCameras, normalizeUrl} from '../src/server/account';
import {SavedCamera} from '../src/storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const phone = (did: string, extra: Partial<SavedCamera> = {}): SavedCamera => ({
  did,
  name: did,
  user: 'admin',
  pwd: '6666',
  ...extra,
});

test('server cameras replace local copies but keep the per-phone quality', () => {
  const merged = mergeServerCameras(
    [phone('PIXB-AAA', {quality: 'low', pwd: 'old'})],
    [{id: 1, did: 'pixb-aaa', name: 'Sala', user: 'admin', pwd: 'new'}],
  );
  expect(merged).toEqual([{did: 'pixb-aaa', name: 'Sala', user: 'admin', pwd: 'new', serverId: 1, quality: 'low'}]);
});

test('phone-only cameras are kept; revoked server cameras are dropped', () => {
  const merged = mergeServerCameras(
    [phone('PIXB-PHONE'), phone('PIXB-REVOKED', {serverId: 9})],
    [{id: 2, did: 'PIXB-NEW', name: 'Nova', user: 'admin', pwd: 'x'}],
  );
  expect(merged.map(c => c.did)).toEqual(['PIXB-NEW', 'PIXB-PHONE']);
});

test('server address is normalized', () => {
  expect(normalizeUrl(' 192.168.0.10:8080/ ')).toBe('http://192.168.0.10:8080');
  expect(normalizeUrl('https://cam.exemplo.com.br')).toBe('https://cam.exemplo.com.br');
});
