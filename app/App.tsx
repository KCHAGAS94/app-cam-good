import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, BackHandler, StatusBar, Text, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {CameraModule, onNetworkChange} from './src/camera/native';
import {loadAccount, syncCameras} from './src/server/account';
import {processUploads} from './src/server/uploads';
import AccountScreen from './src/screens/AccountScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import PickCameraScreen from './src/screens/PickCameraScreen';
import MultiViewScreen from './src/screens/MultiViewScreen';
import {getFavorite, loadCameras, SavedCamera} from './src/storage';
import HomeScreen from './src/screens/HomeScreen';
import SetupScreen from './src/screens/SetupScreen';
import LiveScreen from './src/screens/LiveScreen';
import CameraWifiScreen from './src/screens/CameraWifiScreen';
import SdCardScreen from './src/screens/SdCardScreen';
import RecordingsScreen from './src/screens/RecordingsScreen';
import CameraSettingsScreen from './src/screens/CameraSettingsScreen';
import {colors, ui} from './src/theme';

type Route =
  | {name: 'home'}
  | {name: 'setup'}
  /** fromMulti = opened from the 4-camera grid: back returns to it */
  | {name: 'live'; camera: SavedCamera; fromMulti?: boolean; fullscreen?: boolean}
  | {name: 'multi'}
  | {name: 'wifi'; camera: SavedCamera}
  /** memory-card space/format, opened from the gallery; back returns to it */
  | {name: 'sd'; camera: SavedCamera; fromHome?: boolean}
  /** memory-card gallery (hour by hour); fromHome = opened from the menu, back goes home */
  | {name: 'recordings'; camera: SavedCamera; fromHome?: boolean}
  | {name: 'pickCamera'}
  | {name: 'settings'; camera: SavedCamera}
  | {name: 'account'}
  /** photos stored on the central server */
  | {name: 'gallery'; from?: SavedCamera};

export default function App() {
  const [route, setRoute] = useState<Route>({name: 'home'});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after a server sync so the camera list reloads. */
  const [listVersion, setListVersion] = useState(0);
  const refreshList = () => setListVersion(v => v + 1);

  useEffect(() => {
    CameraModule.init()
      .then(async () => {
        // favorite camera: the app starts straight on it, full screen
        const fav = await getFavorite();
        const camera = fav ? (await loadCameras()).find(c => c.did === fav) : undefined;
        if (camera) {
          setRoute({name: 'live', camera, fullscreen: true});
        }
        setReady(true);
      })
      .catch(e => setError(String(e?.message ?? e)));
  }, []);

  // central server: load the account, bring its cameras, send pending photos/videos
  useEffect(() => {
    loadAccount().then(account => {
      if (account) {
        syncCameras().then(refreshList).catch(() => {}); // offline: keep the cached list
        processUploads();
      }
    });
    // retry uploads whenever the phone gets a network again
    const sub = onNetworkChange(e => e.type !== 'none' && processUploads());
    return () => sub.remove();
  }, []);

  /** Camera settings (password, name) are protected by the phone's fingerprint / PIN. */
  const openSettings = async (camera: SavedCamera) => {
    const result = await CameraModule.authenticate('Configurações da câmera', 'Confirme que é você')
      .catch(() => 'failed' as const);
    if (result === 'ok') {
      setRoute({name: 'settings', camera});
    } else if (result === 'no-lock') {
      Alert.alert(
        'Celular sem bloqueio',
        'Seu celular não tem digital nem senha de tela configurada, então não dá para confirmar que é você. Para proteger as configurações, configure um bloqueio de tela no Android.',
        [{text: 'Continuar', onPress: () => setRoute({name: 'settings', camera})}],
      );
    } else if (result === 'failed') {
      Alert.alert('Não confirmado', 'Não foi possível confirmar sua identidade.');
    }
    // 'cancel': user closed the prompt, stay on the live view
  };

  // Android back button: Wi-Fi settings -> live view -> camera list
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'recordings') {
        return false; // RecordingsScreen handles its own back steps
      }
      if (route.name === 'gallery' && route.from) {
        setRoute({name: 'live', camera: route.from});
        return true;
      }
      if (route.name === 'multi') {
        return false; // MultiViewScreen handles back itself
      }
      if (route.name === 'live' && route.fromMulti) {
        setRoute({name: 'multi'});
        return true;
      }
      if (route.name === 'sd') {
        setRoute({name: 'recordings', camera: route.camera, fromHome: route.fromHome});
        return true;
      }
      if (route.name === 'wifi' || route.name === 'settings') {
        setRoute({name: 'live', camera: route.camera});
        return true;
      }
      if (route.name !== 'home') {
        setRoute({name: 'home'});
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={ui.screen} edges={['top', 'bottom']}>
        {error ? (
          <View style={{padding: 24}}>
            <Text style={ui.text}>Falha ao iniciar a biblioteca da câmera:</Text>
            <Text style={[ui.muted, {marginTop: 8}]}>{error}</Text>
          </View>
        ) : !ready ? (
          <View style={{flex: 1, justifyContent: 'center'}}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : route.name === 'home' ? (
          <HomeScreen
            key={listVersion}
            onAdd={() => setRoute({name: 'setup'})}
            onOpen={camera => setRoute({name: 'live', camera})}
            onOpenAccount={() => setRoute({name: 'account'})}
            onOpenPhotos={() => setRoute({name: 'gallery'})}
            onOpenMulti={() => setRoute({name: 'multi'})}
            onOpenRecordings={cameras =>
              cameras.length === 1
                ? setRoute({name: 'recordings', camera: cameras[0], fromHome: true})
                : setRoute({name: 'pickCamera'})
            }
          />
        ) : route.name === 'multi' ? (
          <MultiViewScreen
            onBack={() => setRoute({name: 'home'})}
            onOpen={camera => setRoute({name: 'live', camera, fromMulti: true})}
          />
        ) : route.name === 'pickCamera' ? (
          <PickCameraScreen
            title="Galeria"
            onBack={() => setRoute({name: 'home'})}
            onPick={camera => setRoute({name: 'recordings', camera, fromHome: true})}
          />
        ) : route.name === 'gallery' ? (
          <GalleryScreen
            cameraServerId={route.from?.serverId}
            onBack={() => setRoute(route.from ? {name: 'live', camera: route.from} : {name: 'home'})}
          />
        ) : route.name === 'account' ? (
          <AccountScreen onBack={() => setRoute({name: 'home'})} onSynced={refreshList} />
        ) : route.name === 'setup' ? (
          <SetupScreen onDone={() => setRoute({name: 'home'})} />
        ) : route.name === 'wifi' ? (
          <CameraWifiScreen
            camera={route.camera}
            onBack={() => setRoute({name: 'live', camera: route.camera})}
          />
        ) : route.name === 'settings' ? (
          <CameraSettingsScreen
            camera={route.camera}
            onBack={() => setRoute({name: 'live', camera: route.camera})}
            onSaved={() => setRoute({name: 'home'})}
          />
        ) : route.name === 'recordings' ? (
          <RecordingsScreen
            camera={route.camera}
            onBack={() => setRoute(route.fromHome ? {name: 'home'} : {name: 'live', camera: route.camera})}
            onOpenSd={() => setRoute({name: 'sd', camera: route.camera, fromHome: route.fromHome})}
          />
        ) : route.name === 'sd' ? (
          <SdCardScreen
            camera={route.camera}
            onBack={() => setRoute({name: 'recordings', camera: route.camera, fromHome: route.fromHome})}
          />
        ) : (
          <LiveScreen
            camera={route.camera}
            startFullscreen={route.fullscreen}
            onBack={() => setRoute(route.fromMulti ? {name: 'multi'} : {name: 'home'})}
            onOpenWifi={() => setRoute({name: 'wifi', camera: route.camera})}
            onOpenRecordings={() => setRoute({name: 'recordings', camera: route.camera})}
            onOpenSettings={() => openSettings(route.camera)}
            onOpenGallery={() => setRoute({name: 'gallery', from: route.camera})}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
