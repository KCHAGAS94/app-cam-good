import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  CamCommands,
  CMD,
  IrMode,
  LightMode,
  PTZ,
  ptzForScreen,
  ScreenDir,
  rotmirParse,
  rotmirValue,
} from '../camera/commands';
import {CameraModule, CameraView, netLabel, onMessage, parseReply, Status, statusLabel} from '../camera/native';
import {askMicPermission} from '../camera/permissions';
import {CloudState, StreamId, useCameraSession} from '../camera/useCameraSession';
import {useNetType} from '../camera/useNetType';
import {OtherLoginWarning} from '../components';
import {getAccount, logAction} from '../server/account';
import {enqueueUpload} from '../server/uploads';
import {isDefaultPassword, Quality, SavedCamera, updateCamera} from '../storage';
import {colors, ui} from '../theme';
import {useAppActive} from '../useAppActive';

type Props = {
  camera: SavedCamera;
  onBack: () => void;
  onOpenWifi: () => void;
  onOpenSd: () => void;
  onOpenRecordings: () => void;
  onOpenSettings: () => void;
  onOpenGallery: () => void;
  /** Open already in full screen (favorite camera at app start). */
  startFullscreen?: boolean;
};

/** Explains a failed connection using what the P2P server knows about the camera. */
function failureHint(
  status: number,
  cloud: CloudState,
  netType: string | null,
  otherLogin: boolean,
): string | null {
  if (netType === 'none') {
    return 'Seu celular está sem internet.';
  }
  if (status === Status.INVALID_ID) {
    return 'Confira o ID da câmera.';
  }
  if (otherLogin) {
    return 'A câmera recusou o login. Provavelmente a senha está errada.';
  }
  if (cloud && !cloud.online) {
    return 'A câmera não está conectada à internet: verifique se ela está ligada e se o Wi-Fi dela está funcionando.';
  }
  if (cloud?.online) {
    return 'A câmera está online, mas a conexão falhou. Tentando de novo…';
  }
  if (status === Status.OFFLINE || status === Status.TIMEOUT) {
    return 'Verificando se a câmera está online…';
  }
  return null;
}

/** Three-way selector (Auto / Ligado / Desligado). */
function Segmented<T extends number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T | null;
  options: {value: T; label: string}[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segment, disabled && {opacity: 0.5}]}>
      {options.map(o => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, selected && styles.segmentSelected]}>
            <Text style={[ui.text, {fontSize: 14}, selected && {color: '#fff', fontWeight: '600'}]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Same values for infrared (icut) and white light: 0 off, 1 on, 2 auto. */
const MODE_OPTIONS = [
  {value: 2, label: 'Auto'},
  {value: 1, label: 'Ligado'},
  {value: 0, label: 'Desligado'},
];

export default function LiveScreen({
  camera,
  onBack,
  onOpenWifi,
  onOpenSd,
  onOpenRecordings,
  onOpenSettings,
  onOpenGallery,
  startFullscreen = false,
}: Props) {
  const {did} = camera;
  const auth = {user: camera.user, pwd: camera.pwd};
  const appActive = useAppActive();
  const phoneNet = useNetType();
  const [quality, setQuality] = useState<Quality>(camera.quality ?? 'auto');
  // picture rotation for a camera mounted sideways; saved per camera on this phone
  const [rotation, setRotation] = useState<number>(camera.rotation ?? 0);
  const rotate = () => {
    const next = (rotation + 90) % 360;
    setRotation(next);
    updateCamera(did, {rotation: next});
  };
  // auto: main stream on Wi-Fi, lighter sub stream on mobile data
  const streamId: StreamId = quality === 'high' ? 1 : quality === 'low' ? 2 : phoneNet === 'cellular' ? 2 : 1;
  // the session is paused while the app is in the background (saves mobile data)
  const {status, online, otherLogin, video, netType, cloud, reconnect} = useCameraSession(camera, {
    live: true,
    paused: !appActive,
    streamId,
  });

  const changeQuality = (q: Quality) => {
    setQuality(q);
    updateCamera(did, {quality: q});
  };

  // full screen: automatically in landscape, or with the button
  const {width: winW, height: winH} = useWindowDimensions();
  const landscape = winW > winH;
  const [fullscreenBtn, setFullscreenBtn] = useState(startFullscreen);
  const fullscreen = landscape || fullscreenBtn;

  // Android back button leaves full screen first
  useEffect(() => {
    if (!fullscreenBtn) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setFullscreenBtn(false);
      return true;
    });
    return () => sub.remove();
  }, [fullscreenBtn]);
  const hint = online ? null : failureHint(status, cloud, netType, otherLogin);

  // camera settings, read from get_parms / get_whiteLight once online
  const [ir, setIr] = useState<IrMode | null>(null);
  const [light, setLight] = useState<LightMode | null>(null);
  const [mirror, setMirror] = useState(false);
  const [flip, setFlip] = useState(false);
  const [led, setLed] = useState<boolean | null>(null);
  const holding = useRef(false);

  // photos (video recording happens 24h on the camera's memory card, not on the phone)
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(t => (t === text ? null : t)), 3000);
  };

  /**
   * Logged in + account camera: photos go ONLY to the central server (kept in the app
   * outbox until uploaded). Otherwise they are saved in the phone gallery.
   */
  const serverOnly = () => camera.serverId !== undefined && getAccount() !== null;

  const sendToServer = (uri: string) => {
    if (!serverOnly()) {
      return false;
    }
    enqueueUpload({
      uri,
      kind: 'photo',
      cameraServerId: camera.serverId!,
      takenAt: new Date().toISOString(),
      serverOnly: true,
    });
    return true;
  };

  // history on the central server: one "live_view" per visit, when the video shows up
  const loggedView = useRef(false);
  useEffect(() => {
    if (video && !loggedView.current) {
      loggedView.current = true;
      logAction(camera, 'live_view');
    }
  }, [video, camera]);

  const takePhoto = async () => {
    try {
      const uri = await CameraModule.takeSnapshot(did, !serverOnly());
      const sent = sendToServer(uri);
      showToast(sent ? 'Foto enviada para o servidor (veja em Fotos)' : 'Foto salva na galeria (Pictures/CamGood)');
    } catch (e: any) {
      showToast(e?.message ?? 'Não foi possível salvar a foto');
    }
  };

  const send = (json: string) => CameraModule.send(did, json);

  // ---- audio: listen (camera mic) and push-to-talk (camera speaker) ----
  const [listening, setListening] = useState(false);
  const [talking, setTalking] = useState(false);
  const resumeListening = useRef(false);

  // (re)open the audio channel whenever the session comes online while sound is on
  useEffect(() => {
    if (online && listening) {
      CameraModule.startListening(did);
    }
  }, [online, listening, did]);

  // leaving the screen: never leave the microphone open
  useEffect(
    () => () => {
      CameraModule.stopListening(did).catch(() => {});
      if (talkingRef.current) {
        talkingRef.current = false;
        CameraModule.send(did, CamCommands.talk(auth, false)).catch(() => {});
      }
      CameraModule.stopTalk(did).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [did],
  );

  const toggleSound = () => {
    if (listening) {
      CameraModule.stopListening(did);
    }
    setListening(!listening);
  };

  const talkingRef = useRef(false);

  /** Tap to start talking, tap again to stop (no need to hold the button). */
  const toggleTalk = () => (talkingRef.current ? talkEnd() : talkStart());

  const talkStart = async () => {
    if (!(await askMicPermission())) {
      showToast('Sem permissão de microfone');
      return;
    }
    // half-duplex like the vendor app: mute the camera while you talk (avoids echo)
    resumeListening.current = listening;
    if (listening) {
      await CameraModule.stopListening(did);
    }
    talkingRef.current = true;
    logAction(camera, 'talk');
    setTalking(true);
    send(CamCommands.talk(auth, true));
    CameraModule.startTalk(did);
  };

  const talkEnd = async () => {
    if (!talkingRef.current) {
      return;
    }
    talkingRef.current = false;
    setTalking(false);
    send(CamCommands.talk(auth, false));
    await CameraModule.stopTalk(did);
    if (resumeListening.current) {
      CameraModule.startListening(did);
    }
  };

  useEffect(() => {
    const sub = onMessage(e => {
      if (e.did !== did) {
        return;
      }
      const r = parseReply(e.json);
      if (!r) {
        return;
      }
      if (r.cmd === CMD.GET_PARAMS) {
        if (r.icut !== undefined) {
          setIr(Number(r.icut) as IrMode);
        }
        if (r.rotmir !== undefined) {
          const o = rotmirParse(Number(r.rotmir));
          setMirror(o.mirror);
          setFlip(o.flip);
        }
        if (r.lamp !== undefined) {
          setLed(Number(r.lamp) === 1);
        }
      } else if (r.cmd === CMD.GET_WHITE_LIGHT && r.status !== undefined) {
        setLight(Number(r.status) as LightMode);
      }
    });
    return () => sub.remove();
  }, [did]);

  // read current settings every time the session comes online
  useEffect(() => {
    if (online) {
      send(CamCommands.getParams(auth));
      send(CamCommands.getWhiteLight(auth));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  /**
   * Tap = one step; hold = keep moving until release (same as the vendor app).
   * The arrow is the direction ON SCREEN: it is translated to the camera's direction
   * according to the picture rotation (⟳), so "right" always moves the picture right.
   */
  const ptzHandlers = (screenDir: ScreenDir) => {
    const {move, stop} = ptzForScreen(screenDir, rotation);
    return {
      onPress: () => send(CamCommands.ptzStep(auth, move)),
      onLongPress: () => {
        holding.current = true;
        send(CamCommands.ptz(auth, move));
      },
      onPressOut: () => {
        if (holding.current) {
          holding.current = false;
          send(CamCommands.ptz(auth, stop));
        }
      },
      delayLongPress: 300,
      disabled: !online,
    };
  };

  const changeIr = (m: IrMode) => {
    setIr(m);
    send(CamCommands.irCut(auth, m));
  };
  const changeLight = (m: LightMode) => {
    setLight(m);
    send(CamCommands.whiteLight(auth, m));
  };
  const toggleMirror = () => {
    setMirror(!mirror);
    send(CamCommands.rotateMirror(auth, rotmirValue(!mirror, flip)));
  };
  const toggleFlip = () => {
    setFlip(!flip);
    send(CamCommands.rotateMirror(auth, rotmirValue(mirror, !flip)));
  };
  const toggleLed = () => {
    const next = !led;
    setLed(next);
    send(CamCommands.lamp(auth, next));
  };

  const confirmReboot = () =>
    Alert.alert('Reiniciar câmera', 'A câmera vai desconectar por cerca de 1 minuto.', [
      {text: 'Cancelar', style: 'cancel'},
      {text: 'Reiniciar', onPress: () => send(CamCommands.reboot(auth))},
    ]);

  const videoContent = (
    <>
      <CameraView did={did} resizeMode="contain" imageRotation={rotation} style={StyleSheet.absoluteFill} />
      {!video && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[ui.text, {marginTop: 10}]}>
            {online ? 'Carregando vídeo…' : statusLabel(status)}
          </Text>
          {hint && <Text style={[ui.muted, styles.hint]}>{hint}</Text>}
          {!online && otherLogin && (
            <Pressable onPress={onOpenSettings} hitSlop={8} style={{marginTop: 10}}>
              <Text style={ui.link}>Corrigir senha</Text>
            </Pressable>
          )}
          {!online && !otherLogin && cloud !== null && (
            <Pressable onPress={reconnect} hitSlop={8} style={{marginTop: 10}}>
              <Text style={ui.link}>Tentar agora</Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );

  if (fullscreen) {
    return (
      <View style={styles.full}>
        <StatusBar hidden />
        {videoContent}
        {!landscape && (
          <Pressable style={styles.exitFull} onPress={() => setFullscreenBtn(false)} hitSlop={12}>
            <Text style={ui.text}>✕ Sair da tela cheia</Text>
          </Pressable>
        )}
        <View style={styles.videoButtons}>
          <Pressable style={styles.videoBtn} onPress={rotate} hitSlop={8} accessibilityLabel="Girar imagem">
            <Text style={styles.videoBtnIcon}>⟳</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={ui.screen}>
      <StatusBar hidden={false} />
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title} numberOfLines={1}>
          {camera.name}
        </Text>
        <View style={[styles.dot, {backgroundColor: online ? colors.ok : colors.warn}]} />
      </View>

      <View style={styles.videoBox}>
        {videoContent}
        <View style={styles.videoButtons}>
          <Pressable style={styles.videoBtn} onPress={rotate} hitSlop={8} accessibilityLabel="Girar imagem">
            <Text style={styles.videoBtnIcon}>⟳</Text>
          </Pressable>
          <Pressable style={styles.videoBtn} onPress={() => setFullscreenBtn(true)} hitSlop={8} accessibilityLabel="Tela cheia">
            <Text style={styles.videoBtnIcon}>⛶</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[ui.muted, {textAlign: 'center', marginTop: 8}]}>
        {video ? `${video.width}×${video.height} · ` : ''}
        {statusLabel(status)} · celular no {netLabel(netType)}
      </Text>

      <View style={styles.captureRow}>
        <Pressable style={[ui.buttonGhost, {flex: 1}]} disabled={!video} onPress={takePhoto}>
          <Text style={[ui.text, !video && {opacity: 0.4}]}>📷 Foto</Text>
        </Pressable>
        <Pressable style={[ui.buttonGhost, {flex: 1}]} onPress={onOpenRecordings}>
          <Text style={ui.text}>🎞 Gravações</Text>
        </Pressable>
      </View>
      <View style={styles.captureRow}>
        <Pressable
          style={[ui.buttonGhost, {flex: 1}, listening && {borderColor: colors.primary}]}
          disabled={!online}
          onPress={toggleSound}>
          <Text style={[ui.text, !online && {opacity: 0.4}]}>{listening ? '🔊 Som ligado' : '🔇 Som desligado'}</Text>
        </Pressable>
        <Pressable
          style={[ui.buttonGhost, {flex: 1}, talking && styles.talkingBtn]}
          disabled={!online && !talking}
          onPress={toggleTalk}>
          <Text style={[ui.text, talking && styles.talkingText, !online && !talking && {opacity: 0.4}]}>
            {talking ? '🎤 Falando… toque p/ parar' : '🎤 Toque para falar'}
          </Text>
        </Pressable>
      </View>
      {toast && <Text style={[ui.text, {textAlign: 'center', paddingHorizontal: 16}]}>{toast}</Text>}

      <ScrollView contentContainerStyle={{padding: 16, gap: 18}}>
        {/* pan / tilt */}
        <View style={styles.pad}>
          <View style={styles.padRow}>
            <Pressable style={styles.padBtn} {...ptzHandlers('up')}>
              <Text style={styles.padIcon}>▲</Text>
            </Pressable>
          </View>
          <View style={styles.padRow}>
            <Pressable style={styles.padBtn} {...ptzHandlers('left')}>
              <Text style={styles.padIcon}>◀</Text>
            </Pressable>
            <Pressable
              style={[styles.padBtn, styles.padCenter]}
              disabled={!online}
              onPress={() => send(CamCommands.ptzStep(auth, PTZ.CENTER))}>
              <Text style={[styles.padIcon, {fontSize: 12}]}>Centro</Text>
            </Pressable>
            <Pressable style={styles.padBtn} {...ptzHandlers('right')}>
              <Text style={styles.padIcon}>▶</Text>
            </Pressable>
          </View>
          <View style={styles.padRow}>
            <Pressable style={styles.padBtn} {...ptzHandlers('down')}>
              <Text style={styles.padIcon}>▼</Text>
            </Pressable>
          </View>
          <Text style={[ui.muted, {textAlign: 'center', marginTop: 4}]}>
            Toque para um passo · segure para girar
          </Text>
        </View>

        {otherLogin && <OtherLoginWarning onRetry={reconnect} onFixPassword={onOpenSettings} />}

        {isDefaultPassword(camera) && (
          <Pressable style={[ui.card, {borderColor: colors.warn}]} onPress={onOpenSettings}>
            <Text style={[ui.text, {color: colors.warn}]}>
              ⚠ Câmera com a senha de fábrica (6666). Toque para trocar.
            </Text>
          </Pressable>
        )}

        <Pressable style={ui.button} onPress={onOpenRecordings}>
          <Text style={ui.buttonText}>🎞 Galeria (gravações do cartão, hora a hora)</Text>
        </Pressable>

        {camera.serverId !== undefined && getAccount() && (
          <Pressable style={ui.buttonGhost} onPress={onOpenGallery}>
            <Text style={ui.text}>🖼 Fotos desta câmera (servidor)</Text>
          </Pressable>
        )}

        <View style={{gap: 8}}>
          <Text style={ui.muted}>
            Qualidade do vídeo{quality === 'auto' ? ` (agora: ${streamId === 1 ? 'alta' : 'leve'})` : ''}
          </Text>
          <View style={styles.segment}>
            {(
              [
                ['auto', 'Auto'],
                ['high', 'Alta'],
                ['low', 'Leve'],
              ] as [Quality, string][]
            ).map(([q, label]) => (
              <Pressable
                key={q}
                onPress={() => changeQuality(q)}
                style={[styles.segmentItem, quality === q && styles.segmentSelected]}>
                <Text style={[ui.text, {fontSize: 14}, quality === q && {color: '#fff', fontWeight: '600'}]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{gap: 8}}>
          <Text style={ui.muted}>Visão noturna (infravermelho)</Text>
          <Segmented
            value={ir}
            options={MODE_OPTIONS as {value: IrMode; label: string}[]}
            onChange={changeIr}
            disabled={!online}
          />
        </View>

        <View style={{gap: 8}}>
          <Text style={ui.muted}>Luz branca</Text>
          <Segmented
            value={light}
            options={MODE_OPTIONS as {value: LightMode; label: string}[]}
            onChange={changeLight}
            disabled={!online}
          />
        </View>

        <View style={{flexDirection: 'row', gap: 10}}>
          <Pressable
            style={[ui.buttonGhost, {flex: 1}, flip && {borderColor: colors.primary}]}
            disabled={!online}
            onPress={toggleFlip}>
            <Text style={ui.text}>Inverter imagem</Text>
          </Pressable>
          <Pressable
            style={[ui.buttonGhost, {flex: 1}, mirror && {borderColor: colors.primary}]}
            disabled={!online}
            onPress={toggleMirror}>
            <Text style={ui.text}>Espelhar</Text>
          </Pressable>
        </View>

        <View style={{flexDirection: 'row', gap: 10}}>
          <Pressable style={[ui.buttonGhost, {flex: 1}]} onPress={onOpenSd}>
            <Text style={ui.text}>Cartão de memória</Text>
          </Pressable>
          <Pressable style={[ui.buttonGhost, {flex: 1}]} disabled={!online} onPress={toggleLed}>
            <Text style={ui.text}>LED indicador: {led === null ? '—' : led ? 'ligado' : 'desligado'}</Text>
          </Pressable>
        </View>

        <View style={{flexDirection: 'row', gap: 10}}>
          <Pressable style={[ui.buttonGhost, {flex: 1}]} onPress={onOpenWifi}>
            <Text style={ui.text}>Wi-Fi da câmera</Text>
          </Pressable>
          <Pressable style={[ui.buttonGhost, {flex: 1}]} onPress={onOpenSettings}>
            <Text style={ui.text}>Configurações</Text>
          </Pressable>
        </View>

        <View style={{flexDirection: 'row', gap: 10}}>
          <Pressable style={[ui.buttonGhost, {flex: 1}]} disabled={!online} onPress={confirmReboot}>
            <Text style={ui.text}>Reiniciar</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {width: 10, height: 10, borderRadius: 5},
  videoBox: {width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000'},
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  hint: {marginTop: 6, textAlign: 'center'},
  full: {flex: 1, backgroundColor: '#000'},
  exitFull: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  talkingBtn: {borderColor: colors.danger, backgroundColor: 'rgba(229,83,75,0.15)'},
  talkingText: {color: colors.danger, fontWeight: '700'},
  videoButtons: {position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 8},
  videoBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoBtnIcon: {color: '#fff', fontSize: 20},
  captureRow: {flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10},
  pad: {gap: 6, alignItems: 'center'},
  padRow: {flexDirection: 'row', justifyContent: 'center', gap: 6},
  padBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  padCenter: {backgroundColor: colors.bg},
  padIcon: {color: colors.text, fontSize: 18},
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segmentItem: {flex: 1, paddingVertical: 10, alignItems: 'center'},
  segmentSelected: {backgroundColor: colors.primary},
});
