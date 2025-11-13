// BEGIN HANDOVER: IDEMPOTENCY
export const stableId=(patientId:string, kind:string, fingerprint:string)=>{
  const s=`${patientId}:${kind}:${fingerprint}`;
  let h=0;
  for (let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))>>>0; }
  const hex=h.toString(16).padStart(8,"0");
  return (hex+hex+hex).slice(0,24);
};
// END HANDOVER: IDEMPOTENCY
