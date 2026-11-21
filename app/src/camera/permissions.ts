import {PermissionsAndroid, Platform} from 'react-native';

/** Android needs location (and "nearby devices" on 13+) to tell us the Wi-Fi name. */
export async function askWifiPermissions() {
  if (Platform.OS !== 'android') {
    return;
  }
  const perms = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (Number(Platform.Version) >= 33) {
    perms.push('android.permission.NEARBY_WIFI_DEVICES' as any);
  }
  await PermissionsAndroid.requestMultiple(perms);
}

/** Microphone permission for push-to-talk. Resolves true if granted. */
export async function askMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microfone',
    message: 'Para falar pelo alto-falante da câmera, o app precisa usar o microfone.',
    buttonPositive: 'Permitir',
    buttonNegative: 'Agora não',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}
