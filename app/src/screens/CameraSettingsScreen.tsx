import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {CamCommands, CMD} from '../camera/commands';
import {CameraModule, onMessage, parseReply, statusLabel} from '../camera/native';
import {useCameraSession} from '../camera/useCameraSession';
import {pushCameraPassword} from '../server/account';
import {isDefaultPassword, SavedCamera, updateCamera, validateCameraPassword} from '../storage';
import {colors, ui} from '../theme';

type Props = {camera: SavedCamera; onBack: () => void; onSaved: () => void};

/** Wait this long for the edit_user reply before rebooting anyway (vendor app waits 500 ms). */
const REPLY_WAIT_MS = 4000;

export default function CameraSettingsScreen({camera, onBack, onSaved}: Props) {
  const {did} = camera;
  const auth = {user: camera.user, pwd: camera.pwd};
  const {status, online} = useCameraSession(camera);

  const [name, setName] = useState(camera.name);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savedPwd, setSavedPwd] = useState(camera.pwd);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const replyResolver = useRef<((r: Record<string, any> | null) => void) | null>(null);

  useEffect(() => {
    const sub = onMessage(e => {
      if (e.did !== did) {
        return;
      }
      const r = parseReply(e.json);
      if (r?.cmd === CMD.EDIT_USER && replyResolver.current) {
        replyResolver.current(r);
        replyResolver.current = null;
      }
    });
    return () => sub.remove();
  }, [did]);

  const waitEditReply = () =>
    new Promise<Record<string, any> | null>(resolve => {
      replyResolver.current = resolve;
      setTimeout(() => {
        if (replyResolver.current === resolve) {
          replyResolver.current = null;
          resolve(null);
        }
      }, REPLY_WAIT_MS);
    });

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    await updateCamera(did, {name: trimmed});
    setMessage('✓ Nome salvo.');
  };

  const pwdError = newPwd ? validateCameraPassword(newPwd) : null;
  const mismatch = confirmPwd.length > 0 && confirmPwd !== newPwd;
  const canChange = online && !busy && newPwd.length > 0 && !pwdError && confirmPwd === newPwd;

  const doChangePassword = async () => {
    setBusy(true);
    setMessage(null);
    const reply = waitEditReply();
    CameraModule.send(did, CamCommands.changePassword(auth, newPwd));
    const r = await reply;
    if (r && Number(r.result) < 0) {
      setBusy(false);
      setMessage(`A câmera recusou a troca (código ${r.result}). A senha continua a mesma.`);
      return;
    }
    // vendor flow: reboot so the new password takes effect, then save it in the app
    CameraModule.send(did, CamCommands.reboot({user: auth.user, pwd: newPwd}));
    CameraModule.send(did, CamCommands.reboot(auth));
    await updateCamera(did, {pwd: newPwd, name: name.trim() || camera.name});
    // account camera: update the central server so everyone with access keeps connecting
    const serverNote = await pushCameraPassword(camera, newPwd)
      .then(() => (camera.serverId !== undefined ? '\n\nA senha também foi atualizada no servidor.' : ''))
      .catch(() => '\n\n⚠ Não foi possível atualizar o servidor agora. Atualize a senha desta câmera no painel web.');
    setBusy(false);
    Alert.alert(
      'Senha trocada',
      'A câmera está reiniciando (cerca de 1 minuto). O app já vai usar a nova senha.\n\nAnote a senha: se esquecer, só resetando a câmera.' +
        serverNote,
      [{text: 'OK', onPress: onSaved}],
    );
  };

  const confirmChange = () =>
    Alert.alert('Trocar senha da câmera', 'A câmera vai reiniciar depois da troca. Continuar?', [
      {text: 'Cancelar', style: 'cancel'},
      {text: 'Trocar', onPress: doChangePassword},
    ]);

  /** Only fixes what the app has saved (e.g. password changed on another phone). */
  const saveStoredPassword = async () => {
    if (!savedPwd) {
      return;
    }
    await updateCamera(did, {pwd: savedPwd});
    pushCameraPassword(camera, savedPwd).catch(() => {});
    Alert.alert('Senha salva', 'O app vai usar essa senha para conectar.', [{text: 'OK', onPress: onSaved}]);
  };

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title}>Configurações</Text>
      </View>

      <ScrollView contentContainerStyle={{padding: 16, gap: 14}} keyboardShouldPersistTaps="handled">
        <View style={[ui.card, {gap: 10}]}>
          <Text style={[ui.text, {fontWeight: '600'}]}>Nome</Text>
          <TextInput style={ui.input} value={name} onChangeText={setName} />
          <Pressable style={ui.buttonGhost} onPress={saveName}>
            <Text style={ui.text}>Salvar nome</Text>
          </Pressable>
          <Text style={ui.muted}>ID: {did}</Text>
        </View>

        <View style={[ui.card, {gap: 10}]}>
          <Text style={[ui.text, {fontWeight: '600'}]}>Senha da câmera</Text>
          {isDefaultPassword(camera) ? (
            <Text style={[ui.muted, {color: colors.warn}]}>
              ⚠ A câmera está com a senha de fábrica (6666). Qualquer pessoa que souber o ID dela
              consegue ver as imagens. Troque por uma senha só sua.
            </Text>
          ) : (
            <Text style={ui.muted}>Troca a senha gravada na própria câmera.</Text>
          )}

          {!online ? (
            <View style={{alignItems: 'center', gap: 6}}>
              <ActivityIndicator color={colors.primary} />
              <Text style={ui.muted}>{statusLabel(status)} (precisa estar online para trocar)</Text>
            </View>
          ) : (
            <>
              <Text style={ui.muted}>Nova senha</Text>
              <TextInput
                style={ui.input}
                value={newPwd}
                onChangeText={setNewPwd}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPwd}
              />
              {pwdError && <Text style={[ui.muted, {color: colors.danger}]}>{pwdError}</Text>}
              <Text style={ui.muted}>Repita a nova senha</Text>
              <TextInput
                style={ui.input}
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPwd}
              />
              {mismatch && <Text style={[ui.muted, {color: colors.danger}]}>As senhas não conferem.</Text>}
              <Pressable onPress={() => setShowPwd(v => !v)} hitSlop={8}>
                <Text style={ui.link}>{showPwd ? 'Ocultar senhas' : 'Mostrar senhas'}</Text>
              </Pressable>
              <Pressable style={[ui.button, !canChange && {opacity: 0.5}]} disabled={!canChange} onPress={confirmChange}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>Trocar senha</Text>}
              </Pressable>
            </>
          )}
        </View>

        <View style={[ui.card, {gap: 10}]}>
          <Text style={[ui.text, {fontWeight: '600'}]}>Senha salva no app</Text>
          <Text style={ui.muted}>
            Use só se a senha foi trocada em outro celular e o app não conecta mais. Isso não muda nada
            na câmera.
          </Text>
          <TextInput
            style={ui.input}
            value={savedPwd}
            onChangeText={setSavedPwd}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPwd}
          />
          <Pressable style={ui.buttonGhost} onPress={saveStoredPassword}>
            <Text style={ui.text}>Salvar senha no app</Text>
          </Pressable>
        </View>

        {message && <Text style={[ui.text, {textAlign: 'center'}]}>{message}</Text>}
      </ScrollView>
    </View>
  );
}
