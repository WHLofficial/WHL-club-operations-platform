// @vitest-environment jsdom
// v6.37.2：+N 徽章从 span 改 button——手机没有 hover，原先只挂一条 title 等于死元素。
// 渲染契约（1+N 折叠、点击展开全量、再点收回、aria 属性）在这一处钉死。
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { CardBadges, CardGroup, RegCard, SquadCard } from './card-parts.tsx';
import { DESKTOP_CELLS, DESKTOP_CELLS_DESK } from '../../lib/club-cards.ts';
import type { PlayerLibraryRow, SquadPlayerRow } from '../../lib/api.ts';

afterEach(cleanup);

const badges = [
  { kind: 'status' as const, text: '挂牌中' },
  { kind: 'protect' as const, text: '保护期' },
  { kind: 'star' as const, text: '未来之星' },
];

describe('CardBadges 的 +N 展开（v6.37.2）', () => {
  it('收起只显首枚 +N（title 带全量）；点击展开全部徽章，再点收回', () => {
    const { container } = render(<CardBadges badges={badges} />);
    expect(container.querySelectorAll('.sqc-badge')).toHaveLength(2);
    const more = container.querySelector('button.sqc-badge-more') as HTMLButtonElement;
    expect(more).toBeTruthy();
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('title')).toBe('保护期、未来之星');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.getAttribute('aria-label')).toBe('展开其余 2 枚徽章');

    fireEvent.click(more);
    expect(Array.from(container.querySelectorAll('.sqc-badge'), (el) => el.textContent)).toEqual([
      '挂牌中',
      '保护期',
      '未来之星',
      '收起',
    ]);
    const back = container.querySelector('button.sqc-badge-more') as HTMLButtonElement;
    expect(back.getAttribute('aria-expanded')).toBe('true');
    expect(back.getAttribute('aria-label')).toBe('收回其余 2 枚徽章');

    fireEvent.click(back);
    expect(Array.from(container.querySelectorAll('.sqc-badge'), (el) => el.textContent)).toEqual(['挂牌中', '+2']);
  });

  it('无折叠（只有首枚）不渲染 button；空徽章且无 extra 整块不渲染', () => {
    const { container } = render(<CardBadges badges={badges.slice(0, 1)} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('.sqc-badge')).toHaveLength(1);

    const empty = render(<CardBadges badges={[]} />);
    expect(empty.container.innerHTML).toBe('');
  });
});

/* ---------- v6.38.1：值格分段色（CARD_VIEW_CELLS.shade 轴 = CA/PA/初始CA 套 attrClass 五档） ---------- */

const cardRow = {
  id: 1, uid: 'fc99001', name: '测试甲', number: '1', clubId: null, position: 'GK',
  age: 31, ca: 45, pa: 92, prestige: null, marketValue: null, status: 'active',
  transferListed: false, notForSale: false, growthTier: 1, isFutureStar: false,
  chinaPlan: false, agentTier: 0, badgesSilver: 0, badgesGold: 0,
  growable: true, clubName: null, positions: ['GK'], influence: 2,
  wage: null, releaseFee: null, contractType: null, foot: 3, baseCa: 45,
  fcId: 99001, source: null, serviceSeasons: null, protected: false,
} as unknown as PlayerLibraryRow;

describe('SquadCard 值格分段色（v6.38.1）', () => {
  it('基本视图：缺值格显 — 且不上色；PA 92 → attr-good；年龄不在 shade 轴不上色', () => {
    const { container } = render(
      <MemoryRouter>
        <SquadCard row={{ ...cardRow, ca: null as unknown as number }} view="basic" extras={[]} />
      </MemoryRouter>,
    );
    const vs = container.querySelectorAll('.sqc-v');
    // 年龄 / CA / PA（ca 缺 → 值 — 且类不带 attr-*）
    expect(vs[0]!.className).not.toContain('attr-');
    expect(vs[0]!.textContent).toBe('31');
    expect(vs[1]!.textContent).toBe('—');
    expect(vs[1]!.className).not.toContain('attr-');
    expect(vs[2]!.className).toContain('attr-good');
    expect(vs[2]!.textContent).toBe('92');
  });

  it('阈值五档抽样：45→bad、62→mid、78→solid、85→good（attrClass 阈值 50/60/70/80）', () => {
    const { container } = render(
      <MemoryRouter>
        <SquadCard row={{ ...cardRow, ca: 62, baseCa: 62 }} view="basic" extras={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.sqc-v')[1]!.className).toContain('attr-mid');
    expect(container.querySelectorAll('.sqc-v')[2]!.className).toContain('attr-good');
  });
});

/* ---------- v6.39.1/v6.39.2：宽卡（wide）结构契约 ----------
   桌面回归的根因在 CSS（基类 .sqc-m 改 grid 后 .sqc-card.wide 漏回 display:flex），
   jsdom 量不到 computed 布局，所以这里只钉**结构**：wide 必出 article.sqc-card.wide、
   值格走 DESKTOP_CELLS（13 格；注册台 RegCard 走 DESKTOP_CELLS_DESK 11 格）、窄卡不带 .wide、
   列头 wide/narrow 两分支渲染同一份标签列表。
   几何（computed display / 列头与值区逐列对齐）由 scripts/e2e/smoke.mjs ⑨ 段桌面分支量。 */

describe('SquadCard 宽窄结构（v6.39.1）', () => {
  it('wide：article 带 .wide 类，值区走 DESKTOP_CELLS 13 格（含身价/影响力/经纪人）', () => {
    const { container } = render(
      <MemoryRouter>
        <SquadCard row={cardRow} view="basic" extras={[]} wide />
      </MemoryRouter>,
    );
    const article = container.querySelector('article.sqc-card')!;
    expect(article.className).toContain('wide');
    expect(container.querySelectorAll('.sqc-v')).toHaveLength(13);
  });

  it('窄卡：article 不带 .wide，值区格数按视图（basic = 3）', () => {
    const { container } = render(
      <MemoryRouter>
        <SquadCard row={cardRow} view="basic" extras={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelector('article.sqc-card')!.className).not.toContain('wide');
    expect(container.querySelectorAll('.sqc-v')).toHaveLength(3);
  });

  it('组头：wide 走 .sqc-glegend、窄屏走 .sqc-gcols，两分支渲染同一份标签列表（逐列对齐的前提）', () => {
    const cells = DESKTOP_CELLS;
    const labels = cells.map((c) => c.label);
    const wide = render(
      <MemoryRouter>
        <CardGroup groupKey="GK" label="门将" count={1} cells={cells} extras={[]} wide>
          <SquadCard row={cardRow} view="basic" extras={[]} wide />
        </CardGroup>
      </MemoryRouter>,
    );
    expect(wide.container.querySelector('.sqc-gcols')).toBeNull();
    const wideK = [...wide.container.querySelectorAll('.sqc-glegend .sqc-k')].map((k) => k.textContent);
    expect(wideK).toEqual(labels);

    const narrow = render(
      <MemoryRouter>
        <CardGroup groupKey="GK" label="门将" count={1} cells={cells} extras={[]}>
          <SquadCard row={cardRow} view="basic" extras={[]} />
        </CardGroup>
      </MemoryRouter>,
    );
    expect(narrow.container.querySelector('.sqc-glegend')).toBeNull();
    expect([...narrow.container.querySelectorAll('.sqc-gcols .sqc-k')].map((k) => k.textContent)).toEqual(labels);
  });

  it('组头：assign 时带 .has-assign（宽屏列头右侧要让出分配列，否则列头比值区宽一截）', () => {
    const { container } = render(
      <MemoryRouter>
        <CardGroup groupKey="GK" label="门将" count={1} cells={DESKTOP_CELLS} extras={[]} wide assign>
          <SquadCard row={cardRow} view="basic" extras={[]} wide />
        </CardGroup>
      </MemoryRouter>,
    );
    expect(container.querySelector('.sqc-ghead')!.className).toContain('has-assign');
  });

  it('注册台宽卡（RegCard）：桌面 11 格（DESKTOP_CELLS_DESK 舍初始CA/成长空间），窄卡仍按视图 3 格', () => {
    const row = cardRow as unknown as SquadPlayerRow;
    const wide = render(
      <MemoryRouter>
        <RegCard row={row} view="basic" assign="none" flags={[]} extras={[]} wide onAssign={() => {}} />
      </MemoryRouter>,
    );
    const article = wide.container.querySelector('article.sqc-card')!;
    expect(article.className).toContain('wide');
    expect(article.className).toContain('has-assign');
    expect(wide.container.querySelectorAll('.sqc-v')).toHaveLength(DESKTOP_CELLS_DESK.length);
    expect(DESKTOP_CELLS_DESK.length).toBe(11);

    const narrow = render(
      <MemoryRouter>
        <RegCard row={row} view="basic" assign="none" flags={[]} extras={[]} onAssign={() => {}} />
      </MemoryRouter>,
    );
    expect(narrow.container.querySelectorAll('.sqc-v')).toHaveLength(3);
  });
});

/* ---------- v6.54.0 步骤 8：待生效小字的宽窄两种形态（§10.4 / §10.5） ----------
   桌面（wide）= 值格内第二行 `(+1.20)3.70`（注册台工资格带「待生效 」前缀）；
   窄屏（≤760，非 wide）= 值区下方整行第三行 `待生效 工资 3.70(+1.20) · 违约金 25(+5)`。
   两套格式不混用；窄屏绝不隐藏 pending（合规必须可见）——这是 TC-RD-32/33 的结构锁。 */

const pendingRow = {
  ...cardRow,
  wage: 2.5,
  releaseFee: 20,
  hasPending: true,
  pendingWage: 3.7,
  pendingReleaseFee: 25,
  pendingSource: 'demand' as const,
};

describe('待生效小字宽窄两形态（v6.54.0 §10.4/§10.5）', () => {
  it('注册台宽卡：工资格第二行「待生效 (+1.20)3.70」、RC 格「(+5)25」，并带 aria-label', () => {
    const row = pendingRow as unknown as SquadPlayerRow;
    const { container } = render(
      <MemoryRouter>
        <RegCard row={row} view="contract" assign="none" flags={[]} extras={[]} wide onAssign={() => {}} />
      </MemoryRouter>,
    );
    const cells = Array.from(container.querySelectorAll('.sqc-v')).filter((v) => v.querySelector('.sqc-pend'));
    // 合同视图里变化的两格：工资 / 违约金（wide 走 DESKTOP_CELLS_DESK，按内容定位而不是按固定下标）
    expect(cells).toHaveLength(2);
    expect(cells[0]!.textContent).toContain('2.50');
    expect(cells[0]!.querySelector('.sqc-pend')!.textContent).toBe('待生效 (+1.20)3.70');
    expect(cells[0]!.getAttribute('aria-label')).toBe('当前工资 2.50；待生效 3.70，加 1.20');
    expect(cells[1]!.textContent).toContain('20m');
    expect(cells[1]!.querySelector('.sqc-pend')!.textContent).toBe('(+5)25');
    // 窄屏第三行不在宽卡上渲染（两套格式不混用）
    expect(container.querySelector('.sqc-pend-row')).toBeNull();
  });

  it('阵容宽卡：小字只写差额新值，不带「待生效」前缀（§10.4 球队页口径）', () => {
    const { container } = render(
      <MemoryRouter>
        <SquadCard row={pendingRow as unknown as PlayerLibraryRow} view="contract" extras={[]} wide />
      </MemoryRouter>,
    );
    const wageCell = Array.from(container.querySelectorAll('.sqc-v')).find((v) =>
      v.querySelector('.sqc-pend'),
    )!;
    expect(wageCell.querySelector('.sqc-pend')!.textContent).toBe('(+1.20)3.70');
  });

  it('注册台窄卡：pending 走整行第三行（新值在前），值格内不出第二行', () => {
    const row = pendingRow as unknown as SquadPlayerRow;
    const { container } = render(
      <MemoryRouter>
        <RegCard row={row} view="contract" assign="none" flags={[]} extras={[]} onAssign={() => {}} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.sqc-pend')).toHaveLength(0);
    const third = container.querySelector('.sqc-pend-row')!;
    expect(third.textContent).toBe('待生效 工资 3.70(+1.20) · 违约金 25(+5)');
    expect(third.getAttribute('aria-label')).toBe('待生效 工资 3.70(+1.20) · 违约金 25(+5)');
  });

  it('阵容窄卡：同一个第三行（球队页与注册台同形）', () => {
    const { container } = render(
      <MemoryRouter>
        <SquadCard row={pendingRow as unknown as PlayerLibraryRow} view="basic" extras={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.sqc-pend-row')!.textContent).toBe('待生效 工资 3.70(+1.20) · 违约金 25(+5)');
  });

  it('RC-only pending：只有违约金变化时工资格不加第二行（宽窄两形态同口径）', () => {
    const row = {
      ...pendingRow,
      pendingWage: 2.5,
      pendingReleaseFee: 25,
    } as unknown as SquadPlayerRow;
    const wide = render(
      <MemoryRouter>
        <RegCard row={row} view="contract" assign="none" flags={[]} extras={[]} wide onAssign={() => {}} />
      </MemoryRouter>,
    );
    const wideCells = Array.from(wide.container.querySelectorAll('.sqc-v')).filter((v) => v.querySelector('.sqc-pend'));
    // 只有违约金那一格有小字；工资格不加（§10.5「RC-only pending 只 RC 第二行」）
    expect(wideCells).toHaveLength(1);
    expect(wideCells[0]!.querySelector('.sqc-pend')!.textContent).toBe('(+5)25');

    const narrow = render(
      <MemoryRouter>
        <RegCard row={row} view="contract" assign="none" flags={[]} extras={[]} onAssign={() => {}} />
      </MemoryRouter>,
    );
    expect(narrow.container.querySelector('.sqc-pend-row')!.textContent).toBe('待生效 违约金 25(+5)');
  });

  it('非 pending 行：宽窄都不渲染任何待生效小字', () => {
    const row = cardRow as unknown as SquadPlayerRow;
    const wide = render(
      <MemoryRouter>
        <RegCard row={row} view="contract" assign="none" flags={[]} extras={[]} wide onAssign={() => {}} />
      </MemoryRouter>,
    );
    expect(wide.container.querySelector('.sqc-pend')).toBeNull();
    expect(wide.container.querySelector('.sqc-pend-row')).toBeNull();

    const narrow = render(
      <MemoryRouter>
        <RegCard row={row} view="contract" assign="none" flags={[]} extras={[]} onAssign={() => {}} />
      </MemoryRouter>,
    );
    expect(narrow.container.querySelector('.sqc-pend')).toBeNull();
    expect(narrow.container.querySelector('.sqc-pend-row')).toBeNull();
  });
});
