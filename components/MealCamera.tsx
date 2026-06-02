import React, { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'

interface Props {
  onAnalyze: (imageBase64: string) => void
  isAnalyzing?: boolean
}

const SkeletonBlock: React.FC<{ height: number }> = ({ height }) => {
  const opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [opacity])

  return <Animated.View style={[styles.skeleton, { height, opacity }]} />
}

const MealCamera: React.FC<Props> = ({ onAnalyze, isAnalyzing = false }) => {
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)

  const requestPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      return status === 'granted'
    }
    return true
  }

  const handleCamera = async () => {
    const granted = await requestPermission()
    if (!granted) return

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
      base64: true,
    })

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0]
      setImageUri(asset.uri)
      setImageBase64(asset.base64 ?? null)
    }
  }

  const handleLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') return

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
      base64: true,
    })

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0]
      setImageUri(asset.uri)
      setImageBase64(asset.base64 ?? null)
    }
  }

  const handleAnalyze = async () => {
    if (!imageBase64 && imageUri) {
      // expo-image-picker が base64 を返さなかった場合、FileSystem で再取得
      try {
        const FS = await import('expo-file-system/legacy') as any
        const b64 = await FS.readAsStringAsync(imageUri, { encoding: FS.EncodingType.Base64 })
        if (b64) { setImageBase64(b64); onAnalyze(b64) }
        return
      } catch {}
    }
    if (imageBase64) {
      onAnalyze(imageBase64)
    }
  }

  const handleClear = () => {
    setImageUri(null)
    setImageBase64(null)
  }

  if (isAnalyzing) {
    return (
      <View style={styles.card}>
        <SkeletonBlock height={180} />
        <View style={{ marginTop: 12, gap: 8 }}>
          <SkeletonBlock height={16} />
          <SkeletonBlock height={16} />
          <SkeletonBlock height={44} />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.card}>
      {imageUri ? (
        <>
          {/* Preview */}
          <View style={styles.previewContainer}>
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Analyze button */}
          <TouchableOpacity
            style={styles.analyzeButton}
            onPress={handleAnalyze}
            activeOpacity={0.8}
          >
            <Text style={styles.analyzeButtonText}>🔍 分析する</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Placeholder */}
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>🍽️</Text>
            <Text style={styles.placeholderText}>食事の写真を撮影または選択してください</Text>
          </View>

          {/* Action buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleCamera}
              activeOpacity={0.8}
            >
              <Text style={styles.actionButtonIcon}>📷</Text>
              <Text style={styles.actionButtonText}>カメラ</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleLibrary}
              activeOpacity={0.8}
            >
              <Text style={styles.actionButtonIcon}>🖼️</Text>
              <Text style={styles.actionButtonText}>ライブラリ</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  placeholder: {
    height: 160,
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeholderIcon: {
    fontSize: 40,
  },
  placeholderText: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 6,
  },
  actionButtonIcon: {
    fontSize: 24,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  previewContainer: {
    position: 'relative',
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
  },
  clearBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 999,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  analyzeButton: {
    backgroundColor: '#FF6B00',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  analyzeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  skeleton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    width: '100%',
  },
})

export default MealCamera
