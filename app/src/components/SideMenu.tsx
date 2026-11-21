import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors} from '../theme';

export type MenuItem = {key: string; icon: string; label: string; onPress: () => void};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Big line under the brand (user name). */
  title: string;
  subtitle?: string;
  items: MenuItem[];
  /** Pinned at the bottom (e.g. SAIR / ENTRAR). */
  footer?: MenuItem;
};

const DURATION = 220;

/**
 * Full-height drawer that slides in from the RIGHT over a dimmed background:
 * brand + ✕ on top, user block, menu items, and a footer item pinned to the bottom.
 * Closes on tap outside, on ✕, or with the Android back button.
 */
export function SideMenu({visible, onClose, title, subtitle, items, footer}: Props) {
  const {width} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(320, width * 0.82);
  const progress = useRef(new Animated.Value(0)).current;
  // keep the Modal mounted while the closing animation runs
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
  }, [visible, progress]);

  const translateX = progress.interpolate({inputRange: [0, 1], outputRange: [panelWidth, 0]});

  const choose = (item: MenuItem) => {
    onClose();
    setTimeout(item.onPress, 120); // let the drawer start closing before switching screens
  };

  return (
    <Modal visible={mounted} transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, {opacity: progress}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fechar menu" />
      </Animated.View>

      <Animated.View style={[styles.panel, {width: panelWidth, transform: [{translateX}]}]}>
        {/* brand bar */}
        <View style={[styles.top, {paddingTop: insets.top + 14}]}>
          <Text style={styles.brand}>CamGood</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar menu">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {/* user */}
        <View style={styles.user}>
          <Text style={styles.name} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.sub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.items}>
          {items.map(item => (
            <MenuRow key={item.key} item={item} onChoose={choose} />
          ))}
        </View>

        {footer && (
          <View style={[styles.footer, {paddingBottom: insets.bottom + 8}]}>
            <MenuRow item={footer} onChoose={choose} />
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

function MenuRow({item, onChoose}: {item: MenuItem; onChoose: (item: MenuItem) => void}) {
  return (
    <Pressable onPress={() => onChoose(item)} style={({pressed}) => [styles.item, pressed && styles.itemPressed]}>
      <Text style={styles.icon}>{item.icon}</Text>
      <Text style={styles.itemLabel}>{item.label.toUpperCase()}</Text>
    </Pressable>
  );
}

/** The ☰ button that opens the menu. */
export function MenuButton({onPress}: {onPress: () => void}) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityLabel="Abrir menu" style={styles.burger}>
      <View style={styles.bar} />
      <View style={styles.bar} />
      <View style={styles.bar} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {backgroundColor: 'rgba(0,0,0,0.55)'},
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: '#123a37', // dark teal, matches the app accent
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: {color: colors.primary, fontSize: 24, fontWeight: '800'},
  close: {color: colors.text, fontSize: 24},
  user: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#0f2a28',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: {color: colors.text, fontSize: 16, fontWeight: '700'},
  sub: {color: colors.primary, fontSize: 13, marginTop: 2},
  items: {flex: 1, paddingTop: 12, paddingHorizontal: 8},
  item: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 10},
  itemPressed: {backgroundColor: colors.card},
  icon: {fontSize: 18, width: 26, textAlign: 'center'},
  itemLabel: {color: colors.text, fontSize: 15, fontWeight: '700', letterSpacing: 0.3},
  footer: {borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 8, paddingTop: 8},
  burger: {width: 26, height: 20, justifyContent: 'space-between'},
  bar: {height: 2.5, borderRadius: 2, backgroundColor: colors.text},
});
