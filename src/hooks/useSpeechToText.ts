// BEGIN HANDOVER: STT_HOOK
type STT={ start:()=>Promise<void>; stop:()=>Promise<string>; supported:boolean };
export function useSpeechToText():STT{
  let text="";
  return { supported:true, start: async()=>{ text=""; }, stop: async()=>text };
}
// END HANDOVER: STT_HOOK
