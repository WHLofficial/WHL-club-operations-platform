// 球员库筛选面板（增量 26）：桌面左栏与窄屏抽屉共用同一份控件，只有栅格外层不同。
// 面板只负责渲染与回调，筛选状态、URL 同步、列清单都在页面（pages/PlayersLibrary.tsx）手里。
import type { Dispatch, SetStateAction } from 'react';
import type { ClubDirectoryRow } from '../lib/api.ts';
import { playstyleById, SOURCE_LABEL } from '../lib/ref.ts';
import { COL_DEFS, POSITION_GROUPS, POSITIONS, STATUS_LABEL, type Filters } from '../lib/players-library.ts';

export interface FilterPanelProps {
  filters: Filters;
  set: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setFilters: Dispatch<SetStateAction<Filters>>;
  clubs: ClubDirectoryRow[];
  togglePosition: (pos: string) => void;
  togglePs: (id: number) => void;
  resetAll: () => void;
  activeAdvCount: number;
  activeCols: string[];
  manualCols: string[] | null;
  toggleCol: (key: string) => void;
  resetCols: () => void;
}

// 细分属性键与后端白名单同源（FC26_GAME_ATTR_COLUMNS 尾段 34 项，照搬 src/core/fc26.ts）；
// 前端只做展示，硬校验在后端
const ATTR_KEYS = [
  'sprintspeed', 'acceleration', 'finishing', 'positioning', 'shotpower', 'longshots', 'penalties', 'volleys',
  'vision', 'crossing', 'freekickaccuracy', 'longpassing', 'shortpassing', 'curve', 'agility', 'balance',
  'reactions', 'composure', 'ballcontrol', 'dribbling', 'interceptions', 'headingaccuracy', 'defensiveawareness',
  'standingtackle', 'slidingtackle', 'jumping', 'stamina', 'strength', 'aggression',
  'gkdiving', 'gkhandling', 'gkkicking', 'gkpositioning', 'gkreflexes',
] as const;

// PlayStyle 下拉数据：ref 表按类型分组（id 0 是占位）
const PLAYSTYLES = [...playstyleById.values()].filter((r) => r.id > 0);
const PS_TYPES = [...new Set(PLAYSTYLES.map((r) => r.type ?? '其他'))];

export default function FilterPanel({
  filters,
  set,
  setFilters,
  clubs,
  togglePosition,
  togglePs,
  resetAll,
  activeAdvCount,
  activeCols,
  manualCols,
  toggleCol,
  resetCols,
}: FilterPanelProps) {
  const num = (key: keyof Filters, label: string, placeholder?: string) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={filters[key] as string}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as Filters[typeof key])}
      />
    </label>
  );

  return (
    <div className="lib-panel">
      <div className="library-controls">
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

      <div className="lib-chip-row" aria-label="位置多选">
        <span className="muted lib-chip-label">位置</span>
        {POSITION_GROUPS.map(([label, group]) => (
          <button
            key={label}
            type="button"
            className={`lib-chip${group.every((p) => filters.positions.includes(p)) ? ' on' : ''}`}
            onClick={() =>
              setFilters((f) => ({
                ...f,
                positions: group.every((p) => f.positions.includes(p))
                  ? f.positions.filter((p) => !group.includes(p))
                  : [...new Set([...f.positions, ...group])],
              }))
            }
          >
            {label}
          </button>
        ))}
        {POSITIONS.map((p) => (
          <button key={p} type="button" className={`lib-chip${filters.positions.includes(p) ? ' on' : ''}`} onClick={() => togglePosition(p)}>
            {p}
          </button>
        ))}
      </div>

      <details className="lib-adv" open={false}>
        <summary>更多筛选{activeAdvCount > 0 ? `（已启用 ${activeAdvCount} 项）` : ''}</summary>
        <div className="lib-adv-body">
          <div className="lib-adv-group">
            <h4>区间</h4>
            <div className="lib-adv-grid">
              {num('caMin', 'CA ≥')}
              {num('caMax', 'CA ≤')}
              {num('paMin', 'PA ≥')}
              {num('paMax', 'PA ≤')}
              {num('gapMin', '成长空间 ≥', 'PA−CA')}
              {num('gapMax', '成长空间 ≤')}
              {num('baseCaMin', '初始 CA ≥')}
              {num('baseCaMax', '初始 CA ≤')}
              {num('ageMin', '年龄 ≥')}
              {num('ageMax', '年龄 ≤')}
              {num('mvMin', '身价 ≥', 'm')}
              {num('mvMax', '身价 ≤', 'm')}
              {num('inflMin', '影响力 ≥')}
              {num('inflMax', '影响力 ≤')}
            </div>
          </div>
          <div className="lib-adv-group">
            <h4>细分属性</h4>
            <div className="lib-adv-grid">
              <label className="field">
                属性键
                <select value={filters.attr} onChange={(e) => set('attr', e.target.value)}>
                  <option value="">不筛</option>
                  {ATTR_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              {filters.attr && num('attrMin', '≥')}
              {filters.attr && num('attrMax', '≤')}
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
                经纪人
                <select value={filters.agentTier} onChange={(e) => set('agentTier', e.target.value)}>
                  <option value="">全部</option>
                  <option value="1">温和</option>
                  <option value="2">普通</option>
                  <option value="3">苛刻</option>
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
              <span className="muted">PlayStyle（多选，金徽也算）</span>
              {PS_TYPES.map((type) => (
                <div key={type} className="lib-chip-row">
                  <span className="muted lib-chip-label">{type}</span>
                  {PLAYSTYLES.filter((r) => (r.type ?? '其他') === type).map((r) => (
                    <button key={r.id} type="button" className={`lib-chip${filters.ps.includes(r.id) ? ' on' : ''}`} onClick={() => togglePs(r.id)}>
                      {r.chs ?? r.en ?? r.id}
                    </button>
                  ))}
                </div>
              ))}
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
              {num('wageMin', '工资 ≥', 'm/半赛季')}
              {num('wageMax', '工资 ≤', 'm/半赛季')}
              {num('rcMin', '解约金 ≥', 'm')}
              {num('rcMax', '解约金 ≤', 'm')}
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
              {num('yearsMin', '效力时长 ≥', '赛季')}
              {num('yearsMax', '效力时长 ≤', '赛季')}
            </div>
          </div>
        </div>
      </details>

      <details className="lib-cols">
        <summary>显示列（{activeCols.length} 列可变）</summary>
        <div className="lib-chip-row">
          {COL_DEFS.map((d) => (
            <button key={d.key} type="button" className={`lib-chip${activeCols.includes(d.key) ? ' on' : ''}`} onClick={() => toggleCol(d.key)}>
              {d.label}
            </button>
          ))}
          {manualCols !== null && (
            <button type="button" className="lib-chip" onClick={resetCols}>
              恢复自动
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
