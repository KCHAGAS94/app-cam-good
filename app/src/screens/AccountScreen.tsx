import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {GhostButton, PrimaryButton} from '../components';
import {Account, getAccount, login, logout, onAccountChange, syncCameras} from '../server/account';
import {onPendingChange, processUploads} from '../server/uploads';
import {colors, ui} from '../theme';

type Props = {onBack: () => void; onSynced: () => void};

/** Login to the central server, or account info + logout when already logged in. */
export default function AccountScreen({onBack, onSynced}: Props) {
  const [account, setAccount] = useState<Account | null>(getAccount());
  const [serverUrl, setServerUrl] = useState(account?.serverUrl ?? '');
  const [email, setEmail] = useState(account?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const offAccount = onAccountChange(setAccount);
    const offPending = onPendingChange(setPending);
    return () => {
      offAccount();
      offPending();
    };
  }, []);

  const doLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(serverUrl, email, password);
      setPassword('');
      const cams = await syncCameras();
      processUploads();
      setMessage(`✓ Conectado. ${cams.filter(c => c.serverId !== undefined).length} câmera(s) liberada(s) para você.`);
      onSynced();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const cams = await syncCameras();
      processUploads();
      setMessage(`✓ Atualizado: ${cams.filter(c => c.serverId !== undefined).length} câmera(s) da conta.`);
      onSynced();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doLogout = () =>
    Alert.alert('Sair da conta', 'As câmeras da conta saem do app. As que você salvou só no celular continuam.', [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          await logout();
          setMessage(null);
          onSynced();
        },
      },
    ]);

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title}>Conta</Text>
      </View>

      <ScrollView contentContainerStyle={{padding: 16, gap: 14}} keyboardShouldPersistTaps="handled">
        {account ? (
          <View style={[ui.card, {gap: 10}]}>
            <Text style={[ui.text, {fontWeight: '600'}]}>{account.user.name}</Text>
            <Text style={ui.muted}>{account.user.email}</Text>
            <Text style={ui.muted}>
              {account.user.role === 'admin' ? 'Administrador' : 'Usuário'} · {account.serverUrl}
            </Text>
            <Text style={ui.muted}>
              {pending === 0
                ? 'Fotos e vídeos: tudo enviado para o servidor.'
                : `Fotos e vídeos aguardando envio: ${pending}`}
            </Text>
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <PrimaryButton label="Atualizar câmeras e enviar pendentes" onPress={doSync} />
                <GhostButton label="Sair da conta" onPress={doLogout} />
              </>
            )}
          </View>
        ) : (
          <View style={[ui.card, {gap: 10}]}>
            <Text style={[ui.text, {fontWeight: '600'}]}>Entrar no CamGood central</Text>
            <Text style={ui.muted}>
              Com a conta, as câmeras liberadas para você aparecem sozinhas e as fotos e vídeos ficam
              salvos também no servidor.
            </Text>
            <Text style={ui.muted}>Endereço do servidor</Text>
            <TextInput
              style={ui.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="ex.: 192.168.0.10:8080"
              placeholderTextColor={colors.muted}
            />
            <Text style={ui.muted}>E-mail</Text>
            <TextInput
              style={ui.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Text style={ui.muted}>Senha</Text>
            <TextInput style={ui.input} value={password} onChangeText={setPassword} secureTextEntry />
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <PrimaryButton label="Entrar" onPress={doLogin} disabled={!serverUrl || !email || !password} />
            )}
          </View>
        )}
        {error && <Text style={[ui.text, {color: colors.danger}]}>{error}</Text>}
        {message && <Text style={ui.text}>{message}</Text>}
      </ScrollView>
    </View>
  );
}
