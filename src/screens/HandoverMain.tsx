import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Button, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VictoryChart, VictoryLine, VictoryTheme } from 'victory-native'; // INSTALAR: victory-native (y react-native-svg)
import * as Speech from 'expo-speech'; // INSTALAR: expo-speech
import Chip from '@/src/components/Chip';
import PatientCard from '@/src/components/PatientCard';
import AudioAttach from '@/src/components/AudioAttach';

type Vitales = { hr?: number; rr?: number; temp?: number; spo2?: number; sbp?: number; dbp?: number; bgMgDl?: number; avpu?: string; };
type Paciente = { id: string; name: string; age: number; sex: 'Masculino'|'Femenino'|'Otro'; room: string; unit: string; dx: string; };

const PACIENTE_MOCK: Paciente = { id: 'pat-004', name: 'Carlos Gómez', age: 54, sex: 'Masculino', room: 'C-312', unit: 'Medicina Interna', dx: 'Neumonía adquirida en la comunidad' };

// Catálogo amplio de dispositivos (seleccionables)
const CATALOGO_DISPOSITIVOS = [
  'VVP','Línea arterial','CVC','PICC','Port-a-Cath','Sonda vesical Foley','SNG','SNE','Sonda yeyunal',
  'Traqueostomía','Cánula nasal','Mascarilla simple','Venturi','Reservorio (NRB)','CPAP/BiPAP','Ventilación mecánica',
  'Bomba de infusión','PCA','Drenaje torácico','Drenaje Jackson-Pratt','VAC (vacuoterapia)','Marcapasos temporal',
  'Colostomía','Ileostomía','Hemodiálisis (catéter)','Drenajes quirúrgicos'
];

// Cálculo simple NEWS2 (placeholder visual, NO sustituye tu lógica real)
function calcularNEWS2(v: Vitales): { score: number; color: string; etiqueta: string } {
  let s = 0;
  if (v.rr && (v.rr < 8 || v.rr > 25)) s += 3; else if (v.rr && (v.rr >= 21 && v.rr <= 24)) s += 2; else if (v.rr && (v.rr >= 9 && v.rr <= 11)) s += 1;
  if (v.spo2 && v.spo2 < 92) s += 3; else if (v.spo2 && v.spo2 <= 93) s += 2; else if (v.spo2 && v.spo2 <= 95) s += 1;
  if (v.temp && (v.temp < 35 || v.temp >= 39.1)) s += 3; else if (v.temp && (v.temp >= 38.1 && v.temp <= 39)) s += 1; else if (v.temp && (v.temp >= 35.1 && v.temp <= 36)) s += 1;
  if (v.sbp && (v.sbp <= 90)) s += 3; else if (v.sbp && (v.sbp >= 91 && v.sbp <= 100)) s += 2; else if (v.sbp && (v.sbp >= 101 && v.sbp <= 110)) s += 1;
  // HR simplificado
  if (v.hr && (v.hr <= 40 || v.hr >= 131)) s += 3; else if (v.hr && (v.hr >= 111 && v.hr <= 130)) s += 2; else if (v.hr && (v.hr >= 41 && v.hr <= 50)) s += 1; else if (v.hr && (v.hr >= 91 && v.hr <= 110)) s += 1;
  const color = s >= 7 ? '#EF4444' : s >= 5 ? '#F59E0B' : '#10B981';
  const etiqueta = s >= 7 ? 'Alto' : s >= 5 ? 'Moderado' : 'Bajo';
  return { score: s, color, etiqueta };
}

export default function HandoverMain() {
  const [tab, setTab] = useState<'admin'|'paciente'|'vitales'|'dispositivos'|'meds'|'examenes'|'dx'|'cuidados'|'cierre'>('admin');
  const [v, setV] = useState<Vitales>({ hr: 80, rr: 16, temp: 37.2, spo2: 96, sbp: 118, dbp: 75, bgMgDl: 110, avpu: 'A' });
  const [sb, setSb] = useState({ s:'', b:'', a:'', r:'' });
  const [meds, setMeds] = useState('Paracetamol 1g, Omeprazol 20mg');
  const [ox, setOx] = useState({ dispositivo: 'Cánula / Mascarilla', flujo: '2', fio2: '30' });
  const [disps, setDisps] = useState<string[]>(['Cánula nasal']);
  const news2 = useMemo(()=>calcularNEWS2(v),[v]);

  const tabs = [
    {k:'admin',t:'Administrativo'},{k:'paciente',t:'Paciente'},{k:'vitales',t:'Signos Vitales'},{k:'dispositivos',t:'Dispositivos'},
    {k:'meds',t:'Medicación'},{k:'examenes',t:'Exámenes'},{k:'dx',t:'Diagnóstico/Evolución'},{k:'cuidados',t:'Cuidados/Riesgos'},{k:'cierre',t:'Cierre'},
  ] as const;

  return (
    <SafeAreaView style={s.container}>
      {/* Tabs superiores */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabbar}>
        {tabs.map(t=>(
          <TouchableOpacity key={t.k} onPress={()=>setTab(t.k)} style={[s.tab, tab===t.k && s.tabActive]}>
            <Text style={[s.tabText, tab===t.k && s.tabTextActive]}>{t.t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={s.content}>
        {tab==='admin' && <Administrativo />}
        {tab==='paciente' && <Paciente paciente={PACIENTE_MOCK} news2Color={news2.color} news2Score={news2.score} news2Etiqueta={news2.etiqueta} />}
        {tab==='vitales' && <Vitales v={v} setV={setV} news2={news2} />}
        {tab==='dispositivos' && <Dispositivos seleccionados={disps} setSeleccionados={setDisps} />}
        {tab==='meds' && <Medicacion meds={meds} setMeds={setMeds} ox={ox} setOx={setOx} />}
        {tab==='examenes' && <Examenes />}
        {tab==='dx' && <Diagnostico sb={sb} setSb={setSb} />}
        {tab==='cuidados' && <Cuidados />}
        {tab==='cierre' && <Cierre sb={sb} v={v} meds={meds} disps={disps} ox={ox} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function Administrativo(){
  return (
    <View style={s.card}>
      <Text style={s.h1}>Administrativo</Text>
      <Label>Unidad</Label>
      <Input placeholder="Unidad" defaultValue="Medicina Interna" />
      <Label>Inicio</Label>
      <Input placeholder="2025-11-03T07:05Z" />
      <Label>Fin</Label>
      <Input placeholder="2025-11-03T11:05Z" />
      <Label>Enfermería entrante</Label>
      <Input placeholder="Entrante" />
      <Label>Enfermería saliente</Label>
      <Input placeholder="Saliente" />
      <Label>Paciente</Label>
      <Input placeholder="pat-004" />
    </View>
  );
}

function Paciente({paciente, news2Color, news2Score, news2Etiqueta}:{paciente:Paciente; news2Color:string; news2Score:number; news2Etiqueta:string;}){
  return (
    <View style={s.card}>
      <Text style={s.h1}>Paciente</Text>
      <PatientCard id={paciente.id} name={paciente.name} age={paciente.age} sex={paciente.sex} room={paciente.room} />
      <View style={[s.badge,{backgroundColor:news2Color}]}>
        <Text style={{color:'#fff',fontWeight:'700'}}>NEWS2: {news2Score} • {news2Etiqueta}</Text>
      </View>
      <View style={s.noteBox}>
        <Text style={s.noteTitle}>Diagnóstico principal</Text>
        <Text style={s.noteText}>{paciente.dx}</Text>
      </View>
    </View>
  );
}

function Vitales({v,setV,news2}:{v:Vitales; setV:(nv:Vitales)=>void; news2:{score:number;color:string;etiqueta:string}}){
  const hrData = [{x:1,y:78},{x:2,y:82},{x:3,y:80},{x:4,y:v.hr??80}];
  return (
    <View style={s.card}>
      <Text style={s.h1}>Signos Vitales</Text>
      <VictoryChart theme={VictoryTheme.material} height={200}>
        <VictoryLine data={hrData} style={{ data: { stroke: '#EF4444', strokeWidth: 2 } }} />
      </VictoryChart>
      <View style={s.grid2}>
        <Field label="Frecuencia cardíaca (/min)" value={String(v.hr??'')} onChangeText={t=>setV({...v,hr:Number(t)})} />
        <Field label="Frecuencia respiratoria (/min)" value={String(v.rr??'')} onChangeText={t=>setV({...v,rr:Number(t)})} />
        <Field label="Temperatura (°C)" value={String(v.temp??'')} onChangeText={t=>setV({...v,temp:Number(t)})} />
        <Field label="SpO₂ (%)" value={String(v.spo2??'')} onChangeText={t=>setV({...v,spo2:Number(t)})} />
        <Field label="TA sistólica (mmHg)" value={String(v.sbp??'')} onChangeText={t=>setV({...v,sbp:Number(t)})} />
        <Field label="TA diastólica (mmHg)" value={String(v.dbp??'')} onChangeText={t=>setV({...v,dbp:Number(t)})} />
        <Field label="Glucemia (mg/dL)" value={String(v.bgMgDl??'')} onChangeText={t=>setV({...v,bgMgDl:Number(t)})} />
        <Field label="AVPU" value={v.avpu??''} onChangeText={t=>setV({...v,avpu:t.toUpperCase()})} />
      </View>
      <View style={[s.badge,{backgroundColor:news2.color,alignSelf:'flex-start',marginTop:12}]}>
        <Text style={{color:'#fff',fontWeight:'700'}}>NEWS2: {news2.score} • {news2.etiqueta}</Text>
      </View>
    </View>
  );
}

function Dispositivos({seleccionados,setSeleccionados}:{seleccionados:string[]; setSeleccionados:(v:string[])=>void;}){
  const toggle = (d:string)=> setSeleccionados(seleccionados.includes(d) ? seleccionados.filter(x=>x!==d) : [...seleccionados,d]);
  return (
    <View style={s.card}>
      <Text style={s.h1}>Dispositivos</Text>
      <View style={s.chipsWrap}>
        {CATALOGO_DISPOSITIVOS.map(d=>(
          <View key={d} style={{margin:6}}>
            <TouchableOpacity onPress={()=>toggle(d)}>
              <Chip label={d} selected={seleccionados.includes(d)} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <Label>Comentarios</Label>
      <Input placeholder="Detalle de accesos, calibre, lateralidad, fecha de inserción…" />
    </View>
  );
}

function Medicacion({meds,setMeds,ox,setOx}:{meds:string; setMeds:(v:string)=>void; ox:{dispositivo:string;flujo:string;fio2:string}; setOx:(o:{dispositivo:string;flujo:string;fio2:string})=>void;}){
  return (
    <View style={s.card}>
      <Text style={s.h1}>Oxigenoterapia</Text>
      <Label>Dispositivo</Label>
      <Input placeholder="Cánula / Mascarilla / Venturi…" value={ox.dispositivo} onChangeText={t=>setOx({...ox,dispositivo:t})} />
      <Label>Flujo O₂ (L/min)</Label>
      <Input placeholder="2" keyboardType="number-pad" value={ox.flujo} onChangeText={t=>setOx({...ox,flujo:t})} />
      <Label>FiO₂ (%)</Label>
      <Input placeholder="30" keyboardType="number-pad" value={ox.fio2} onChangeText={t=>setOx({...ox,fio2:t})} />
      <View style={[s.divider,{marginVertical:16}]} />
      <Text style={s.h1}>Medicación</Text>
      <Label>Medicaciones (separadas por coma)</Label>
      <Input placeholder="Paracetamol 1g, Omeprazol 20mg" value={meds} onChangeText={setMeds} multiline />
    </View>
  );
}

function Examenes(){
  return (
    <View style={s.card}>
      <Text style={s.h1}>Exámenes</Text>
      <Input placeholder="Últimos exámenes relevantes y pendientes…" multiline />
      <Label>Procedimientos</Label>
      <Input placeholder="Realizados / Programados…" multiline />
    </View>
  );
}

function Diagnostico({sb,setSb}:{sb:{s:string;b:string;a:string;r:string}; setSb:(v:{s:string;b:string;a:string;r:string})=>void;}){
  return (
    <View style={s.card}>
      <Text style={s.h1}>Diagnóstico y Evolución (SBAR)</Text>
      <Label>SBAR – Situación</Label><Input placeholder="Situación…" value={sb.s} onChangeText={t=>setSb({...sb,s:t})} multiline />
      <Label>SBAR – Antecedentes</Label><Input placeholder="Antecedentes…" value={sb.b} onChangeText={t=>setSb({...sb,b:t})} multiline />
      <Label>SBAR – Análisis</Label><Input placeholder="Análisis…" value={sb.a} onChangeText={t=>setSb({...sb,a:t})} multiline />
      <Label>SBAR – Recomendación</Label><Input placeholder="Recomendación…" value={sb.r} onChangeText={t=>setSb({...sb,r:t})} multiline />
    </View>
  );
}

function Cuidados(){
  return (
    <View style={s.card}>
      <Text style={s.h1}>Cuidados y Riesgos</Text>
      <Label>Nutrición e hidratación</Label><Input placeholder="Dieta, tolerancia, balance hídrico…" multiline />
      <Label>Movilidad / Piel</Label><Input placeholder="Braden, cambios posturales, integridad cutánea…" multiline />
      <Label>Riesgos identificados</Label><Input placeholder="Caídas, convulsiones, aislamiento, etc." multiline />
      <Label>Incidentes</Label><Input placeholder="Evento adverso / casi-incidente…" multiline />
    </View>
  );
}

function Cierre({sb,v,meds,disps,ox}:{sb:{s:string;b:string;a:string;r:string}; v:Vitales; meds:string; disps:string[]; ox:{dispositivo:string;flujo:string;fio2:string}}){
  const resumen = useMemo(()=>[
    `Paciente: ${PACIENTE_MOCK.name} (${PACIENTE_MOCK.id})`,
    `Unidad: ${PACIENTE_MOCK.unit} • Habitación ${PACIENTE_MOCK.room}`,
    `Dx: ${PACIENTE_MOCK.dx}`,
    `SBAR: S:${sb.s} B:${sb.b} A:${sb.a} R:${sb.r}`,
    `Vitales: HR ${v.hr} • RR ${v.rr} • Temp ${v.temp} • SpO2 ${v.spo2} • PA ${v.sbp}/${v.dbp} • Glic ${v.bgMgDl}`,
    `Oxígeno: ${ox.dispositivo} • ${ox.flujo} L/min • FiO2 ${ox.fio2}%`,
    `Dispositivos: ${disps.join(', ') || '—'}`,
    `Medicación: ${meds || '—'}`
  ].join('\n'),[sb,v,meds,disps,ox]);

  return (
    <View style={s.card}>
      <Text style={s.h1}>Cierre</Text>
      <Label>Resumen final (lectura en voz alta)</Label>
      <View style={s.noteBox}><Text style={s.noteText}>{resumen}</Text></View>
      <View style={{marginVertical:8}}>
        <Button title="Reproducir (TTS)" onPress={()=>Speech.speak(resumen,{language:'es'})} />
      </View>
      <Label>Adjuntos</Label>
      <AudioAttach onRecorded={(uri)=>console.log('Audio:', uri)} />
      <View style={{height:12}} />
      <Button title="Guardar y Enviar (solo UI)" onPress={()=>console.log('Enviar bundle (UI): listo para integrar FHIR')} />
      <Text style={{marginTop:8,color:'#64748b',fontSize:12}}>
        * Esta pantalla no envía aún a FHIR: integraremos con buildHandoverBundle y cola offline en el siguiente paso.
      </Text>
    </View>
  );
}

function Label({children}:{children:React.ReactNode}){ return <Text style={s.label}>{children}</Text>; }
function Input(props: any){ return <TextInput {...props} style={[s.input, props.style]} placeholderTextColor="#94a3b8" />; }
function Field({label,value,onChangeText}:{label:string;value:string;onChangeText:(t:string)=>void}){ return (<View style={{marginBottom:10}}><Label>{label}</Label><Input value={value} onChangeText={onChangeText} keyboardType="numeric" /></View>); }

const s = StyleSheet.create({
  container:{flex:1,backgroundColor:'#F3F4F6'},
  tabbar:{backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#e5e7eb'},
  tab:{paddingHorizontal:14,paddingVertical:12,marginRight:6},
  tabActive:{borderBottomWidth:3,borderBottomColor:'#2563EB'},
  tabText:{color:'#334155',fontWeight:'600'},
  tabTextActive:{color:'#2563EB'},
  content:{padding:16},
  card:{backgroundColor:'#fff',borderRadius:16,padding:16,shadowColor:'#000',shadowOpacity:0.05,shadowOffset:{width:0,height:4},shadowRadius:8,elevation:2,marginBottom:16},
  h1:{fontSize:18,fontWeight:'800',color:'#0f172a',marginBottom:12},
  label:{fontWeight:'600',color:'#334155',marginBottom:6},
  input:{borderWidth:1,borderColor:'#e5e7eb',borderRadius:10,padding:10,backgroundColor:'#fff',color:'#0f172a'},
  grid2:{flexDirection:'row',flexWrap:'wrap',gap:10},
  badge:{paddingVertical:8,paddingHorizontal:12,borderRadius:999},
  noteBox:{backgroundColor:'#EEF2FF',borderRadius:12,padding:12},
  noteTitle:{fontSize:12,fontWeight:'700',color:'#6366F1',marginBottom:4},
  noteText:{color:'#312e81'},
  chipsWrap:{flexDirection:'row',flexWrap:'wrap',marginTop:8},
  divider:{height:1,backgroundColor:'#e2e8f0',width:'100%'}
});


