// components/ConfirmSheet.tsx — 汎用の確認ダイアログ（Modalベース）
//
// 2026-09-21: React Native WebのAlert.alert()は複数ボタンの確認ダイアログとして
// 信頼できず（実機で「提出する」ボタンを押しても何も起きない不具合の原因になった）、
// app/(tabs)/team.tsxで既に使っていたこの自前Modalコンポーネントを他画面
// （app/race-plan.tsx等）からも使えるよう共通コンポーネント化した。
import React from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../context/ThemeContext'
import { BRAND } from '../lib/theme'

export default function ConfirmSheet({ visible, title, message, confirmLabel, dangerous, onConfirm, onCancel }: {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  dangerous?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'center',paddingHorizontal:28}}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onCancel}/>
        <View style={{backgroundColor:colors.card,borderRadius:20,padding:24,gap:16,shadowColor:'#000',shadowOffset:{width:0,height:8},shadowOpacity:0.18,shadowRadius:24,elevation:16}}>
          <View style={{alignItems:'center',gap:8}}>
            <View style={{width:48,height:48,borderRadius:14,backgroundColor:dangerous?'rgba(239,68,68,0.1)':'rgba(22,101,52,0.1)',alignItems:'center',justifyContent:'center'}}>
              <Ionicons name={dangerous?'warning-outline':'help-circle-outline'} size={26} color={dangerous?'#ef4444':BRAND}/>
            </View>
            <Text style={{color:colors.text,fontSize:17,fontWeight:'800',textAlign:'center'}}>{title}</Text>
            <Text style={{color:colors.textSec,fontSize:13,lineHeight:20,textAlign:'center'}}>{message}</Text>
          </View>
          <View style={{flexDirection:'row',gap:10}}>
            <TouchableOpacity
              style={{flex:1,paddingVertical:13,borderRadius:12,borderWidth:1,borderColor:colors.border,alignItems:'center'}}
              onPress={onCancel} activeOpacity={0.7}
            >
              <Text style={{color:colors.textSec,fontSize:14,fontWeight:'700'}}>{t('team.confirm.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{flex:1,paddingVertical:13,borderRadius:12,backgroundColor:dangerous?'#ef4444':BRAND,alignItems:'center'}}
              onPress={() => { onConfirm(); onCancel() }} activeOpacity={0.85}
            >
              <Text style={{color:'#fff',fontSize:14,fontWeight:'800'}}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
