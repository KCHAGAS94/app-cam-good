import {useEffect, useState} from 'react';
import {CameraModule, NetType, onNetworkChange} from './native';

/** The phone's current network: wifi | cellular | other | none (null until known). */
export function useNetType() {
  const [netType, setNetType] = useState<NetType | null>(null);
  useEffect(() => {
    CameraModule.getConnectionType().then(setNetType);
    const sub = onNetworkChange(e => setNetType(e.type));
    return () => sub.remove();
  }, []);
  return netType;
}
