import React from 'react';
import { View, Text } from 'react-native';

export default function PatientCard({ id, name, age, sex, room }:{id:string;name:string;age:number;sex:string;room:string}) {
  return <View style={{borderWidth:1,borderColor:'#e5e7eb',borderRadius:12,padding:12}}>
    <Text style={{fontSize:18,fontWeight:'700'}}>{name}</Text>
    <Text>ID: {id} • {age} años • {sex} • {room}</Text>
  </View>;
}
