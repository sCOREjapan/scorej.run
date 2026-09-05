// app/reaction-start-settings.tsx — スタート反応練習ツールのタイミング設定画面

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Animated,
  Easing,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import SimpleSlider from '../components/SimpleSlider'
import { unlockAudio, Sounds } from '../lib/sounds'
import {
  getStarterSettings,
  saveStarterSettings,
  STARTER_DEFAULTS,
  GUN_RANDOM_MIN,
  GUN_RANDOM_MAX,
  type StarterSettings,
} from '../lib/starterSettings'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'


// ============================================================
// Design
// ============================================================

const BG = '#FFFFFF'
const BG_GREEN = '#F0FDF4'

const CARD = '#FFFFFF'
const CARD_LIGHT = '#FAFAF9'

const BORDER = 'rgba(0,0,0,0.08)'
const BORDER_STRONG = 'rgba(0,0,0,0.12)'

const TEXT_PRIMARY = '#111827'
const TEXT_SECONDARY = '#6B7280'
const TEXT_HINT = '#9CA3AF'

const BRAND = '#FB923C'
const GREEN = '#16A34A'
const BLUE = '#0EA5E9'


// ============================================================
// Screen
// ============================================================

export default function StarterSettingsScreen() {
  const router = useRouter()
  const { t } = useTranslation()

  const [settings, setSettings] =
    useState<StarterSettings>(STARTER_DEFAULTS)

  const [loaded, setLoaded] = useState(false)


  // ==========================================================
  // Existing lifecycle / state logic
  // ==========================================================

  useEffect(() => {
    getStarterSettings().then(s => {
      setSettings(s)
      setLoaded(true)
    })
  }, [])


  const update = useCallback(
    (patch: Partial<StarterSettings>) => {
      setSettings(prev => {
        const next = { ...prev, ...patch }
        saveStarterSettings(next)
        return next
      })
    },
    []
  )


  // ==========================================================
  // Visual animation only
  // ==========================================================

  const entranceOpacity = useRef(
    new Animated.Value(0)
  ).current

  const entranceY = useRef(
    new Animated.Value(18)
  ).current

  const randomPanelScale = useRef(
    new Animated.Value(1)
  ).current


  useEffect(() => {
    if (!loaded) return

    Animated.parallel([
      Animated.timing(entranceOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.timing(entranceY, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }, [
    loaded,
    entranceOpacity,
    entranceY,
  ])


  useEffect(() => {
    Animated.sequence([
      Animated.timing(randomPanelScale, {
        toValue: 1.015,
        duration: 130,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),

      Animated.spring(randomPanelScale, {
        toValue: 1,
        friction: 7,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start()
  }, [
    settings.gunRandom,
    randomPanelScale,
  ])


  // ==========================================================
  // Loading
  // ==========================================================

  if (!loaded) {
    return (
      <View style={st.loading}>
        <View style={st.loadingMark}>
          <View style={st.loadingDot} />
        </View>
      </View>
    )
  }


  // ==========================================================
  // Render
  // ==========================================================

  return (
    <SafeAreaView
      style={st.safe}
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
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        pointerEvents="none"
        style={st.backgroundGlow}
      />


      {/* ======================================================
          Header
      ======================================================= */}

      <View style={st.header}>

        <TouchableOpacity
          onPress={() => router.back()}
          style={st.backBtn}
          hitSlop={{
            top: 12,
            bottom: 12,
            left: 12,
            right: 12,
          }}
          accessibilityLabel={t(
            'starterSettings.backLabel'
          )}
        >
          <Ionicons
            name="chevron-back"
            size={25}
            color={TEXT_PRIMARY}
          />
        </TouchableOpacity>


        <View style={st.headerCenter}>

          <Text style={st.headerTitle}>
            {t('starterSettings.headerTitle')}
          </Text>

        </View>


        <View style={st.headerRight}>
          <View style={st.headerStatusDot} />
        </View>

      </View>


      {/* ======================================================
          Content
      ======================================================= */}

      <Animated.View
        style={[
          st.content,
          {
            opacity: entranceOpacity,
            transform: [
              {
                translateY: entranceY,
              },
            ],
          },
        ]}
      >

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={st.scroll}
        >

          {/* ==================================================
              Intro
          =================================================== */}

          <View style={st.intro}>

            <View style={st.introNumber}>
              <Text style={st.introNumberText}>
                01
              </Text>
            </View>

            <View style={st.introCopy}>
              <Text style={st.introTitle}>
                タイミング調整
              </Text>

              <Text style={st.introDescription}>
                各号令の間隔を調整できます
              </Text>
            </View>

          </View>


          {/* ==================================================
              Card 01 — Marks / Set
          =================================================== */}

          <View style={st.card}>

            <View style={st.cardHeader}>

              <View style={st.cardHeaderLeft}>

                <View
                  style={[
                    st.cardIcon,
                    {
                      backgroundColor:
                        'rgba(56,189,248,0.10)',
                    },
                  ]}
                >
                  <Ionicons
                    name="timer-outline"
                    size={18}
                    color={BLUE}
                  />
                </View>

                <View>
                  <Text style={st.cardTitle}>
                    号令タイミング
                  </Text>
                </View>

              </View>

              <Text style={st.cardIndex}>
                01
              </Text>

            </View>


            {/* ==================================================
                Start → Marks
            =================================================== */}

            <View style={st.settingBlock}>

              <View style={st.settingTop}>

                <View style={st.settingNameWrap}>

                  <View
                    style={[
                      st.phaseDot,
                      {
                        backgroundColor: BLUE,
                      },
                    ]}
                  />

                  <Text style={st.label}>
                    {t(
                      'starterSettings.startToMarks'
                    )}
                  </Text>

                </View>


                <View style={st.valueBox}>

                  <Text style={st.valueNumber}>
                    {settings.startToMarksSec.toFixed(1)}
                  </Text>

                  <Text style={st.valueUnit}>
                    s
                  </Text>

                </View>

              </View>


              <View style={st.sliderWrap}>

                <SimpleSlider
                  value={
                    settings.startToMarksSec
                  }
                  min={1}
                  max={10}
                  step={0.5}
                  color={BLUE}
                  onChange={(v) =>
                    update({
                      startToMarksSec: v,
                    })
                  }
                />

              </View>


              <View style={st.rangeRow}>

                <Text style={st.rangeText}>
                  1.0 s
                </Text>

                <Text style={st.rangeText}>
                  10.0 s
                </Text>

              </View>

            </View>


            <View style={st.divider} />


            {/* ==================================================
                Marks → Set
            =================================================== */}

            <View style={st.settingBlock}>

              <View style={st.settingTop}>

                <View style={st.settingNameWrap}>

                  <View
                    style={[
                      st.phaseDot,
                      {
                        backgroundColor:
                          BRAND,
                      },
                    ]}
                  />

                  <Text style={st.label}>
                    {t(
                      'starterSettings.marksToSet'
                    )}
                  </Text>

                </View>


                <View
                  style={[
                    st.valueBox,
                    {
                      backgroundColor:
                        'rgba(251,146,60,0.09)',
                      borderColor:
                        'rgba(251,146,60,0.18)',
                    },
                  ]}
                >

                  <Text
                    style={[
                      st.valueNumber,
                      {
                        color: BRAND,
                      },
                    ]}
                  >
                    {settings.marksToSetSec.toFixed(1)}
                  </Text>

                  <Text
                    style={[
                      st.valueUnit,
                      {
                        color: BRAND,
                      },
                    ]}
                  >
                    s
                  </Text>

                </View>

              </View>


              <View style={st.sliderWrap}>

                <SimpleSlider
                  value={
                    settings.marksToSetSec
                  }
                  min={3}
                  max={30}
                  step={1}
                  color={BRAND}
                  onChange={(v) =>
                    update({
                      marksToSetSec: v,
                    })
                  }
                />

              </View>


              <View style={st.rangeRow}>

                <Text style={st.rangeText}>
                  3 s
                </Text>

                <Text style={st.rangeText}>
                  30 s
                </Text>

              </View>

            </View>

          </View>


          {/* ==================================================
              Card 02 — Gun
          =================================================== */}

          <Animated.View
            style={[
              st.card,
              {
                transform: [
                  {
                    scale: randomPanelScale,
                  },
                ],
              },
            ]}
          >

            <View style={st.cardHeader}>

              <View style={st.cardHeaderLeft}>

                <View
                  style={[
                    st.cardIcon,
                    {
                      backgroundColor:
                        'rgba(244,63,94,0.10)',
                    },
                  ]}
                >
                  <Ionicons
                    name="flash-outline"
                    size={18}
                    color="#F43F5E"
                  />
                </View>

                <View>
                  <Text style={st.cardTitle}>
                    号砲設定
                  </Text>
                </View>

              </View>

              <Text style={st.cardIndex}>
                02
              </Text>

            </View>


            {/* ==================================================
                Random toggle
            =================================================== */}

            <View style={st.randomControl}>

              <View style={st.randomCopy}>

                <View style={st.randomTitleRow}>

                  <View
                    style={[
                      st.randomIndicator,
                      settings.gunRandom &&
                        st.randomIndicatorActive,
                    ]}
                  />

                  <Text style={st.label}>
                    {t(
                      'starterSettings.setToGun'
                    )}
                  </Text>

                </View>


                <Text style={st.randomDescription}>
                  {settings.gunRandom
                    ? 'ランダム'
                    : '固定'}
                </Text>

              </View>


              <View style={st.switchContainer}>

                <Text
                  style={[
                    st.switchLabel,
                    settings.gunRandom &&
                      st.switchLabelActive,
                  ]}
                >
                  {t(
                    'starterSettings.random'
                  )}
                </Text>

                <Switch
                  value={settings.gunRandom}
                  onValueChange={(v) => {
                    unlockAudio()
                    Sounds.toggleOn()
                    update({
                      gunRandom: v,
                    })
                  }}
                  trackColor={{
                    false:
                      'rgba(0,0,0,0.12)',
                    true: BRAND,
                  }}
                  thumbColor="#fff"
                  ios_backgroundColor="rgba(0,0,0,0.12)"
                />

              </View>

            </View>


            {/* ==================================================
                Random state
            =================================================== */}

            {settings.gunRandom ? (

              <View style={st.randomPanel}>

                <View style={st.randomPanelTop}>

                  <View>
                    <Text style={st.randomPanelEyebrow}>
                      範囲
                    </Text>

                    <Text style={st.randomPanelValue}>
                      {GUN_RANDOM_MIN.toFixed(1)}
                      <Text style={st.randomPanelUnit}>
                        {' '}—{' '}
                      </Text>
                      {GUN_RANDOM_MAX.toFixed(1)}
                      <Text style={st.randomPanelUnit}>
                        {' '}秒
                      </Text>
                    </Text>
                  </View>


                  <View style={st.randomIcon}>
                    <Ionicons
                      name="shuffle"
                      size={21}
                      color={BRAND}
                    />
                  </View>

                </View>


                <View style={st.randomVisual}>

                  <View
                    style={[
                      st.randomLine,
                      {
                        backgroundColor:
                          'rgba(251,146,60,0.22)',
                      },
                    ]}
                  />

                  <View
                    style={[
                      st.randomMarker,
                      {
                        left: '18%',
                      },
                    ]}
                  />

                  <View
                    style={[
                      st.randomMarker,
                      {
                        left: '48%',
                      },
                    ]}
                  />

                  <View
                    style={[
                      st.randomMarker,
                      {
                        left: '79%',
                      },
                    ]}
                  />

                </View>


                <Text style={st.hint}>
                  {t(
                    'starterSettings.randomHint',
                    {
                      min: GUN_RANDOM_MIN,
                      max: GUN_RANDOM_MAX,
                    }
                  )}
                </Text>

              </View>

            ) : (

              /* ==================================================
                 Fixed state
              =================================================== */

              <View style={st.fixedPanel}>

                <View style={st.settingTop}>

                  <View
                    style={st.settingNameWrap}
                  >

                    <View
                      style={[
                        st.phaseDot,
                        {
                          backgroundColor:
                            '#F43F5E',
                        },
                      ]}
                    />

                    <Text style={st.label}>
                      {t(
                        'starterSettings.fixedWait'
                      )}
                    </Text>

                  </View>


                  <View
                    style={[
                      st.valueBox,
                      {
                        backgroundColor:
                          'rgba(244,63,94,0.08)',
                        borderColor:
                          'rgba(244,63,94,0.16)',
                      },
                    ]}
                  >

                    <Text
                      style={[
                        st.valueNumber,
                        {
                          color:
                            '#F43F5E',
                        },
                      ]}
                    >
                      {settings.gunFixedSec.toFixed(1)}
                    </Text>

                    <Text
                      style={[
                        st.valueUnit,
                        {
                          color:
                            '#F43F5E',
                        },
                      ]}
                    >
                      s
                    </Text>

                  </View>

                </View>


                <View style={st.sliderWrap}>

                  <SimpleSlider
                    value={
                      settings.gunFixedSec
                    }
                    min={1}
                    max={3}
                    step={0.1}
                    color="#F43F5E"
                    onChange={(v) =>
                      update({
                        gunFixedSec: v,
                      })
                    }
                  />

                </View>


                <View style={st.rangeRow}>

                  <Text style={st.rangeText}>
                    1.0 s
                  </Text>

                  <Text style={st.rangeText}>
                    3.0 s
                  </Text>

                </View>

              </View>

            )}

          </Animated.View>


          {/* ==================================================
              Sequence preview
          =================================================== */}

          <View style={st.preview}>

            <View style={st.previewHeader}>

              <Text style={st.previewEyebrow}>
                流れ
              </Text>

              <Ionicons
                name="pulse-outline"
                size={16}
                color={TEXT_HINT}
              />

            </View>


            <View style={st.timeline}>

              <View style={st.timelineNode}>

                <View
                  style={[
                    st.timelineDot,
                    {
                      backgroundColor:
                        BLUE,
                    },
                  ]}
                />

                <Text style={st.timelineLabel}>
                  MARKS
                </Text>

              </View>


              <View
                style={[
                  st.timelineLine,
                  {
                    backgroundColor:
                      'rgba(56,189,248,0.25)',
                  },
                ]}
              />


              <View style={st.timelineNode}>

                <View
                  style={[
                    st.timelineDot,
                    {
                      backgroundColor:
                        BRAND,
                    },
                  ]}
                />

                <Text style={st.timelineLabel}>
                  SET
                </Text>

              </View>


              <View
                style={[
                  st.timelineLine,
                  {
                    backgroundColor:
                      'rgba(251,146,60,0.25)',
                  },
                ]}
              />


              <View style={st.timelineNode}>

                <View
                  style={[
                    st.timelineDot,
                    {
                      backgroundColor:
                        '#F43F5E',
                    },
                  ]}
                />

                <Text style={st.timelineLabel}>
                  GO
                </Text>

              </View>

            </View>


            <Text style={st.previewText}>
              自動保存されます
            </Text>

          </View>


          <View style={st.bottomSpace} />

        </ScrollView>

      </Animated.View>

    </SafeAreaView>
  )
}


// ============================================================
// Styles
// ============================================================

const st = StyleSheet.create({

  // ==========================================================
  // Root
  // ==========================================================

  safe: {
    flex: 1,
    backgroundColor: BG,
  },

  loading: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingMark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND,
  },


  // ==========================================================
  // Background
  // ==========================================================

  backgroundGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -180,
    right: -120,
    backgroundColor:
      'rgba(22,101,52,0.12)',
  },


  // ==========================================================
  // Header
  // ==========================================================

  header: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(0,0,0,0.06)',
  },

  backBtn: {
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
    letterSpacing: 2.1,
    color: TEXT_HINT,
    marginBottom: 3,
  },

  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_PRIMARY,
    letterSpacing: -0.2,
  },

  headerRight: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GREEN,
  },


  // ==========================================================
  // Content
  // ==========================================================

  content: {
    flex: 1,
  },

  scroll: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 30,
    gap: 16,
  },


  // ==========================================================
  // Intro
  // ==========================================================

  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },

  introNumber: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor:
      'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor:
      'rgba(0,0,0,0.02)',
  },

  introNumberText: {
    fontSize: 11,
    fontWeight: '900',
    color: TEXT_SECONDARY,
    fontVariant: ['tabular-nums'],
  },

  introCopy: {
    flex: 1,
  },

  introEyebrow: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: BRAND,
    marginBottom: 3,
  },

  introTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
    color: TEXT_PRIMARY,
  },

  introDescription: {
    fontSize: 11,
    fontWeight: '500',
    color: TEXT_HINT,
    marginTop: 3,
  },


  // ==========================================================
  // Cards
  // ==========================================================

  card: {
    borderRadius: 25,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    padding: 18,
    overflow: 'hidden',

    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 7,
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },

  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },

  cardEyebrow: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: TEXT_HINT,
    marginBottom: 3,
  },

  cardTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
    color: TEXT_PRIMARY,
  },

  cardIndex: {
    fontSize: 10,
    fontWeight: '800',
    color: TEXT_HINT,
    fontVariant: ['tabular-nums'],
  },


  // ==========================================================
  // Setting block
  // ==========================================================

  settingBlock: {
    width: '100%',
  },

  settingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  settingNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 12,
  },

  phaseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 9,
  },

  label: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },


  // ==========================================================
  // Value
  // ==========================================================

  valueBox: {
    minWidth: 74,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor:
      'rgba(56,189,248,0.16)',
    backgroundColor:
      'rgba(56,189,248,0.07)',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingHorizontal: 11,
  },

  valueNumber: {
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    color: BLUE,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.8,
  },

  valueUnit: {
    fontSize: 11,
    fontWeight: '800',
    color: BLUE,
    marginLeft: 3,
  },


  // ==========================================================
  // Slider
  // ==========================================================

  sliderWrap: {
    marginTop: 14,
    paddingHorizontal: 1,
  },

  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },

  rangeText: {
    fontSize: 9,
    fontWeight: '600',
    color: TEXT_HINT,
    fontVariant: ['tabular-nums'],
  },

  rangeCenter: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: TEXT_HINT,
  },


  // ==========================================================
  // Divider
  // ==========================================================

  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 24,
  },


  // ==========================================================
  // Random control
  // ==========================================================

  randomControl: {
    minHeight: 66,
    borderRadius: 17,
    borderWidth: 1,
    borderColor:
      'rgba(0,0,0,0.05)',
    backgroundColor:
      'rgba(0,0,0,0.02)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  randomCopy: {
    flex: 1,
    paddingRight: 10,
  },

  randomTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  randomIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: TEXT_HINT,
    marginRight: 9,
  },

  randomIndicatorActive: {
    backgroundColor: BRAND,
  },

  randomDescription: {
    fontSize: 10,
    fontWeight: '600',
    color: TEXT_HINT,
    marginTop: 4,
    marginLeft: 16,
  },

  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  switchLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: TEXT_HINT,
  },

  switchLabelActive: {
    color: BRAND,
  },


  // ==========================================================
  // Random panel
  // ==========================================================

  randomPanel: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      'rgba(251,146,60,0.13)',
    backgroundColor:
      'rgba(251,146,60,0.045)',
    padding: 15,
  },

  randomPanelTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  randomPanelEyebrow: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: TEXT_HINT,
    marginBottom: 4,
  },

  randomPanelValue: {
    fontSize: 25,
    fontWeight: '900',
    color: BRAND,
    letterSpacing: -0.7,
    fontVariant: ['tabular-nums'],
  },

  randomPanelUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: BRAND,
    letterSpacing: 0,
  },

  randomIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:
      'rgba(251,146,60,0.09)',
    borderWidth: 1,
    borderColor:
      'rgba(251,146,60,0.15)',
  },

  randomVisual: {
    height: 22,
    marginTop: 14,
    position: 'relative',
    justifyContent: 'center',
  },

  randomLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
  },

  randomMarker: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: BRAND,
    top: 7,
  },

  hint: {
    fontSize: 11,
    lineHeight: 17,
    color: TEXT_SECONDARY,
    marginTop: 10,
  },


  // ==========================================================
  // Fixed panel
  // ==========================================================

  fixedPanel: {
    marginTop: 15,
  },


  // ==========================================================
  // Sequence preview
  // ==========================================================

  preview: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor:
      'rgba(0,0,0,0.02)',
    padding: 16,
  },

  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },

  previewEyebrow: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.7,
    color: TEXT_HINT,
  },

  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  timelineNode: {
    alignItems: 'center',
  },

  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginBottom: 7,
  },

  timelineLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: TEXT_SECONDARY,
  },

  timelineLine: {
    flex: 1,
    height: 1,
    marginHorizontal: 8,
    marginBottom: 16,
  },

  previewText: {
    fontSize: 9,
    fontWeight: '500',
    color: TEXT_HINT,
    marginTop: 15,
  },


  // ==========================================================
  // Bottom
  // ==========================================================

  bottomSpace: {
    height: 8,
  },

})
