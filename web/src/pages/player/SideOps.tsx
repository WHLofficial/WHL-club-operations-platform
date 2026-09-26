// 左栏五态操作区（v6.2.0 出骨架，v6.3.0 接真实端点与数据）：
//   A 本队·未挂牌 = 报价设置（真实读写）+ 续约/挂牌/解约（开单端点）+ 我收到的报价入口
//   B 本队·挂牌中 = 转会区信息（要价/最高出价来自转会区列表缓存）；主动下架无端点，窗尾自动收口
//   C 别队真人·未挂牌 = 报价（POST /api/offers，报价即冻结）/ 激活（POST /api/market/activations）
//   D 别队真人·非卖品 = 报价置灰「此球员为非卖品！」；激活不受非卖品限制
//   E CPU 队 / 自由身 = 海捞签入（POST /api/transfers/free-agent，带新违约金）
// 窗门控（v6.2.0 延续）：转会动作后端一律 409 no_window，前端关窗时同步置灰；
// 报价设置是意图标记不锁窗，关窗时也能改。
// 训练营球员（contractType=trainee）：合同固定、只能被激活带走，不显示报价设置与挂牌/续约。
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost, apiPut, apiUpload, type ContractDto } from '../../lib/api.ts';
import { qk, usePlayerListing, useListingDetail, useMarketInvalidation, useOffersInvalidation } from '../../lib/queries.ts';
import { MarketBidForm } from '../../components/MarketBidForm.tsx';
import { money } from '../market/shared.tsx';

export interface SideOpsPlayer {
  id: number;
  status: string;
  transferListed: boolean;
  minOfferPrice: number | null;
  offerAuto: boolean;
  notForSale: boolean;
}

type Panel = null | 'offer' | 'renew' | 'list' | 'term' | 'freeagent' | 'activate';

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function SideOps({
  player,
  contract,
  isMine,
  isFree,
  isCpu,
  isCoach,
  myClubId,
  windowOpen,
  pendingMine,
  show,
  refreshAll,
}: {
  player: SideOpsPlayer;
  contract: ContractDto | null;
  isMine: boolean;
  isFree: boolean;
  isCpu: boolean;
  isCoach: boolean;
  /** 我的俱乐部 id（举报判据：本队球员被别队激活时才知道「激活方不是我」） */
  myClubId: number | null;
  windowOpen: boolean;
  /** 轮到我处理的收到报价条数（/api/offers?box=in 的 pendingMine） */
  pendingMine: number;
  show: (text: string, err?: boolean) => void;
  refreshAll: () => void;
}) {
  const qc = useQueryClient();
  const invalidateOffers = useOffersInvalidation();
  const invalidateMarket = useMarketInvalidation();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [bidBusy, setBidBusy] = useState(false);
  const [armed, setArmed] = useState(false); // 解约 / 激活这类不可逆动作的第二击
  // 报价设置草稿（v6.4.0 改动 B：最低报价/自动应答与转会名单解耦；非卖品与名单互斥自动清对方）
  const [listDraft, setListDraft] = useState(player.transferListed);
  const [minDraft, setMinDraft] = useState(player.minOfferPrice === null ? '' : String(player.minOfferPrice));
  const [autoDraft, setAutoDraft] = useState(player.offerAuto);
  const [nfsDraft, setNfsDraft] = useState(player.notForSale);
  // 操作草稿
  const [offerAmount, setOfferAmount] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [renewFee, setRenewFee] = useState('');
  const [askPrice, setAskPrice] = useState('');
  const [freeFee, setFreeFee] = useState('');
  // 激活证据截图（v6.4.0 改动 4：证据制，激活必附 QQ 通知截图）
  const [proofFile, setProofFile] = useState<File | null>(null);

  // 草稿只在换球员时重置：保存后数据刷新（player 字段值变化）会把用户在刷新窗口内的
  // 下一次操作覆盖掉（草稿回跳、保存按钮失效），所以刻意不依赖字段值。
  useEffect(() => {
    setListDraft(player.transferListed);
    setMinDraft(player.minOfferPrice === null ? '' : String(player.minOfferPrice));
    setAutoDraft(player.offerAuto);
    setNfsDraft(player.notForSale);
    setPanel(null);
    setArmed(false);
    setProofFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上：只跟随 player.id
  }, [player.id]);

  // 挂牌态信息源（v6.4.0 改动 6）：按球员查现行挂牌（公开端点），详情给下一步最低价与出价历史。
  // 只有教练 + 挂牌中的球员才启用查询，其余态零请求。
  const playerListingQuery = usePlayerListing(player.id, isCoach && player.status === 'listed');
  const activeListingId = playerListingQuery.data?.listings[0]?.id ?? null;
  const listedDetailQuery = useListingDetail(activeListingId);

  const releaseFee = contract?.releaseFee ?? null;
  const offerCap = releaseFee !== null && releaseFee > 0 ? round2(releaseFee * 1.5) : null;
  const isTrainee = contract?.contractType === 'trainee';
  // v6.4.0 改动 B：线与开关独立于转会名单，脏判按「草稿 ≠ 现值」逐字段比
  const minDraftValue = minDraft === '' ? null : Number(minDraft);
  const settingsDirty =
    listDraft !== player.transferListed ||
    nfsDraft !== player.notForSale ||
    minDraftValue !== player.minOfferPrice ||
    autoDraft !== player.offerAuto;

  async function run(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      show(await fn());
      setPanel(null);
      setArmed(false);
      invalidateOffers();
      void qc.invalidateQueries({ queryKey: qk.myClub });
      void qc.invalidateQueries({ queryKey: qk.squad });
      void qc.invalidateQueries({ queryKey: ['market', 'board'] });
      void qc.invalidateQueries({ queryKey: ['market', 'listing-by-player', player.id] });
      refreshAll();
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    void run(async () => {
      await apiPut(`/api/players/${player.id}/offer-settings`, {
        transferListed: listDraft,
        minOfferPrice: minDraftValue,
        offerAuto: autoDraft,
        notForSale: nfsDraft,
      });
      return '报价设置已保存。';
    });
  }

  // 激活提交（v6.4.0 改动 4）：先传 QQ 通知截图拿 key，再带 key 建激活挂牌
  function submitActivation() {
    if (!proofFile) return;
    void run(async () => {
      const up = await apiUpload<{ key: string }>('/api/media/activation', proofFile.type, proofFile);
      await apiPost('/api/market/activations', { playerId: player.id, proofMediaKey: up.key });
      return '激活挂牌已提交：5 分钟内出首价才算数。';
    });
  }

  // 出价提交（v6.4.0 改动 6，别队挂牌分支）：与转会区详情同一端点，成功后联动失效
  async function submitBid(amount: number) {
    if (activeListingId === null || bidBusy) return;
    setBidBusy(true);
    try {
      await apiPost(`/api/market/listings/${activeListingId}/bids`, { amount });
      show('出价已提交，资金冻结中。');
      invalidateMarket(activeListingId);
      void qc.invalidateQueries({ queryKey: ['market', 'listing-by-player', player.id] });
      refreshAll();
    } catch (err) {
      show(err instanceof Error ? err.message : '出价失败', true);
    } finally {
      setBidBusy(false);
    }
  }

  // 举报激活通知（v6.4.0 改动 4，被激活方）：只建管理核查任务，不冻结匹配窗
  function reportActivation() {
    void run(async () => {
      await apiPost(`/api/market/listings/${activeListingId}/activation-report`, {});
      return '举报已提交，管理组会核查对方的 QQ 通知截图。';
    });
  }

  const activatePanel = (
    <>
      <label className="side-field">
        <span className="side-lab">
          <span>QQ 通知截图</span>
          <span className="side-range mono">≤ 5MB</span>
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
          aria-label="QQ 通知截图"
        />
      </label>
      <p className="side-sub">证据制：先上传你在 QQ 里通知对方俱乐部的截图（png / jpg / webp），再提交激活。对方如未收到通知可以举报，管理组会核查截图。</p>
      <div className="side-btns">
        <button type="button" className="btn btn-sm" disabled={busy || !proofFile} onClick={submitActivation}>
          提交激活
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setPanel(null)}>
          取消
        </button>
      </div>
    </>
  );

  let body: ReactElement | null;
  if (!isCoach) {
    body = null;
  } else if (isMine && player.status === 'listed') {
    // 本队挂牌中（含训练营球员被别队激活）：挂牌信息 + 被激活方的举报入口（v6.4.0 改动 4/6）
    const ld = listedDetailQuery.data ?? null;
    const l = ld?.listing ?? null;
    const activatedByOther = l !== null && l.type === 'activation' && l.activatedBy !== null && l.activatedBy !== myClubId;
    const leaderBid = ld?.bids.find((b) => b.status === 'active') ?? null;
    body = (
      <section className="side-sec">
        <div className="side-sec-head">转会区 · 本队挂牌中</div>
        <div className="side-row">
          <span className="attr-name">要价</span>
          <span className="mono">{l ? `${money(l.askPrice)} m` : '—'}</span>
        </div>
        <div className="side-row">
          <span className="attr-name">最高出价</span>
          <span className="mono">{l?.highestBid != null ? `${money(l.highestBid)} m` : '暂无出价'}</span>
        </div>
        {leaderBid && (
          <div className="side-row">
            <span className="attr-name">领先出价方</span>
            <span>{leaderBid.clubName}</span>
          </div>
        )}
        <div className="side-btns">
          <Link className="btn btn-sm" to="/market">
            去转会区
          </Link>
          {activatedByOther && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={reportActivation}>
              举报（没收到 QQ 通知）
            </button>
          )}
        </div>
        {activatedByOther ? (
          <p className="side-sub">本队球员被激活：对方声称已在 QQ 通知并提交了截图。如未收到通知可举报，管理组会核查（不影响匹配窗）。</p>
        ) : (
          <p className="side-sub">挂牌期间无任何操作；窗口结束无人出价会自动下架（收下架费）。</p>
        )}
      </section>
    );
  } else if (!isMine && player.status === 'listed') {
    // 别队挂牌（v6.4.0 改动 6）：挂牌信息 + 出价途径——修掉此前落 C 态暴露必 4xx 报价/激活按钮的真缺陷
    const ld = listedDetailQuery.data ?? null;
    const l = ld?.listing ?? null;
    const isActivator = myClubId !== null && l?.activatedBy === myClubId;
    const canBid =
      l !== null &&
      (l.status === 'listed' || l.status === 'bidding') &&
      l.windowOpen &&
      !l.bidPaused &&
      !ld?.marketBidPaused &&
      !(l.firstBidPending && !isActivator);
    body = (
      <section className="side-sec">
        <div className="side-sec-head">转会区 · 外队挂牌中</div>
        {l === null ? (
          <p className="side-sub">正在查这单挂牌…</p>
        ) : (
          <>
            <div className="side-row">
              <span className="attr-name">挂牌方</span>
              <span>{l.sellerClub.name}</span>
            </div>
            <div className="side-row">
              <span className="attr-name">{l.type === 'activation' ? '激活价' : '挂牌价'}</span>
              <span className="mono">{money(l.askPrice)} m</span>
            </div>
            <div className="side-row">
              <span className="attr-name">当前最高</span>
              <span className="mono gold-text">
                {l.highestBidder ? `${l.highestBidder.name} · ${money(l.highestBid)} m` : l.highestBid != null ? `${money(l.highestBid)} m` : '暂无出价'}
              </span>
            </div>
            {canBid ? (
              <MarketBidForm
                mode={l.firstBidPending && isActivator ? 'activation-first' : 'normal'}
                askPrice={l.askPrice}
                nextMinBid={l.nextMinBid}
                available={null}
                onBid={submitBid}
              />
            ) : (
              <p className="side-sub">
                {!l.windowOpen
                  ? '这单所属的转会窗口已经关了。'
                  : l.status === 'pending_review'
                    ? '这单已截止，正在等管理组审核。'
                    : l.status === 'matched_pending'
                      ? '首价已落定，正在等被激活方决定是否匹配。'
                      : l.firstBidPending
                        ? `激活首价窗内只有激活方可以出价。`
                        : '这单暂时不能出价。'}
              </p>
            )}
            <div className="side-btns">
              <Link className="btn btn-sm btn-ghost" to="/market">
                去转会区看详情
              </Link>
            </div>
          </>
        )}
      </section>
    );
  } else if (isMine && !isTrainee) {
    body = (
      <>
        <section className="side-sec">
          <div className="side-sec-head">报价设置</div>
          <div className="side-row">
            <span className="attr-name">转会名单</span>
            <span className="seg seg-mini" role="radiogroup" aria-label="转会名单">
              <button
                type="button"
                className={listDraft ? 'on' : ''}
                disabled={busy}
                onClick={() => {
                  setListDraft(true);
                  setNfsDraft(false);
                }}
              >
                是
              </button>
              <button type="button" className={!listDraft ? 'on' : ''} disabled={busy} onClick={() => setListDraft(false)}>
                否
              </button>
            </span>
          </div>
          <label className="side-field">
            <span className="side-lab">
              <span>最低报价（m）</span>
              <span className="side-range mono">{offerCap !== null ? `≤ ${offerCap}` : '—'}</span>
            </span>
            <input
              className="mono"
              inputMode="decimal"
              min="1"
              step="0.5"
              placeholder="留空 = 不设线"
              value={minDraft}
              onChange={(e) => setMinDraft(e.target.value.replace(/[^0-9.]/g, ''))}
              aria-label="最低报价"
            />
          </label>
          <div className="side-row">
            <span className="attr-name">达线自动同意</span>
            <span className="seg seg-mini" role="radiogroup" aria-label="达线自动同意">
              <button
                type="button"
                className={autoDraft ? 'on' : ''}
                disabled={busy || minDraftValue === null}
                onClick={() => setAutoDraft(true)}
              >
                是
              </button>
              <button
                type="button"
                className={!autoDraft ? 'on' : ''}
                disabled={busy || minDraftValue === null}
                onClick={() => setAutoDraft(false)}
              >
                否
              </button>
            </span>
          </div>
          <p className="side-sub">
            低于最低报价一律自动拒（与开关无关）；达线且开关开着才自动同意，否则进人工谈判。两者都不必进转会名单{listDraft ? '，但进名单必须设线' : ''}。
          </p>
          <div className="side-row">
            <span className="attr-name">非卖品</span>
            <span className="seg seg-mini" role="radiogroup" aria-label="非卖品">
              <button
                type="button"
                className={nfsDraft ? 'on' : ''}
                disabled={busy}
                onClick={() => {
                  setNfsDraft(true);
                  setListDraft(false);
                }}
              >
                是
              </button>
              <button type="button" className={!nfsDraft ? 'on' : ''} disabled={busy} onClick={() => setNfsDraft(false)}>
                否
              </button>
            </span>
          </div>
          {nfsDraft && <p className="side-sub">一切报价自动拒</p>}
          <div className="side-btns">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !settingsDirty}
              onClick={() => saveSettings()}
            >
              保存设置
            </button>
          </div>
        </section>
        <section className="side-sec">
          <div className="side-sec-head">球队操作</div>
          {panel === 'renew' && (
            <>
              <label className="side-field">
                <span className="side-lab">
                  <span>新违约金（m）</span>
                  <span className="side-range mono">
                    {releaseFee !== null ? (releaseFee <= 20 ? `±10` : `±50%`) : '—'}
                  </span>
                </span>
                <input
                  className="mono"
                  inputMode="decimal"
                  value={renewFee}
                  onChange={(e) => setRenewFee(e.target.value.replace(/[^0-9.]/g, ''))}
                  aria-label="新违约金"
                />
              </label>
              <p className="side-sub">提高付差额的 30%、降低免费；保护期从审核通过起重新起算。</p>
              <div className="side-btns">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy || renewFee === ''}
                  onClick={() =>
                    void run(async () => {
                      const r = await apiPost<{ oldReleaseFee: number; newReleaseFee: number; changeFee: number }>(
                        '/api/transfers/rc-change',
                        { playerId: player.id, newReleaseFee: Number(renewFee) },
                      );
                      return `续约已提交：${r.oldReleaseFee.toFixed(2)} → ${r.newReleaseFee.toFixed(2)} m${
                        r.changeFee > 0 ? `，加价 30% 共 ${r.changeFee.toFixed(2)} m 待审核收取` : ''
                      }。`;
                    })
                  }
                >
                  提交续约
                </button>
              </div>
            </>
          )}
          {panel === 'list' && (
            <>
              <label className="side-field">
                <span className="side-lab">
                  <span>挂牌要价（m）</span>
                  <span className="side-range mono">{offerCap !== null ? `≤ ${offerCap}` : '—'}</span>
                </span>
                <input
                  className="mono"
                  inputMode="decimal"
                  value={askPrice}
                  onChange={(e) => setAskPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                  aria-label="挂牌要价"
                />
              </label>
              <p className="side-sub">下限取违约金/身价五折取低（不低于 1 m），上限违约金 1.5 倍。</p>
              <div className="side-btns">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy || askPrice === ''}
                  onClick={() =>
                    void run(async () => {
                      const r = await apiPost<{ listingId: number; min: number; max: number }>('/api/market/listings', {
                        playerId: player.id,
                        askPrice: Number(askPrice),
                      });
                      return `挂牌成功（#${r.listingId}）：规则区间 ${r.min.toFixed(2)}–${r.max.toFixed(2)} m。`;
                    })
                  }
                >
                  提交挂牌
                </button>
              </div>
            </>
          )}
          {panel === 'term' && (
            <>
              <p className="side-sub">
                解约费 = 违约金 ×（3 − 效力赛季数）× 10%（效力满 3 赛季免费）；被解约球员本窗全联盟禁签。再次点击确认。
              </p>
              <div className="side-btns">
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (!armed) {
                      setArmed(true);
                      return;
                    }
                    void run(async () => {
                      const r = await apiPost<{ terminationFee: number }>('/api/transfers/termination', { playerId: player.id });
                      return `解约申请已提交：${
                        r.terminationFee > 0 ? `解约费 ${r.terminationFee.toFixed(2)} m 待审核时回收` : '效力满 3 赛季免费'
                      }。`;
                    });
                  }}
                >
                  {armed ? '确认解约' : '解约'}
                </button>
              </div>
            </>
          )}
          {panel === null && (
            <div className="side-btns">
              <button type="button" className="btn btn-sm" disabled={busy || !windowOpen || releaseFee === null} onClick={() => setPanel('renew')}>
                续约
              </button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !windowOpen || releaseFee === null} onClick={() => setPanel('list')}>
                挂牌
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy || !windowOpen} onClick={() => setPanel('term')}>
                解约
              </button>
            </div>
          )}
          {panel !== null && (
            <div className="side-btns">
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setPanel(null)}>
                取消
              </button>
            </div>
          )}
          {releaseFee === null && <p className="side-sub">没有含违约金的现行合同，续约/挂牌先找管理组补合同。</p>}
        </section>
        <Link className="side-entry" to="/offers?box=in">
          <span>我收到的报价</span>
          <span className={pendingMine > 0 ? 'mono gold-text' : 'muted'}>
            {pendingMine > 0 ? `${pendingMine} 条待处理 ›` : '暂无待处理 ›'}
          </span>
        </Link>
      </>
    );
  } else if (isMine) {
    // 本队训练营球员：合同固定，唯一出口是被激活转会
    body = (
      <section className="side-sec">
        <div className="side-sec-head">球队操作</div>
        <p className="side-sub">训练营球员：合同固定（工资 0.75 m / 违约金 5 m），只能被其他球队按激活转会带走。</p>
      </section>
    );
  } else if (player.notForSale) {
    body = (
      <section className="side-sec">
        <div className="side-sec-head">球队操作</div>
        {panel === 'activate' ? (
          activatePanel
        ) : (
          <div className="side-btns">
            <button type="button" className="btn btn-sm" disabled title="此球员为非卖品">
              报价
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !windowOpen} onClick={() => setPanel('activate')}>
              激活
            </button>
          </div>
        )}
        <p className="side-sub">此球员为非卖品！激活不受非卖品限制。</p>
      </section>
    );
  } else if (isFree || isCpu) {
    body = (
      <section className="side-sec">
        <div className="side-sec-head">球队操作</div>
        {panel === 'freeagent' ? (
          <>
            <label className="side-field">
              <span className="side-lab">
                <span>新违约金（m）</span>
              </span>
              <input
                className="mono"
                inputMode="decimal"
                value={freeFee}
                onChange={(e) => setFreeFee(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="新违约金"
              />
            </label>
            <p className="side-sub">签入即付海捞费并定新合同；签完本窗内他队还能竞价挖角。</p>
            <div className="side-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || freeFee === ''}
                onClick={() =>
                  void run(async () => {
                    const r = await apiPost<{ fee: number }>('/api/transfers/free-agent', {
                      playerId: player.id,
                      newReleaseFee: Number(freeFee),
                    });
                    return `海捞签入成功，海捞费 ${r.fee?.toFixed(2) ?? '—'} m。`;
                  })
                }
              >
                确认签入
              </button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setPanel(null)}>
                取消
              </button>
            </div>
          </>
        ) : (
          <div className="side-btns">
            <button type="button" className="btn btn-sm" disabled={busy || !windowOpen} onClick={() => setPanel('freeagent')}>
              海捞签入
            </button>
          </div>
        )}
      </section>
    );
  } else {
    // C 态：别队真人 · 未挂牌
    body = (
      <section className="side-sec">
        <div className="side-sec-head">球队操作</div>
        {panel === 'offer' ? (
          <>
            <label className="side-field">
              <span className="side-lab">
                <span>报价（m）</span>
                <span className="side-range mono">{offerCap !== null ? `≤ ${offerCap}` : '—'}</span>
              </span>
              <input
                className="mono"
                inputMode="decimal"
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="报价金额"
              />
            </label>
            <label className="side-field">
              <span className="side-lab">
                <span>附言（可选）</span>
              </span>
              <input
                value={offerNote}
                onChange={(e) => setOfferNote(e.target.value.slice(0, 100))}
                aria-label="报价附言"
                placeholder="给卖家的一句话"
              />
            </label>
            {player.minOfferPrice !== null && (
              <p className="side-sub">对方最低报价线 {player.minOfferPrice} m：低于线自动拒；达线且对方开了自动同意才直接成交，否则进人工谈判。</p>
            )}
            <p className="side-sub">报价即冻结资金；对方同意即自动挂牌，你的价锁成领先出价。</p>
            <div className="side-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || offerAmount === ''}
                onClick={() =>
                  void run(async () => {
                    const r = await apiPost<{ offerId: number; status: string }>('/api/offers', {
                      playerId: player.id,
                      amount: Number(offerAmount),
                      note: offerNote || undefined,
                    });
                    return r.status === 'accepted'
                      ? '达到对方最低报价线，已自动同意并挂牌！'
                      : r.status === 'rejected'
                        ? '低于对方最低报价线，报价被自动拒绝。'
                        : `报价已送出（#${r.offerId}），等卖家表态。`;
                  })
                }
              >
                送出报价
              </button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setPanel(null)}>
                取消
              </button>
            </div>
          </>
        ) : panel === 'activate' ? (
          activatePanel
        ) : (
          <div className="side-btns">
            <button type="button" className="btn btn-sm" disabled={busy || !windowOpen} onClick={() => setPanel('offer')}>
              报价
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !windowOpen} onClick={() => setPanel('activate')}>
              激活
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="side-ops">
      {!windowOpen && <div className="side-closed-note">转会窗未开放，转会相关操作暂不可用</div>}
      {body}
    </div>
  );
}
