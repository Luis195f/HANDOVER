// BEGIN HANDOVER: FHIR_BUNDLE
type FhirResource={ resourceType:string; id?:string; [k:string]:any };
export function bundleTx(resources:FhirResource[]){
  return { resourceType:"Bundle", type:"transaction",
    entry: resources.map(r=>({ resource:r, request:{ method: r.id?"PUT":"POST", url: r.id?`${r.resourceType}/${r.id}`:r.resourceType } })) };
}
// END HANDOVER: FHIR_BUNDLE
