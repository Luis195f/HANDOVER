import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getSession } from '@/src/security/auth';

export default function AuthGate() {
  const nav = useNavigation<any>();
  useEffect(() => { (async () => {
    const sess = await getSession();
    nav.reset({ index: 0, routes: [{ name: sess ? 'App' : 'Auth' }] });
  })(); }, [nav]);
  return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><ActivityIndicator/></View>;
}