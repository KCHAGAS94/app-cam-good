import {StyleSheet} from 'react-native';

export const colors = {
  bg: '#0f1417',
  card: '#1a2226',
  border: '#2a353b',
  text: '#e8eef1',
  muted: '#8a9aa3',
  primary: '#2bb3a3',
  danger: '#e5534b',
  ok: '#3fb950',
  warn: '#d29922',
};

export const ui = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  title: {color: colors.text, fontSize: 20, fontWeight: '700', flex: 1},
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  text: {color: colors.text, fontSize: 15},
  muted: {color: colors.muted, fontSize: 13},
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  buttonGhost: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  link: {color: colors.primary, fontSize: 15, fontWeight: '600'},
});
