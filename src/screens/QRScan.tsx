// BEGIN HANDOVER: QR_SCAN
import React,{useEffect,useState} from "react";
import { Text, View, Button } from "react-native";
import { BarCodeScanner } from "expo-barcode-scanner";
export default function QRScan({navigation}:any){
  const [hasPermission,setHasPermission]=useState<boolean|null>(null);
  const [scanned,setScanned]=useState(false);
  useEffect(()=>{(async()=>{const {status}=await BarCodeScanner.requestPermissionsAsync(); setHasPermission(status==="granted");})();},[]);
  if(hasPermission===null) return <Text>Solicitando permiso…</Text>;
  if(hasPermission===false) return <Text>Sin permiso de cámara</Text>;
  return <View style={{flex:1}}>
    <BarCodeScanner style={{flex:1}} onBarCodeScanned={scanned?undefined:({data})=>{
      setScanned(true);
      const m=data.match(/Patient\/([A-Za-z0-9\-]+)/);
      if(m) navigation.navigate("Patient", { id: m[1] });
    }}/>
    {scanned && <Button title="Escanear otro" onPress={()=>setScanned(false)}/>}
  </View>;
}
// END HANDOVER: QR_SCAN
