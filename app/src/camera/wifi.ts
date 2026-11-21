export type WifiNet = {ssid: string; signal: number; encryption: number};

/** Parses a scan_wifi reply (cmd 113): {"count":N,"data":[{ssid,signal}]} or flat "ssid[i]" keys. */
export function parseWifiList(reply: Record<string, any>): WifiNet[] {
  const out: WifiNet[] = [];
  if (Array.isArray(reply.data)) {
    for (const n of reply.data) {
      if (n?.ssid) {
        out.push({
          ssid: String(n.ssid),
          signal: Number(n.signal ?? 0),
          encryption: Number(n.encryption ?? 0),
        });
      }
    }
  } else {
    const count = Number(reply.count ?? 0);
    for (let i = 0; i < count; i++) {
      const ssid = reply[`ssid[${i}]`];
      if (ssid) {
        out.push({
          ssid: String(ssid),
          signal: Number(reply[`signal[${i}]`] ?? 0),
          encryption: Number(reply[`encryption[${i}]`] ?? 0),
        });
      }
    }
  }
  const unique = new Map<string, WifiNet>();
  out.forEach(n => {
    const prev = unique.get(n.ssid);
    if (!prev || prev.signal < n.signal) {
      unique.set(n.ssid, n);
    }
  });
  return [...unique.values()].sort((a, b) => b.signal - a.signal);
}

/** Network the camera is on, from a get_wifi reply (cmd 112). Field names vary by firmware. */
export function currentSsid(reply: Record<string, any>): string {
  return String(reply.ssid ?? reply.wifissid ?? reply.wifi_ssid ?? '');
}

export const looks5G = (ssid: string) => /5\s?g(hz)?\b/i.test(ssid);
