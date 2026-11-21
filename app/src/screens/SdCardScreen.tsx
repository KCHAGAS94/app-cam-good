import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {CamCommands, CMD} from '../camera/commands';
import {CameraModule, onMessage, parseReply, statusLabel} from '../camera/native';
import {useCameraSession} from '../camera/useCameraSession';
import {SavedCamera} from '../storage';
import {colors, ui} from '../theme';

type Props = {camera: SavedCamera; onBack: () => void};

type SdInfo = {total: number; free: number; raw: Record<string, any>};

const FORMAT_TIMEOUT_MS = 60_000;

/** "29.7 GB" / "512 MB" from a value in MB. */
function size(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/**
 * Memory card: capacity, format, and the recording options this camera reports.
 * (For PIXB cameras the vendor app only shows capacity + format; recording options
 * appear here only if the camera answers get_record_param.)
 */
export default function SdCardScreen({camera, onBack}: Props) {
  const {did} = camera;
  const auth = {user: camera.user, pwd: camera.pwd};
  const {status, online} = useCameraSession(camera);
  const [sd, setSd] = useState<SdInfo | null>(null);
  const [rec, setRec] = useState<Record<string, any> | null>(null);
  const [formatting, setFormatting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastRaw, setLastRaw] = useState('');

  const send = (json: string) => CameraModule.send(did, json);
  const refresh = () => {
    send(CamCommands.getSdCard(auth));
    send(CamCommands.getRecordParams(auth));
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
      if (r.cmd === CMD.GET_SD || r.cmd === CMD.SET_SD || r.cmd === CMD.GET_RECORD_PARAMS || r.cmd === CMD.SET_RECORD_PARAMS) {
        setLastRaw(e.json);
      }
      if (r.cmd === CMD.GET_SD) {
        setSd({total: Number(r.total ?? 0), free: Number(r.free ?? 0), raw: r});
      } else if (r.cmd === CMD.SET_SD) {
        setFormatting(false);
        setMessage(Number(r.result) >= 0 ? '✓ Cartão formatado.' : `A câmera recusou (código ${r.result}).`);
        send(CamCommands.getSdCard(auth));
      } else if (r.cmd === CMD.GET_RECORD_PARAMS && Number(r.result ?? 0) >= 0) {
        setRec(r);
      } else if (r.cmd === CMD.SET_RECORD_PARAMS) {
        setMessage(Number(r.result) >= 0 ? '✓ Configuração salva.' : `A câmera recusou (código ${r.result}).`);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [did]);

  useEffect(() => {
    if (online) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // some firmwares don't answer the format command: stop the spinner and re-read the card
  useEffect(() => {
    if (!formatting) {
      return;
    }
    const t = setTimeout(() => {
      setFormatting(false);
      send(CamCommands.getSdCard(auth));
    }, FORMAT_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatting]);

  const confirmFormat = () =>
    Alert.alert('Formatar cartão', 'Todas as gravações do cartão serão apagadas. Continuar?', [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Formatar',
        style: 'destructive',
        onPress: () => {
          setMessage(null);
          setFormatting(true);
          send(CamCommands.formatSdCard(auth));
        },
      },
    ]);

  /** Change one recording option and send the full parameter set back. */
  const setRecField = (field: string, value: number) => {
    if (!rec) {
      return;
    }
    const next = {...rec, [field]: value};
    setRec(next);
    setMessage(null);
    send(CamCommands.setRecordParams(auth, next));
  };

  const inserted = sd !== null && sd.total > 0;
  const usedPct = inserted ? Math.round(((sd!.total - sd!.free) * 100) / sd!.total) : 0;

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title}>Cartão de memória</Text>
      </View>

      <ScrollView contentContainerStyle={{padding: 16, gap: 14}}>
        {!online && (
          <View style={[ui.card, {gap: 10, alignItems: 'center'}]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={ui.text}>{statusLabel(status)}</Text>
          </View>
        )}

        {online && (
          <View style={[ui.card, {gap: 10}]}>
            {sd === null ? (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={[ui.muted, {textAlign: 'center'}]}>Consultando o cartão…</Text>
              </>
            ) : !inserted ? (
              <>
                <Text style={[ui.text, {fontWeight: '600'}]}>Nenhum cartão encontrado</Text>
                <Text style={ui.muted}>
                  Desligue a câmera, coloque o cartão microSD (até 128 GB, de preferência classe 10)
                  e ligue de novo.
                </Text>
              </>
            ) : (
              <>
                <Text style={[ui.text, {fontWeight: '600'}]}>Cartão inserido</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, {width: `${usedPct}%`}]} />
                </View>
                <Text style={ui.muted}>
                  {usedPct}% usado · {size(sd.free)} livres de {size(sd.total)}
                </Text>
              </>
            )}
            <Pressable onPress={refresh} hitSlop={8}>
              <Text style={ui.link}>Atualizar</Text>
            </Pressable>
          </View>
        )}

        {online && inserted && rec && (
          <View style={[ui.card, {gap: 14}]}>
            <Text style={[ui.text, {fontWeight: '600'}]}>Gravação</Text>
            {rec.recordcov !== undefined && (
              <View style={styles.row}>
                <Text style={[ui.text, {flex: 1}]}>Sobrescrever as mais antigas quando encher</Text>
                <Switch
                  value={Number(rec.recordcov) === 1}
                  onValueChange={v => setRecField('recordcov', v ? 1 : 0)}
                  trackColor={{true: colors.primary}}
                />
              </View>
            )}
            {rec.recordAudio !== undefined && (
              <View style={styles.row}>
                <Text style={[ui.text, {flex: 1}]}>Gravar áudio</Text>
                <Switch
                  value={Number(rec.recordAudio) === 1}
                  onValueChange={v => setRecField('recordAudio', v ? 1 : 0)}
                  trackColor={{true: colors.primary}}
                />
              </View>
            )}
          </View>
        )}

        {online && inserted && (
          <Pressable
            style={[ui.buttonGhost, {borderColor: colors.danger}, formatting && {opacity: 0.5}]}
            disabled={formatting}
            onPress={confirmFormat}>
            {formatting ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={[ui.text, {color: colors.danger}]}>Formatar cartão</Text>
            )}
          </Pressable>
        )}

        {message && <Text style={[ui.text, {textAlign: 'center'}]}>{message}</Text>}

        {lastRaw !== '' && (
          <Text style={[ui.muted, {fontSize: 11}]} selectable>
            Detalhes técnicos: {lastRaw.slice(0, 300)}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: 'hidden'},
  barFill: {height: 10, backgroundColor: colors.primary},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
});
