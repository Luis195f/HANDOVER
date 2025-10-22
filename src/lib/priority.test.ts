import { describe, it, expect } from "vitest";
import { news2Score, priorityFromNews2, sortByPriority } from "./priority";

describe("priority.ts (mínimo)", () => {
  it("news2Score: caso basal debe ser 0", () => {
    const s = news2Score({ rr:16, hr:85, sbp:120, temp:37, spo2:97, o2:false, acvpu:"A" });
    expect(s).toBe(0);
  });

  it("news2Score: caso crítico suma alto", () => {
    const s = news2Score({ rr:28, hr:135, sbp:88, temp:39.2, spo2:91, o2:true, acvpu:"V" });
    //  rr>=25:3, hr>=131:3, sbp<=90:3, temp>=39.1:2, spo2<=91:3, O2:2, AVPU≠A:3 → total 19
    expect(s).toBe(19);
  });

  it("priorityFromNews2: mapea umbrales (low/medium/high)", () => {
    expect(priorityFromNews2(4)).toBe("low");
    expect(priorityFromNews2(5)).toBe("medium");
    expect(priorityFromNews2(7)).toBe("high");
  });

  it("sortByPriority: ordena por criticidad y es estable en empates", () => {
    const data = [
      { id:"a", news2:5 },
      { id:"b", news2:7 },
      { id:"c", news2:5 }, // empate con "a"
      { id:"d", news2:2 },
    ];
    const out = sortByPriority(data);
    expect(out.map(x=>x.id)).toEqual(["b","a","c","d"]); // "a" antes de "c" (estable)
  });
});
