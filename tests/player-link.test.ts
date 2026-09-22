// 球员档案链接的目标 ID（增量 32）。
//
// 规则只有一条：fcId 优先、内部 id 回落。它决定「分享出去的链接能不能活过下一次导入」——
// 内部 id 是导入顺序的产物，fc_id 才是 FC26 的稳定身份（赛事平台的 player.id 也是它，
// 生产实测范围 19541–279948，与内部 id 空间 1–18301 不重叠）。
// 之所以单独锁一条用例：这条规则散在 11 个链接点上，任何一处手写模板串都会悄悄退回内部 id。
import { describe, expect, it } from 'vitest';
import { playerPath } from '../web/src/lib/player-link.ts';

describe('playerPath', () => {
  it('有 fcId 时用 fcId（内部 id 只是导入顺序的产物）', () => {
    expect(playerPath({ id: 301, fcId: 239085 })).toBe('/players/239085');
  });

  it('fcId 为空时回落内部 id（派生不出 FC26 ID 的球员，链接不能断）', () => {
    expect(playerPath({ id: 301, fcId: null })).toBe('/players/301');
    expect(playerPath({ id: 301 })).toBe('/players/301');
  });
});
