// 球员库筛选面板（v3.1.0）：桌面左栏与窄屏抽屉共用同一份控件，只有栅格外层不同。
// 面板只负责渲染与回调，筛选状态、URL 同步、列清单都在页面（pages/PlayersLibrary.tsx）手里。
import type { Dispatch, SetStateAction } from 'react';
import type { ClubDirectoryRow } from '../lib/api.ts';
import MultiSelect, { type MultiSelectItem } from './MultiSelect.tsx';
import { ATTR_GROUPS, ATTR_LABELS, playstyleById, SOURCE_LABEL } from '../lib/ref.ts';
import { COL_DEFS, MARKER_EMOJI, MARKER_LABEL, POSITIONS, STATUS_LABEL, type Filters } from '../lib/players-library.ts';
import { isGoldPlaystyleId } from '../../../src/core/fc26.ts';
import { MARKER_VALUES, type PlayerMarker } from '../../../src/core/squad-rules.ts';

export interface FilterPanelProps {
  filters: Filters;
  set: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setFilters: Dispatch<SetStateAction<Filters>>;
  clubs: ClubDirectoryRow[];
  togglePosition: (pos: string) => void;
  togglePs: (id: number) => void;
  resetAll: () => void;
  // 生效条件条数（与工具条按钮上的数字同一个来源：页面把摘要条的 chips.length 传进来）
  activeCount: number;
  activeCols: string[];
  manualCols: string[] | null;
  toggleCol: (key: string) => void;
  resetCols: () => void;
}

// PlayStyle 下拉数据（v3.1.1 步骤 4）：银徽章与金徽章是两件事——金徽在库里存「基础 ID+100」
// 且只进金槽（core/fc26.ts 的两段 ID 口径），所以顶层分两段、段内再按 EA 的六类分组。
// 段名排在 id 序之前：ref 表是按 id 升序的，不排序也能得到「先银后金」，但表一旦被重排就会串段。
const PS_TYPE_CN: Record<string, string> = {
  Finishing: '射门',
  Passing: '传球',
  Defending: '防守',
  Ballcontrol: '控球',
  Physical: '体格',
  Goalkeeper: '门将',
};

function psItem(row: { id: number; chs?: string; en?: string; type?: string }, section: string): MultiSelectItem {
  return {
    value: String(row.id),
    label: row.chs ?? row.en ?? String(row.id),
    section,
    group: PS_TYPE_CN[row.type ?? ''] ?? row.type ?? '其他',
  };
}

const PS_ROWS = [...playstyleById.values()].filter((r) => r.id > 0);
const PS_ITEMS: MultiSelectItem[] = [
  ...PS_ROWS.filter((r) => !isGoldPlaystyleId(r.id)).map((r) => psItem(r, '银徽章')),
  ...PS_ROWS.filter((r) => isGoldPlaystyleId(r.id)).map((r) => psItem(r, '金徽章')),
];

// 位置与显示列的多选下拉条目（v3.1.1 步骤 3）；位置只有 12 个码位、不分段
const POSITION_ITEMS: MultiSelectItem[] = POSITIONS.map((p) => ({ value: p, label: p }));
const COL_ITEMS: MultiSelectItem[] = COL_DEFS.map((d) => ({ value: d.key, label: d.label }));

export default function FilterPanel({
  filters,
  set,
  setFilters,
  clubs,
  togglePosition,
  togglePs,
  resetAll,
  activeCount,
  activeCols,
  manualCols,
  toggleCol,
  resetCols,
}: FilterPanelProps) {
  // 成对区间输入（v3.1.1 步骤 2）：同属性的上下限并成一行两列，左「最低」右「最高」。
  // 字段名与 URL 键一律不动（还是 caMin/caMax 这一套），这里只改版式与文案。
  // 摘要条那边不跟着合并（步骤 5 只并了位置与徽章）：上下限是两件独立的事，
  // 「CA ≥ 70」和「CA ≤ 90」各留一条 chip，删一个不会把另一个也带走。
  const pair = (minKey: keyof Filters, maxKey: keyof Filters, label: string, hint?: string) => (
    <div className="pair">
      <span className="pair-label">
        {label}
        {hint ? <span className="pair-hint">{hint}</span> : null}
      </span>
      <input
        type="number"
        name={String(minKey)}
        value={filters[minKey] as string}
        placeholder="最低"
        aria-label={`${label} 最低`}
        onChange={(e) => set(minKey, e.target.value as Filters[typeof minKey])}
      />
      <input
        type="number"
        name={String(maxKey)}
        value={filters[maxKey] as string}
        placeholder="最高"
        aria-label={`${label} 最高`}
        onChange={(e) => set(maxKey, e.target.value as Filters[typeof maxKey])}
      />
    </div>
  );

  return (
    <div className="lib-panel">
      <div className="library-controls control-row">
        <label className="field">
          俱乐部
          <select value={filters.club} onChange={(e) => set('club', e.target.value)}>
            <option value="">全部</option>
            <option value="free">自由身</option>
            {clubs.map((club) => (
              <option key={club.id} value={String(club.id)}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          状态
          <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">全部</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="seg seg-mini" role="radiogroup" aria-label="按可成长筛选">
          {([['all', '全部'], ['1', '可成长'], ['0', '非成长']] as const).map(([v, label]) => (
            <button key={v} type="button" className={filters.growable === v ? 'on' : ''} onClick={() => set('growable', v)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" type="button" onClick={resetAll}>
          清空筛选
        </button>
      </div>

      {/* 位置（v3.1.1 步骤 3）：改多选下拉，只有 12 个码位；原先的四个组 chip
          （门将/后卫/中场/前锋）下线，一行铺 5 行的位置清单收成一行控件。 */}
      <div className="lib-chip-row">
        <MultiSelect label="位置" items={POSITION_ITEMS} selected={filters.positions} onToggle={togglePosition} onClear={() => set('positions', [])} />
      </div>

      <details className="lib-adv" open={false}>
        <summary>更多筛选{activeCount > 0 ? `（已启用 ${activeCount} 项）` : ''}</summary>
        <div className="lib-adv-body">
          <div className="lib-adv-group">
            <h4>区间</h4>
            <div className="lib-adv-grid">
              {pair('caMin', 'caMax', 'CA')}
              {pair('paMin', 'paMax', 'PA')}
              {pair('gapMin', 'gapMax', '成长空间', 'PA−CA')}
              {pair('baseCaMin', 'baseCaMax', '初始 CA')}
              {pair('ageMin', 'ageMax', '年龄', '岁')}
              {pair('mvMin', 'mvMax', '身价', 'm')}
              {pair('inflMin', 'inflMax', '影响力')}
            </div>
          </div>
          <div className="lib-adv-group">
            <h4>细分属性</h4>
            <div className="lib-adv-grid">
              <label className="field">
                属性
                {/* 换属性键时把区间一起清掉：否则旧 min/max 留在状态里，摘要条看不见、计数不计、
                    单删不了，而选回同一个属性时它又会悄悄生效 */}
                <select
                  value={filters.attr}
                  onChange={(e) => setFilters((f) => ({ ...f, attr: e.target.value, attrMin: '', attrMax: '' }))}
                >
                  <option value="">不筛</option>
                  {/* v3.1.1 步骤 2：34 项按属性页的七组速查卡分组（单一来源 ref.ts），选项写中文名 */}
                  {ATTR_GROUPS.map((g) => (
                    <optgroup key={g.key} label={g.label}>
                      {g.keys.map((k) => (
                        <option key={k} value={k}>
                          {ATTR_LABELS[k] ?? k}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {filters.attr && pair('attrMin', 'attrMax', ATTR_LABELS[filters.attr] ?? filters.attr)}
            </div>
          </div>
          <div className="lib-adv-group">
            <h4>条件</h4>
            <div className="lib-adv-grid">
              <label className="field">
                惯用脚
                <select value={filters.foot} onChange={(e) => set('foot', e.target.value as Filters['foot'])}>
                  <option value="">全部</option>
                  <option value="1">右脚</option>
                  <option value="0">左脚</option>
                </select>
              </label>
              <label className="field">
                成长档位
                <select value={filters.growthTier} onChange={(e) => set('growthTier', e.target.value)}>
                  <option value="">全部</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={String(n)}>
                      {n} 档
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                经纪人性格
                <select value={filters.agentTier} onChange={(e) => set('agentTier', e.target.value)}>
                  <option value="">全部</option>
                  <option value="1">温和</option>
                  <option value="2">普通</option>
                  <option value="3">苛刻</option>
                </select>
              </label>
              <label className="field">
                标记
                <select value={filters.marker} onChange={(e) => set('marker', e.target.value as Filters['marker'])}>
                  <option value="">全部</option>
                  {(MARKER_VALUES as readonly string[]).map((m) => (
                    <option key={m} value={m}>
                      {MARKER_EMOJI[m as PlayerMarker]} {MARKER_LABEL[m as PlayerMarker]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field check">
                <input type="checkbox" checked={filters.futureStar} onChange={(e) => set('futureStar', e.target.checked)} />
                仅未来之星
              </label>
              <label className="field check">
                <input type="checkbox" checked={filters.chinaPlan} onChange={(e) => set('chinaPlan', e.target.checked)} />
                仅中国计划
              </label>
              <label className="field">
                FC ID
                <input type="number" value={filters.fcId} onChange={(e) => set('fcId', e.target.value)} placeholder="精确查号" />
              </label>
            </div>
            <div className="lib-adv-ps">
              <MultiSelect
                label="PlayStyle"
                items={PS_ITEMS}
                selected={filters.ps.map(String)}
                onToggle={(v) => togglePs(Number(v))}
                onClear={() => set('ps', [])}
              />
            </div>
          </div>
          <div className="lib-adv-group">
            <h4>合同</h4>
            <div className="lib-adv-grid">
              <label className="field">
                现行合同
                <select value={filters.hasContract} onChange={(e) => set('hasContract', e.target.value as Filters['hasContract'])}>
                  <option value="">不限</option>
                  <option value="1">有</option>
                  <option value="0">无</option>
                </select>
              </label>
              {pair('wageMin', 'wageMax', '工资', 'm/半赛季')}
              {pair('rcMin', 'rcMax', '解约金', 'm')}
              <label className="field check">
                <input type="checkbox" checked={filters.rcNone} onChange={(e) => set('rcNone', e.target.checked)} />
                无解约金条款
              </label>
              <label className="field">
                合同类型
                <select value={filters.contractType} onChange={(e) => set('contractType', e.target.value)}>
                  <option value="">全部</option>
                  <option value="formal">正式合同</option>
                  <option value="trainee">训练营合同</option>
                </select>
              </label>
              <label className="field">
                成约方式
                <select value={filters.source} onChange={(e) => set('source', e.target.value)}>
                  <option value="">全部</option>
                  {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                保护期
                <select value={filters.protectedSel} onChange={(e) => set('protectedSel', e.target.value as Filters['protectedSel'])}>
                  <option value="">不限</option>
                  <option value="in">保护期内</option>
                  <option value="out">保护期外</option>
                </select>
              </label>
              {pair('yearsMin', 'yearsMax', '效力时长', '赛季')}
            </div>
          </div>
        </div>
      </details>

      {/* 显示列（v3.1.1 步骤 3）：与位置同一个多选下拉 —— 18 个 chip 铺开吃掉左栏一大片，
          语义上本来就是「勾选哪些列」。手动改过列才在面板底部出现「恢复自动」。 */}
      <div className="lib-chip-row">
        <MultiSelect
          label="显示列"
          items={COL_ITEMS}
          selected={activeCols}
          onToggle={toggleCol}
          footer={
            manualCols !== null ? (
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetCols}>
                恢复自动
              </button>
            ) : null
          }
        />
      </div>
    </div>
  );
}
