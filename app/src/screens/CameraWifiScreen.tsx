import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {CamCommands, CMD} from '../camera/commands';
import {CameraModule, onMessage, parseReply, Status, statusLabel} from '../camera/native';
import {useCameraSession} from '../camera/useCameraSession';
import {OtherLoginWarning} from '../components';
import {currentSsid, looks5G, parseWifiList, WifiNet} from '../camera/wifi';
import {SavedCamera} from '../storage';
import {colors, ui} from '../theme';

type Props = {camera: SavedCamera; onBack: () => void};

/**
 * Changes the Wi-Fi of a camera that is already online (no reset needed).
 * If the camera is offline (old network gone), the user must reset it and use "Câmera nova".
 */
export default function CameraWifiScreen({camera, onBack}: Props) {
  const {did} = camera;
  const auth = {user: camera.user, pwd: camera.pwd};
  const {status, online, otherLogin, cloud, reconnect} = useCameraSession(camera);
  const [current, setCurrent] = useState<string | null>(null);
  const [networks, setNetworks] = useState<WifiNet[] | null>(null);
  const [ssid, setSsid] = useState('');
  const [enc, setEnc] = useState(0);
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [sent, setSent] = useState(false);
  const [reply, setReply] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const sub = onMessage(e => {
      if (e.did !== did) {
        return;
      }
      const r = parseReply(e.json);
      if (r?.cmd === CMD.GET_WIFI) {
        // result < 0 = the camera refused (e.g. session not logged in yet): leave "não informada"
        setCurrent(Number(r.result ?? 0) >= 0 ? currentSsid(r) : '');
      } else if (r?.cmd === CMD.SCAN_WIFI) {
        setNetworks(Number(r.result ?? 0) >= 0 ? parseWifiList(r) : []);
      } else if (r?.cmd === CMD.SET_WIFI) {
        setReply(r);
      }
    });
    return () => sub.remove();
  }, [did]);

  // ask current network + nearby networks every time the shared session is (re)online
  useEffect(() => {
    if (online) {
      CameraModule.send(did, CamCommands.getWifi(auth));
      CameraModule.send(did, CamCommands.scanWifi(auth));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, did]);

  const refresh = () => {
    setNetworks(null);
    CameraModule.send(did, CamCommands.scanWifi(auth));
  };

  const confirmSend = () => {
    Alert.alert(
      'Trocar Wi-Fi da câmera',
      `A câmera vai reiniciar e tentar entrar em “${ssid}”.\n\nSe a senha estiver errada, ela fica offline e será preciso resetar (10 s no botão) e configurar como câmera nova.`,
      [
        {text: 'Cancelar', style: 'cancel'},
        {
          text: 'Trocar',
          onPress: () => {
            setReply(null);
            CameraModule.send(did, CamCommands.setWifi(auth, ssid, password, enc));
            setSent(true);
          },
        },
      ],
    );
  };

  // "offline" only when the P2P server confirms the camera is not on the internet
  const unreachable = status === Status.INVALID_ID || (cloud !== null && !cloud.online);

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title}>Wi-Fi da câmera</Text>
      </View>

      <ScrollView contentContainerStyle={{padding: 16, gap: 14}} keyboardShouldPersistTaps="handled">
        {otherLogin && <OtherLoginWarning onRetry={reconnect} />}

        {!online && !sent && (
          <View style={[ui.card, {gap: 10}]}>
            {!unreachable && <ActivityIndicator color={colors.primary} />}
            <Text style={ui.text}>{statusLabel(status)}</Text>
            {unreachable ? (
              <Text style={ui.muted}>
                A câmera não está na internet, então não dá para trocar o Wi-Fi por aqui. Se ela
                ainda não foi configurada, use “Adicionar → Câmera nova” com o celular na rede
                PIXB- dela. Se ela estava num Wi-Fi que mudou, segure o RESET por 10 segundos e faça
                o mesmo.
              </Text>
            ) : (
              <Text style={ui.muted}>Tentando de novo…</Text>
            )}
          </View>
        )}

        {online && !sent && (
          <>
            <View style={ui.card}>
              <Text style={ui.muted}>Rede atual da câmera</Text>
              <Text style={[ui.text, {fontWeight: '600', marginTop: 4}]}>
                {current === null ? 'consultando…' : current || 'não informada'}
              </Text>
            </View>

            <View style={[ui.card, {gap: 12}]}>
              <Text style={[ui.text, {fontWeight: '600'}]}>Nova rede</Text>
              <Text style={ui.muted}>Só redes 2.4 GHz funcionam.</Text>
              {networks === null ? (
                <ActivityIndicator color={colors.primary} />
              ) : networks.length === 0 ? (
                <Text style={ui.muted}>A câmera não listou redes. Digite o nome abaixo.</Text>
              ) : (
                networks.map(n => (
                  <Pressable
                    key={n.ssid}
                    onPress={() => {
                      setSsid(n.ssid);
                      setEnc(n.encryption);
                    }}
                    style={[
                      ui.buttonGhost,
                      {alignItems: 'flex-start', paddingHorizontal: 12},
                      ssid === n.ssid && {borderColor: colors.primary},
                    ]}>
                    <Text style={ui.text}>
                      {n.ssid}
                      {n.ssid === current ? '  (atual)' : ''}
                    </Text>
                  </Pressable>
                ))
              )}
              <Text style={ui.muted}>Nome da rede</Text>
              <TextInput style={ui.input} value={ssid} onChangeText={setSsid} autoCapitalize="none" />
              {looks5G(ssid) && (
                <Text style={[ui.muted, {color: colors.warn}]}>
                  Essa parece ser uma rede 5G. A câmera provavelmente não vai conseguir entrar nela.
                </Text>
              )}
              <Text style={ui.muted}>Senha do Wi-Fi</Text>
              <TextInput
                style={ui.input}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPwd}
              />
              <Pressable onPress={() => setShowPwd(v => !v)} hitSlop={8}>
                <Text style={ui.link}>{showPwd ? 'Ocultar senha' : 'Mostrar senha'}</Text>
              </Pressable>
              <Pressable
                style={[ui.button, !ssid && {opacity: 0.5}]}
                disabled={!ssid}
                onPress={confirmSend}>
                <Text style={ui.buttonText}>Trocar Wi-Fi</Text>
              </Pressable>
              <Pressable style={ui.buttonGhost} onPress={refresh}>
                <Text style={ui.text}>Atualizar lista</Text>
              </Pressable>
            </View>
          </>
        )}

        {sent && (
          <View style={[ui.card, {gap: 12}]}>
            <Text style={[ui.text, {fontWeight: '600'}]}>Pedido enviado</Text>
            <Text style={ui.muted}>
              {reply === null
                ? 'Aguardando resposta da câmera…'
                : Number(reply.result) >= 0
                ? '✓ A câmera confirmou o recebimento.'
                : `A câmera recusou o comando (código ${reply.result}).`}
            </Text>
            <Text style={ui.text}>
              Ela vai reiniciar e entrar em “{ssid}” em cerca de 1 minuto. Depois disso, abra a câmera
              na lista normalmente. Se ela não voltar, resete e configure como câmera nova.
            </Text>
            <Pressable style={ui.button} onPress={onBack}>
              <Text style={ui.buttonText}>Voltar</Text>
            </Pressable>
          </View>
        )}

      </ScrollView>
    </View>
  );
}
