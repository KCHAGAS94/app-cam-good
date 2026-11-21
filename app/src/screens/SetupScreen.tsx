import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {CamCommands} from '../camera/commands';
import {
  CameraModule,
  onMessage,
  onSearchResult,
  onStatus,
  parseReply,
  SearchEvent,
  Status,
  statusLabel,
} from '../camera/native';
import {askWifiPermissions} from '../camera/permissions';
import {acquire, getState, reconnect} from '../camera/sessionManager';
import {getAccount, registerCamera, ServerError, syncCameras} from '../server/account';
import {GhostButton, PrimaryButton} from '../components';
import {looks5G, parseWifiList, WifiNet} from '../camera/wifi';
import {DEFAULT_PWD, DEFAULT_USER, saveCamera} from '../storage';
import {colors, ui} from '../theme';

type Props = {onDone: () => void};

type Mode = 'hotspot' | 'lan' | 'manual';
type Step =
  | 'choose'
  | 'join-hotspot'
  | 'searching'
  | 'pick'
  | 'login'
  | 'wifi'
  | 'wifi-sent'
  | 'verify'
  | 'save';

/** How long to keep retrying to reach the camera on the home Wi-Fi after setup. */
const VERIFY_TIMEOUT_MS = 150_000;

export default function SetupScreen({onDone}: Props) {
  const [mode, setMode] = useState<Mode>('hotspot');
  const [step, setStep] = useState<Step>('choose');
  const [ssidNow, setSsidNow] = useState('');
  const [found, setFound] = useState<SearchEvent[]>([]);
  const [did, setDid] = useState('');
  const [typedDid, setTypedDid] = useState('');
  const [pwd, setPwd] = useState(DEFAULT_PWD);
  const [name, setName] = useState('Câmera');
  const [status, setStatus] = useState<number | null>(null);
  const [networks, setNetworks] = useState<WifiNet[] | null>(null);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPwd, setWifiPwd] = useState('');
  const [wifiEnc, setWifiEnc] = useState(0);
  const [showWifiPwd, setShowWifiPwd] = useState(false);
  /** Camera's answer to set_wifi: null = waiting, otherwise the parsed reply. */
  const [wifiReply, setWifiReply] = useState<Record<string, any> | null>(null);
  const [lastRaw, setLastRaw] = useState('');
  const [verified, setVerified] = useState(false);
  const [verifyGaveUp, setVerifyGaveUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedDid = useRef<string | null>(null);
  const verifyStartedAt = useRef(0);

  // ---- native events ----
  useEffect(() => {
    const subs = [
      onSearchResult(e =>
        setFound(prev => (prev.some(p => p.did === e.did) ? prev : [...prev, e])),
      ),
      onStatus(e => {
        if (e.type === 0 && e.did === connectedDid.current) {
          setStatus(e.param);
        }
      }),
      onMessage(e => {
        if (e.did !== connectedDid.current) {
          return;
        }
        setLastRaw(e.json);
        const reply = parseReply(e.json);
        if (reply?.pro === 'mj_other_login') {
          setError(
            'A câmera está conectada em outro app ou aparelho (ex.: PIX-LINK CAM). Feche o outro app; o CamGood tenta de novo sozinho.',
          );
        } else if (reply?.cmd === 113) {
          setError(null);
          setNetworks(Number(reply.result ?? 0) >= 0 ? parseWifiList(reply) : []);
        } else if (reply?.cmd === 114) {
          setWifiReply(reply);
        }
      }),
    ];
    return () => {
      subs.forEach(s => s.remove());
      CameraModule.bindToWifi(false);
      releaseSession.current?.();
    };
  }, []);

  /** Use the shared session (sessionManager) so other screens don't open a second login. */
  const releaseSession = useRef<(() => void) | null>(null);
  const holdSession = (id: string, password: string) => {
    releaseSession.current?.();
    releaseSession.current = acquire({did: id, user: DEFAULT_USER, pwd: password});
    setStatus(getState(id).status);
  };

  // When the camera comes online during setup, ask it for the Wi-Fi networks it can see.
  useEffect(() => {
    if (step === 'login' && status === Status.ONLINE) {
      if (mode === 'hotspot') {
        setStep('wifi');
        CameraModule.send(did, CamCommands.scanWifi({user: DEFAULT_USER, pwd}));
      } else {
        setStep('save');
      }
    }
  }, [status, step, mode, did, pwd]);

  // Verification on the home Wi-Fi: wait for ONLINE, retrying while the camera reboots/joins.
  useEffect(() => {
    if (step !== 'verify' || verified) {
      return;
    }
    if (status === Status.ONLINE) {
      setVerified(true);
      return;
    }
    const failedNow =
      status !== null &&
      ([Status.FAILED, Status.OFFLINE, Status.TIMEOUT, Status.ERROR, Status.DISCONNECTED] as number[]).includes(
        status,
      );
    if (!failedNow) {
      return;
    }
    // the session manager keeps retrying every few seconds; we only decide when to give up
    if (Date.now() - verifyStartedAt.current > VERIFY_TIMEOUT_MS) {
      setVerifyGaveUp(true);
    }
  }, [step, status, verified]);

  // ---- actions ----
  const refreshNetworkInfo = async () => {
    await askWifiPermissions();
    const info = await CameraModule.getNetworkInfo();
    setSsidNow(info.ssid);
    return info;
  };

  const runSearch = async () => {
    setError(null);
    setFound([]);
    setStep('searching');
    await CameraModule.search(4000);
    setStep('pick');
  };

  const startHotspotFlow = async () => {
    const info = await refreshNetworkInfo();
    if (info.ssid && !info.ssid.toUpperCase().startsWith('PIX')) {
      setError(
        `Seu celular está na rede "${info.ssid}". Conecte-se à rede da câmera (começa com PIXB-) e tente de novo.`,
      );
      return;
    }
    await CameraModule.bindToWifi(true);
    // On the hotspot the camera ID is the network name itself (vendor app does the same).
    if (info.ssid) {
      login(info.ssid);
      return;
    }
    // Android didn't give us the network name (permission denied): try a LAN search,
    // and the "pick" step also lets the user type the PIXB-... name.
    runSearch();
  };

  const login = (targetDid: string) => {
    const id = targetDid.trim();
    if (!id) {
      return;
    }
    setDid(id);
    connectedDid.current = id;
    setStep('login');
    holdSession(id, pwd);
  };

  const sendWifi = () => {
    if (!wifiSsid) {
      return;
    }
    setWifiReply(null);
    CameraModule.send(did, CamCommands.setWifi({user: DEFAULT_USER, pwd}, wifiSsid, wifiPwd, wifiEnc));
    setStep('wifi-sent');
    // give the command time to reach the camera, then release the hotspot binding
    setTimeout(() => CameraModule.bindToWifi(false), 3000);
  };

  /** Phone is back on the home Wi-Fi: reconnect to the camera through it. */
  const startVerify = async () => {
    setError(null);
    const info = await refreshNetworkInfo();
    if (info.ssid.toUpperCase().startsWith('PIX')) {
      setError('O celular ainda está na rede da câmera. Conecte no Wi-Fi da sua casa e tente de novo.');
      return;
    }
    await CameraModule.bindToWifi(false);
    setVerified(false);
    setVerifyGaveUp(false);
    verifyStartedAt.current = Date.now();
    setStatus(Status.CONNECTING);
    setStep('verify');
    if (!releaseSession.current) {
      holdSession(did, pwd);
    }
    reconnect(did); // drop the old hotspot path and connect through the home Wi-Fi
  };

  const retryVerify = () => {
    setVerifyGaveUp(false);
    verifyStartedAt.current = Date.now();
    setStatus(Status.CONNECTING);
    reconnect(did);
  };

  const finish = async () => {
    const cam = {did: did.trim(), name: name.trim() || 'Câmera', user: DEFAULT_USER, pwd};
    await saveCamera(cam);
    // admins logged into the central server also register the camera there
    const account = getAccount();
    if (account?.user.role === 'admin') {
      try {
        await registerCamera(cam);
      } catch (e: any) {
        if (!(e instanceof ServerError && e.status === 409)) {
          // 409 = already registered; anything else: keep it on the phone and tell the user
          Alert.alert('Servidor', `A câmera foi salva no celular, mas não no servidor: ${e.message}`);
        }
      }
      await syncCameras().catch(() => {});
    }
    onDone();
  };

  // ---- UI ----

  const failed =
    status !== null &&
    ([Status.FAILED, Status.INVALID_ID, Status.OFFLINE, Status.TIMEOUT, Status.ERROR] as number[]).includes(
      status,
    );

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onDone} hitSlop={12}>
          <Text style={ui.link}>‹ Cancelar</Text>
        </Pressable>
        <Text style={ui.title}>Adicionar câmera</Text>
      </View>

      <ScrollView contentContainerStyle={{padding: 16, gap: 14}} keyboardShouldPersistTaps="handled">
        {error && (
          <View style={[ui.card, {borderColor: colors.danger}]}>
            <Text style={ui.text}>{error}</Text>
          </View>
        )}

        {step === 'choose' && (
          <>
            <Pressable
              style={ui.card}
              onPress={() => {
                setMode('hotspot');
                setStep('join-hotspot');
              }}>
              <Text style={[ui.text, {fontWeight: '600'}]}>Câmera nova</Text>
              <Text style={[ui.muted, {marginTop: 4}]}>
                Conecta na rede da câmera (PIXB-…) e envia a senha do seu Wi-Fi para ela.
              </Text>
            </Pressable>
            <Pressable
              style={ui.card}
              onPress={() => {
                setMode('lan');
                runSearch();
              }}>
              <Text style={[ui.text, {fontWeight: '600'}]}>Câmera já está no meu Wi-Fi</Text>
              <Text style={[ui.muted, {marginTop: 4}]}>Procura a câmera na sua rede.</Text>
            </Pressable>
            <Pressable
              style={ui.card}
              onPress={() => {
                setMode('manual');
                setStep('save');
              }}>
              <Text style={[ui.text, {fontWeight: '600'}]}>Digitar o ID</Text>
              <Text style={[ui.muted, {marginTop: 4}]}>Se você já sabe o ID (começa com PIXB).</Text>
            </Pressable>
          </>
        )}

        {step === 'join-hotspot' && (
          <View style={[ui.card, {gap: 12}]}>
            <Text style={ui.text}>1. Rosqueie a câmera no bocal e espere a luz piscar.</Text>
            <Text style={ui.text}>
              2. Se ela não criar a rede, segure o botão RESET por 10 segundos.
            </Text>
            <Text style={ui.text}>
              3. Nas configurações de Wi-Fi do celular, conecte na rede que começa com{' '}
              <Text style={{fontWeight: '700'}}>PIXB-</Text> (não tem senha).
            </Text>
            <Text style={ui.muted}>
              Se o Android avisar que a rede “não tem internet”, escolha manter a conexão.
            </Text>
            {ssidNow ? <Text style={ui.muted}>Rede atual: {ssidNow}</Text> : null}
            <GhostButton label="Abrir configurações de Wi-Fi" onPress={() => Linking.sendIntent('android.settings.WIFI_SETTINGS')} />
            <PrimaryButton label="Já conectei, procurar câmera" onPress={startHotspotFlow} />
          </View>
        )}

        {step === 'searching' && (
          <View style={[ui.card, {alignItems: 'center', gap: 12}]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={ui.text}>Procurando câmeras na rede…</Text>
          </View>
        )}

        {step === 'pick' && (
          <View style={{gap: 12}}>
            {found.length === 0 ? (
              <View style={[ui.card, {gap: 8}]}>
                <Text style={ui.text}>Nenhuma câmera encontrada.</Text>
                <Text style={ui.muted}>
                  {mode === 'hotspot'
                    ? 'Confirme que o celular está na rede PIXB- da câmera.'
                    : 'Confirme que a câmera e o celular estão no mesmo Wi-Fi.'}
                </Text>
              </View>
            ) : (
              found.map(f => (
                <Pressable key={f.did} style={ui.card} onPress={() => login(f.did)}>
                  <Text style={[ui.text, {fontWeight: '600'}]}>{f.did}</Text>
                  <Text style={ui.muted}>{f.ip}</Text>
                </Pressable>
              ))
            )}
            <GhostButton label="Procurar de novo" onPress={runSearch} />
            {mode === 'hotspot' && (
              <View style={[ui.card, {gap: 10}]}>
                <Text style={ui.muted}>
                  Ou digite o nome da rede da câmera (é o ID dela), ex.: PIXB-HCAM12345678ABCDE
                </Text>
                <TextInput
                  style={ui.input}
                  value={typedDid}
                  onChangeText={setTypedDid}
                  autoCapitalize="characters"
                  placeholder="PIXB-..."
                  placeholderTextColor={colors.muted}
                />
                <PrimaryButton label="Conectar" onPress={() => login(typedDid)} disabled={!typedDid.trim()} />
              </View>
            )}
          </View>
        )}

        {step === 'login' && (
          <View style={[ui.card, {gap: 12}]}>
            <Text style={ui.text}>Conectando em {did}…</Text>
            {!failed && <ActivityIndicator color={colors.primary} />}
            <Text style={ui.muted}>{statusLabel(status ?? undefined)}</Text>
            {failed && (
              <>
                <Text style={ui.muted}>Senha da câmera (padrão 6666):</Text>
                <TextInput style={ui.input} value={pwd} onChangeText={setPwd} autoCapitalize="none" />
                <PrimaryButton label="Tentar de novo" onPress={() => login(did)} />
              </>
            )}
          </View>
        )}

        {step === 'wifi' && (
          <View style={[ui.card, {gap: 12}]}>
            <Text style={[ui.text, {fontWeight: '600'}]}>Escolha o Wi-Fi da sua casa</Text>
            <Text style={ui.muted}>A câmera só funciona em redes 2.4 GHz (evite as que terminam em “5G”).</Text>
            {networks === null ? (
              <ActivityIndicator color={colors.primary} />
            ) : networks.length === 0 ? (
              <Text style={ui.muted}>A câmera não listou redes. Digite o nome abaixo.</Text>
            ) : (
              networks.map(n => (
                <Pressable
                  key={n.ssid}
                  onPress={() => {
                    setWifiSsid(n.ssid);
                    setWifiEnc(n.encryption);
                  }}
                  style={[
                    ui.buttonGhost,
                    {alignItems: 'flex-start', paddingHorizontal: 12},
                    wifiSsid === n.ssid && {borderColor: colors.primary},
                  ]}>
                  <Text style={ui.text}>{n.ssid}</Text>
                </Pressable>
              ))
            )}
            <Text style={ui.muted}>Nome da rede</Text>
            <TextInput style={ui.input} value={wifiSsid} onChangeText={setWifiSsid} autoCapitalize="none" />
            {looks5G(wifiSsid) && (
              <Text style={[ui.muted, {color: colors.warn}]}>
                Essa parece ser uma rede 5G. A câmera provavelmente não vai conseguir entrar nela.
              </Text>
            )}
            <Text style={ui.muted}>Senha do Wi-Fi</Text>
            <TextInput
              style={ui.input}
              value={wifiPwd}
              onChangeText={setWifiPwd}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showWifiPwd}
            />
            <Pressable onPress={() => setShowWifiPwd(v => !v)} hitSlop={8}>
              <Text style={ui.link}>{showWifiPwd ? 'Ocultar senha' : 'Mostrar senha'}</Text>
            </Pressable>
            <PrimaryButton label="Enviar para a câmera" onPress={sendWifi} disabled={!wifiSsid} />
            <GhostButton
              label="Atualizar lista"
              onPress={() => {
                setNetworks(null);
                CameraModule.send(did, CamCommands.scanWifi({user: DEFAULT_USER, pwd}));
              }}
            />
          </View>
        )}

        {step === 'wifi-sent' && (
          <View style={[ui.card, {gap: 12}]}>
            <Text style={[ui.text, {fontWeight: '600'}]}>Senha enviada!</Text>
            <Text style={ui.muted}>
              {wifiReply === null
                ? 'Aguardando resposta da câmera… (às vezes ela reinicia sem responder, tudo bem)'
                : Number(wifiReply.result) >= 0
                ? '✓ A câmera confirmou o recebimento.'
                : `A câmera recusou o comando (código ${wifiReply.result}).`}
            </Text>
            <Text style={ui.text}>
              A câmera vai reiniciar e entrar no Wi-Fi “{wifiSsid}”. Isso leva cerca de 1 minuto. A
              rede PIXB- dela vai sumir.
            </Text>
            <Text style={ui.text}>Agora reconecte o celular no Wi-Fi da sua casa ({wifiSsid}).</Text>
            <GhostButton label="Abrir configurações de Wi-Fi" onPress={() => Linking.sendIntent('android.settings.WIFI_SETTINGS')} />
            <PrimaryButton label="Já voltei para o Wi-Fi de casa, verificar" onPress={startVerify} />
            <Pressable onPress={() => setStep('save')} hitSlop={8}>
              <Text style={[ui.muted, {textAlign: 'center'}]}>Pular verificação</Text>
            </Pressable>
          </View>
        )}

        {step === 'verify' && (
          <View style={[ui.card, {gap: 12}]}>
            {verified ? (
              <>
                <Text style={[ui.text, {fontWeight: '600', color: colors.ok}]}>
                  ✓ Câmera conectada pelo Wi-Fi da sua casa!
                </Text>
                <PrimaryButton label="Continuar" onPress={() => setStep('save')} />
              </>
            ) : verifyGaveUp ? (
              <>
                <Text style={[ui.text, {fontWeight: '600'}]}>Não consegui falar com a câmera.</Text>
                <Text style={ui.muted}>
                  Se a rede PIXB- da câmera voltou a aparecer, ela não conseguiu entrar no Wi-Fi
                  (senha errada ou rede 5G). Nesse caso, conecte nela de novo e refaça a
                  configuração.
                </Text>
                <PrimaryButton label="Tentar de novo" onPress={retryVerify} />
                <GhostButton label="Refazer configuração" onPress={() => setStep('join-hotspot')} />
              </>
            ) : (
              <>
                <Text style={ui.text}>Procurando a câmera pelo Wi-Fi de casa…</Text>
                <ActivityIndicator color={colors.primary} />
                <Text style={ui.muted}>
                  {statusLabel(status ?? undefined)} · pode levar até 2 minutos enquanto ela reinicia.
                </Text>
              </>
            )}
          </View>
        )}

        {lastRaw !== '' && (step === 'wifi' || step === 'wifi-sent') && (
          <Text style={[ui.muted, {fontSize: 11}]} selectable>
            Detalhes técnicos: {lastRaw.slice(0, 300)}
          </Text>
        )}

        {step === 'save' && (
          <View style={[ui.card, {gap: 12}]}>
            <Text style={ui.muted}>Nome</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} />
            <Text style={ui.muted}>ID da câmera</Text>
            <TextInput
              style={ui.input}
              value={did}
              onChangeText={setDid}
              autoCapitalize="characters"
              placeholder="PIXB-..."
              placeholderTextColor={colors.muted}
              editable={mode === 'manual'}
            />
            <Text style={ui.muted}>Senha da câmera</Text>
            <TextInput style={ui.input} value={pwd} onChangeText={setPwd} autoCapitalize="none" />
            <PrimaryButton label="Salvar câmera" onPress={finish} disabled={!did.trim()} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
