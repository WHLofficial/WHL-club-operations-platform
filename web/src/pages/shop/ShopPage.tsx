// 消费中心 /shop（v6.26.0）：五类商品 + 球场消费三卡的统一入口。
// B 布局（visual companion 定稿）：左主栏商品页签（?tab= 深链）+ 底部球场三卡；右侧栏我的工单常驻（行内展开）。
// 提交流程：确认框 → 提交即扣费 → 管理组审核 → 通过自动生效 / 拒绝自动退款。
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiPost } from '../../lib/api.ts';
import { PS_GRANTABLE_BASE_IDS, POSITION_BY_ID } from '../../../../src/core/fc26.ts';
import { areAdjacent } from '../../../../src/core/shop.ts';
import { playstyleById, roleById } from '../../lib/ref.ts';
import { useShopCatalog, useShopInvalidation, useShopOrders, useShopSquadState, useMyClub, useSeasonsCurrent } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import type { ShopOrderDto, ShopPrices, ShopSquadStatePlayer } from '../../lib/api.ts';
import { BookingsCard, FacilityOpsCard, NamingCard } from './venueCards.tsx';

type ShopTab = 'pa' | 'badge' | 'role' | 'position' | 'shell';

// v6.29.0：关窗期消费工单（POST /api/shop/orders）后端一律 409 no_window——
// 下单入口统一置灰，并把同一句提示摆在提交区近旁。窗口态复用公开端点 /api/seasons/current。
const WINDOW_CLOSED_NOTE = '关窗期间不能提交消费工单，开窗后再来';

const TAB_LABEL: Record<ShopTab, string> = {
  pa: '买 PA',
  badge: '徽章',
  role: '角色（职责）',
  position: '位置热区',
  shell: '队壳申请',
};

const STATUS_BADGE: Record<ShopOrderDto['status'], { cls: string; label: string }> = {
  pending: { cls: 'gold', label: '待审核' },
  approved: { cls: 'green', label: '已生效' },
  rejected: { cls: 'red', label: '已拒绝' },
};

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const tabRaw = params.get('tab');
  const tab: ShopTab = tabRaw === 'badge' || tabRaw === 'role' || tabRaw === 'position' || tabRaw === 'shell' ? tabRaw : 'pa';

  const { loading, isCoach, club: myClub, failed: clubFailed } = useMyClub();
  const catalogQuery = useShopCatalog(true);
  const catalog = catalogQuery.data ?? null;

  function goTab(next: ShopTab) {
    if (next === tab) return;
    setParams((p) => {
      const np = new URLSearchParams(p);
      np.set('tab', next);
      return np;
    });
  }

  return (
    <div className="container">
      <h1>消费中心</h1>
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : clubFailed && isCoach ? (
        <div className="card empty-state">
          <p className="muted">俱乐部身份暂时取不到，请稍后刷新重试。</p>
        </div>
      ) : !isCoach || myClub === null ? (
        <div className="card empty-state">
          <p className="muted">
            {isCoach ? '还没有绑定俱乐部。先到我的球队完成绑定，再来逛消费中心。' : '这里只对教练开放。球员消费是教练操作，观众视角看看就好。'}
          </p>
        </div>
      ) : (
        <ShopContent tab={tab} goTab={goTab} balance={myClub.balance} catalog={catalog} catalogError={catalogQuery.error instanceof Error ? catalogQuery.error.message : null} />
      )}
    </div>
  );
}

function ShopContent({
  tab,
  goTab,
  balance,
  catalog,
  catalogError,
}: {
  tab: ShopTab;
  goTab: (t: ShopTab) => void;
  balance: number | null;
  catalog: { prices: ShopPrices; paCap: number; hpremiumClubIds: number[] } | null;
  catalogError: string | null;
}) {
  const squadState = useShopSquadState(true);
  const players = squadState.data?.players ?? [];
  // 关窗期后端拒绝消费工单；数据未到按未开窗处理（与球员页 windowOpen 同口径）
  const seasons = useSeasonsCurrent();
  const windowOpen = seasons.data?.window?.status === 'open';

  return (
    <>
      {/* 余额条 + 流水线说明条 */}
      <section className="card">
        <p>
          资金余额 <span className="mono gold-text">{balance === null ? '—' : `${balance.toFixed(2)} m`}</span>
          {catalog && (
            <span className="hint">
              {' '}· 当前版本 PA 上限 <span className="mono">{catalog.paCap}</span>
            </span>
          )}
        </p>
        <p className="hint" style={{ marginBottom: 0 }}>
          <span className="badge sky">提交</span> 提交即扣费 → <span className="badge gold">管理组审核</span> → <span className="badge green">通过自动生效</span> /{' '}
          <span className="badge red">拒绝自动退款</span>
          {'　'}球员重导入不影响已购属性（台账自动重放），买的徽章跟着球员走。
        </p>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {/* 左主栏：商品页签 + 表单 + 球场三卡 */}
        <div style={{ flex: '1 1 480px' }}>
          <div className="seg" role="group" aria-label="商品分类">
            {(Object.keys(TAB_LABEL) as ShopTab[]).map((t) => (
              <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => goTab(t)}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {!windowOpen && (
            <p className="hint" style={{ marginTop: 8 }}>
              {WINDOW_CLOSED_NOTE}
            </p>
          )}
          {catalogError ? (
            <section className="card">
              <p className="muted">{catalogError}</p>
            </section>
          ) : catalog === null ? (
            <section className="card">
              <p className="muted">正在取价目…</p>
            </section>
          ) : squadState.isError ? (
            <section className="card">
              <p className="muted">{squadState.error instanceof Error ? squadState.error.message : '名单状态读不出来'}</p>
            </section>
          ) : (
            <>
              {tab === 'pa' && <PaCard prices={catalog.prices} paCap={catalog.paCap} players={players} loading={squadState.isPending} windowOpen={windowOpen} />}
              {tab === 'badge' && <BadgeCard prices={catalog.prices} players={players} loading={squadState.isPending} windowOpen={windowOpen} />}
              {tab === 'role' && <RoleCard prices={catalog.prices} players={players} loading={squadState.isPending} windowOpen={windowOpen} />}
              {tab === 'position' && <PositionCard prices={catalog.prices} players={players} loading={squadState.isPending} windowOpen={windowOpen} />}
              {tab === 'shell' && <ShellCard prices={catalog.prices} hpremium={catalog.hpremiumClubIds} windowOpen={windowOpen} />}
            </>
          )}

          <FacilityOpsCard />
          <NamingCard />
          <BookingsCard />
        </div>

        {/* 右侧栏：我的工单 */}
        <div style={{ flex: '0 1 340px' }}>
          <OrdersCard />
        </div>
      </div>
    </>
  );
}

// 每类商品共用的球员下拉：value 存内部 id
function PlayerSelect({
  players,
  value,
  onChange,
  filter,
}: {
  players: ShopSquadStatePlayer[];
  value: string;
  onChange: (id: number | null) => void;
  filter?: (p: ShopSquadStatePlayer) => boolean;
}) {
  const list = filter ? players.filter(filter) : players;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">选球员…</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.number !== null ? `#${p.number} ` : ''}
          {p.name}
        </option>
      ))}
    </select>
  );
}

function submitOrder(category: string, payload: Record<string, unknown>, confirmText: string, note: string | null, after: () => void, fail: (msg: string) => void, done: (msg: string) => void) {
  if (!window.confirm(confirmText)) return;
  void apiPost<{ summary: string }>('/api/shop/orders', { category, payload, note })
    .then((out) => {
      after();
      done(`已提交：${out.summary}。费用已扣，等管理组审核。`);
    })
    .catch((err) => fail(err instanceof Error ? err.message : '提交失败'));
}

/* ---------- 买 PA ---------- */

function PaCard({ prices, paCap, players, loading, windowOpen }: { prices: ShopPrices; paCap: number; players: ShopSquadStatePlayer[]; loading: boolean; windowOpen: boolean }) {
  const { show } = useToast();
  const invalidate = useShopInvalidation();
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [points, setPoints] = useState(1);
  const player = players.find((p) => p.id === playerId) ?? null;
  const price = points * prices.paPerPoint;
  const headroom = player?.pa != null ? paCap - player.pa : null;
  const maxPoints = player?.pa != null ? Math.max(0, Math.min(10, paCap - player.pa)) : 10;
  const disabled = loading || player === null || points < 1 || points > maxPoints || !windowOpen;

  return (
    <section className="card">
      <h3>买 PA</h3>
      <p className="hint">
        <span className="mono">{prices.paPerPoint}</span> m / 点，单次 1–10 点；PA 不可超过当前版本上限 <span className="mono">{paCap}</span>。只有可成长球员能买。
      </p>
      <div className="inline-form">
        <PlayerSelect players={players} value={playerId === null ? '' : String(playerId)} onChange={setPlayerId} filter={(p) => p.growable} />
        <select value={points} onChange={(e) => setPoints(Number(e.target.value))}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n} disabled={headroom !== null && n > headroom}>
              {n} 点
            </option>
          ))}
        </select>
        <span className="mono gold-text">{price.toFixed(2)} m</span>
        <button
          className="btn btn-sm"
          type="button"
          disabled={disabled}
          title={!windowOpen ? WINDOW_CLOSED_NOTE : undefined}
          onClick={() =>
            submitOrder(
              'pa',
              { playerId, points },
              `确认为「${player?.name}」买 ${points} 点 PA，支付 ${price.toFixed(2)} m？（提交即扣费，审核不过自动退款）`,
              null,
              invalidate,
              (m) => show(m, true),
              (m) => show(m),
            )
          }
        >
          提交
        </button>
      </div>
      {player && (
        <p className="hint" style={{ marginBottom: 0 }}>
          当前 PA <span className="mono">{player.pa ?? '—'}</span> / 上限 <span className="mono">{paCap}</span>
          {headroom !== null && <>，还能买 {Math.min(10, Math.max(0, headroom))} 点</>}
          。管理组审核通过后 PA 立即上涨。
        </p>
      )}
    </section>
  );
}

/* ---------- 徽章 ---------- */

type BadgeOp = 'silver' | 'gold' | 'upgrade';

function BadgeCard({ prices, players, loading, windowOpen }: { prices: ShopPrices; players: ShopSquadStatePlayer[]; loading: boolean; windowOpen: boolean }) {
  const { show } = useToast();
  const invalidate = useShopInvalidation();
  const [op, setOp] = useState<BadgeOp>('silver');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [psid, setPsid] = useState<number | null>(null);
  const player = players.find((p) => p.id === playerId) ?? null;
  const price = op === 'silver' ? prices.badgeSilver : op === 'gold' ? prices.badgeGold : prices.badgeSilverToGold;

  const options = (() => {
    if (!player) return [];
    if (op === 'silver') return PS_GRANTABLE_BASE_IDS.filter((id) => !player.ownedSilver.includes(id));
    if (op === 'gold') return PS_GRANTABLE_BASE_IDS.filter((id) => !player.ownedGold.includes(id));
    return player.ownedSilver.filter((id) => !player.ownedGold.includes(id));
  })();
  const silverFull = player != null && player.silverUsed >= 12;
  const goldFull = player != null && player.goldUsed >= 3;
  const opBlocked = (op === 'silver' && silverFull) || ((op === 'gold' || op === 'upgrade') && goldFull);
  const disabled = loading || player === null || psid === null || !options.includes(psid) || opBlocked || !windowOpen;

  return (
    <section className="card">
      <h3>徽章</h3>
      <p className="hint">
        银徽章 <span className="mono">{prices.badgeSilver}</span> m / 金徽章 <span className="mono">{prices.badgeGold}</span> m / 银升金{' '}
        <span className="mono">{prices.badgeSilverToGold}</span> m；每名球员上限 3 金 12 银。
      </p>
      <div className="seg" role="group" aria-label="徽章操作">
        {(['silver', 'gold', 'upgrade'] as BadgeOp[]).map((o) => (
          <button key={o} type="button" className={op === o ? 'on' : ''} onClick={() => { setOp(o); setPsid(null); }}>
            {o === 'silver' ? '买银徽章' : o === 'gold' ? '买金徽章' : '银徽升金'}
          </button>
        ))}
      </div>
      <div className="inline-form" style={{ marginTop: 8 }}>
        <PlayerSelect
          players={players}
          value={playerId === null ? '' : String(playerId)}
          onChange={(id) => {
            setPlayerId(id);
            setPsid(null);
          }}
        />
        <select value={psid === null ? '' : String(psid)} onChange={(e) => setPsid(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">{player === null ? '先选球员' : options.length === 0 ? '没有可选项' : op === 'upgrade' ? '选银徽章…' : '选 PlayStyle…'}</option>
          {options.map((id) => (
            <option key={id} value={id}>
              {playstyleById.get(id)?.chs ?? `PlayStyle #${id}`}
            </option>
          ))}
        </select>
        <span className="mono gold-text">{price.toFixed(2)} m</span>
        <button
          className="btn btn-sm"
          type="button"
          disabled={disabled}
          title={!windowOpen ? WINDOW_CLOSED_NOTE : undefined}
          onClick={() =>
            submitOrder(
              op === 'upgrade' ? 'badge_upgrade' : 'badge',
              op === 'upgrade' ? { playerId, psid } : { playerId, kind: op, psid },
              `确认为「${player?.name}」${op === 'upgrade' ? `把「${playstyleById.get(psid ?? 0)?.chs ?? ''}」银徽升金` : `购${op === 'silver' ? '银' : '金'}徽章「${playstyleById.get(psid ?? 0)?.chs ?? ''}」`}，支付 ${price.toFixed(2)} m？（提交即扣费，审核不过自动退款）`,
              null,
              invalidate,
              (m) => show(m, true),
              (m) => show(m),
            )
          }
        >
          提交
        </button>
      </div>
      {player && (
        <p className="hint" style={{ marginBottom: 0 }}>
          银槽 <span className="mono">{player.silverUsed}/12</span> · 金槽 <span className="mono">{player.goldUsed}/3</span>
          {silverFull && ' · 银槽已满'}
          {goldFull && ' · 金槽已满'}
        </p>
      )}
    </section>
  );
}

/* ---------- 角色（职责） ---------- */

type RoleOp = 'add' | 'upgrade' | 'remove';

function roleLabel(id: number): string {
  const r = roleById.get(id);
  return r ? `${r.chs.replace(/ \+$/, '')}${id > 100 ? ' ++' : ' +'}` : `角色 #${id}`;
}

function RoleCard({ prices, players, loading, windowOpen }: { prices: ShopPrices; players: ShopSquadStatePlayer[]; loading: boolean; windowOpen: boolean }) {
  const { show } = useToast();
  const invalidate = useShopInvalidation();
  const [op, setOp] = useState<RoleOp>('add');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const player = players.find((p) => p.id === playerId) ?? null;

  const price = op === 'add' ? (roleId !== null && roleId > 100 ? prices.roleAddPlusPlus : prices.roleAddPlus) : op === 'upgrade' ? prices.roleUpgrade : prices.roleRemove;

  const roleOptions = (() => {
    if (!player || op !== 'add') return [];
    // 新增角色必须在球员注册位置（热区）下选：双加号 = 基础 ID + 100
    return [1, 2, 3, 4, 5].flatMap((base) =>
      player.zones.includes(rolePositionOfClient(base)) ? [base, base + 100] : [],
    );
  })();
  const ownedBases = new Set((player?.roles ?? []).map((r) => (r.roleId > 100 ? r.roleId - 100 : r.roleId)));
  const addOptions = roleOptions.filter((id) => !ownedBases.has(id > 100 ? id - 100 : id));
  const slotOptions = (player?.roles ?? []).filter((r) => (op === 'upgrade' ? r.roleId <= 100 : true));

  const disabled =
    loading ||
    player === null ||
    !windowOpen ||
    (op === 'add' ? roleId === null || !addOptions.includes(roleId) : slot === null || !slotOptions.some((r) => r.slot === slot));

  return (
    <section className="card">
      <h3>角色（职责）</h3>
      <p className="hint">
        新增单加号 <span className="mono">{prices.roleAddPlus}</span> m / 新增双加号 <span className="mono">{prices.roleAddPlusPlus}</span> m / 单升双{' '}
        <span className="mono">{prices.roleUpgrade}</span> m / 去除 <span className="mono">{prices.roleRemove}</span> m；每名球员上限 5 个角色，只能在注册位置下新增。
      </p>
      <div className="seg" role="group" aria-label="角色操作">
        {(['add', 'upgrade', 'remove'] as RoleOp[]).map((o) => (
          <button key={o} type="button" className={op === o ? 'on' : ''} onClick={() => { setOp(o); setRoleId(null); setSlot(null); }}>
            {o === 'add' ? '新增' : o === 'upgrade' ? '单加号升双加号' : '去除'}
          </button>
        ))}
      </div>
      <div className="inline-form" style={{ marginTop: 8 }}>
        <PlayerSelect
          players={players}
          value={playerId === null ? '' : String(playerId)}
          onChange={(id) => {
            setPlayerId(id);
            setRoleId(null);
            setSlot(null);
          }}
        />
        {op === 'add' ? (
          <select value={roleId === null ? '' : String(roleId)} onChange={(e) => setRoleId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{player === null ? '先选球员' : addOptions.length === 0 ? '热区下没有可新增的角色' : '选角色…'}</option>
            {addOptions.map((id) => (
              <option key={id} value={id}>
                {roleLabel(id)}
              </option>
            ))}
          </select>
        ) : (
          <select value={slot === null ? '' : String(slot)} onChange={(e) => setSlot(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{player === null ? '先选球员' : slotOptions.length === 0 ? (op === 'upgrade' ? '没有单加号角色可升' : '没有角色可去除') : `选槽位（${op === 'upgrade' ? '单加号' : '已有角色'}）…`}</option>
            {slotOptions.map((r) => (
              <option key={r.slot} value={r.slot}>
                第 {r.slot} 槽：{roleLabel(r.roleId)}
              </option>
            ))}
          </select>
        )}
        <span className="mono gold-text">{price.toFixed(2)} m</span>
        <button
          className="btn btn-sm"
          type="button"
          disabled={disabled}
          title={!windowOpen ? WINDOW_CLOSED_NOTE : undefined}
          onClick={() =>
            submitOrder(
              'role',
              op === 'add' ? { playerId, action: 'add', roleId } : { playerId, action: op, slot },
              op === 'add'
                ? `确认为「${player?.name}」新增角色「${roleId !== null ? roleLabel(roleId) : ''}」，支付 ${price.toFixed(2)} m？（提交即扣费，审核不过自动退款）`
                : `确认为「${player?.name}」${op === 'upgrade' ? '把该角色升为双加号' : '去除该角色'}，支付 ${price.toFixed(2)} m？（提交即扣费，审核不过自动退款）`,
              null,
              invalidate,
              (m) => show(m, true),
              (m) => show(m),
            )
          }
        >
          提交
        </button>
      </div>
      {player && (
        <p className="hint" style={{ marginBottom: 0 }}>
          热区 {player.zones.filter(Boolean).join(' / ')} · 现有角色{' '}
          {player.roles.length === 0 ? (
            <span>无</span>
          ) : (
            player.roles.map((r) => (
              <span key={r.slot} style={{ marginRight: 6 }}>
                第 {r.slot} 槽 {roleLabel(r.roleId)}
              </span>
            ))
          )}
        </p>
      )}
    </section>
  );
}

// 角色归属位置：role.json 的 chs 首词即位置（与 src/core/shop.ts 的 ROLE_POSITION_BY_ID 同源，
// 这里用 ref 数据现算，免得再背一份表；tests 锁两端口径一致）
function rolePositionOfClient(baseId: number): string {
  return roleById.get(baseId)?.chs.split(' ')[0] ?? '';
}

/* ---------- 位置热区 ---------- */

type PositionOp = 'add' | 'remove' | 'replace';

const POSITION_OPTIONS = Object.values(POSITION_BY_ID); // 含 GK，选项里再过滤

function PositionCard({ prices, players, loading, windowOpen }: { prices: ShopPrices; players: ShopSquadStatePlayer[]; loading: boolean; windowOpen: boolean }) {
  const { show } = useToast();
  const invalidate = useShopInvalidation();
  const [op, setOp] = useState<PositionOp>('add');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [posId, setPosId] = useState<number | null>(null);
  const player = players.find((p) => p.id === playerId) ?? null;

  const price = op === 'add' ? prices.positionAdd : op === 'remove' ? prices.positionRemove : prices.positionReplace;

  // 槽位口径：热区 = 主位 + 2-4 槽。主位不可动；GK 不可被新增/替换；主位 GK 全拒。
  const isGkMain = player?.zones[0] === 'GK';
  const slotOccupied = (n: number) => player != null && playerZonesAt(player, n) !== null;

  const slotOptions = op === 'add' ? [2, 3, 4].filter((n) => !slotOccupied(n)) : [2, 3, 4].filter((n) => slotOccupied(n));
  const posOptions = (() => {
    if (!player || op === 'remove' || isGkMain) return [];
    const remaining = op === 'replace' ? player.zones.filter((_, i) => i !== (slot ?? -1)) : player.zones;
    return POSITION_OPTIONS.filter((name) => {
      const id = positionIdByName(name);
      if (id === null || name === 'GK') return false;
      if (op === 'add') {
        return !player.zones.includes(name) && player.zones.some((z) => z && areAdjacent(z, name));
      }
      // replace：新位置不得与剩余热区重复，且须与剩余热区之一相邻
      return !remaining.includes(name) && remaining.some((z) => z && areAdjacent(z, name));
    }).map((name) => ({ name, id: positionIdByName(name)! }));
  })();
  const slotChosen = slot !== null && slotOptions.includes(slot);
  const disabled =
    loading ||
    player === null ||
    isGkMain ||
    !windowOpen ||
    !slotChosen ||
    (op !== 'remove' && (posId === null || !posOptions.some((o) => o.id === posId)));

  return (
    <section className="card">
      <h3>位置热区</h3>
      <p className="hint">
        新增 <span className="mono">{prices.positionAdd}</span> m / 去除 <span className="mono">{prices.positionRemove}</span> m / 替换{' '}
        <span className="mono">{prices.positionReplace}</span> m；第一位置不可动，GK 不可增删换，主位 GK 不可操作，热区上限 4 个，新增须与现有热区相邻，去除/替换会连带去除该位置上的角色。
      </p>
      <div className="seg" role="group" aria-label="位置操作">
        {(['add', 'remove', 'replace'] as PositionOp[]).map((o) => (
          <button key={o} type="button" className={op === o ? 'on' : ''} onClick={() => { setOp(o); setSlot(null); setPosId(null); }}>
            {o === 'add' ? '新增' : o === 'remove' ? '去除' : '替换'}
          </button>
        ))}
      </div>
      <div className="inline-form" style={{ marginTop: 8 }}>
        <PlayerSelect
          players={players}
          value={playerId === null ? '' : String(playerId)}
          onChange={(id) => {
            setPlayerId(id);
            setSlot(null);
            setPosId(null);
          }}
        />
        {isGkMain ? (
          <span className="muted">主位 GK，不可操作位置热区</span>
        ) : (
          <>
            <select
              value={slot === null ? '' : String(slot)}
              onChange={(e) => {
                setSlot(e.target.value === '' ? null : Number(e.target.value));
                setPosId(null);
              }}
            >
              <option value="">{player === null ? '先选球员' : slotOptions.length === 0 ? (op === 'add' ? '没有空槽' : '没有已设槽位') : op === 'add' ? '选空槽…' : '选槽位…'}</option>
              {slotOptions.map((n) => (
                <option key={n} value={n}>
                  {op === 'add' ? `第 ${n} 槽（空）` : `第 ${n} 槽：${playerZonesAt(player!, n)}`}
                </option>
              ))}
            </select>
            {op !== 'remove' && (
              <select value={posId === null ? '' : String(posId)} onChange={(e) => setPosId(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">{player === null || slot === null ? '先选槽位' : posOptions.length === 0 ? '没有相邻可选位置' : '选位置…'}</option>
                {posOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <span className="mono gold-text">{price.toFixed(2)} m</span>
        <button
          className="btn btn-sm"
          type="button"
          disabled={disabled}
          title={!windowOpen ? WINDOW_CLOSED_NOTE : undefined}
          onClick={() =>
            submitOrder(
              'position',
              op === 'remove' ? { playerId, action: 'remove', slot } : { playerId, action: op, slot, posId },
              `确认为「${player?.name}」${op === 'add' ? `新增位置「${POSITION_BY_ID[posId ?? 0] ?? ''}」` : op === 'remove' ? `去除第 ${slot} 槽位置` : `把第 ${slot} 槽替换为「${POSITION_BY_ID[posId ?? 0] ?? ''}」`}，支付 ${price.toFixed(2)} m？（提交即扣费，审核不过自动退款）`,
              null,
              invalidate,
              (m) => show(m, true),
              (m) => show(m),
            )
          }
        >
          提交
        </button>
      </div>
      {player && (
        <p className="hint" style={{ marginBottom: 0 }}>
          当前热区：
          <span className="badge" title="第一位置不可动">
            🔒 {player.zones[0]}（主位）
          </span>
          {player.zones.slice(1).filter(Boolean).map((z, i) => (
            <span key={i} className="badge" style={{ marginLeft: 6 }}>
              {z}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function positionIdByName(name: string): number | null {
  const hit = Object.entries(POSITION_BY_ID).find(([, n]) => n === name);
  return hit ? Number(hit[0]) : null;
}

/** 第 n 槽（n≥2）的位置名；空槽返回 null（主位永远是 zones[0]） */
function playerZonesAt(p: ShopSquadStatePlayer, n: number): string | null {
  return p.zones[n - 1] ?? null;
}

/* ---------- 队壳申请 ---------- */

function ShellCard({ prices, hpremium, windowOpen }: { prices: ShopPrices; hpremium: number[]; windowOpen: boolean }) {
  const { show } = useToast();
  const invalidate = useShopInvalidation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // 豪门判定按「我的俱乐部」：hpremium 是俱乐部 id 名单
  const { club } = useMyClub();
  const isHpremium = club != null && hpremium.includes(club.id);

  return (
    <section className="card">
      <h3>队壳申请</h3>
      <p className="hint">
        申请费 <span className="mono">{prices.clubShell}</span> m（提交即扣，拒绝自动退款）。同一时间只能有一张待审申请；管理组线下挑壳建档后发绑定码，凭码到我的球队绑定。
        {isHpremium && ' ⚠️ 豪门俱乐部队壳事项请在群内咨询管理组，系统不受理申请。'}
      </p>
      <div className="inline-form">
        <input className="grow" style={{ flex: 1 }} placeholder="给管理组的备注（想要的方向、预算等，可空）" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <button
          className="btn btn-sm"
          type="button"
          disabled={busy || isHpremium || !windowOpen}
          title={isHpremium ? '豪门队壳事项请在群内咨询管理组' : !windowOpen ? WINDOW_CLOSED_NOTE : undefined}
          onClick={() => {
            if (!window.confirm(`确认提交队壳申请，支付 ${prices.clubShell.toFixed(2)} m？（提交即扣费，拒绝自动退款）`)) return;
            setBusy(true);
            void apiPost<{ summary: string }>('/api/shop/orders', { category: 'club_shell', payload: { note: note.trim() || undefined }, note: note.trim() || null })
              .then(() => {
                invalidate();
                show('队壳申请已提交，费用已扣。管理组线下定壳后交付绑定码。');
                setNote('');
              })
              .catch((err) => show(err instanceof Error ? err.message : '提交失败', true))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '提交中…' : '提交申请'}
        </button>
      </div>
    </section>
  );
}

/* ---------- 我的工单（右栏，行内展开） ---------- */

function OrdersCard() {
  const { time } = useTimeFmt();
  const ordersQuery = useShopOrders(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const orders = ordersQuery.data?.orders ?? [];
  // 待审置顶（金），其余按时间倒序
  const pending = orders.filter((o) => o.status === 'pending');
  const rest = orders.filter((o) => o.status !== 'pending');
  const sorted = [...pending, ...rest];

  return (
    <section className="card">
      <h3>我的工单</h3>
      {ordersQuery.isError ? (
        <p className="muted">{ordersQuery.error instanceof Error ? ordersQuery.error.message : '工单读不出来'}</p>
      ) : sorted.length === 0 ? (
        <p className="muted">{ordersQuery.isPending ? '正在读工单…' : '还没有提交过工单。'}</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {sorted.map((o) => {
            const st = STATUS_BADGE[o.status];
            const open = expanded === o.id;
            return (
              <div key={o.id} className={o.status === 'pending' ? 'banner warn' : ''} style={{ padding: '6px 8px', cursor: 'pointer' }} onClick={() => setExpanded(open ? null : o.id)}>
                <div>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                  {o.source === 'external' && (
                    <span className="badge sky" style={{ marginLeft: 6 }} title="管理组代录的外部增益（积分兑换 / 奖励等）">
                      外部
                    </span>
                  )}
                  <span style={{ marginLeft: 6 }}>{o.categoryLabel}</span>
                  {o.amount !== null && <span className="mono gold-text" style={{ float: 'right' }}>−{o.amount.toFixed(2)} m</span>}
                </div>
                <p className="hint" style={{ margin: '2px 0 0' }}>
                  {o.summary} · {time(o.createdAt)}
                </p>
                {o.status === 'rejected' && o.rejectReason && (
                  <p className="error-msg" style={{ margin: '2px 0 0' }}>
                    理由：{o.rejectReason}（费用已退回）
                  </p>
                )}
                {open && (
                  <div style={{ marginTop: 4 }}>
                    <pre className="mono muted" style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
                      {JSON.stringify(o.payload, null, 2)}
                    </pre>
                    {o.note && <p className="hint">备注：{o.note}</p>}
                    <p className="hint" style={{ margin: 0 }}>
                      单号 <span className="mono">#{o.id}</span> · {o.source === 'external' ? '管理组代录' : '教练提交'} · {o.reviewedAt ? `审核于 ${time(o.reviewedAt)}` : '未审核'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
