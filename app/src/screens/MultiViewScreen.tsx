import React, {useEffect, useState} from 'react';
import {ActivityIndicator, BackHandler, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {CameraModule, CameraView, statusLabel} from '../camera/native';
import {useCameraSession} from '../camera/useCameraSession';
import {loadCameras, SavedCamera} from '../storage';
import {colors} from '../theme';
import {useAppActive} from '../useAppActive';

type Props = {onBack: () => void; onOpen: (camera: SavedCamera) => void};

const PER_PAGE = 4;

/** One live tile of the grid (light sub-stream, no sound). */
function CameraTile({camera, active, onPress}: {camera: SavedCamera; active: boolean; onPress: () => void}) {
  const {status, online, video} = useCameraSession(camera, {live: true, streamId: 2, paused: !active});
  return (
    <Pressable style={styles.tile} onPress={onPress}>
      <CameraView
        did={camera.did}
        resizeMode="contain"
        imageRotation={camera.rotation ?? 0}
        style={StyleSheet.absoluteFill}
      />
      {!video && (
        <View style={styles.tileOverlay}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.tileStatus}>{online ? 'Carregando…' : statusLabel(status)}</Text>
        </View>
      )}
      <View style={styles.label}>
        <View style={[styles.dot, {backgroundColor: online ? colors.ok : colors.warn}]} />
        <Text style={styles.labelText} numberOfLines={1}>
          {camera.name}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Up to 4 cameras live at once, screen locked in landscape. Tap a tile to open that camera.
 * More than 4 cameras: pages of 4 with ‹ › buttons.
 */
export default function MultiViewScreen({onBack, onOpen}: Props) {
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  const [page, setPage] = useState(0);
  const appActive = useAppActive();

  useEffect(() => {
    loadCameras().then(setCameras);
    CameraModule.setOrientation('landscape');
    return () => CameraModule.setOrientation('auto');
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const pages = Math.max(1, Math.ceil(cameras.length / PER_PAGE));
  const visible = cameras.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  // 1 camera = full, 2 = side by side, 3-4 = 2x2
  const cols = visible.length <= 1 ? 1 : 2;
  const rows = visible.length <= 2 ? 1 : 2;

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.grid}>
        {visible.map(cam => (
          <View key={cam.did} style={{width: `${100 / cols}%`, height: `${100 / rows}%`, padding: 1}}>
            <CameraTile camera={cam} active={appActive} onPress={() => onOpen(cam)} />
          </View>
        ))}
      </View>

      <View style={styles.topBar} pointerEvents="box-none">
        <Pressable style={styles.chip} onPress={onBack} hitSlop={10}>
          <Text style={styles.chipText}>‹ Voltar</Text>
        </Pressable>
        {pages > 1 && (
          <View style={styles.pager}>
            <Pressable
              style={[styles.chip, page === 0 && styles.dim]}
              disabled={page === 0}
              onPress={() => setPage(p => p - 1)}
              hitSlop={10}>
              <Text style={styles.chipText}>‹</Text>
            </Pressable>
            <Text style={styles.chipText}>
              {page + 1}/{pages}
            </Text>
            <Pressable
              style={[styles.chip, page >= pages - 1 && styles.dim]}
              disabled={page >= pages - 1}
              onPress={() => setPage(p => p + 1)}
              hitSlop={10}>
              <Text style={styles.chipText}>›</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#000'},
  grid: {flex: 1, flexDirection: 'row', flexWrap: 'wrap'},
  tile: {flex: 1, backgroundColor: '#000', overflow: 'hidden'},
  tileOverlay: {...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 6},
  tileStatus: {color: colors.muted, fontSize: 12},
  label: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    maxWidth: '80%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  labelText: {color: '#fff', fontSize: 12, fontWeight: '600'},
  dot: {width: 7, height: 7, borderRadius: 4},
  topBar: {position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between'},
  pager: {flexDirection: 'row', alignItems: 'center', gap: 8},
  chip: {backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6},
  chipText: {color: '#fff', fontSize: 14, fontWeight: '600'},
  dim: {opacity: 0.4},
});
