import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  deleteMedia,
  getAccount,
  listMedia,
  mediaImageSource,
  mediaOpenUrl,
  ServerMedia,
} from '../server/account';
import {onPendingChange, processUploads} from '../server/uploads';
import {loadCameras, SavedCamera} from '../storage';
import {colors, ui} from '../theme';

type Props = {onBack: () => void; cameraServerId?: number};

const PAGE = 60;

const fmtDate = (d: string) => {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)} ${p(x.getHours())}:${p(x.getMinutes())}`;
};
const fmtDuration = (ms: number | null) => {
  if (!ms) {
    return '';
  }
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Chip({label, active, onPress}: {label: string; active: boolean; onPress: () => void}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[ui.text, styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Photos and videos stored on the central server, for the cameras this account can use. */
export default function GalleryScreen({onBack, cameraServerId}: Props) {
  const account = getAccount();
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  const [cameraId, setCameraId] = useState<number | undefined>(cameraServerId);
  const [kind, setKind] = useState<'photo' | 'video' | undefined>();
  const [items, setItems] = useState<ServerMedia[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState<ServerMedia | null>(null);

  useEffect(() => {
    loadCameras().then(list => setCameras(list.filter(c => c.serverId !== undefined)));
    return onPendingChange(setPending);
  }, []);

  const load = useCallback(
    async (before?: number) => {
      setError(null);
      try {
        const page = await listMedia({cameraId, kind, before});
        setItems(prev => (before ? [...prev, ...page] : page));
        setHasMore(page.length === PAGE);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [cameraId, kind],
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // a finished upload shows up right away
  const [lastPending, setLastPending] = useState(pending);
  useEffect(() => {
    if (pending < lastPending) {
      load();
    }
    setLastPending(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const openVideo = async (m: ServerMedia) => {
    try {
      await Linking.openURL(await mediaOpenUrl(m.id));
    } catch (e: any) {
      Alert.alert('Vídeo', e.message ?? 'Não foi possível abrir o vídeo.');
    }
  };

  const remove = (m: ServerMedia) =>
    Alert.alert('Apagar', 'Apagar este arquivo do servidor? Não tem como desfazer.', [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMedia(m.id);
            setOpen(null);
            setItems(prev => prev.filter(x => x.id !== m.id));
          } catch (e: any) {
            Alert.alert('Erro', e.message);
          }
        },
      },
    ]);

  if (!account) {
    return (
      <View style={ui.screen}>
        <View style={ui.header}>
          <Pressable onPress={onBack} hitSlop={12}>
            <Text style={ui.link}>‹ Voltar</Text>
          </Pressable>
          <Text style={ui.title}>Fotos</Text>
        </View>
        <Text style={[ui.muted, {padding: 16}]}>Entre na sua conta (tela Conta) para ver as fotos do servidor.</Text>
      </View>
    );
  }

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title}>Fotos</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow}>
        <Chip label="Todas" active={!cameraId} onPress={() => setCameraId(undefined)} />
        {cameras.map(c => (
          <Chip key={c.did} label={c.name} active={cameraId === c.serverId} onPress={() => setCameraId(c.serverId)} />
        ))}
        <View style={styles.sep} />
        <Chip label="Fotos e vídeos" active={!kind} onPress={() => setKind(undefined)} />
        <Chip label="Fotos" active={kind === 'photo'} onPress={() => setKind('photo')} />
        <Chip label="Vídeos" active={kind === 'video'} onPress={() => setKind('video')} />
      </ScrollView>

      {pending > 0 && (
        <Pressable style={styles.pending} onPress={() => processUploads()}>
          <Text style={ui.text}>
            ⬆ {pending} {pending === 1 ? 'arquivo aguardando' : 'arquivos aguardando'} envio · toque para tentar agora
          </Text>
          <Text style={ui.muted}>Só envia quando o celular alcança o servidor.</Text>
        </Pressable>
      )}

      {error && <Text style={[ui.text, {color: colors.danger, paddingHorizontal: 16}]}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{marginTop: 32}} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={m => String(m.id)}
          numColumns={3}
          contentContainerStyle={{padding: 8, flexGrow: 1}}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                processUploads();
                load();
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onEndReached={() => hasMore && load(items[items.length - 1]?.id)}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            !error ? (
              <Text style={[ui.muted, {textAlign: 'center', marginTop: 40}]}>
                Nada por aqui ainda.{'\n'}As fotos e vídeos que você fizer nas câmeras da conta aparecem aqui.
              </Text>
            ) : undefined
          }
          renderItem={({item}) => (
            <Pressable style={styles.tile} onPress={() => (item.kind === 'photo' ? setOpen(item) : openVideo(item))}>
              {item.kind === 'photo' ? (
                <Image source={mediaImageSource(item.id)} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.videoThumb]}>
                  <Text style={styles.play}>▶</Text>
                  <Text style={ui.muted}>{fmtDuration(item.duration_ms)}</Text>
                </View>
              )}
              <Text style={styles.meta} numberOfLines={1}>
                {fmtDate(item.taken_at)}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={open !== null} animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.viewer}>
          {open && (
            <Image source={mediaImageSource(open.id)} style={styles.full} resizeMode="contain" />
          )}
          {open && (
            <View style={styles.viewerBar}>
              <Text style={[ui.muted, {flex: 1}]} numberOfLines={2}>
                {open.camera_name ?? ''} · {fmtDate(open.taken_at)}
                {open.user_name ? ` · ${open.user_name}` : ''}
              </Text>
              <Pressable onPress={() => openVideo(open)} hitSlop={8}>
                <Text style={ui.link}>Abrir</Text>
              </Pressable>
              {account.user.role === 'admin' && (
                <Pressable onPress={() => remove(open)} hitSlop={8}>
                  <Text style={[ui.link, {color: colors.danger}]}>Apagar</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setOpen(null)} hitSlop={8}>
                <Text style={ui.link}>Fechar</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {flexGrow: 0},
  chipsRow: {paddingHorizontal: 16, gap: 8, paddingBottom: 8, alignItems: 'center'},
  chip: {borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6},
  chipActive: {backgroundColor: colors.primary, borderColor: colors.primary},
  chipText: {fontSize: 13},
  chipTextActive: {color: '#fff', fontWeight: '600'},
  sep: {width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: 4},
  pending: {marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10, backgroundColor: colors.card, gap: 2},
  tile: {width: '33.33%', padding: 4},
  thumb: {width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#000'},
  videoThumb: {justifyContent: 'center', alignItems: 'center', backgroundColor: colors.card},
  play: {color: colors.text, fontSize: 28},
  meta: {color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'center'},
  viewer: {flex: 1, backgroundColor: '#000'},
  full: {flex: 1},
  viewerBar: {flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, backgroundColor: colors.bg},
});
