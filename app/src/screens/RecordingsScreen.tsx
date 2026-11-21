import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {CamCommands, CMD} from '../camera/commands';
import {
  CameraModule,
  CameraView,
  onMessage,
  onPlayback,
  onPlaybackFlow,
  parseReply,
  PlaybackEvent,
  statusLabel,
} from '../camera/native';
import {
  dayLabel,
  fileLabel,
  hourKey,
  hourLabel,
  parseRecordDays,
  parseRecordFiles,
  parseRecordHours,
  RecordDay,
} from '../camera/recordings';
import {useCameraSession} from '../camera/useCameraSession';
import {EmptyCard, LoadingCard} from '../components';
import {logAction} from '../server/account';
import {loadCameras, SavedCamera} from '../storage';
import {colors, ui} from '../theme';

type Props = {camera: SavedCamera; onBack: () => void};
type Step = 'days' | 'day' | 'player';

const REPLY_TIMEOUT_MS = 12_000;
const DELETE_TIMEOUT_MS = 5_000;
const SPEEDS = [1, 2, 4] as const;

/**
 * Memory-card gallery, hour by hour: pick a day, see each recorded hour as a card,
 * watch the whole hour (files play in sequence, 1x/2x/4x) or delete it.
 */
export default function RecordingsScreen({camera, onBack}: Props) {
  const {did} = camera;
  const auth = {user: camera.user, pwd: camera.pwd};
  const {status, online} = useCameraSession(camera);
  const thisYear = new Date().getFullYear();

  // same picture rotation chosen in the live view (read fresh: it may have changed there)
  const [rotation, setRotation] = useState(camera.rotation ?? 0);
  useEffect(() => {
    loadCameras().then(list => {
      const saved = list.find(c => c.did === did);
      if (saved?.rotation !== undefined) {
        setRotation(saved.rotation);
      }
    });
  }, [did]);

  const [step, setStep] = useState<Step>('days');
  const [year, setYear] = useState(thisYear);
  const [days, setDays] = useState<RecordDay[] | null>(null);
  const [day, setDay] = useState<RecordDay | null>(null);
  const [hours, setHours] = useState<number[] | null>(null);
  /** files per hour, loaded when a card is opened / played / deleted */
  const [filesByHour, setFilesByHour] = useState<Record<number, string[]>>({});
  const [openHour, setOpenHour] = useState<number | null>(null);
  const [busyHour, setBusyHour] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // player
  const [playlist, setPlaylist] = useState<{hour: number; files: string[]} | null>(null);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState<PlaybackEvent | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [sound, setSound] = useState(true);
  const playing = useRef<string | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const advanced = useRef(false);

  const send = (json: string) => CameraModule.send(did, json);

  // ---- request/reply: one waiter per reply code ----
  const waiters = useRef(new Map<number, (r: Record<string, any> | null) => void>());
  const request = (json: string, code: number, timeout = REPLY_TIMEOUT_MS) =>
    new Promise<Record<string, any> | null>(resolve => {
      waiters.current.get(code)?.(null); // a newer request replaces an older one
      waiters.current.set(code, resolve);
      send(json);
      setTimeout(() => {
        if (waiters.current.get(code) === resolve) {
          waiters.current.delete(code);
          resolve(null);
        }
      }, timeout);
    });

  useEffect(() => {
    const subs = [
      onMessage(e => {
        if (e.did !== did) {
          return;
        }
        const r = parseReply(e.json);
        const w = r ? waiters.current.get(r.cmd) : undefined;
        if (r && w) {
          waiters.current.delete(r.cmd);
          w(r);
        }
      }),
      onPlayback(e => e.did === did && setProgress(e)),
      // camera sends faster than we show: pause its sending while our queue is full
      onPlaybackFlow(e => {
        if (e.did !== did || !playing.current || pausedRef.current) {
          return;
        }
        send(e.full ? CamCommands.pauseRecordFile(auth, playing.current) : CamCommands.resumeRecordFile(auth, playing.current));
      }),
    ];
    return () => subs.forEach(s => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [did]);

  // ---- loading lists ----
  const loadDays = async (y: number) => {
    setDays(null);
    const r = await request(CamCommands.getRecordDays(auth, y), CMD.GET_RECORD_DAYS);
    setDays(r ? parseRecordDays(r, y) : []);
  };

  const loadHours = async (d: RecordDay) => {
    setHours(null);
    const r = await request(CamCommands.getRecordHours(auth, d.key), CMD.GET_RECORD_HOURS);
    const list = r ? parseRecordHours(r) : [];
    setHours(list);
    return list;
  };

  const loadFiles = async (d: RecordDay, h: number) => {
    const r = await request(CamCommands.getRecordFiles(auth, hourKey(d.key, h)), CMD.GET_RECORD_FILES);
    const {files} = r ? parseRecordFiles(r) : {files: [] as string[]};
    setFilesByHour(prev => ({...prev, [h]: files}));
    return files;
  };

  useEffect(() => {
    if (online && step === 'days') {
      loadDays(year);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, year]);

  const openDay = (d: RecordDay) => {
    setDay(d);
    setFilesByHour({});
    setOpenHour(null);
    setMessage(null);
    setStep('day');
    loadHours(d);
  };

  const toggleHour = async (h: number) => {
    if (openHour === h) {
      setOpenHour(null);
      return;
    }
    setOpenHour(h);
    if (day && !filesByHour[h]) {
      setBusyHour(h);
      await loadFiles(day, h);
      setBusyHour(null);
    }
  };

  // ---- player ----
  const stopPlayer = () => {
    if (playing.current) {
      send(CamCommands.stopRecordFile(auth));
      CameraModule.stopPlayback(did);
      CameraModule.setAudioOutput(false);
      playing.current = null;
    }
  };

  const playFile = async (name: string) => {
    stopPlayer();
    setProgress(null);
    setPaused(false);
    advanced.current = false;
    playing.current = name;
    await CameraModule.startPlayback(did, name);
    CameraModule.setPlaybackSpeed(did, speed);
    if (sound) {
      await CameraModule.setAudioOutput(true);
    }
    send(CamCommands.playRecordAudio(auth, name, sound && speed === 1));
    send(CamCommands.playRecordFile(auth, name));
    logAction(camera, 'playback', {file: name});
  };

  /** Watch a whole hour: its files play one after another. */
  const watchHour = async (h: number, startAt = 0) => {
    if (!day) {
      return;
    }
    setBusyHour(h);
    const files = filesByHour[h] ?? (await loadFiles(day, h));
    setBusyHour(null);
    if (files.length === 0) {
      setMessage('Nenhum arquivo nesta hora.');
      return;
    }
    setPlaylist({hour: h, files});
    setIndex(startAt);
    setStep('player');
    playFile(files[startAt]);
  };

  const goTo = (i: number) => {
    if (!playlist || i < 0 || i >= playlist.files.length) {
      return;
    }
    setIndex(i);
    playFile(playlist.files[i]);
  };

  // auto-advance to the next file at the end of the current one
  useEffect(() => {
    if (!playlist || !progress || progress.total <= 0 || advanced.current) {
      return;
    }
    if (progress.frame >= progress.total - 1) {
      advanced.current = true;
      const t = setTimeout(() => {
        if (index + 1 < playlist.files.length) {
          goTo(index + 1);
        } else {
          setMessage('Fim desta hora.');
        }
      }, 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const togglePause = () => {
    if (!playing.current) {
      return;
    }
    const next = !paused;
    send(next ? CamCommands.pauseRecordFile(auth, playing.current) : CamCommands.resumeRecordFile(auth, playing.current));
    CameraModule.setPlaybackPaused(did, next);
    setPaused(next);
  };

  const changeSpeed = (s: (typeof SPEEDS)[number]) => {
    setSpeed(s);
    CameraModule.setPlaybackSpeed(did, s);
    // sound only makes sense at normal speed
    if (playing.current) {
      send(CamCommands.playRecordAudio(auth, playing.current, sound && s === 1));
    }
    CameraModule.setAudioOutput(sound && s === 1);
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    CameraModule.setAudioOutput(next && speed === 1);
    if (playing.current) {
      send(CamCommands.playRecordAudio(auth, playing.current, next && speed === 1));
    }
  };

  // ---- delete ----
  const deleteFiles = async (files: string[]) => {
    for (const f of files) {
      await request(CamCommands.deleteRecordFile(auth, f), CMD.PLAY_RECORD_FILE, DELETE_TIMEOUT_MS);
    }
  };

  const deleteHour = (h: number) =>
    Alert.alert('Apagar hora', `Apagar todas as gravações de ${hourLabel(h)}? Não tem como desfazer.`, [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          if (!day) {
            return;
          }
          setBusyHour(h);
          setMessage(null);
          const files = filesByHour[h] ?? (await loadFiles(day, h));
          await deleteFiles(files);
          const remaining = await loadFiles(day, h);
          const hoursNow = await loadHours(day);
          setBusyHour(null);
          if (remaining.length > 0 && hoursNow.includes(h)) {
            setMessage(
              remaining.length === files.length
                ? 'A câmera não permitiu apagar arquivos individuais. Para liberar espaço, use “Formatar cartão” (apaga tudo) ou deixe ela sobrescrever as mais antigas.'
                : `Apagados ${files.length - remaining.length} de ${files.length} arquivos.`,
            );
          } else {
            setMessage(`✓ ${hourLabel(h)} apagada.`);
            setOpenHour(null);
          }
        },
      },
    ]);

  const deleteOne = (h: number, f: string) =>
    Alert.alert('Apagar arquivo', `Apagar ${fileLabel(f)}?`, [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          if (!day) {
            return;
          }
          setBusyHour(h);
          await deleteFiles([f]);
          const remaining = await loadFiles(day, h);
          setBusyHour(null);
          setMessage(
            remaining.includes(f)
              ? 'A câmera não permitiu apagar este arquivo. Use “Formatar cartão” para apagar tudo.'
              : '✓ Arquivo apagado.',
          );
          if (remaining.length === 0) {
            loadHours(day);
          }
        },
      },
    ]);

  // ---- navigation ----
  const goBack = () => {
    if (step === 'player') {
      stopPlayer();
      setStep('day');
    } else if (step === 'day') {
      setStep('days');
    } else {
      onBack();
    }
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBackRef.current();
      return true;
    });
    return () => {
      sub.remove();
      stopPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title =
    step === 'days' ? `Gravações · ${camera.name}` : step === 'day' && day ? dayLabel(day.date) : playlist ? hourLabel(playlist.hour) : '';
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.frame * 100) / progress.total) : 0;
  const currentFile = playlist?.files[index];

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {step === 'player' && playlist && (
        <View>
          <View style={styles.videoBox}>
            <CameraView
              did={`${did}#pb`}
              resizeMode="contain"
              imageRotation={rotation}
              style={StyleSheet.absoluteFill}
            />
            {!progress && (
              <View style={styles.overlay}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[ui.text, {marginTop: 10}]}>Abrindo gravação…</Text>
              </View>
            )}
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, {width: `${pct}%`}]} />
          </View>
          <Text style={[ui.muted, styles.center]}>
            Arquivo {index + 1} de {playlist.files.length}
            {currentFile ? ` · ${fileLabel(currentFile)}` : ''}
          </Text>

          <View style={styles.row}>
            <Pressable style={[ui.buttonGhost, styles.flex]} disabled={index <= 0} onPress={() => goTo(index - 1)}>
              <Text style={[ui.text, index <= 0 && styles.dim]}>⏮</Text>
            </Pressable>
            <Pressable style={[ui.button, styles.flex2]} onPress={togglePause}>
              <Text style={ui.buttonText}>{paused ? '▶ Continuar' : '⏸ Pausar'}</Text>
            </Pressable>
            <Pressable
              style={[ui.buttonGhost, styles.flex]}
              disabled={index >= playlist.files.length - 1}
              onPress={() => goTo(index + 1)}>
              <Text style={[ui.text, index >= playlist.files.length - 1 && styles.dim]}>⏭</Text>
            </Pressable>
          </View>

          <View style={styles.row}>
            <View style={styles.segment}>
              {SPEEDS.map(s => (
                <Pressable key={s} onPress={() => changeSpeed(s)} style={[styles.segItem, speed === s && styles.segActive]}>
                  <Text style={[ui.text, speed === s && styles.segTextActive]}>{s}x</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={[ui.buttonGhost, styles.flex]} onPress={toggleSound}>
              <Text style={ui.text}>{sound && speed === 1 ? '🔊' : '🔇'}</Text>
            </Pressable>
          </View>
          {speed > 1 && (
            <Text style={[ui.muted, styles.center]}>Som desligado na velocidade {speed}x.</Text>
          )}
          {message && <Text style={[ui.text, styles.center, {marginTop: 8}]}>{message}</Text>}
        </View>
      )}

      {step !== 'player' && (
        <ScrollView contentContainerStyle={{padding: 16, gap: 10}}>
          {!online && <LoadingCard text={statusLabel(status)} />}

          {online && step === 'days' && (
            <>
              <View style={styles.yearRow}>
                {[thisYear, thisYear - 1].map(y => (
                  <Pressable
                    key={y}
                    onPress={() => setYear(y)}
                    style={[ui.buttonGhost, styles.flex, y === year && {borderColor: colors.primary}]}>
                    <Text style={ui.text}>{y}</Text>
                  </Pressable>
                ))}
              </View>
              {days === null ? (
                <LoadingCard text="Consultando o cartão…" />
              ) : days.length === 0 ? (
                <EmptyCard text={`Nenhuma gravação em ${year}. Confira se há um cartão na câmera (tela “Cartão de memória”).`} />
              ) : (
                days.map(d => (
                  <Pressable key={d.key} style={ui.card} onPress={() => openDay(d)}>
                    <Text style={ui.text}>📅 {dayLabel(d.date)}</Text>
                  </Pressable>
                ))
              )}
            </>
          )}

          {online && step === 'day' && (
            <>
              {message && <Text style={ui.text}>{message}</Text>}
              {hours === null ? (
                <LoadingCard text="Carregando horários…" />
              ) : hours.length === 0 ? (
                <EmptyCard text="Nenhuma gravação neste dia." />
              ) : (
                hours.map(h => {
                  const files = filesByHour[h];
                  const expanded = openHour === h;
                  return (
                    <View key={h} style={ui.card}>
                      <Pressable onPress={() => toggleHour(h)} style={styles.hourHead}>
                        <View style={styles.flex}>
                          <Text style={[ui.text, styles.hourTitle]}>🕒 {hourLabel(h)}</Text>
                          <Text style={ui.muted}>
                            {files ? `${files.length} arquivo(s)` : 'Toque para ver os arquivos'}
                          </Text>
                        </View>
                        {busyHour === h && <ActivityIndicator color={colors.primary} />}
                      </Pressable>
                      <View style={styles.hourActions}>
                        <Pressable style={[ui.button, styles.flex2]} onPress={() => watchHour(h)} disabled={busyHour !== null}>
                          <Text style={ui.buttonText}>▶ Assistir</Text>
                        </Pressable>
                        <Pressable
                          style={[ui.buttonGhost, styles.flex, styles.danger]}
                          onPress={() => deleteHour(h)}
                          disabled={busyHour !== null}>
                          <Text style={[ui.text, {color: colors.danger}]}>🗑 Apagar</Text>
                        </Pressable>
                      </View>
                      {expanded &&
                        files?.map((f, i) => (
                          <View key={f} style={styles.fileRow}>
                            <Pressable style={styles.flex} onPress={() => watchHour(h, i)}>
                              <Text style={ui.text}>▶ {fileLabel(f)}</Text>
                            </Pressable>
                            <Pressable onPress={() => deleteOne(h, f)} hitSlop={10}>
                              <Text style={{color: colors.danger}}>🗑</Text>
                            </Pressable>
                          </View>
                        ))}
                    </View>
                  );
                })
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  videoBox: {width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000'},
  overlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center'},
  bar: {height: 4, backgroundColor: colors.card},
  barFill: {height: 4, backgroundColor: colors.primary},
  center: {textAlign: 'center', marginTop: 6},
  row: {flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, alignItems: 'center'},
  flex: {flex: 1},
  flex2: {flex: 2},
  dim: {opacity: 0.4},
  segment: {flex: 3, flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden'},
  segItem: {flex: 1, paddingVertical: 10, alignItems: 'center'},
  segActive: {backgroundColor: colors.primary},
  segTextActive: {color: '#fff', fontWeight: '700'},
  yearRow: {flexDirection: 'row', gap: 10, marginBottom: 4},
  hourHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  hourTitle: {fontWeight: '700', fontSize: 16},
  hourActions: {flexDirection: 'row', gap: 8, marginTop: 12},
  danger: {borderColor: colors.danger},
  fileRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8},
});
