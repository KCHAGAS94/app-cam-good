import {
  NativeEventEmitter,
  NativeModules,
  requireNativeComponent,
  ViewProps,
} from 'react-native';

type CameraModuleType = {
  init(): Promise<string>;
  getNetworkInfo(): Promise<{ip: string; ssid: string}>;
  bindToWifi(enable: boolean): Promise<boolean>;
  getConnectionType(): Promise<NetType>;
  /** Seconds since the camera checked in with the P2P server (0..60 = online). */
  checkOnline(did: string): Promise<number>;
  /** Locks the screen: "landscape" (4-camera grid), "portrait" or back to "auto". */
  setOrientation(mode: 'landscape' | 'portrait' | 'auto'): void;
  /** Opens playback of a memory-card file; frames go to <CameraView did={`${did}#pb`}>. */
  startPlayback(did: string, fileName: string): Promise<number>;
  stopPlayback(did: string): Promise<void>;
  /** 1 / 2 / 4: playback frames drawn at 15 fps x speed. */
  setPlaybackSpeed(did: string, speed: number): void;
  /** Stop/resume drawing playback frames (the camera is paused with play_record_file). */
  setPlaybackPaused(did: string, paused: boolean): void;
  /** Live sound from the camera (PCM 8 kHz played on the phone). */
  startListening(did: string): Promise<boolean>;
  stopListening(did: string): Promise<boolean>;
  /** Speaker on/off without opening the live audio channel (memory-card playback). */
  setAudioOutput(enabled: boolean): Promise<boolean>;
  /** Push-to-talk: phone mic -> camera speaker. Needs RECORD_AUDIO permission. */
  startTalk(did: string): Promise<boolean>;
  stopTalk(did: string): Promise<boolean>;
  /**
   * Saves the frame on screen. toGallery: phone gallery (Pictures/CamGood, content:// URI);
   * otherwise the app's private outbox (file:// URI) for server-only storage.
   */
  takeSnapshot(did: string, toGallery: boolean): Promise<string>;
  /** Records what is on screen to MP4; stopRecording saves it (gallery or outbox, as above). */
  startRecording(did: string): Promise<boolean>;
  stopRecording(did: string, toGallery: boolean): Promise<{uri: string; durationMs: number} | null>;
  /** Deletes an outbox file (after the server confirmed the upload). */
  deleteLocalFile(uri: string): Promise<boolean>;
  /** Moves an outbox file to the phone gallery (server refused it, so it isn't lost). */
  moveToGallery(uri: string): Promise<string | null>;
  search(durationMs: number): Promise<void>;
  connect(did: string, user: string, pwd: string): Promise<number>;
  disconnect(did: string): Promise<void>;
  startLive(did: string, streamId: number): Promise<number>;
  stopLive(did: string): Promise<void>;
  send(did: string, json: string): Promise<number>;
};

export const CameraModule: CameraModuleType = NativeModules.CameraModule;
const emitter = new NativeEventEmitter(NativeModules.CameraModule);

/** Connection status codes reported by the library (event type 0). */
export const Status = {
  CONNECTING: 0,
  INITIALIZING: 1,
  ONLINE: 2,
  FAILED: 3,
  DISCONNECTED: 4,
  INVALID_ID: 5,
  OFFLINE: 6,
  TIMEOUT: 7,
  ERROR: 8,
  SLEEPING: 9,
  OTHER_LOGIN: 110,
} as const;

export function statusLabel(code: number | undefined): string {
  switch (code) {
    case Status.CONNECTING:
    case Status.INITIALIZING:
      return 'Conectando…';
    case Status.ONLINE:
      return 'Online';
    case Status.FAILED:
      return 'Falha ao conectar';
    case Status.DISCONNECTED:
      return 'Desconectada';
    case Status.INVALID_ID:
      return 'ID inválido';
    case Status.OFFLINE:
      return 'Câmera offline';
    case Status.TIMEOUT:
      return 'Tempo esgotado';
    case Status.ERROR:
      return 'Erro de conexão';
    case Status.SLEEPING:
      return 'Câmera em repouso';
    case Status.OTHER_LOGIN:
      return 'Conectada em outro aparelho';
    default:
      return 'Desconectada';
  }
}

export type NetType = 'wifi' | 'cellular' | 'other' | 'none';

export const netLabel = (t: NetType | null) =>
  t === 'wifi' ? 'Wi-Fi' : t === 'cellular' ? 'dados móveis' : t === 'none' ? 'sem internet' : 'rede';

/** Interprets checkOnline(): is the camera registered on the P2P server right now? */
export const isCloudOnline = (seconds: number) => seconds >= 0 && seconds <= 60;

export type StatusEvent = {did: string; type: number; param: number};
export type SearchEvent = {did: string; ip: string; mac: string; name: string; port: number};
export type MessageEvent = {did: string; json: string};
export type VideoInfoEvent = {did: string; width: number; height: number};
export type SnapshotEvent = {did: string; path: string};

const listen =
  <T,>(event: string) =>
  (cb: (e: T) => void) =>
    emitter.addListener(event, (e: any) => cb(e as T));

export const onStatus = listen<StatusEvent>('CamStatus');
export const onSearchResult = listen<SearchEvent>('CamSearchResult');
export const onMessage = listen<MessageEvent>('CamMessage');
export const onVideoInfo = listen<VideoInfoEvent>('CamVideoInfo');
export const onSnapshot = listen<SnapshotEvent>('CamSnapshot');
export const onNetworkChange = listen<{type: NetType}>('CamNetwork');
export type PlaybackEvent = {
  did: string;
  timestamp: number;
  frame: number;
  total: number;
  width: number;
  height: number;
};
export const onPlayback = listen<PlaybackEvent>('CamPlayback');
/** Playback queue full (pause the camera's sending) / drained (resume). */
export const onPlaybackFlow = listen<{did: string; full: boolean}>('CamPlaybackFlow');

/** Parses the JSON part of a camera reply (the library sometimes adds bytes around it). */
export function parseReply(raw: string): Record<string, any> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

type CameraViewProps = ViewProps & {
  did: string;
  resizeMode?: 'contain' | 'cover';
  /** 0 / 90 / 180 / 270: rotates the picture (camera mounted sideways). */
  imageRotation?: number;
};

/** Native view that draws the live video of camera `did`. */
export const CameraView = requireNativeComponent<CameraViewProps>('CameraView');
