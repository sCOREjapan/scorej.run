// components/Avatar.tsx — アバター表示・選択の共通コンポーネント
// 2026-09-24: 元々app/(tabs)/team.tsx内にしか無かったが、設定(マイページ)画面からも
// 同じアバターを変更できるようにするため、共有コンポーネントとして切り出した。
import React from 'react'
import { View, Text, Image, TouchableOpacity, ScrollView, Modal, StyleSheet, Dimensions } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'
import { AVATAR_IMAGES, AVATAR_KEYS } from '../lib/avatarAssets'

const SCREEN_H = Dimensions.get('window').height

// avatarKeyがあればプリセットキャラクター画像を最優先で表示する
// （lib/avatarAssets.ts参照）。無ければ従来通りemoji→頭文字の順にフォールバック。
export function Avatar({ name, size=40, color=BRAND, emoji, avatarKey }: { name:string; size?:number; color?:string; emoji?:string; avatarKey?:string }) {
  const source = avatarKey ? AVATAR_IMAGES[avatarKey] : undefined
  if (source) {
    return <Image source={source} style={{width:size,height:size,borderRadius:size/2,backgroundColor:color+'11'}} resizeMode="cover"/>
  }
  return (
    <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:color+'22',borderWidth:1.5,borderColor:color+'44',alignItems:'center',justifyContent:'center'}}>
      {emoji
        ? <Text style={{fontSize:size*.52,lineHeight:size*.68}}>{emoji}</Text>
        : <Text style={{color,fontSize:size*.38,fontWeight:'800'}}>{name.charAt(0)}</Text>
      }
    </View>
  )
}

// 選手・コーチ共通のプリセットアバター選択モーダル
export function AvatarPickerModal({ visible, current, onSelect, onClose }: {
  visible: boolean; current?: string; onSelect: (key: string) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose}/>
        <View style={{backgroundColor:colors.card,borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:44,maxHeight:SCREEN_H*0.7}}>
          <View style={{width:36,height:4,borderRadius:2,backgroundColor:colors.border,alignSelf:'center',marginBottom:16}}/>
          <Text style={{fontSize:16,fontWeight:'800',color:colors.text,marginBottom:16}}>{t('team.avatarPicker.title')}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
              {AVATAR_KEYS.map(key => (
                <TouchableOpacity
                  key={key}
                  onPress={() => onSelect(key)}
                  activeOpacity={0.75}
                  style={{
                    width:64,height:64,borderRadius:16,overflow:'hidden',
                    borderWidth: current===key?3:0, borderColor:BRAND,
                  }}
                >
                  <Image source={AVATAR_IMAGES[key]} style={{width:'100%',height:'100%'}} resizeMode="cover"/>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

export const AVATAR_COLORS = ['#FF3B30','#FF9500','#34C759','#007AFF','#AF52DE']
export function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0)%AVATAR_COLORS.length] }

// リスクスコアを、アバターを囲む細いリングの塗り具合で表す（行全体を着色しない代わりの表現）
export function RingAvatar({ name, size=44, color, ringPct, avatarKey }: { name:string; size?:number; color:string; ringPct:number; avatarKey?:string }) {
  const { colors } = useTheme()
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, ringPct)) / 100
  const innerInset = stroke + 2
  const innerSize = size - innerInset * 2
  const source = avatarKey ? AVATAR_IMAGES[avatarKey] : undefined
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - filled)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
        />
      </Svg>
      <View style={{
        position: 'absolute', top: innerInset, left: innerInset, width: innerSize, height: innerSize,
        borderRadius: innerSize / 2, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {source
          ? <Image source={source} style={{width:'100%',height:'100%'}} resizeMode="cover"/>
          : <Text style={{ color: colors.textSec, fontSize: innerSize * .38, fontWeight: '800' }}>{name.charAt(0)}</Text>
        }
      </View>
    </View>
  )
}
