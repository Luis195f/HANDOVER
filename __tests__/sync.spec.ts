// BEGIN HANDOVER: TEST_SYNC
import { queue } from "../src/lib/sync/offlineQueue";
it("enqueue/dequeue", async()=>{
  await queue.push({id:"1",type:"obs",payload:{},createdAt:Date.now()});
  const j=await queue.shift();
  expect(j?.id).toBe("1");
});
// END HANDOVER: TEST_SYNC
