import {useCallback, useEffect, useRef, useState} from 'react';
import {CameraModule, isCloudOnline} from './native';

export type CloudStatus = 'checking' | 'online' | 'offline';

const POLL_MS = 30_000;

/**
 * Online/offline of several cameras, asked to the P2P server (no video session needed).
 * Polls every 30 s while `enabled` (e.g. app in foreground on the camera list).
 */
export function useCloudStatus(dids: string[], enabled: boolean) {
  const [statuses, setStatuses] = useState<Record<string, CloudStatus>>({});
  const [refreshing, setRefreshing] = useState(false);
  const key = dids.join('|');
  const latest = useRef(dids);
  latest.current = dids;

  const check = useCallback(async () => {
    const list = latest.current;
    if (list.length === 0) {
      return;
    }
    const results = await Promise.all(
      list.map(async did => {
        const s = await CameraModule.checkOnline(did).catch(() => -1);
        return [did, isCloudOnline(s) ? 'online' : 'offline'] as const;
      }),
    );
    setStatuses(prev => ({...prev, ...Object.fromEntries(results)}));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await check();
    setRefreshing(false);
  }, [check]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    check();
    const t = setInterval(check, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, key, check]);

  const statusOf = (did: string): CloudStatus => statuses[did] ?? 'checking';

  return {statusOf, refresh, refreshing};
}
