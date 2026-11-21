/**
 * Tests for the pure helpers that read camera replies (no native code involved).
 * Reply shapes follow the vendor app (PIX-LINK CAM) for PIXB cameras.
 */
import {CamCommands, rotmirParse, rotmirValue} from '../src/camera/commands';
import {
  fileLabel,
  hourKey,
  parseRecordDays,
  parseRecordFiles,
  parseRecordHours,
} from '../src/camera/recordings';
import {currentSsid, looks5G, parseWifiList} from '../src/camera/wifi';
import {isCloudOnline, parseReply} from '../src/camera/native';
import {validateCameraPassword} from '../src/storage';

jest.mock('react-native', () => ({
  NativeModules: {CameraModule: {}},
  NativeEventEmitter: jest.fn().mockImplementation(() => ({addListener: jest.fn()})),
  requireNativeComponent: jest.fn(() => 'CameraView'),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('recordings', () => {
  test('days come from the month bitmasks (bit i = day i+1), newest first', () => {
    // January: days 1 and 3 (0b101); November: day 14 (bit 13)
    const days = parseRecordDays({cmd: 205, year: 2026, 'month[0]': 5, 'month[10]': 1 << 13}, 2026);
    expect(days.map(d => d.key)).toEqual(['2026_11_14', '2026_01_3', '2026_01_1']);
  });

  test('invalid year falls back to the requested one', () => {
    expect(parseRecordDays({year: 0, 'month[1]': 1}, 2025)[0].key).toBe('2025_02_1');
  });

  test('hours come from a 24-bit mask', () => {
    expect(parseRecordHours({cmd: 401, record_hour: (1 << 0) | (1 << 15) | (1 << 23)})).toEqual([0, 15, 23]);
    expect(parseRecordHours({cmd: 401})).toEqual([]);
  });

  test('hour key matches the vendor format', () => {
    expect(hourKey('2026_11_5', 7)).toBe('2026_11_5_07');
  });

  test('file list from recordList or record_name[i]', () => {
    expect(parseRecordFiles({record_num: 2, recordList: ['b.av', 'a.av']}).files).toEqual(['a.av', 'b.av']);
    expect(parseRecordFiles({record_num: 2, 'record_name[0]': 'x.av', 'record_name[1]': '-1'}).files).toEqual([
      'x.av',
    ]);
    expect(parseRecordFiles({record_num: 0, needDown: 1}).needDownload).toBe(true);
  });

  test('file label shows the time when the name has a timestamp', () => {
    expect(fileLabel('20261114153012.av')).toBe('15:30:12');
    expect(fileLabel('clip.av')).toBe('clip.av');
  });

  test('play command adds the date for .av files', () => {
    const json = JSON.parse(CamCommands.playRecordFile({user: 'admin', pwd: 'x'}, '20261114153012.av'));
    expect(json).toMatchObject({pro: 'play_record_file', cmd: 207, type: 1, date: '2026_11_14'});
  });
});

describe('wifi', () => {
  test('scan list from data[] and flat keys, deduplicated by best signal', () => {
    const fromArray = parseWifiList({
      data: [
        {ssid: 'MinhaRede', signal: 40},
        {ssid: 'MinhaRede', signal: 80},
        {ssid: 'Vizinho', signal: 50},
      ],
    });
    expect(fromArray.map(n => [n.ssid, n.signal])).toEqual([
      ['MinhaRede', 80],
      ['Vizinho', 50],
    ]);
    const flat = parseWifiList({count: 1, 'ssid[0]': 'AP', 'signal[0]': 70, 'encryption[0]': 4});
    expect(flat).toEqual([{ssid: 'AP', signal: 70, encryption: 4}]);
  });

  test('current network and 5G detection', () => {
    expect(currentSsid({cmd: 112, ssid: 'MinhaRede'})).toBe('MinhaRede');
    expect(looks5G('MinhaRede_5G')).toBe(true);
    expect(looks5G('Casa 5GHz')).toBe(true);
    expect(looks5G('MinhaRede')).toBe(false);
  });

  test('set_wifi carries plain and URL-encoded values', () => {
    const json = JSON.parse(CamCommands.setWifi({user: 'admin', pwd: '6666'}, 'Casa Vó', 'a&b', 0));
    expect(json).toMatchObject({cmd: 114, wifissid: 'Casa Vó', encwifissid: 'Casa%20V%C3%B3', encwifipwd: 'a%26b'});
  });
});

describe('misc', () => {
  test('replies wrapped in extra bytes are still parsed', () => {
    expect(parseReply('\u0000{"cmd":101,"icut":2}\u0000')).toEqual({cmd: 101, icut: 2});
    expect(parseReply('garbage')).toBeNull();
  });

  test('cloud online window is 0..60 seconds', () => {
    expect(isCloudOnline(0)).toBe(true);
    expect(isCloudOnline(60)).toBe(true);
    expect(isCloudOnline(61)).toBe(false);
    expect(isCloudOnline(-1)).toBe(false);
  });

  test('rotmir: bit 0 mirror, bit 1 flip', () => {
    expect(rotmirValue(true, true)).toBe(3);
    expect(rotmirParse(2)).toEqual({mirror: false, flip: true});
  });

  test('camera password rules', () => {
    expect(validateCameraPassword('abc')).not.toBeNull();
    expect(validateCameraPassword('6666')).not.toBeNull();
    expect(validateCameraPassword('senha com espaço')).not.toBeNull();
    expect(validateCameraPassword('Minha.Senha1')).toBeNull();
  });
});
