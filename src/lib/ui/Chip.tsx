// @ts-nocheck
import React from 'react';
import { Pressable, Text } from 'react-native';

export function Chip({ label, onPress }: { label: string; onPress: (label: string)=>void }) {
  return (
    <Pressable
      onPress={()=>onPress(label)}
      style={({pressed})=>({ paddingVertical:6, paddingHorizontal:10, borderRadius:9999,
        backgroundColor: pressed? '#23314f':'#1c2946', marginRight:8, marginBottom:8, borderWidth:1, borderColor:'#2f3b5c' })}>
      <Text style={{ color:'#cfe0ff' }}>{label}</Text>
    </Pressable>
  );
}
