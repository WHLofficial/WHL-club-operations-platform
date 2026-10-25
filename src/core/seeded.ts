// 确定性伪随机 [0,1)：同 seed+draw 恒定（关窗批重跑必须逐字一致）。FNV-1a 喂入 + splitmix32 收尾。
// v6.54.0 从 src/worker/venue-ops.ts 上收 core：闹涨薪域（生成闸 draw 20 / 还价判定 draw 21）
// 要与档期、随机事件、冠名对赌、传闻共用同一随机源——确定性契约只有一份，各域用不同 draw 区分。
export function seededUnit(seed: number[], draw: number): number {
  let h = 0x811c9dc5;
  for (const value of [...seed, draw]) {
    let x = value | 0;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (x & 0xff), 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  let z = (h + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z / 4294967296;
}
