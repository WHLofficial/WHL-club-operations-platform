// 球员对比（v6.34.0 步骤 5+6）：/players/compare?ids=<fc_id>,<fc_id>[,<fc_id>]。
// URL 即事实源——任何情况不改写 URL、不重定向（spec §1/§8）；页面结构＝spec §2 的
// A（单列纵向）＋ E（≥1000px 属性表双栏）＋ F（滚过雷达后吸附的迷你雷达条）。
// 数据：并发 ≤3 次 GET /api/players/:id（走 qk.player 缓存键，与详情页零重复请求）；
// 纯函数（解析/配色/胜负标记）在 lib/compare.ts，雷达轴/组均在 lib/radar.ts，这里只做组装。
// 界面文案与状态全谱照 docs/superpowers/specs/2026-10-05-player-compare-design.md §8 与终稿屏。
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import type { PlayerDetail } from '../lib/api.ts';
import { colorFor, groupAverages, parseCompareIds, rowMarks } from '../lib/compare.ts';
import {
  ATTR_GROUPS,
  ATTR_LABELS,
  playstyleBadges,
  positionName,
  roleChs,
} from '../lib/ref.ts';
import { axesFor, starText } from '../lib/radar.ts';
import { attrClass } from '../lib/players-library.ts';
import { usePlayerDetail } from '../lib/queries.ts';
import { playerPath } from '../lib/player-link.ts';
import { useMediaQuery } from '../lib/use-media.ts';
import { AttrRadar } from '../components/AttrRadar.tsx';
import { PositionHeatmap } from '../components/PositionHeatmap.tsx';
import { BadgeCounts, badgeCountItems } from '../components/BadgeCounts.tsx';
import { PlaystyleBadge } from '../components/PlaystyleBadge.tsx';

// 窄屏断点（spec §2/§10）：≤840px 单栏回落、吸顶条压 32px、位置热区图不出
const NARROW_QUERY = '(max-width: 840px)';

// 属性表双栏分列（spec §2.5/§5）：左 PAC/SHO/PAS（14 项）、右 DRI/DEF/PHY（15 项）＋ GKP（5 项，右栏末）；
// GKP 没有组头行（spec §5 的「6 组组头」），外场球员照常显示低值（spec §12）
const LEFT_GROUPS = ATTR_GROUPS.slice(0, 3);
const RIGHT_GROUPS = [...ATTR_GROUPS.slice(3, 6), ATTR_GROUPS[6]];

/** 取数：null / undefined / 非数一律 null（显示「—」且不参与胜负比较）。
 *  与雷达组均的旧口径（Number(null)===0 也算有效值，lib/radar.ts 注释）有意分开——
 *  表格侧「没录过」必须一眼可辨（TC-CMP-TBL-07） */
function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 错误对象里的 HTTP 状态（api.ts 的 ApiError.status；非该形状回 null） */
function errorStatus(err: unknown): number | null {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : null;
  }
  return null;
}

interface CompareSlot {
  id: number;
  /** 存活序（URL 顺序、404 已剔除）——颜色索引，色随人走、重试不跳色（spec §4/§8） */
  index: number;
  detail: PlayerDetail | null;
  state: 'loading' | 'ready' | 'missing' | 'failed';
  retry: () => void;
}

type ReadySlot = CompareSlot & { detail: PlayerDetail };

function isReady(s: CompareSlot): s is ReadySlot {
  return s.state === 'ready' && s.detail !== null;
}

function slotFromQuery(id: number, index: number, q: UseQueryResult<PlayerDetail>): CompareSlot {
  const retry = () => void q.refetch();
  if (q.isError) {
    return { id, index, detail: null, state: errorStatus(q.error) === 404 ? 'missing' : 'failed', retry };
  }
  if (q.data) return { id, index, detail: q.data, state: 'ready', retry };
  return { id, index, detail: null, state: 'loading', retry };
}

// ---- 小件 ----

function posChipsOf(attrs: Record<string, unknown>): string[] {
  return ['PosID1', 'PosID2', 'PosID3', 'PosID4']
    .map((k) => positionName(attrs[k]))
    .filter((v): v is string => v !== null);
}

function rolesOf(attrs: Record<string, unknown>): string[] {
  return ['RoleID1', 'RoleID2', 'RoleID3', 'RoleID4', 'RoleID5']
    .map((k) => roleChs(attrs[k]))
    .filter((v): v is string => v !== null);
}

function footText(foot: number | null | undefined): string {
  return foot === 1 ? '右脚' : foot === 0 ? '左脚' : '—';
}

// 雷达几何与绘制全在共享件 web/src/components/AttrRadar.tsx（v6.35.0 统一，本页不再自带实现）：
// big 170×176 中心 (85,88) R=62（2 人叠图）、small 120×104 中心 (60,52) R=40（3 人并排）、mini 同 small（吸顶条）；
// 环带走 neutral 模式（不铺五档色、只画环线）——叠色/并排下铺色会糊，spec §4 登记为对比页唯一有意差异。

// 位置热区图（v6.35.0 落地，替换原「待热区图轮落地」占位）：仅 2 人桌面态在叠图两侧各出一张
function HeatSide({ slot }: { slot: ReadySlot }) {
  const attrs = slot.detail.player.gameAttrs ?? {};
  return (
    <div className="cmp-heatmap">
      <PositionHeatmap posCodes={posChipsOf(attrs)} isGk={slot.detail.player.position === 'GK'} />
    </div>
  );
}

// 值格组（spec §5）：每格 .v 定宽 2.5em 居中＋等宽数字；分隔点 .dt；数字用球员本命色；
// 胜方加粗、等值（平手）两侧都加粗（rowMarks 口径＝至少不落下风）；values 不给 ⇒ 不标胜负（惯用脚）
function ValueCells({
  slots,
  texts,
  values,
  muted = false,
}: {
  slots: ReadySlot[];
  texts: string[];
  values?: (number | null)[];
  muted?: boolean;
}) {
  const marks = values ? rowMarks(values) : texts.map(() => false);
  return (
    <span className="cmp-vals">
      {slots.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span className="cmp-dt">·</span>}
          <span
            className={`cmp-v${marks[i] ? ' cmp-bold' : ''}${muted ? ' cmp-mut' : ''}`}
            style={muted ? undefined : { color: colorFor(s.index) }}
          >
            {texts[i]}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function CompareRow({ label, children, head = false }: { label: string; children: ReactNode; head?: boolean }) {
  return (
    <div className={`cmp-row${head ? ' cmp-gh' : ''}`}>
      <span className="cmp-row-label">{label}</span>
      {children}
    </div>
  );
}

// ---- 页面本体 ----

export default function PlayerCompare() {
  const [params] = useSearchParams();
  const raw = params.get('ids');
  const parsed = useMemo(() => parseCompareIds(raw), [raw]);
  const narrow = useMediaQuery(NARROW_QUERY);

  // 固定 3 次 hook（Hooks 顺序稳定）：多余槽传 undefined ⇒ enabled=false，一次请求都不发
  // （用户可贴 50 个 id 的分享串，请求数恒 ≤3——spec §8 最坏情况口径）
  const q0 = usePlayerDetail(parsed.ids[0]);
  const q1 = usePlayerDetail(parsed.ids[1]);
  const q2 = usePlayerDetail(parsed.ids[2]);
  const queries = [q0, q1, q2];

  // 处理链（spec §8）：切分/非法/去重/超限已在 parseCompareIds；这里接 404 丢弃与失败留槽
  const slots = parsed.ids.map((id, i) => slotFromQuery(id, i, queries[i]));
  const visible = slots
    .filter((s) => s.state !== 'missing')
    .map((s, i) => ({ ...s, index: i })); // 颜色按存活序重排（含 404 丢弃后的 URL 顺序）
  const ready = visible.filter(isReady);
  const failed = visible.filter((s) => s.state === 'failed');
  const loading = visible.filter((s) => s.state === 'loading');
  const missing = slots.filter((s) => s.state === 'missing');

  const hasIds = parsed.ids.length > 0;
  const nothingReady = hasIds && visible.length > 0 && ready.length === 0;
  const showError = nothingReady && loading.length === 0;
  const showLoading = nothingReady && loading.length > 0;

  // 拼图题（spec §8）：全员门将用 GK 六轴，其余（含门将＋外场混比）统一外场六维
  const allGk = ready.length > 0 && ready.every((s) => s.detail.player.position === 'GK');
  const axes = axesFor(allGk);

  // 提示条（处理链顺序）：非法 → 重复 → 超 3 → 404 → 部分失败；「不自动改写 URL」是硬线
  const notices: string[] = [];
  if (parsed.droppedInvalid > 0) notices.push(`已忽略 ${parsed.droppedInvalid} 个无效 id`);
  if (parsed.droppedDuplicate > 0) notices.push('重复的球员已自动去重');
  if (parsed.overLimit > 0) notices.push('最多同时对比 3 人，已只取前 3 位');
  for (const s of missing) notices.push(`未找到 id ${s.id} 对应的球员，已忽略`);
  if (failed.length > 0 && ready.length > 0) notices.push(`有 ${failed.length} 名球员的数据没取到，其余球员已照常显示`);

  const urlChip = raw === null ? '/players/compare' : `/players/compare?ids=${raw}`;

  // 吸顶雷达条 F（spec §2.4）：雷达底部滚出视口时出现，滚到页尾消失。
  // position:sticky 的吸附由 CSS 承担（条子常驻文档流、不遮内容、不跳位），这里只切开关类。
  const radarRef = useRef<HTMLDivElement | null>(null);
  const [barOn, setBarOn] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const zone = radarRef.current;
      if (!zone) return;
      const r = zone.getBoundingClientRect();
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
      setBarOn(r.bottom <= 0 && !atEnd);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const retryAll = () => {
    for (const s of failed) s.retry();
  };

  return (
    <div className="container cmp-page">
      <div className="cmp-topbar">
        <h1>球员对比</h1>
        <code className="cmp-urlchip">{urlChip}</code>
        {/* 「编辑名单」把名单带回球员库（URL 即事实源：原串直传，库页按 parseCompareIds 同口径预置）；
            名单不足 2 人的空/单人态走页面内的「去球员库选人 / ＋ 从球员库选」，不给死胡同按钮 */}
        {visible.length >= 2 && raw !== null && (
          <Link className="btn btn-sm cmp-edit" to={`/players?compare=${encodeURIComponent(raw)}`}>
            编辑名单
          </Link>
        )}
      </div>

      {notices.length > 0 && !showError && (
        <div className="cmp-notices">
          {notices.map((n, i) => (
            <p className="cmp-notice" key={`${i}-${n}`}>
              <span className="cmp-notice-ic" aria-hidden="true">
                !
              </span>
              <span>{n}</span>
            </p>
          ))}
        </div>
      )}

      {/* 0 人态（无 ids 或全部被丢弃）：页面级空态，不重定向 */}
      {(!hasIds || visible.length === 0) && (
        <div className="cmp-state cmp-empty" role="status">
          <p className="cmp-state-title">还没有选择球员</p>
          <p className="cmp-state-hint">从球员库里勾选 2–3 名球员即可开始对比（也可以直接把 id 写进地址栏）。</p>
          <Link className="btn" to="/players">
            去球员库选人
          </Link>
        </div>
      )}

      {/* 加载中：骨架屏（全部在途，或部分 404 丢弃后其余仍在途） */}
      {showLoading && (
        <div className="cmp-state cmp-loading" role="status">
          <p className="cmp-state-title">正在调阅球员数据…</p>
          <div className="cmp-sk-grid" aria-hidden="true">
            <div className="cmp-sk" />
            <div className="cmp-sk" />
            <div className="cmp-sk" />
            <div className="cmp-sk cmp-sk-lg" />
          </div>
        </div>
      )}

      {/* 全部失败：页面级错误态 + 重试（id 没有丢，重试后还是这份名单） */}
      {showError && (
        <div className="cmp-state cmp-error" role="alert">
          <p className="cmp-state-title">球员数据没取到</p>
          <p className="cmp-state-hint">网络或服务暂时不可用，可重试；id 没有丢，重试后还是这份名单。</p>
          <button type="button" className="btn" onClick={retryAll}>
            重试
          </button>
        </div>
      )}

      {ready.length > 0 && (
        <>
          {/* 身份卡 ×N：失败留可重试槽位、在途出骨架卡（形态按存活人数，spec §8） */}
          <div className={`cmp-ids cmp-ids-${visible.length}`}>
            {visible.map((s) =>
              isReady(s) ? (
                <IdentityCard key={s.id} slot={s} detail={s.detail} />
              ) : s.state === 'failed' ? (
                <div className="cmp-failslot" key={s.id}>
                  <p className="cmp-failslot-text">球员 {s.id} 的数据没取到</p>
                  <button type="button" className="btn btn-sm" onClick={s.retry}>
                    重试
                  </button>
                </div>
              ) : (
                <div className="cmp-card cmp-card-sk" key={s.id} aria-hidden="true">
                  <div className="cmp-sk cmp-sk-lg" />
                  <div className="cmp-sk" />
                </div>
              ),
            )}
          </div>

          {/* 雷达区：1 人＝单人雷达（＋空槽）；2 人＝热区图｜双色叠图｜热区图；3 人＝三张并排小雷达 */}
          <div className="cmp-radarzone" ref={radarRef}>
            {ready.length === 1 && (
              <div className="cmp-radar-solo">
                <AttrRadar
                  variant="big"
                  bands="neutral"
                  className="cmp-radar-big"
                  axes={axes}
                  ariaLabel="六维雷达"
                  series={[{ color: colorFor(ready[0].index), attrs: ready[0].detail.player.gameAttrs ?? {} }]}
                />
                {visible.length === 1 && (
                  <div className="cmp-emptyslot">
                    <p className="cmp-emptyslot-title">还差 1 名球员</p>
                    {/* 回球员库并带 ?compare= 预置勾选（v6.37.0 修：原先裸 /players 丢掉当前球员） */}
                    <Link className="btn btn-sm" to={`/players?compare=${ready[0].id}`}>
                      ＋ 从球员库选
                    </Link>
                  </div>
                )}
              </div>
            )}
            {ready.length === 2 && (
              <>
                {!narrow && <HeatSide slot={ready[0]} />}
                <div className="cmp-radar-main">
                  <AttrRadar
                    variant="big"
                    bands="neutral"
                    className="cmp-radar-big"
                    axes={axes}
                    ariaLabel="六维雷达（双色叠图）"
                    series={ready.map((s) => ({ color: colorFor(s.index), attrs: s.detail.player.gameAttrs ?? {} }))}
                  />
                </div>
                {!narrow && <HeatSide slot={ready[1]} />}
              </>
            )}
            {ready.length === 3 && (
              <div className="cmp-radar3">
                {ready.map((s) => (
                  <div className="cmp-radar3-cell" key={s.id}>
                    <AttrRadar
                      variant="small"
                      bands="neutral"
                      className="cmp-radar-small"
                      axes={axes}
                      ariaLabel="六维雷达"
                      series={[{ color: colorFor(s.index), attrs: s.detail.player.gameAttrs ?? {} }]}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {ready.length >= 2 && (
            <div className="cmp-legend">
              {ready.map((s) => (
                <span className="cmp-legend-item" key={s.id}>
                  <span className="cmp-dot" style={{ background: colorFor(s.index) }} />
                  {s.detail.player.name}
                </span>
              ))}
            </div>
          )}

          {/* 吸顶雷达条 F：只在对比态出现；可见性由 cmp-stickybar-on 切（CSS sticky 吸附） */}
          {ready.length >= 2 && (
            <div className={`cmp-stickybar${barOn ? ' cmp-stickybar-on' : ''}`} aria-hidden={!barOn}>
              {ready.map((s) => (
                <span className="cmp-bar-item" key={s.id}>
                  <AttrRadar
                    variant="mini"
                    bands="neutral"
                    className="cmp-bar-radar"
                    axes={axes}
                    ariaHidden
                    series={[{ color: colorFor(s.index), attrs: s.detail.player.gameAttrs ?? {} }]}
                  />
                  <span className="cmp-bar-text">
                    <span className="cmp-bar-name" style={{ color: colorFor(s.index) }}>
                      {s.detail.player.name}
                    </span>
                    <span className="cmp-bar-capa">
                      CA {s.detail.player.ca} / PA {s.detail.player.pa}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* 对照区只在 2–3 人态出现（1 人不出对比表，spec §8） */}
          {ready.length >= 2 && (
            <>
              <AttributeTable slots={ready} />
              <MiscSection slots={ready} />
              <MetaSection slots={ready} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- 身份卡 ----

function IdentityCard({ slot, detail }: { slot: ReadySlot; detail: PlayerDetail }) {
  const p = detail.player;
  const attrs = p.gameAttrs ?? {};
  const color = colorFor(slot.index);
  const pos = posChipsOf(attrs);
  const roles = rolesOf(attrs);
  const height = numOf(attrs['height']);
  const weight = numOf(attrs['weight']);
  return (
    <section className="cmp-card">
      <div className="cmp-card-head">
        <span className="cmp-dot" style={{ background: color }} aria-hidden="true" />
        <Link className="cmp-name" to={playerPath(p)}>
          {p.name}
        </Link>
        {p.officialName !== undefined && p.officialName !== p.name && <span className="official-name">{p.officialName}</span>}
        <span className="cmp-capa">
          <span className="cmp-capa-label">CA</span>
          <span className={`mono cmp-capa-num ${attrClass(p.ca)}`}>{p.ca}</span>
          <span className="cmp-capa-label">PA</span>
          <span className={`mono cmp-capa-num ${attrClass(p.pa)}`}>{p.pa}</span>
        </span>
      </div>
      <div className="pos-chips">
        {pos.length > 0 ? (
          pos.map((v, i) => (
            <span key={v} className={i === 0 ? 'pos-chip pos-chip-main' : 'pos-chip'}>
              {v}
            </span>
          ))
        ) : (
          <span className="pos-chip">—</span>
        )}
      </div>
      <p className="cmp-card-sub">
        {detail.club?.name ?? '自由身'} · {height ?? '—'}cm / {weight ?? '—'}kg · {footText(p.foot)} · 逆足{' '}
        {starText(attrs['weakfoot'])} · 花式 {starText(attrs['skillmoves'])}
      </p>
      {roles.length > 0 && (
        <div className="role-chips">
          {roles.map((r, i) => (
            <span
              key={`${r}-${i}`}
              className={r.includes('++') ? 'role-chip role-plusplus' : /\+\s*$/.test(r) ? 'role-chip role-plus' : 'role-chip'}
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- 属性对照表 E ----

function GroupBlock({
  group,
  slots,
  avgByPlayer,
}: {
  group: (typeof ATTR_GROUPS)[number];
  slots: ReadySlot[];
  avgByPlayer: Map<string, number | null>[];
}) {
  const attrsOf = slots.map((s) => s.detail.player.gameAttrs ?? {});
  return (
    <>
      {/* 组头行：只留组名（无「组均」字样）＋组均数值；仅六组有组头（GKP 无组头，行在右栏末） */}
      {group.key !== 'GKP' && (
        <CompareRow head label={group.key}>
          <ValueCells
            slots={slots}
            texts={avgByPlayer.map((m) => {
              const v = m.get(group.key);
              return v === null || v === undefined ? '—' : String(v);
            })}
            values={avgByPlayer.map((m) => m.get(group.key) ?? null)}
          />
        </CompareRow>
      )}
      {group.keys.map((k) => {
        const nums = attrsOf.map((a) => numOf(a[k]));
        return (
          <CompareRow key={k} label={ATTR_LABELS[k] ?? k}>
            <ValueCells slots={slots} texts={nums.map((v) => (v === null ? '—' : String(v)))} values={nums} />
          </CompareRow>
        );
      })}
    </>
  );
}

function AttributeTable({ slots }: { slots: ReadySlot[] }) {
  const avgByPlayer = slots.map(
    (s) => new Map<string, number | null>(groupAverages(s.detail.player.gameAttrs ?? {}).map((r): [string, number | null] => [r.key, r.value])),
  );
  return (
    <div className="cmp-table">
      <div className="cmp-cols">
        <div className="cmp-col">
          {LEFT_GROUPS.map((g) => (
            <GroupBlock key={g.key} group={g} slots={slots} avgByPlayer={avgByPlayer} />
          ))}
        </div>
        <div className="cmp-col">
          {RIGHT_GROUPS.map((g) => (
            <GroupBlock key={g.key} group={g} slots={slots} avgByPlayer={avgByPlayer} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- 杂项区（spec §6）----

function MiscSection({ slots }: { slots: ReadySlot[] }) {
  const attrsOf = slots.map((s) => s.detail.player.gameAttrs ?? {});
  const rows: { label: string; texts: string[]; values?: (number | null)[]; muted?: boolean }[] = [
    // 惯用脚不标胜负（spec §6）；身高/体重/逆足/花式/影响力标（影响力两位小数，不是国际声望★）
    { label: '惯用脚', texts: slots.map((s) => footText(s.detail.player.foot)), muted: true },
    {
      label: '身高',
      texts: attrsOf.map((a) => (numOf(a['height']) === null ? '—' : String(numOf(a['height'])))),
      values: attrsOf.map((a) => numOf(a['height'])),
    },
    {
      label: '体重',
      texts: attrsOf.map((a) => (numOf(a['weight']) === null ? '—' : String(numOf(a['weight'])))),
      values: attrsOf.map((a) => numOf(a['weight'])),
    },
    {
      label: '逆足',
      texts: attrsOf.map((a) => (numOf(a['weakfoot']) === null ? '—' : `${numOf(a['weakfoot'])}★`)),
      values: attrsOf.map((a) => numOf(a['weakfoot'])),
    },
    {
      label: '花式',
      texts: attrsOf.map((a) => (numOf(a['skillmoves']) === null ? '—' : `${numOf(a['skillmoves'])}★`)),
      values: attrsOf.map((a) => numOf(a['skillmoves'])),
    },
    {
      label: '影响力',
      texts: slots.map((s) => s.detail.player.influence.toFixed(2)),
      values: slots.map((s) => s.detail.player.influence),
    },
  ];
  return (
    <div className="cmp-misc">
      <div className="cmp-row cmp-gh cmp-gh-nobg">
        <span className="cmp-row-label">杂项</span>
      </div>
      {rows.map((r) => (
        <CompareRow key={r.label} label={r.label}>
          <ValueCells slots={slots} texts={r.texts} values={r.values} muted={r.muted} />
        </CompareRow>
      ))}
    </div>
  );
}

// ---- 位置 · 角色 · 徽章 · 徽章数（spec §7；四行标签列定宽 5.4em，值列按球员分列）----

function MetaSection({ slots }: { slots: ReadySlot[] }) {
  return (
    <div className="cmp-meta">
      <div className="cmp-meta-row">
        <span className="cmp-meta-label">位置</span>
        {slots.map((s) => {
          const pos = posChipsOf(s.detail.player.gameAttrs ?? {});
          return (
            <span className="cmp-meta-cell" key={s.id}>
              <span className="pos-chips">
                {pos.length > 0 ? (
                  pos.map((v, i) => (
                    <span key={v} className={i === 0 ? 'pos-chip pos-chip-main' : 'pos-chip'}>
                      {v}
                    </span>
                  ))
                ) : (
                  <span className="pos-chip">—</span>
                )}
              </span>
            </span>
          );
        })}
      </div>
      <div className="cmp-meta-row">
        <span className="cmp-meta-label">角色</span>
        {slots.map((s) => {
          const roles = rolesOf(s.detail.player.gameAttrs ?? {});
          return (
            <span className="cmp-meta-cell cmp-roles" key={s.id}>
              <span className="role-chips">
                {roles.length > 0 ? (
                  roles.map((r, i) => (
                    <span
                      key={`${r}-${i}`}
                      className={r.includes('++') ? 'role-chip role-plusplus' : /\+\s*$/.test(r) ? 'role-chip role-plus' : 'role-chip'}
                    >
                      {r}
                    </span>
                  ))
                ) : (
                  <span className="role-chip">—</span>
                )}
              </span>
            </span>
          );
        })}
      </div>
      <div className="cmp-meta-row">
        <span className="cmp-meta-label">徽章</span>
        {slots.map((s) => {
          const badges = playstyleBadges(s.detail.player.gameAttrs ?? {});
          return (
            <span className="cmp-meta-cell" key={s.id}>
              {badges.length > 0 ? (
                badges.map((b) => <PlaystyleBadge key={`${b.slot}-${b.psid}`} psid={b.psid} gold={b.gold} />)
              ) : (
                <span className="cmp-mut">—</span>
              )}
            </span>
          );
        })}
      </div>
      <div className="cmp-meta-row">
        <span className="cmp-meta-label">徽章数</span>
        {slots.map((s) => (
          <span className="cmp-meta-cell" key={s.id}>
            {/* 金在前（spec §7）：两枚定宽小块 = 台账计数 badgesGold / badgesSilver。
                零值抑制 + 金在前走 BadgeCounts（v6.35.0 四页共用一份计数口径）；
                两枚全 0 与相邻行的空态一致出「—」。 */}
            {badgeCountItems(s.detail.player.badgesSilver, s.detail.player.badgesGold).length === 0 ? (
              <span className="cmp-mut">—</span>
            ) : (
              <BadgeCounts
                silver={s.detail.player.badgesSilver}
                gold={s.detail.player.badgesGold}
                density="text"
                className="cmp-badgecnt"
                sep={<span className="cmp-dt">·</span>}
              />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
