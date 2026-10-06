// 阵容/注册名单卡片化共享组件（v6.37.0 定稿：位置分组即容器 + 行解剖，桌面与窄屏同构）。
// 窄屏（≤760px）：四视图 chips + 组头挂列头（值-only 指标格，宽度钉死 --sqc-cw 对齐）；
// 桌面：无 chips、四视图全列合并（DESKTOP_CELLS），组头列头退化为右对齐标签串（定稿画板 14-B）。
// 结构纪律沿袭既有窄屏案例：narrow 与桌面 DOM 互斥、类名一律 sqc- 前缀、CSS 集中在 styles.css 段末。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MARKER_EMOJI, MARKER_LABEL } from '../../lib/players-library.ts';
import {
  CARD_VIEWS,
  CARD_VIEW_CELLS,
  DESKTOP_CELLS,
  inlineBadgesOf,
  positionSummary,
  type CardCell,
  type CardMetricRow,
  type CardViewKey,
  type InlineBadge,
} from '../../lib/club-cards.ts';
import { clubCellClass, clubCellContent, clubColDef, type ClubColRow } from '../../lib/club-columns.tsx';
import { playerPath } from '../../lib/player-link.ts';
import type { PlayerLibraryRow, SquadIssue, SquadPlayerRow } from '../../lib/api.ts';

/** 注册名单的分配值（与 DeskTab 既有 Assignment 同形，提出共用） */
export type AssignValue = 'none' | 'first_team' | 'trainee';

const ASSIGN_OPTIONS: readonly { value: AssignValue; label: string }[] = [
  { value: 'none', label: '未分配' },
  { value: 'first_team', label: '一线队' },
  { value: 'trainee', label: '训练营' },
];

/** 位置组的色条颜色（组头左缘 3px）；unknown = 未知位置「其他」组 */
export const GROUP_ACCENTS: Record<string, string> = {
  GK: '#b45309',
  DF: '#047857',
  MF: '#1d4ed8',
  FW: '#b91c1c',
  unknown: '#64748b',
};

/** 各视图指标格的钉死列宽（窄屏值-only 对齐用；合同 4 列最宽、放得下「10.50 m」） */
export const VIEW_COL_WIDTH: Record<CardViewKey, string> = {
  basic: '40px',
  growth: '50px',
  contract: '52px',
  market: '52px',
};

/* ---------- 行内徽章（1 + N 折叠，定稿优先级在 club-cards.inlineBadgesOf） ---------- */

const BADGE_TIP: Record<string, string> = {
  无合同: '等管理组导入合同模板后才能注册',
};

export function CardBadges({ badges, extra }: { badges: readonly InlineBadge[]; extra?: ReactNode }) {
  if (badges.length === 0 && !extra) return null;
  const first = badges[0];
  const rest = badges.slice(1);
  return (
    <span className="sqc-badges">
      {first && (
        <span className={`sqc-badge sqc-badge-${first.kind}`} title={BADGE_TIP[first.text]}>
          {first.text}
        </span>
      )}
      {rest.length > 0 && (
        <span className="sqc-badge sqc-badge-more" title={rest.map((b) => b.text).join('、')}>
          +{rest.length}
        </span>
      )}
      {extra}
    </span>
  );
}

/* ---------- 副行：标记（行首，恒显不折叠）+ 主位置 +N（点展开）· UID ---------- */

function CardSubline({ marker, positions, uid }: { marker: string | null; positions: readonly string[]; uid: string }) {
  const [open, setOpen] = useState(false);
  const multi = positions.length > 1;
  const text = positionSummary(positions, open);
  return (
    <div className="sqc-subline">
      {marker && (
        <span className="sqc-marker" title={MARKER_LABEL[marker as keyof typeof MARKER_LABEL] ?? marker}>
          {MARKER_EMOJI[marker as keyof typeof MARKER_EMOJI] ?? marker}
        </span>
      )}
      {multi ? (
        <button
          type="button"
          className="sqc-pos"
          onClick={() => setOpen((v) => !v)}
          title={open ? '点击收回' : '点击展开全部位置'}
        >
          {text}
        </button>
      ) : (
        <span className="sqc-pos">{text ?? '—'}</span>
      )}
      <span className="sqc-sep" aria-hidden="true">
        ·
      </span>
      <span className="sqc-uid">{uid.replace(/^fc/, '')}</span>
    </div>
  );
}

/* ---------- 指标格：组头标签行 + 行内值（同一套钉死列宽，逐列对齐） ---------- */

export function extraColDefs(extraKeys: readonly string[]): { key: string; label: string }[] {
  return extraKeys.map((key) => ({ key, label: clubColDef(key)?.label ?? key }));
}

function metricValues(cells: readonly CardCell[], row: CardMetricRow, extras: readonly string[], colRow: ClubColRow): ReactNode[] {
  return [
    ...cells.map((c) => (
      <span key={c.key} className={`sqc-v${c.num === false ? '' : ' num'}`}>
        {c.get(row) ?? '—'}
      </span>
    )),
    ...extras.map((key) => (
      <span key={key} className={`sqc-v ${clubCellClass(key, colRow)}`.trim()}>
        {clubCellContent(key, colRow)}
      </span>
    )),
  ];
}

/* ---------- 位置分组容器：组头（色条 + 组名·人数 + 列头）---------- */

export function CardGroup({
  groupKey,
  label,
  count,
  cells,
  extras,
  wide,
  assign,
  children,
}: {
  groupKey: string;
  label: string;
  count: number;
  cells: readonly CardCell[];
  extras: readonly { key: string; label: string }[];
  wide?: boolean;
  assign?: boolean;
  children: ReactNode;
}) {
  const accent = GROUP_ACCENTS[groupKey] ?? GROUP_ACCENTS.unknown!;
  return (
    <section className={`sqc-group${wide ? ' wide' : ''}`} style={{ '--sqc-accent': accent } as CSSProperties}>
      <header className={`sqc-ghead${assign ? ' has-assign' : ''}`}>
        <h4 className="sqc-gtitle">
          {label} <span className="sqc-gcount">· {count}</span>
        </h4>
        {wide ? (
          // 桌面（定稿 14-B）：列头退化为组头右侧的标签串，不逐列对齐
          <span className="sqc-glegend">
            {[...cells, ...extras].map((c) => c.label).join(' ')}
          </span>
        ) : (
          <span className="sqc-m sqc-gcols" aria-hidden="true">
            {cells.map((c) => (
              <span key={c.key} className="sqc-k">
                {c.label}
              </span>
            ))}
            {extras.map((d) => (
              <span key={d.key} className="sqc-k">
                {d.label}
              </span>
            ))}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/* ---------- 阵容卡（GET /api/players 行：positions[] 多位置可展开） ---------- */

export function SquadCard({
  row,
  view,
  extras,
  wide,
}: {
  row: PlayerLibraryRow;
  view: CardViewKey;
  extras: readonly { key: string; label: string }[];
  wide?: boolean;
}) {
  const cells = wide ? DESKTOP_CELLS : CARD_VIEW_CELLS[view];
  const badges = inlineBadgesOf(row);
  const values = metricValues(cells, row, extras.map((d) => d.key), row);
  return (
    <article className={`sqc-row sqc-card${wide ? ' wide' : ''}`}>
      {wide ? (
        <span className="sqc-id">
          <span className="sqc-nm-row">
            <span className="sqc-no">{row.number ?? ''}</span>
            <Link className="sqc-nm" to={playerPath(row)}>
              {row.name}
            </Link>
            <CardBadges badges={badges} />
          </span>
          <CardSubline marker={row.marker ?? null} positions={row.positions} uid={row.uid} />
        </span>
      ) : (
        <>
          <span className="sqc-no">{row.number ?? ''}</span>
          <span className="sqc-id">
            <Link className="sqc-nm" to={playerPath(row)}>
              {row.name}
            </Link>
            <CardBadges badges={badges} />
            <CardSubline marker={row.marker ?? null} positions={row.positions} uid={row.uid} />
          </span>
        </>
      )}
      <span className="sqc-m">{values}</span>
    </article>
  );
}

/* ---------- 分配下拉（两端同构：行尾「分配 ▾」，全称选项；无合同禁一线/训练营） ---------- */

const HTMLElementCtor = typeof globalThis.HTMLElement === 'function' ? globalThis.HTMLElement : null;
const HAS_POPOVER = HTMLElementCtor !== null && 'showPopover' in HTMLElementCtor.prototype;

/** 标红 badge 的短标签（完整原因在 message，悬浮 title 兜底）——自 DeskTab 提出共用 */
export const ISSUE_RULE_LABEL: Record<string, string> = {
  squad_size: '人数',
  gk: '门将',
  trainee_size: '训练营人数',
  trainee_growth: '不可成长',
  ca_pa: '初始CA限额',
  contract: '无合同',
  wage_cap: '工资帽',
};

export function AssignmentSelect({
  value,
  hasContract,
  disabled,
  onChange,
}: {
  value: AssignValue;
  hasContract: boolean;
  disabled?: boolean;
  onChange: (next: AssignValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    // 三项小面板：贴触发器右对齐、放不下翻上方（比 MultiSelect 的落位简单，够用）
    const place = () => {
      const r = trigger.getBoundingClientRect();
      const pw = panel.offsetWidth || 128;
      const ph = panel.offsetHeight || 132;
      const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
      const openUp = window.innerHeight - r.bottom < ph + 8 && r.top > ph + 8;
      panel.style.left = `${left}px`;
      panel.style.top = openUp ? 'auto' : `${Math.min(r.bottom + 4, window.innerHeight - ph - 8)}px`;
      panel.style.bottom = openUp ? `${window.innerHeight - r.top + 4}px` : 'auto';
    };
    if (HAS_POPOVER) {
      try {
        panel.showPopover();
      } catch {
        // 连点两次开关之类的时序：面板已在 top layer，不影响落位
      }
    }
    place();
    panel.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      trigger.focus();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (panel.contains(target) || trigger.contains(target))) return;
      setOpen(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  const current = ASSIGN_OPTIONS.find((o) => o.value === value) ?? ASSIGN_OPTIONS[0]!;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sqc-assign-btn${value !== 'none' ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        title="分配"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {current.label}
        <span className="sqc-assign-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className="sqc-assign-pop"
          role="menu"
          aria-label="分配"
          tabIndex={-1}
          // popover 属性只在引擎真支持 Popover API 时加（jsdom 没有时它是普通元素，测试可点）——
          // 同 MultiSelect 的兜底理由
          {...(HAS_POPOVER ? { popover: 'manual' as const } : {})}
        >
          {ASSIGN_OPTIONS.map((o) => {
            const disabled = !hasContract && o.value !== 'none';
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={value === o.value}
                className={`sqc-assign-opt${value === o.value ? ' on' : ''}`}
                disabled={disabled}
                title={disabled ? '没有现行合同，先让管理组导入合同模板' : undefined}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------- 注册卡（GET /api/club/squad 行：单值位置 + 分配下拉 + 校验红旗） ---------- */

export function RegCard({
  row,
  view,
  assign,
  flags,
  extras,
  wide,
  editable,
  onAssign,
}: {
  row: SquadPlayerRow;
  view: CardViewKey;
  assign: AssignValue;
  flags: readonly SquadIssue[];
  extras: readonly { key: string; label: string }[];
  wide?: boolean;
  /** false = 非开窗期，整行分配只读（旧表格把全部分段按钮 disable 的同口径） */
  editable?: boolean;
  onAssign: (next: AssignValue) => void;
}) {
  // 与桌面旧 SquadRow 同口径：不可成长（或无成长空间）的球员分进训练营会报错；
  // 只在真的分进训练营时才显示（不是「潜在进不去」就喊）
  const traineeBlocked = !row.growable || (row.pa ?? 0) - (row.ca ?? 0) <= 0;
  const cells = wide ? DESKTOP_CELLS : CARD_VIEW_CELLS[view];
  const badges = inlineBadgesOf(row);
  const values = metricValues(cells, row, extras.map((d) => d.key), row);
  const flagEls = flags.map((f, i) => (
    <span key={`${f.rule}-${i}`} className="sqc-badge sqc-badge-flag" title={f.message ?? f.rule}>
      {ISSUE_RULE_LABEL[f.rule] ?? f.rule}
    </span>
  ));
  return (
    <article className={`sqc-row sqc-card has-assign${wide ? ' wide' : ''}`}>
      {wide ? (
        <span className="sqc-id">
          <span className="sqc-nm-row">
            <span className="sqc-no">{row.number ?? ''}</span>
            <Link className="sqc-nm" to={playerPath(row)}>
              {row.name}
            </Link>
            <CardBadges badges={badges} extra={flagEls} />
          </span>
          <CardSubline marker={row.marker ?? null} positions={row.position ? [row.position] : []} uid={row.uid} />
        </span>
      ) : (
        <>
          <span className="sqc-no">{row.number ?? ''}</span>
          <span className="sqc-id">
            <Link className="sqc-nm" to={playerPath(row)}>
              {row.name}
            </Link>
            <CardBadges badges={badges} extra={flagEls} />
            <CardSubline marker={row.marker ?? null} positions={row.position ? [row.position] : []} uid={row.uid} />
          </span>
        </>
      )}
      <span className="sqc-m">{values}</span>
      <span className="sqc-assign">
        <AssignmentSelect value={assign} hasContract={row.hasContract} disabled={editable === false} onChange={onAssign} />
        {assign === 'trainee' && traineeBlocked && <span className="error-msg">不可成长</span>}
      </span>
    </article>
  );
}

/* ---------- 四视图 chips（窄屏页面级吸顶；「列…」由页面作为 extra 塞进来） ---------- */

export function ViewChips({
  value,
  onChange,
  extra,
}: {
  value: CardViewKey;
  onChange: (v: CardViewKey) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="sqc-chips" role="tablist" aria-label="指标视图">
      {CARD_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={value === v.key}
          className={`sqc-chip${value === v.key ? ' on' : ''}`}
          onClick={() => onChange(v.key)}
        >
          {v.label}
        </button>
      ))}
      {extra}
    </div>
  );
}
