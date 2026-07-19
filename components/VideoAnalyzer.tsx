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
import type { UserProfile, VideoAnalysisResult } from '../types'

interface Props {
  profile: UserProfile
  onResult: (result: VideoAnalysisResult) => void
  isAnalyzing?: boolean
  progress?: number
}

const SkeletonBlock: React.FC<{ height: number; width?: string | number }> = ({
  height,
  width = '100%',
}) => {
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

  return (
    <Animated.View
      style={[styles.skeleton, { height, width: width as any, opacity }]}
    />
  )
}

const VideoAnalyzer: React.FC<Props> = ({
  profile,
  onResult,
  isAnalyzing = false,
  progress = 0,
}) => {
  const [videoUri, setVideoUri] = useState<string | null>(null)
  const [thumbUri, setThumbUri] = useState<string | null>(null)

  // Animated progress bar width
  const progressAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start()
  }, [progress, progressAnim])

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  })

  const handlePickVideo = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'videos',
      allowsEditing: false,
      quality: 1,
    })

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0]
      setVideoUri(asset.uri)
      // expo-image-picker may provide a thumbnail for videos
      if (asset.uri) {
        setThumbUri(null) // No guaranteed thumbnail in all RN versions
      }
    }
  }

  const handleRecordVideo = async () => {
    if (Platform.OS !== 'web') {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync()
      if (camPerm.status !== 'granted') return
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'videos',
      allowsEditing: false,
      videoMaxDuration: 60,
      quality: 1,
    })

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0]
      setVideoUri(asset.uri)
      setThumbUri(null)
    }
  }

  const handleAnalyze = () => {
    if (!videoUri) return
    // In the real implementation, the hook will handle upload + Claude API.
    // We pass a synthetic result here so the component contract is complete.
    // The actual analysis is driven by the parent via onResult.
    onResult({
      technique_score: 0,
      feedback: '',
      strengths: [],
      improvements: [],
      drills: [],
      next_events: [],
      event_detected: profile.primary_event,
    })
  }

  const handleClear = () => {
    setVideoUri(null)
    setThumbUri(null)
  }

  // ── Skeleton while analyzing ─────────────────────────────────────
  if (isAnalyzing) {
    return (
      <View style={styles.card}>
        <SkeletonBlock height={200} />
        <View style={{ gap: 8, marginTop: 4 }}>
          <View style={styles.progressLabelRow}>
            <SkeletonBlock height={14} width="40%" />
            <SkeletonBlock height={14} width="20%" />
          </View>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                { width: progressWidth },
              ]}
            />
          </View>
          <SkeletonBlock height={44} />
        </View>
      </View>
    )
  }

  // ── Default UI ───────────────────────────────────────────────────
  return (
    <View style={styles.card}>
      {/* Video / thumbnail area */}
      {videoUri ? (
        <View style={styles.previewContainer}>
          {thumbUri ? (
            <Image source={{ uri: thumbUri }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Text style={styles.videoPlaceholderIcon}>🎬</Text>
              <Text style={styles.videoPlaceholderText} numberOfLines={1}>
                {videoUri.split('/').pop()}
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear} activeOpacity={0.7}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.videoBadge}>
            <Text style={styles.videoBadgeText}>動画選択済み</Text>
          </View>
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderIcon}>📹</Text>
          <Text style={styles.placeholderTitle}>フォームを分析する</Text>
          <Text style={styles.placeholderSubtext}>
            {profile.primary_event} のフォームを動画で撮影・分析します
          </Text>
        </View>
      )}

      {/* Pick / Record buttons */}
      {!videoUri && (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleRecordVideo}
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonIcon}>🎥</Text>
            <Text style={styles.actionButtonText}>録画</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handlePickVideo}
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonIcon}>📂</Text>
            <Text style={styles.actionButtonText}>選択</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Analyze button */}
      {videoUri && (
        <TouchableOpacity
          style={styles.analyzeButton}
          onPress={handleAnalyze}
          activeOpacity={0.8}
        >
          <Text style={styles.analyzeButtonText}>🏃 フォーム分析</Text>
        </TouchableOpacity>
      )}

      {/* Progress bar (visible when progress > 0 and not using skeleton) */}
      {progress > 0 && (
        <View style={{ gap: 6 }}>
          <View style={styles.progressLabelRow}>
            <Text style={styles.progressLabel}>分析中...</Text>
            <Text style={styles.progressPct}>{Math.round(progress)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
        </View>
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
    height: 180,
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
  placeholderTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  placeholderSubtext: {
    color: '#888888',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  previewContainer: {
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: 200,
    borderRadius: 10,
  },
  videoPlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  videoPlaceholderIcon: {
    fontSize: 48,
  },
  videoPlaceholderText: {
    color: '#888888',
    fontSize: 12,
    maxWidth: '80%',
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
  videoBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(255,107,0,0.85)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  videoBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
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
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    color: '#888888',
    fontSize: 12,
  },
  progressPct: {
    color: '#FF6B00',
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FF6B00',
    borderRadius: 3,
  },
  skeleton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
  },
})

export default VideoAnalyzer
