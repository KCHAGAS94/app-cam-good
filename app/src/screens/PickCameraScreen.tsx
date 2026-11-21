import React, {useEffect, useState} from 'react';
import {FlatList, Pressable, Text, View} from 'react-native';
import {loadCameras, SavedCamera} from '../storage';
import {ui} from '../theme';

type Props = {title: string; onBack: () => void; onPick: (camera: SavedCamera) => void};

/** "Which camera?" list, used when opening the gallery with more than one camera. */
export default function PickCameraScreen({title, onBack, onPick}: Props) {
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  useEffect(() => {
    loadCameras().then(setCameras);
  }, []);

  return (
    <View style={ui.screen}>
      <View style={ui.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={ui.link}>‹ Voltar</Text>
        </Pressable>
        <Text style={ui.title}>{title}</Text>
      </View>
      <FlatList
        data={cameras}
        keyExtractor={c => c.did}
        contentContainerStyle={{padding: 16, gap: 12}}
        ListEmptyComponent={<Text style={ui.muted}>Nenhuma câmera cadastrada.</Text>}
        renderItem={({item}) => (
          <Pressable style={ui.card} onPress={() => onPick(item)}>
            <Text style={[ui.text, {fontWeight: '600'}]}>🎞 {item.name}</Text>
            <Text style={ui.muted}>{item.did}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
