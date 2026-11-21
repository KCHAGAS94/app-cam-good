import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, ui} from './theme';

type ButtonProps = {label: string; onPress: () => void; disabled?: boolean};

export function PrimaryButton({label, onPress, disabled}: ButtonProps) {
  return (
    <Pressable style={[ui.button, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <Text style={ui.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({label, onPress, disabled}: ButtonProps) {
  return (
    <Pressable style={[ui.buttonGhost, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <Text style={ui.text}>{label}</Text>
    </Pressable>
  );
}

export function LoadingCard({text}: {text: string}) {
  return (
    <View style={[ui.card, styles.center]}>
      <ActivityIndicator color={colors.primary} />
      <Text style={ui.muted}>{text}</Text>
    </View>
  );
}

export function EmptyCard({text}: {text: string}) {
  return (
    <View style={ui.card}>
      <Text style={ui.muted}>{text}</Text>
    </View>
  );
}

/**
 * Camera answered "mj_other_login". It sends this for a WRONG PASSWORD (most common)
 * and also when another phone/app holds the connection.
 */
export function OtherLoginWarning({onRetry, onFixPassword}: {onRetry: () => void; onFixPassword?: () => void}) {
  return (
    <View style={[ui.card, styles.warn]}>
      <Text style={[ui.text, {color: colors.warn}]}>A câmera recusou o login</Text>
      <Text style={ui.muted}>
        Provavelmente a senha salva no app está errada. Também pode ser outro app ou aparelho
        conectado nela (ex.: PIX-LINK CAM), já que ela aceita uma conexão por vez.
      </Text>
      <View style={styles.actions}>
        {onFixPassword && (
          <Pressable onPress={onFixPassword} hitSlop={8}>
            <Text style={ui.link}>Corrigir senha</Text>
          </Pressable>
        )}
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={ui.link}>Reconectar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  warn: {borderColor: colors.warn, gap: 8},
  actions: {flexDirection: 'row', gap: 24},
  disabled: {opacity: 0.5},
  center: {alignItems: 'center', gap: 10},
});
