import React, {useCallback, useEffect, useState} from 'react';
import {Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import {CloudStatus, useCloudStatus} from '../camera/useCloudStatus';
import {MenuButton, MenuItem, SideMenu} from '../components/SideMenu';
import {getAccount, logout, syncCameras} from '../server/account';
import {processUploads} from '../server/uploads';
import {getFavorite, loadCameras, removeCamera, SavedCamera, setFavorite} from '../storage';
import {colors, ui} from '../theme';
import {useAppActive} from '../useAppActive';

type Props = {
  onAdd: () => void;
  onOpen: (camera: SavedCamera) => void;
  onOpenAccount: () => void;
  /** memory-card recordings (asks which camera when there is more than one) */
  onOpenRecordings: (cameras: SavedCamera[]) => void;
  /** photos stored on the central server */
  onOpenPhotos: () => void;
  /** 4-camera grid in landscape */
  onOpenMulti: () => void;
};

const STATUS_UI: Record<CloudStatus, {label: string; color: string}> = {
  checking: {label: 'Verificando…', color: colors.muted},
  online: {label: 'Online', color: colors.ok},
  offline: {label: 'Offline', color: colors.danger},
};

export default function HomeScreen({
  onAdd,
  onOpen,
  onOpenAccount,
  onOpenRecordings,
  onOpenPhotos,
  onOpenMulti,
}: Props) {
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  const appActive = useAppActive();
  const {statusOf, refresh, refreshing} = useCloudStatus(
    cameras.map(c => c.did),
    appActive,
  );
  const account = getAccount();
  const [menuOpen, setMenuOpen] = useState(false);

  const [favorite, setFavoriteState] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadCameras().then(setCameras);
    getFavorite().then(setFavoriteState);
  }, []);

  useEffect(reload, [reload]);

  /** Only one favorite: it opens full screen when the app starts. Tap again to unmark. */
  const toggleFavorite = (cam: SavedCamera) => {
    const next = favorite === cam.did ? null : cam.did;
    setFavoriteState(next);
    setFavorite(next);
  };

  /** Pull to refresh: camera status + (with an account) the camera list from the server. */
  const onRefresh = async () => {
    if (getAccount()) {
      await syncCameras()
        .then(setCameras)
        .catch(() => {});
      processUploads();
    }
    refresh();
  };

  const confirmRemove = (cam: SavedCamera) => {
    if (cam.serverId !== undefined) {
      Alert.alert(
        'Câmera da conta',
        'Esta câmera vem da sua conta no CamGood central. Para tirá-la do app, o administrador remove o seu acesso no painel.',
      );
      return;
    }
    Alert.alert('Remover câmera', `Remover "${cam.name}" da lista?`, [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          if (favorite === cam.did) {
            setFavoriteState(null);
            setFavorite(null);
          }
          removeCamera(cam.did).then(setCameras);
        },
      },
    ]);
  };

  // "Conta" is reached through ENTRAR (footer) or by tapping the user name at the top of the menu
  const menuItems: MenuItem[] = [
    {key: 'add', icon: '➕', label: 'Adicionar câmera', onPress: onAdd},
    ...(cameras.length > 0
      ? [{key: 'gallery', icon: '🎞️', label: 'Galeria', onPress: () => onOpenRecordings(cameras)}]
      : []),
    ...(cameras.length > 1 ? [{key: 'multi', icon: '🔲', label: 'Mosaico', onPress: onOpenMulti}] : []),
    ...(account ? [{key: 'photos', icon: '🖼️', label: 'Fotos', onPress: onOpenPhotos}] : []),
  ];

  const confirmLogout = () =>
    Alert.alert('Sair da conta', 'As câmeras da conta saem do app. As que você salvou só no celular continuam.', [
      {text: 'Cancelar', style: 'cancel'},
      {text: 'Sair', style: 'destructive', onPress: () => logout().then(reload)},
    ]);

  const footer: MenuItem = account
    ? {key: 'logout', icon: '🚪', label: 'Sair', onPress: confirmLogout}
    : {key: 'login', icon: '🔑', label: 'Entrar', onPress: onOpenAccount};

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Text style={ui.title}>Minhas câmeras</Text>
        <MenuButton onPress={() => setMenuOpen(true)} />
      </View>

      <SideMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={account ? account.user.name : 'Sem conta'}
        subtitle={account ? (account.user.role === 'admin' ? 'Administrador' : 'Usuário') + ' · ' + account.user.email : 'Câmeras salvas só neste celular'}
        items={menuItems}
        footer={footer}
        onHeaderPress={account ? onOpenAccount : undefined}
      />

      <FlatList
        data={cameras}
        keyExtractor={c => c.did}
        contentContainerStyle={{padding: 16, gap: 12, flexGrow: 1}}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16}}>
            <Text style={[ui.muted, {textAlign: 'center'}]}>
              Nenhuma câmera ainda.{'\n'}Toque em “Adicionar” para configurar a sua.
            </Text>
            <Pressable style={[ui.button, {paddingHorizontal: 24}]} onPress={onAdd}>
              <Text style={ui.buttonText}>Adicionar câmera</Text>
            </Pressable>
            {!account && (
              <Pressable style={[ui.buttonGhost, {paddingHorizontal: 24}]} onPress={onOpenAccount}>
                <Text style={ui.text}>Entrar com uma conta</Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({item}) => {
          const st = STATUS_UI[statusOf(item.did)];
          return (
            <Pressable
              style={({pressed}) => [ui.card, {opacity: pressed ? 0.7 : 1}]}
              onPress={() => onOpen(item)}
              onLongPress={() => confirmRemove(item)}>
              <View style={styles.row}>
                <Pressable
                  onPress={() => toggleFavorite(item)}
                  hitSlop={12}
                  accessibilityLabel={favorite === item.did ? 'Desmarcar favorita' : 'Marcar como favorita'}>
                  <Text style={[styles.star, favorite === item.did && styles.starOn]}>
                    {favorite === item.did ? '★' : '☆'}
                  </Text>
                </Pressable>
                <Text style={[ui.text, {fontWeight: '600', fontSize: 17, flex: 1}]}>{item.name}</Text>
                <View style={[styles.dot, {backgroundColor: st.color}]} />
                <Text style={[ui.muted, {color: st.color}]}>{st.label}</Text>
              </View>
              {item.serverId !== undefined && <Text style={[ui.muted, {marginTop: 4}]}>Câmera da conta</Text>}
              <Text style={[ui.muted, {marginTop: 8, color: colors.primary}]}>
                {favorite === item.did ? 'Favorita · abre em tela cheia ao iniciar o app' : 'Toque para ver ao vivo'}
              </Text>
            </Pressable>
          );
        }}
      />
      {cameras.length > 0 && (
        <Text style={[ui.muted, {textAlign: 'center', paddingBottom: 12}]}>
          ☆ favorita · puxe para atualizar · segure para remover
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 6},
  dot: {width: 8, height: 8, borderRadius: 4},
  star: {fontSize: 24, color: colors.muted, marginRight: 4},
  starOn: {color: '#f2c94c'},
});
