// app/reaction-start.tsx — スタート反応練習ツール（On your marks → Set → 号砲）

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import {
  unlockAudio,
  preloadStarterSounds,
  playStarterMarksCue,
  playStarterSetCue,
  playStarterGunCue,
} from '../lib/sounds'
import {
  getStarterSettings,
  randomGunDelayMs,
  type StarterSettings,
  STARTER_DEFAULTS,
} from '../lib/starterSettings'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'


// ============================================================
// Design
// ============================================================

const BG = '#FFFFFF'
const BG_GREEN = '#F0FDF4'

const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6B7280'
const TEXT_HINT = '#9CA3AF'

const IDLE_COLOR = '#9CA3AF'
const MARKS_COLOR = '#0EA5E9'
const SET_COLOR = '#F59E0B'
const GO_COLOR = '#E11D48'

const GREEN = '#166534'
const GREEN_BRIGHT = '#16A34A'

const { width: SCREEN_WIDTH } = Dimensions.get('window')


type Phase = 'idle' | 'marks' | 'set' | 'go'


const STAGES: {
  key: Exclude<Phase, 'idle'>
  label: string
  color: string
}[] = [
  {
    key: 'marks',
    label: 'On your marks',
    color: MARKS_COLOR,
  },
  {
    key: 'set',
    label: 'Set',
    color: SET_COLOR,
  },
  {
    key: 'go',
    label: 'GO!',
    color: GO_COLOR,
  },
]


const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  marks: 'On your marks',
  set: 'Set',
  go: 'GO!',
}


const PHASE_COLOR: Record<Phase, string> = {
  idle: IDLE_COLOR,
  marks: MARKS_COLOR,
  set: SET_COLOR,
  go: GO_COLOR,
}


// ============================================================
// Helpers
// ============================================================

function hexToRgba(hex: string, opacity: number) {
  const clean = hex.replace('#', '')

  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}


// ============================================================
// Screen
// ============================================================

export default function StarterScreen() {
  const router = useRouter()
  const { t } = useTranslation()

  const [phase, setPhase] = useState<Phase>('idle')
  const [running, setRunning] = useState(false)

  const settingsRef = useRef<StarterSettings>(
    STARTER_DEFAULTS
  )

  const timeoutsRef = useRef<
    ReturnType<typeof setTimeout>[]
  >([])


  // ==========================================================
  // Animation Values
  // ==========================================================

  // Main phase scale
  const phaseScale = useRef(
    new Animated.Value(1)
  ).current

  // Main phase opacity
  const phaseOpacity = useRef(
    new Animated.Value(1)
  ).current

  // Outer glow
  const glowOpacity = useRef(
    new Animated.Value(0)
  ).current

  const glowScale = useRef(
    new Animated.Value(0.85)
  ).current

  // Central ring
  const ringScale = useRef(
    new Animated.Value(1)
  ).current

  const ringOpacity = useRef(
    new Animated.Value(0.25)
  ).current

  // Idle breathing animation
  const idlePulse = useRef(
    new Animated.Value(0)
  ).current

  const idleLoopRef = useRef<Animated.CompositeAnimation | null>(
    null
  )


  // ==========================================================
  // Existing Lifecycle / Logic
  // ==========================================================

  useEffect(() => {
    preloadStarterSounds().catch(() => {})
    getStarterSettings().then(s => {
      settingsRef.current = s
    })

    return () => clearAll()
  }, [])


  function clearAll() {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
  }


  const handleStart = useCallback(() => {
    unlockAudio()

    if (running) return

    clearAll()

    setRunning(true)
    setPhase('idle')

    const s = settingsRef.current

    const t1 = setTimeout(() => {
      setPhase('marks')
      playStarterMarksCue()

      const t2 = setTimeout(() => {
        setPhase('set')
        playStarterSetCue()

        const gunDelayMs = s.gunRandom
          ? randomGunDelayMs()
          : s.gunFixedSec * 1000

        const t3 = setTimeout(() => {
          setPhase('go')
          playStarterGunCue()

          const t4 = setTimeout(() => {
            setPhase('idle')
            setRunning(false)
          }, 2500)

          timeoutsRef.current.push(t4)
        }, gunDelayMs)

        timeoutsRef.current.push(t3)
      }, s.marksToSetSec * 1000)

      timeoutsRef.current.push(t2)
    }, s.startToMarksSec * 1000)

    timeoutsRef.current.push(t1)
  }, [running])


  const handleCancel = useCallback(() => {
    clearAll()
    setRunning(false)
    setPhase('idle')
  }, [])


  // ==========================================================
  // Phase Animation
  //
  // state / function / timing logic is untouched.
  // Only visual animation is added here.
  // ==========================================================

  useEffect(() => {
    const color = PHASE_COLOR[phase]

    // Stop previous idle animation when entering an active phase.
    idleLoopRef.current?.stop()
    idleLoopRef.current = null

    // Base reset
    phaseScale.setValue(0.94)
    phaseOpacity.setValue(0.65)

    glowOpacity.setValue(0.08)
    glowScale.setValue(0.72)

    ringScale.setValue(0.82)
    ringOpacity.setValue(0.12)


    // ----------------------------------------------------------
    // IDLE
    // ----------------------------------------------------------

    if (phase === 'idle') {
      phaseScale.setValue(1)
      phaseOpacity.setValue(1)

      glowOpacity.setValue(0.03)
      glowScale.setValue(0.9)

      ringScale.setValue(1)
      ringOpacity.setValue(0.18)

      idlePulse.setValue(0)

      idleLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(idlePulse, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(idlePulse, {
            toValue: 0,
            duration: 1800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      )

      idleLoopRef.current.start()

      return
    }


    // ----------------------------------------------------------
    // Active phase
    // ----------------------------------------------------------

    const isGo = phase === 'go'

    Animated.parallel([
      Animated.spring(phaseScale, {
        toValue: isGo ? 1.08 : 1,
        friction: isGo ? 4 : 6,
        tension: isGo ? 110 : 90,
        useNativeDriver: true,
      }),

      Animated.timing(phaseOpacity, {
        toValue: 1,
        duration: isGo ? 100 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.timing(glowOpacity, {
        toValue: isGo ? 0.42 : 0.22,
        duration: isGo ? 90 : 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.spring(glowScale, {
        toValue: isGo ? 1.35 : 1.08,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }),

      Animated.spring(ringScale, {
        toValue: isGo ? 1.45 : 1.12,
        friction: isGo ? 4 : 7,
        tension: 90,
        useNativeDriver: true,
      }),

      Animated.timing(ringOpacity, {
        toValue: isGo ? 0.65 : 0.35,
        duration: isGo ? 80 : 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ])


    // GO! has a second shockwave.
    if (isGo) {
      const shockwave = Animated.sequence([
        Animated.delay(80),

        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 2.1,
            duration: 420,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),

          Animated.timing(ringOpacity, {
            toValue: 0,
            duration: 420,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ])

      shockwave.start()
    }

    return () => {
      idleLoopRef.current?.stop()
    }
  }, [
    phase,
    phaseScale,
    phaseOpacity,
    glowOpacity,
    glowScale,
    ringScale,
    ringOpacity,
    idlePulse,
  ])


  const color = PHASE_COLOR[phase]

  const activeStageIndex =
    STAGES.findIndex(stg => stg.key === phase)


  // ============================================================
  // Render
  // ============================================================

  return (
    <SafeAreaView
      style={ss.safe}
      edges={['top', 'bottom']}
    >

      {/* ======================================================
          Background
      ======================================================= */}

      <LinearGradient
        colors={[
          BG,
          BG_GREEN,
          BG,
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* subtle green corner light */}
      <View
        pointerEvents="none"
        style={ss.backgroundGlow}
      />

      {/* ======================================================
          Header
      ======================================================= */}

      <View style={ss.header}>

        <TouchableOpacity
          onPress={() => router.back()}
          style={ss.iconBtn}
          hitSlop={{
            top: 12,
            bottom: 12,
            left: 12,
            right: 12,
          }}
          accessibilityLabel={t(
            'starter.backLabel'
          )}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color={TEXT_PRIMARY}
          />
        </TouchableOpacity>


        <View style={ss.headerCenter}>

          <Text style={ss.headerTitle}>
            {t('starter.headerTitle')}
          </Text>

        </View>


        <TouchableOpacity
          onPress={() =>
            router.push(
              '/reaction-start-settings' as any
            )
          }
          style={ss.editBtn}
          hitSlop={{
            top: 12,
            bottom: 12,
            left: 12,
            right: 12,
          }}
        >
          <Ionicons
            name="options-outline"
            size={21}
            color={TEXT_PRIMARY}
          />
        </TouchableOpacity>

      </View>


      {/* ======================================================
          Main
      ======================================================= */}

      <View style={ss.body}>

        {/* ====================================================
            Stage Indicator
        ===================================================== */}

        <View style={ss.stageHeader}>

          <Text style={ss.stageHeaderStatus}>
            {phase === 'idle'
              ? '準備完了'
              : `${Math.max(activeStageIndex + 1, 1)} / 3`}
          </Text>

        </View>


        <View style={ss.stepBar}>

          {STAGES.map((stg, i) => {

            const active =
              phase === stg.key

            const passed =
              activeStageIndex > i

            const visible =
              active || passed

            return (
              <View
                key={stg.key}
                style={ss.stepSegmentWrap}
              >

                <View style={ss.stepTrack}>

                  <View
                    style={[
                      ss.stepSegment,
                      visible && {
                        backgroundColor:
                          stg.color,
                      },
                    ]}
                  />

                  {active && (
                    <View
                      style={[
                        ss.stepActiveDot,
                        {
                          backgroundColor:
                            stg.color,
                        },
                      ]}
                    />
                  )}

                </View>

                <Text
                  style={[
                    ss.stepLabel,
                    active && {
                      color: stg.color,
                    },
                    passed && {
                      color: TEXT_SECONDARY,
                    },
                  ]}
                >
                  {stg.label}
                </Text>

              </View>
            )
          })}

        </View>


        {/* ====================================================
            Main Start Interface
        ===================================================== */}

        <View style={ss.startArea}>

          {/* large glow */}

          <Animated.View
            pointerEvents="none"
            style={[
              ss.glow,
              {
                backgroundColor:
                  hexToRgba(color, 0.9),
                opacity: glowOpacity,
                transform: [
                  {
                    scale: glowScale,
                  },
                ],
              },
            ]}
          />


          {/* shockwave ring */}

          <Animated.View
            pointerEvents="none"
            style={[
              ss.shockwave,
              {
                borderColor: color,
                opacity: ringOpacity,
                transform: [
                  {
                    scale: ringScale,
                  },
                ],
              },
            ]}
          />


          {/* Main interactive surface */}

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={
              running
                ? undefined
                : handleStart
            }
            disabled={running}
            style={ss.mainButton}
          >

            <LinearGradient
              colors={[
                hexToRgba(color, 0.15),
                hexToRgba(color, 0.035),
                'rgba(0,0,0,0.01)',
              ]}
              locations={[
                0,
                0.55,
                1,
              ]}
              style={ss.mainButtonGradient}
            >

              {/* decorative lines */}

              <View
                pointerEvents="none"
                style={[
                  ss.decorativeLine,
                  {
                    backgroundColor:
                      hexToRgba(color, 0.55),
                  },
                ]}
              />

              <View
                pointerEvents="none"
                style={[
                  ss.decorativeLineRight,
                  {
                    backgroundColor:
                      hexToRgba(color, 0.25),
                  },
                ]}
              />


              {/* phase number */}

              <Animated.View
                style={[
                  ss.phaseContent,
                  {
                    opacity: phaseOpacity,
                    transform: [
                      {
                        scale: Animated.add(
                          phaseScale,
                          idlePulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 0.015],
                          })
                        ),
                      },
                    ],
                  },
                ]}
              >

                {phase === 'idle' ? (

                  <>

                    <View
                      style={ss.readyIcon}
                    >
                      <Ionicons
                        name="flash-outline"
                        size={25}
                        color={TEXT_PRIMARY}
                      />
                    </View>

                    <Text
                      style={[
                        ss.phaseTextIdle,
                        {
                          color: TEXT_PRIMARY,
                        },
                      ]}
                    >
                      {t('starter.idle')}
                    </Text>

                  </>

                ) : (

                  <>

                    <Text
                      style={[
                        ss.sequenceNumber,
                        {
                          color:
                            hexToRgba(
                              color,
                              0.22
                            ),
                        },
                      ]}
                    >
                      {phase === 'marks'
                        ? '01'
                        : phase === 'set'
                          ? '02'
                          : '03'}
                    </Text>


                    <Text
                      style={[
                        ss.phaseText,
                        {
                          color,
                        },
                      ]}
                    >
                      {PHASE_TEXT[phase]}
                    </Text>


                    <View
                      style={[
                        ss.phaseUnderline,
                        {
                          backgroundColor:
                            color,
                        },
                      ]}
                    />

                  </>

                )}

              </Animated.View>


              {/* Bottom technical readout */}

              <View style={ss.bottomReadout}>

                <Text style={ss.bottomReadoutLeft}>
                  {phase === 'idle'
                    ? '準備完了'
                    : '進行中'}
                </Text>

                <View
                  style={[
                    ss.statusDot,
                    {
                      backgroundColor:
                        running
                          ? color
                          : GREEN_BRIGHT,
                    },
                  ]}
                />

              </View>

            </LinearGradient>

          </TouchableOpacity>


          {/* ==================================================
              Cancel
          =================================================== */}

          {running && (

            <TouchableOpacity
              onPress={handleCancel}
              hitSlop={{
                top: 10,
                bottom: 10,
                left: 10,
                right: 10,
              }}
              style={ss.cancelButton}
            >

              <Ionicons
                name="close"
                size={17}
                color={TEXT_SECONDARY}
              />

              <Text style={ss.cancelText}>
                {t('starter.cancel')}
              </Text>

            </TouchableOpacity>

          )}

        </View>


        {/* ====================================================
            Bottom information
        ===================================================== */}

        <View style={ss.bottomInfo}>

          <View style={ss.bottomInfoLine} />

          <View style={ss.bottomInfoContent}>

            <View>

              <Text style={ss.infoTitle}>
                音を聞いて反応する練習
              </Text>

            </View>


            <Ionicons
              name="radio-outline"
              size={18}
              color={TEXT_HINT}
            />

          </View>

        </View>

      </View>

    </SafeAreaView>
  )
}


// ============================================================
// Styles
// ============================================================

const ss = StyleSheet.create({

  safe: {
    flex: 1,
    backgroundColor: BG,
  },


  // ==========================================================
  // Background
  // ==========================================================

  backgroundGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(22,101,52,0.10)',
    top: -130,
    right: -100,
  },


  // ==========================================================
  // Header
  // ==========================================================

  header: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },

  iconBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerEyebrow: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 2.2,
    color: TEXT_HINT,
    marginBottom: 2,
  },

  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },

  editBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },


  // ==========================================================
  // Body
  // ==========================================================

  body: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
  },


  // ==========================================================
  // Stage header
  // ==========================================================

  stageHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 10,
  },

  stageHeaderLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: TEXT_HINT,
  },

  stageHeaderStatus: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: TEXT_SECONDARY,
    fontVariant: ['tabular-nums'],
  },


  // ==========================================================
  // Step Bar
  // ==========================================================

  stepBar: {
    width: '100%',
    flexDirection: 'row',
    gap: 9,
  },

  stepSegmentWrap: {
    flex: 1,
    gap: 8,
  },

  stepTrack: {
    height: 10,
    width: '100%',
    justifyContent: 'center',
  },

  stepSegment: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },

  stepActiveDot: {
    position: 'absolute',
    right: 0,
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  stepLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: TEXT_HINT,
  },


  // ==========================================================
  // Main Area
  // ==========================================================

  startArea: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },


  // ==========================================================
  // Glow
  // ==========================================================

  glow: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.62,
    aspectRatio: 1,
    borderRadius: SCREEN_WIDTH * 0.31,
    opacity: 0.15,
  },


  // ==========================================================
  // Shockwave
  // ==========================================================

  shockwave: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.61,
    aspectRatio: 1,
    borderRadius: SCREEN_WIDTH * 0.305,
    borderWidth: 1,
  },


  // ==========================================================
  // Main Button
  // ==========================================================

  mainButton: {
    width: '100%',
    aspectRatio: 0.93,
    maxHeight: 430,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },

  mainButtonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },


  // ==========================================================
  // Decorative geometry
  // ==========================================================

  decorativeLine: {
    position: 'absolute',
    top: 24,
    left: 24,
    width: 42,
    height: 2,
  },

  decorativeLineRight: {
    position: 'absolute',
    top: 24,
    right: 24,
    width: 18,
    height: 2,
  },


  // ==========================================================
  // Phase Content
  // ==========================================================

  phaseContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    flex: 1,
  },

  readyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },

  phaseTextIdle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  tapHint: {
    marginTop: 13,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 2.4,
    color: TEXT_HINT,
  },


  // ==========================================================
  // Active phase
  // ==========================================================

  sequenceNumber: {
    position: 'absolute',
    fontSize: 132,
    fontWeight: '900',
    letterSpacing: -8,
    lineHeight: 145,
    opacity: 0.8,
  },

  phaseText: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '900',
    letterSpacing: -1.4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  phaseUnderline: {
    width: 48,
    height: 4,
    borderRadius: 2,
    marginTop: 17,
  },


  // ==========================================================
  // Bottom readout
  // ==========================================================

  bottomReadout: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  bottomReadoutLeft: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.7,
    color: TEXT_HINT,
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },


  // ==========================================================
  // Cancel
  // ==========================================================

  cancelButton: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.94)',
  },

  cancelText: {
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_SECONDARY,
  },


  // ==========================================================
  // Bottom information
  // ==========================================================

  bottomInfo: {
    width: '100%',
    paddingTop: 13,
  },

  bottomInfoLine: {
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.07)',
    marginBottom: 12,
  },

  bottomInfoContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  infoEyebrow: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.7,
    color: TEXT_HINT,
    marginBottom: 3,
  },

  infoTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    color: TEXT_SECONDARY,
  },

})
