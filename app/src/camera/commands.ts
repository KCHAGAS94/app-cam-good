/**
 * JSON commands understood by PIXB cameras (sent with CameraModule.send).
 * Format taken from the vendor protocol: {"pro": <name>, "cmd": <code>, "user", "pwd", ...params}.
 * Replies come back as CamMessage events with the same "cmd" code.
 */

export type Auth = {user: string; pwd: string};

const cmd = (pro: string, code: number, auth: Auth, extra: Record<string, unknown> = {}) =>
  JSON.stringify({pro, cmd: code, user: auth.user, pwd: auth.pwd, ...extra});

/**
 * Pan/tilt values (vendor app behaviour):
 * - tap: one step   -> parms 1, value UP/DOWN/LEFT/RIGHT
 * - hold: continuous -> parms 0, value UP/DOWN/LEFT/RIGHT, then the *_STOP value on release
 */
export const PTZ = {
  UP: 0,
  UP_STOP: 1,
  DOWN: 2,
  DOWN_STOP: 3,
  LEFT: 4,
  LEFT_STOP: 5,
  RIGHT: 6,
  RIGHT_STOP: 7,
  CENTER: 132,
} as const;

export type ScreenDir = 'up' | 'right' | 'down' | 'left';

/** Camera directions in clockwise order, with the value that stops each one. */
const CLOCKWISE = [
  {move: PTZ.UP, stop: PTZ.UP_STOP},
  {move: PTZ.RIGHT, stop: PTZ.RIGHT_STOP},
  {move: PTZ.DOWN, stop: PTZ.DOWN_STOP},
  {move: PTZ.LEFT, stop: PTZ.LEFT_STOP},
];
const SCREEN_ORDER: ScreenDir[] = ['up', 'right', 'down', 'left'];

/**
 * Arrow pressed on the screen -> camera pan/tilt values, taking into account the picture
 * rotation done in the app (⟳). With the picture turned 90° clockwise the camera's "up"
 * shows as "right" on screen, so the right arrow must send "up".
 */
export function ptzForScreen(dir: ScreenDir, rotation: number) {
  const steps = (((Math.round(rotation / 90) % 4) + 4) % 4);
  const screenIndex = SCREEN_ORDER.indexOf(dir);
  return CLOCKWISE[(screenIndex - steps + 4) % 4];
}

/** Infrared night vision (field "icut"). */
export const IR = {OFF: 0, ON: 1, AUTO: 2} as const;
export type IrMode = (typeof IR)[keyof typeof IR];

/** White light LEDs of the bulb (field "status" of set_whiteLight). */
export const LIGHT = {OFF: 0, ON: 1, AUTO: 2} as const;
export type LightMode = (typeof LIGHT)[keyof typeof LIGHT];

/** Image orientation: bit 0 = mirror (left/right), bit 1 = flip (upside down). */
export const rotmirValue = (mirror: boolean, flip: boolean) => (mirror ? 1 : 0) + (flip ? 2 : 0);
export const rotmirParse = (v: number) => ({mirror: (v & 1) === 1, flip: (v & 2) === 2});

/** Reply codes, for matching CamMessage events. */
export const CMD = {
  GET_PARAMS: 101,
  DEV_CONTROL: 102,
  EDIT_USER: 106,
  GET_SD: 109,
  SET_SD: 110,
  SET_RECORD_PARAMS: 122,
  GET_RECORD_PARAMS: 199,
  TALK: 300,
  GET_RECORD_DAYS: 205,
  PLAY_RECORD_FILE: 207,
  GET_RECORD_HOURS: 401,
  GET_RECORD_FILES: 402,
  GET_WIFI: 112,
  SCAN_WIFI: 113,
  SET_WIFI: 114,
  PTZ: 128,
  SET_WHITE_LIGHT: 304,
  GET_WHITE_LIGHT: 305,
  SNAPSHOT: 1001,
} as const;

export const CamCommands = {
  /** Hold-to-move start/stop (parms 0). */
  ptz: (auth: Auth, value: number) => cmd('ptz_control', CMD.PTZ, auth, {parms: 0, value}),

  /** One step, or CENTER (parms 1). */
  ptzStep: (auth: Auth, value: number) => cmd('ptz_control', CMD.PTZ, auth, {parms: 1, value}),

  irCut: (auth: Auth, mode: IrMode) => cmd('dev_control', CMD.DEV_CONTROL, auth, {icut: mode}),

  whiteLight: (auth: Auth, mode: LightMode) =>
    cmd('set_whiteLight', CMD.SET_WHITE_LIGHT, auth, {status: mode}),

  getWhiteLight: (auth: Auth) => cmd('get_whiteLight', CMD.GET_WHITE_LIGHT, auth),

  rotateMirror: (auth: Auth, value: number) =>
    cmd('dev_control', CMD.DEV_CONTROL, auth, {rotmir: value}),

  /** Small status LED on the camera. */
  lamp: (auth: Auth, on: boolean) => cmd('dev_control', CMD.DEV_CONTROL, auth, {lamp: on ? 1 : 0}),

  reboot: (auth: Auth) => cmd('dev_control', CMD.DEV_CONTROL, auth, {reboot: 1}),

  /** Changes the admin password (vendor flow: edit_user, then reboot the camera). */
  changePassword: (auth: Auth, newPwd: string) =>
    cmd('edit_user', CMD.EDIT_USER, auth, {edituser: auth.user, newuser: auth.user, newpwd: newPwd}),

  snapshot: (auth: Auth) => cmd('snap_shot', CMD.SNAPSHOT, auth),

  scanWifi: (auth: Auth) => cmd('scan_wifi', CMD.SCAN_WIFI, auth),

  getWifi: (auth: Auth) => cmd('get_wifi', CMD.GET_WIFI, auth),

  setWifi: (auth: Auth, ssid: string, password: string, encryption: number) =>
    cmd('set_wifi', CMD.SET_WIFI, auth, {
      wifissid: ssid,
      wifipwd: password,
      encwifissid: encodeURIComponent(ssid),
      encwifipwd: encodeURIComponent(password),
      encryption,
    }),

  /** Reply: total / free (MB, total 0 = no card), coverage, sdstatu, recMode. */
  getSdCard: (auth: Auth) => cmd('get_sd', CMD.GET_SD, auth),

  /** Erases the memory card. */
  formatSdCard: (auth: Auth) => cmd('set_sd', CMD.SET_SD, auth, {format: 1}),

  /** Reply: recordcov, recordAudio, record_time, bitStream, start_time, end_time, videoRecord, timerecord. */
  getRecordParams: (auth: Auth) => cmd('get_record_param', CMD.GET_RECORD_PARAMS, auth),

  /** Send back ALL fields of a get_record_param reply, with only the ones we changed edited. */
  setRecordParams: (auth: Auth, params: Record<string, unknown>) => {
    const reserved = ['cmd', 'result', 'pro', 'user', 'pwd'];
    const fields = Object.fromEntries(Object.entries(params).filter(([k]) => !reserved.includes(k)));
    return cmd('set_record_param', CMD.SET_RECORD_PARAMS, auth, fields);
  },

  // ---- memory-card recordings (flow used by the vendor app for PIXB cameras) ----

  /** Reply: year, "month[0]".."month[11]" = bitmask of days with recordings. */
  getRecordDays: (auth: Auth, year: number) => cmd('get_record_day', CMD.GET_RECORD_DAYS, auth, {year}),

  /** ymd like "2026_11_14". Reply: record_hour = 24-bit mask of hours with recordings. */
  getRecordHours: (auth: Auth, ymd: string) => cmd('get_record_hour', CMD.GET_RECORD_HOURS, auth, {ymd}),

  /** ymdh like "2026_11_14_15". Reply: record_num + recordList[] (or "record_name[i]"). */
  getRecordFiles: (auth: Auth, ymdh: string) => cmd('get_record_min', CMD.GET_RECORD_FILES, auth, {ymdh}),

  playRecordFile: (auth: Auth, filename: string) => {
    const extra: Record<string, unknown> = {type: 1, video: 1, audio: 1, filename};
    if (filename.indexOf('.av') > 0 && filename.length > 8) {
      extra.date = `${filename.slice(0, 4)}_${filename.slice(4, 6)}_${filename.slice(6, 8)}`;
    }
    return cmd('play_record_file', CMD.PLAY_RECORD_FILE, auth, extra);
  },

  pauseRecordFile: (auth: Auth, filename: string) =>
    cmd('play_record_file', CMD.PLAY_RECORD_FILE, auth, {suspend: 1, filename}),

  resumeRecordFile: (auth: Auth, filename: string) =>
    cmd('play_record_file', CMD.PLAY_RECORD_FILE, auth, {suspend: 0, filename}),

  stopRecordFile: (auth: Auth) => cmd('play_record_file', CMD.PLAY_RECORD_FILE, auth, {type: 0}),

  /**
   * Deletes one file from the memory card. The vendor app only offers this for other models
   * (PIXC), so PIXB cameras may refuse it: always re-list to confirm.
   */
  deleteRecordFile: (auth: Auth, filename: string) =>
    cmd('del_record_file', CMD.PLAY_RECORD_FILE, auth, {filename}),

  /** Turns the sound of the recording being played on/off. */
  playRecordAudio: (auth: Auth, filename: string, on: boolean) =>
    cmd('play_record_file', CMD.PLAY_RECORD_FILE, auth, {audio: on ? 1 : 0, filename}),

  /** Push-to-talk: tells the camera to open (1) / close (0) its speaker. */
  talk: (auth: Auth, sending: boolean) => cmd('talk_send', CMD.TALK, auth, {isSend: sending ? 1 : 0}),

  /** Current settings: icut, rotmir, lamp, bright, contrast, mic, spk, signal, sensor. */
  getParams: (auth: Auth) => cmd('get_parms', CMD.GET_PARAMS, auth),
};
