import {useCallback, useEffect, useRef, useState} from 'react';
import {CameraModule, onVideoInfo, Status} from './native';
import {acquire, CloudState, getState, reconnect as reconnectSession, SessionState, subscribe} from './sessionManager';
import {useNetType} from './useNetType';
import {SavedCamera} from '../storage';

export type {CloudState};

/** Live stream: 1 = main (best quality), 2 = sub stream (lighter, good for mobile data). */
export type StreamId = 1 | 2;

type Options = {
  /** Start the live video as soon as the session is online. */
  live?: boolean;
  /** Which stream to show (vendor app: 1 = 1080p, 2 = 720p/lighter). */
  streamId?: StreamId;
  /** Pause everything (e.g. app in background). */
  paused?: boolean;
};

/**
 * Uses the shared P2P session of a camera (see sessionManager) and, optionally, its live video.
 * Retry, network-change reconnects and the cloud online check live in the session manager.
 */
export function useCameraSession(
  camera: SavedCamera,
  {live = false, paused = false, streamId = 1}: Options = {},
) {
  const {did, user, pwd} = camera;
  const [state, setState] = useState<SessionState>(() => getState(did));
  const [video, setVideo] = useState<{width: number; height: number} | null>(null);
  const netType = useNetType();
  const streaming = useRef(false);
  const streamRef = useRef<StreamId>(streamId);
  streamRef.current = streamId;

  // hold the shared session while this screen is visible
  useEffect(() => {
    if (paused) {
      return;
    }
    const unsubscribe = subscribe(did, setState);
    const release = acquire({did, user, pwd});
    setState(getState(did));
    return () => {
      unsubscribe();
      release();
    };
  }, [did, user, pwd, paused]);

  const online = state.status === Status.ONLINE;

  // live video: start when online, stop when leaving (the session itself stays open for other screens)
  useEffect(() => {
    if (!live || paused) {
      return;
    }
    const sub = onVideoInfo(e => e.did === did && setVideo({width: e.width, height: e.height}));
    if (online && !streaming.current) {
      streaming.current = true;
      CameraModule.startLive(did, streamRef.current);
    }
    if (!online) {
      streaming.current = false;
      setVideo(null);
    }
    return () => sub.remove();
  }, [did, live, paused, online]);

  useEffect(
    () => () => {
      if (streaming.current) {
        streaming.current = false;
        CameraModule.stopLive(did);
      }
    },
    [did, paused],
  );

  // switch stream while watching (vendor app: stop, wait 300 ms, start the other one)
  const firstStream = useRef(true);
  useEffect(() => {
    if (firstStream.current) {
      firstStream.current = false;
      return;
    }
    if (!live || !streaming.current) {
      return;
    }
    setVideo(null);
    CameraModule.stopLive(did).then(() =>
      setTimeout(() => {
        if (streaming.current) {
          CameraModule.startLive(did, streamId);
        }
      }, 300),
    );
  }, [streamId, did, live]);

  const reconnect = useCallback(() => {
    streaming.current = false;
    setVideo(null);
    reconnectSession(did);
  }, [did]);

  return {
    status: state.status,
    online,
    otherLogin: state.otherLogin,
    video,
    netType,
    cloud: state.cloud,
    reconnect,
  };
}
