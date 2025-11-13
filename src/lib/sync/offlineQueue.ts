// BEGIN HANDOVER: OFFLINE_QUEUE
import { secure } from "../secure-store";
type Job={ id:string; type:string; payload:any; createdAt:number };
const KEY="offlineQueue";
export const queue={
  all: async():Promise<Job[]>=>JSON.parse((await secure.get(KEY))||"[]"),
  push: async(j:Job)=>{ const q=await queue.all(); q.push(j); await secure.set(KEY,JSON.stringify(q)); },
  shift: async()=>{ const q=await queue.all(); const j=q.shift(); await secure.set(KEY,JSON.stringify(q)); return j; }
};
// END HANDOVER: OFFLINE_QUEUE
