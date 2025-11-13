// BEGIN HANDOVER: ALERTS_ENGINE
type Ctx={ daysWithCatheter?:number; allergy?:string; medication?:string; pendingLabs?:number };
export function evalAlerts(ctx:Ctx):string[]{
  const a:string[]=[];
  if((ctx.daysWithCatheter??0)>7) a.push("Catéter > 7 días");
  if(ctx.allergy && ctx.medication && ctx.medication.toLowerCase().includes(ctx.allergy.toLowerCase())) a.push("Alergia/medicación en conflicto");
  if((ctx.pendingLabs??0)>0) a.push("Exámenes pendientes");
  return a;
}
// END HANDOVER: ALERTS_ENGINE
