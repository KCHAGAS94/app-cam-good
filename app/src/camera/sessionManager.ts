import {
  CameraModule,
  isCloudOnline,
  onMessage,
  onNetworkChange,
  onStatus,
  parseReply,
  Status,
} from './native';

/**
 * ONE P2P session per camera, shared by every screen (like the vendor app).
 *
 * Opening a new session for each screen made the camera answer "mj_other_login"
 * (another client logged in) and drop us. Screens now acquire/release the shared
 * session; it is closed a few seconds after the last screen releases it.
 */

const RETRY_MS = 5000;
/** When the camera says another client is logged in, back off instead of fighting for it. */
const RETRY_OTHER_LOGIN_MS = 20_000;
const CLOSE_DELAY_MS = 4000;

const FAILED = [Status.FAILED, Status.DISCONNECTED, Status.OFFLINE, Status.TIMEOUT, Status.ERROR] as number[];

export type CloudState = {seconds: number; online: boolean} | null;

export type SessionState = {
  status: number;
  /** What the P2P server says when the connection fails (camera on the internet or not). */
  cloud: CloudState;
  /** Camera reported that another phone/app logged in (mj_other_login or status 110). */
  otherLogin: boolean;
};

type Session = SessionState & {
  did: string;
  user: string;
  pwd: string;
  refs: number;
  closeTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
};

const sessions = new Map<string, Session>();
const subscribers = new Map<string, Set<(s: SessionState) => void>>();
let wired = false;

function publish(s: Session) {
  const snapshot: SessionState = {status: s.status, cloud: s.cloud, otherLogin: s.otherLogin};
  subscribers.get(s.did)?.forEach(cb => cb(snapshot));
}

function connect(s: Session) {
  clearTimeout(s.retryTimer);
  s.status = Status.CONNECTING;
  publish(s);
  CameraModule.connect(s.did, s.user, s.pwd).catch(() => {});
}

function wire() {
  if (wired) {
    return;
  }
  wired = true;

  onStatus(e => {
    const s = sessions.get(e.did);
    if (!s || e.type !== 0) {
      return;
    }
    s.status = e.param;
    if (e.param === Status.ONLINE) {
      s.cloud = null;
      s.otherLogin = false;
    }
    if (e.param === Status.OTHER_LOGIN) {
      s.otherLogin = true;
    }
    publish(s);
    if (FAILED.includes(e.param) && s.refs > 0) {
      CameraModule.checkOnline(s.did).then(sec => {
        s.cloud = {seconds: sec, online: isCloudOnline(sec)};
        publish(s);
      });
      clearTimeout(s.retryTimer);
      s.retryTimer = setTimeout(() => s.refs > 0 && connect(s), s.otherLogin ? RETRY_OTHER_LOGIN_MS : RETRY_MS);
    }
  });

  onMessage(e => {
    const s = sessions.get(e.did);
    if (!s) {
      return;
    }
    const r = parseReply(e.json);
    if (r?.pro === 'mj_other_login') {
      s.otherLogin = true;
      publish(s);
    }
  });

  // the old P2P path dies when the phone switches network: reconnect every open session
  onNetworkChange(e => {
    if (e.type === 'none') {
      return;
    }
    sessions.forEach(s => s.refs > 0 && reconnect(s.did));
  });
}

/** Start using a camera's session. Returns the release function. */
export function acquire(cam: {did: string; user: string; pwd: string}): () => void {
  wire();
  let s = sessions.get(cam.did);
  const credentialsChanged = s && (s.user !== cam.user || s.pwd !== cam.pwd);
  if (!s) {
    s = {did: cam.did, user: cam.user, pwd: cam.pwd, refs: 0, status: Status.DISCONNECTED, cloud: null, otherLogin: false};
    sessions.set(cam.did, s);
  }
  const session = s;
  clearTimeout(session.closeTimer);
  session.closeTimer = undefined;
  session.refs++;
  session.user = cam.user;
  session.pwd = cam.pwd;

  // reuse the open session; only (re)connect when there is none or the password changed
  const alive = ([Status.ONLINE, Status.CONNECTING, Status.INITIALIZING] as number[]).includes(session.status);
  if (credentialsChanged) {
    reconnect(cam.did);
  } else if (!alive) {
    connect(session);
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    session.refs = Math.max(0, session.refs - 1);
    if (session.refs === 0) {
      clearTimeout(session.retryTimer);
      session.closeTimer = setTimeout(() => {
        if (session.refs === 0) {
          CameraModule.disconnect(session.did);
          session.status = Status.DISCONNECTED;
          session.cloud = null;
          publish(session);
        }
      }, CLOSE_DELAY_MS);
    }
  };
}

/** Drop and reopen the session (network change, "Tentar agora"). */
export function reconnect(did: string) {
  const s = sessions.get(did);
  if (!s) {
    return;
  }
  clearTimeout(s.retryTimer);
  s.otherLogin = false;
  CameraModule.disconnect(did).finally(() => {
    if (s.refs > 0) {
      connect(s);
    }
  });
}

export function getState(did: string): SessionState {
  const s = sessions.get(did);
  return s ? {status: s.status, cloud: s.cloud, otherLogin: s.otherLogin} : {status: Status.CONNECTING, cloud: null, otherLogin: false};
}

export function subscribe(did: string, cb: (s: SessionState) => void): () => void {
  let set = subscribers.get(did);
  if (!set) {
    set = new Set();
    subscribers.set(did, set);
  }
  set.add(cb);
  return () => set!.delete(cb);
}
