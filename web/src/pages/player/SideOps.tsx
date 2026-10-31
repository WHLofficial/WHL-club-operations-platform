// 左栏五态操作区（v6.2.0 出骨架，v6.3.0 接真实端点与数据）：
//   A 本队·未挂牌 = 报价设置（真实读写）+ 续约/挂牌/解约（开单端点）+ 我收到的报价入口
//     （v6.33.0 标价：进转会名单必填公开标价，最低报价转全系统私密，预填走 offer-settings 端点）
//   B 本队·挂牌中 = 转会区信息（要价/最高出价来自转会区列表缓存）；主动下架无端点，窗尾自动收口
//   C 别队真人·未挂牌 = 报价（POST /api/offers，报价即冻结）/ 激活（POST /api/market/activations）
//   D 别队真人·非卖品 = 报价置灰「此球员为非卖品！」；激活不受非卖品限制
//   E CPU 队 / 自由身 = 海捞签入（POST /api/transfers/free-agent，带新违约金）；v6.17.0 起
//     可用性与不可签原因以详情下发的 seaSign 为准（后端 createFreeAgent 守卫链同源），
//     违约金输入框下嵌 seaComps 成交参照；v6.50.0 起收标期内改走密封标（POST /api/transfers/sea-sealed）
// 窗门控（v6.2.0 延续）：转会动作后端一律 409 no_window，前端关窗时同步置灰；
// 报价设置是意图标记不锁窗，关窗时也能改。
// v6.29.0：报价（POST /api/offers）移出窗门控——关窗期也能送报价/还价/同意，
// 关窗期谈成先挂「意向单」（status=intent），开窗后由卖方确认才挂牌。
// 训练营球员（contractType=trainee）：合同固定、只能被激活带走，不显示报价设置与挂牌/续约。
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  apiPut,
  apiSend,
  apiUpload,
  type ContractDto,
  type ContractPendingView,
  type FreeAgentResult,
  type OfferSettingsDto,
  type PlayerDemandState,
  type SeaComps,
  type SeaSignEligibility,
  type SeaSubmitResult,
} from '../../lib/api.ts';
import { fmt2, fmtShort } from '../../lib/contract-view.ts';
import { qk, useOfferSettings, usePlayerListing, useListingDetail, useMarketInvalidation, useOffersInvalidation, useSeaPhase, useClubBalance, useShortlistIds, useShortlistInvalidation } from '../../lib/queries.ts';
import { MarketBidForm } from '../../components/MarketBidForm.tsx';
import OpsGateNote from '../../components/OpsGateNote.tsx';
import { useOpsGate } from '../../lib/ops-gate.ts';
import { useToast } from '../../lib/toast.tsx';
import { creditUse } from '../../lib/credit-line.ts';
import { useTimeFmt } from '../../lib/datetime.ts';
import { fmtClock, useCountdown } from '../../lib/use-countdown.ts';
import { money } from '../market/shared.tsx';
import { ActivationProofDialog } from '../market/ActivationProofDialog.tsx';
import { listingFloorOf, offerCapOf } from '../../lib/transfer-bounds.ts';
import { freeAgentFeePreview, terminationFeePreview } from '../../lib/bypass-fee-preview.ts';

export interface SideOpsPlayer {
  id: number;
  /** 显示名（v6.54.0 步骤 7）：顶部只读块的主语用球员名 */
  name: string;
  status: string;
  transferListed: boolean;
  /** 公开标价（v6.33.0）：详情端点只下发它，私密最低报价不再经详情透出 */
  listPrice: number | null;
  offerAuto: boolean;
  notForSale: boolean;
  /** 身价（v6.54.1）：标价/挂牌下限「违约金/身价五折取低」的取数 */
  marketValue: number | null;
}

type Panel = null | 'offer' | 'renew' | 'list' | 'term' | 'freeagent' | 'sealed';

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function SideOps({
  player,
  contract,
  contractPending,
  demandState,
  isMine,
  isFree,
  isCpu,
  isCoach,
  myClubId,
  windowOpen,
  seaSign,
  seaComps,
  pendingMine,
  myClubName,
  opponentClubName,
  onShowContract,
  show,
  refreshAll,
}: {
  player: SideOpsPlayer;
  contract: ContractDto | null;
  /** 待生效合同变更（v6.54.0 步骤 7，仅本队教练非空）：续约禁用矩阵与「看双版本合同」入口 */
  contractPending: ContractPendingView | null;
  /** 本窗球员要求/转会申请状态（仅本队教练）：四态只读块 */
  demandState: PlayerDemandState | null;
  isMine: boolean;
  isFree: boolean;
  isCpu: boolean;
  isCoach: boolean;
  /** 我的俱乐部 id（举报判据：本队球员被别队激活时才知道「激活方不是我」） */
  myClubId: number | null;
  windowOpen: boolean;
  /** 海捞资格（v6.17.0，详情 seaSign）：E 态按钮开关与不可签原因都由它下发 */
  seaSign: SeaSignEligibility;
  /** 海捞成交参照（v6.17.0，详情 seaComps）：违约金输入框下方的定价锚 */
  seaComps: SeaComps;
  /** 轮到我处理的收到报价条数（/api/offers?box=in 的 pendingMine） */
  pendingMine: number;
  /** 激活通知弹窗的示例文案（v6.60.0）：我的队名与球员现属队名，缺失时用规则原文示例 */
  myClubName?: string | null;
  opponentClubName?: string | null;
  /** 跳到本页「合同卷宗」页签并滚到双版本合同卡（§10.2 已接受态的入口） */
  onShowContract: () => void;
  show: (text: string, err?: boolean) => void;
  refreshAll: () => void;
}) {
  const qc = useQueryClient();
  const invalidateOffers = useOffersInvalidation();
  const invalidateMarket = useMarketInvalidation();
  // v6.49.0 运营时刻表：三类写入口的置灰真源（后端 assertOpOpen 仍是硬闸，这里只省白填一遍表单）
  const listingGate = useOpsGate('transfer_listing');
  const seaGate = useOpsGate('transfer_sea_open');
  const offerGate = useOpsGate('transfer_offer');
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [bidBusy, setBidBusy] = useState(false);
  const [armed, setArmed] = useState(false); // 解约 / 激活这类不可逆动作的第二击
  // 报价设置（v6.33.0 标价）：私密预填源——详情端点走公开缓存不下发最低报价，
  // 标价/底线/开关从 offer-settings 端点回（仅本队教练）；数据没到不开放保存
  const settingsQuery = useOfferSettings(
    player.id,
    isCoach && isMine && player.status === 'normal' && contract?.contractType !== 'trainee',
  );
  const settingsData = settingsQuery.data;
  // 草稿（v6.4.0 改动 B：最低报价/自动应答与转会名单解耦；v6.33.0 加标价；非卖品与名单互斥自动清对方）
  const [listDraft, setListDraft] = useState(player.transferListed);
  const [minDraft, setMinDraft] = useState('');
  const [listPriceDraft, setListPriceDraft] = useState('');
  const [autoDraft, setAutoDraft] = useState(player.offerAuto);
  const [nfsDraft, setNfsDraft] = useState(player.notForSale);
  // 操作草稿
  const [offerAmount, setOfferAmount] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [renewFee, setRenewFee] = useState('');
  const [askPrice, setAskPrice] = useState('');
  const [freeFee, setFreeFee] = useState('');
  // 激活通知截图弹窗（v6.60.0）：旧内嵌文件框改共用弹窗，点击「激活」直接打开
  const [proofOpen, setProofOpen] = useState(false);
  // 候选名单开关（v6.58.0）：教练态自取 ids；未绑队 403 / 匿名不渲染（data 为 undefined 即隐藏）
  const shortlistQuery = useShortlistIds(isCoach);
  const shortlistEntry = shortlistQuery.data?.entries.find((e) => e.playerId === player.id) ?? null;
  const invalidateShortlist = useShortlistInvalidation();
  const { show: showToast, toastNode } = useToast();
  const [starBusy, setStarBusy] = useState(false);
  async function toggleShortlist(): Promise<void> {
    if (starBusy) return;
    setStarBusy(true);
    try {
      if (shortlistEntry !== null) await apiSend('DELETE', `/api/club/shortlist/${shortlistEntry.id}`);
      else await apiSend('POST', '/api/club/shortlist', { playerId: player.id });
      // 失效即触发 ids 重取，别再手动 refetch 一次（会打两次同一接口）
      invalidateShortlist();
    } catch (err) {
      // 上限 30 / 未绑队等 409/403 要让用户看见，不能吞成未处理 rejection
      showToast(err instanceof Error ? err.message : '候选名单操作失败', true);
    } finally {
      setStarBusy(false);
    }
  }

  // 草稿只在换球员时重置：保存后数据刷新（字段值变化）会把用户在刷新窗口内的下一次操作
  // 覆盖掉（草稿回跳、保存按钮失效），所以金额草稿不从 player 灌——等 settings 数据到达灌一次。
  // filledFor 防「保存 → invalidate → refetch → 数据再次到达」把用户下一手草稿覆盖回去。
  const filledFor = useRef<number | null>(null);
  useEffect(() => {
    filledFor.current = null;
    setListDraft(player.transferListed);
    setMinDraft('');
    setListPriceDraft('');
    setAutoDraft(player.offerAuto);
    setNfsDraft(player.notForSale);
    setPanel(null);
    setArmed(false);
    setProofOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上：只跟随 player.id
  }, [player.id]);

  // settings 数据首次到达（对当前球员）时全量灌草稿：私密底线 + 公开标价都从这里来
  useEffect(() => {
    if (settingsData === undefined || filledFor.current === player.id) return;
    filledFor.current = player.id;
    setListDraft(settingsData.transferListed);
    setMinDraft(settingsData.minOfferPrice === null ? '' : String(settingsData.minOfferPrice));
    setListPriceDraft(settingsData.listPrice === null ? '' : String(settingsData.listPrice));
    setAutoDraft(settingsData.offerAuto);
    setNfsDraft(settingsData.notForSale);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟随 player.id 与数据到达
  }, [player.id, settingsData]);

  // 挂牌态信息源（v6.4.0 改动 6）：按球员查现行挂牌（公开端点），详情给下一步最低价与出价历史。
  // 只有教练 + 挂牌中的球员才启用查询，其余态零请求。
  const playerListingQuery = usePlayerListing(player.id, isCoach && player.status === 'listed');
  const activeListingId = playerListingQuery.data?.listings[0]?.id ?? null;
  const listedDetailQuery = useListingDetail(activeListingId);

  // v6.50.0 海捞暗标段：收标期内自由身池整体走密封标（后端 createFreeAgent 同期间被 409 拦），
  // E 态因此换一套表单。只在 E 态球员上取这份数据（其他态零请求）；金额保密，只有自己那份回得来。
  const seaPhaseQuery = useSeaPhase(isCoach && (isFree || isCpu));
  const seaPhase = seaPhaseQuery.data;
  const sealedPhase = seaPhase?.state === 'sealed';
  const mySealedBid = seaPhase?.myBids.find((b) => b.playerId === player.id) ?? null;
  const sealedLeft = useCountdown(sealedPhase ? (seaPhase?.batch?.deadlineAt ?? null) : null);
  const fmt = useTimeFmt();
  // 签入费预览（海捞费 = 新违约金 × 30%，core freeAgentFee 单一出处；明标「审核时收」、
  // 暗标「出标即冻结」共用一份；真数仍以服务端回执为准）
  const signFee = freeAgentFeePreview(freeFee);

  // v6.57.0 预期收入额度：B 态出价 / 海捞（暗标冻结·明标审核时收）/ 续约差额的「动用预期收入」
  // 提示共用一份余额快照；快照缺失（非教练 / 端点未回）creditUse 回 0，整行不渲染。
  const { data: balSnap } = useClubBalance(isCoach);
  const availSnap = balSnap ?? null;
  // 改标时旧冻结被顶替释放：动用额按净差额算（回加旧标冻结）
  const sealedUse = creditUse(
    signFee ?? 0,
    availSnap,
    mySealedBid?.status === 'sealed' ? round2(Number(mySealedBid.newReleaseFee) * 0.3) : 0,
  );
  const seaSignUse = creditUse(signFee ?? 0, availSnap);

  const releaseFee = contract?.releaseFee ?? null;
  // 续约「提高付差额的 30%」：输入无效 / 未提高时 spend=0（动用额行不渲染）
  const renewSpend = (() => {
    const v = Number(renewFee);
    if (releaseFee === null || renewFee.trim() === '' || Number.isNaN(v) || v <= releaseFee) return 0;
    return round2((v - releaseFee) * 0.3);
  })();
  const renewUse = creditUse(renewSpend, availSnap);
  // 解约费预览（v6.63.3 改派生自 core terminationFee 单一出处，bypass-fee-preview；
  // serviceSeasons 由服务端按现行窗刻度算好随合同下发）。无含违约金合同时回 null →
  // 预览数按 0（动用额行不渲染），面板文案退回公式版，不冒充免费。
  const termSpend = terminationFeePreview(releaseFee, contract?.serviceSeasons ?? null) ?? 0;
  const termUse = creditUse(termSpend, availSnap);
  const offerCap = offerCapOf(releaseFee);
  // 标价/挂牌下限（v6.54.1）：与挂牌同规，报价设置面板与挂牌面板的区间提示共用
  const listingFloor = listingFloorOf(releaseFee, player.marketValue);
  const isTrainee = contract?.contractType === 'trainee';

  // 球员要求四态 + 续约禁用矩阵（v6.54.0 步骤 7，§10.2）：
  // 服务端只对本队教练下发 demandState/contractPending，这里再按 isCoach/isMine 兜一层，
  // 避免把他队视角误当本队（例如管理员查看别队球员时命中同一条详情缓存）。
  const ownerView = isCoach && isMine;
  const demand = ownerView ? (demandState?.demand ?? null) : null;
  const transferRequest = ownerView ? (demandState?.transferRequest ?? null) : null;
  const contractPendingView = ownerView ? contractPending : null;
  const demandOpen = demand !== null && (demand.status === 'pending' || demand.status === 'countered');
  const demandAccepted = demand !== null && demand.status === 'accepted';
  const demandRejected = demand !== null && demand.status === 'rejected';
  const demandExpired = demand !== null && demand.status === 'expired';
  const demandUsedThisWindow = ownerView && (demandState?.demandThisWindow ?? false);
  // 优先级：正在闹涨薪 > 已有待生效变更 > 拒绝后申请存续 > 本窗额度已用
  //（与 §10.2 的禁用矩阵同序；四种都只是 UI 前置，服务端 createRcChange 仍各自 409）
  const renewBlock: 'active' | 'pending' | 'request' | 'used' | null = demandOpen
    ? 'active'
    : demandRejected || transferRequest !== null
      ? 'request'
      : contractPendingView !== null
        ? 'pending'
        : demandUsedThisWindow
          ? 'used'
          : null;
  const renewBlockTitle: Record<NonNullable<typeof renewBlock>, string> = {
    // 术语纪律（GLOSSARY「球员要求」节）：界面不出现「闹涨薪」「收件箱」这类机制/载体词
    active: '他正在提涨薪要求，先去谈判区处理',
    pending: '已有待生效合同变更',
    request: '转会申请存续期间不能续约',
    used: '本窗他的合同谈判机会已经用过，下窗再谈',
  };
  // v6.33.0：脏判按「草稿 ≠ settings 现值」逐字段比；settings 没到（私密端点还在路上/失败）禁存，
  // 避免把「进名单必填标价」存成空值打到 400。
  const minDraftValue = minDraft === '' ? null : Number(minDraft);
  const listPriceValue = listPriceDraft === '' ? null : Number(listPriceDraft);
  const settingsDirty =
    settingsData !== undefined &&
    (listDraft !== settingsData.transferListed ||
      nfsDraft !== settingsData.notForSale ||
      minDraftValue !== settingsData.minOfferPrice ||
      listPriceValue !== settingsData.listPrice ||
      autoDraft !== settingsData.offerAuto);

  // 写操作成功后的统一刷新面：激活弹窗也要走同一套，避免两条路径失效范围不一致。
  function refreshAfterMutation() {
    invalidateOffers();
    void qc.invalidateQueries({ queryKey: qk.myClub });
    void qc.invalidateQueries({ queryKey: qk.squad });
    void qc.invalidateQueries({ queryKey: qk.offerSettings(player.id) });
    // 挂牌/解约可能作废在途要求与待生效变更，球队页小字与工作台一起刷新
    void qc.invalidateQueries({ queryKey: ['club', 'pending-contracts'] });
    void qc.invalidateQueries({ queryKey: ['market', 'board'] });
    void qc.invalidateQueries({ queryKey: ['market', 'listing-by-player', player.id] });
    void qc.invalidateQueries({ queryKey: qk.seaPhase });
    refreshAll();
  }

  async function run(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      show(await fn());
      setPanel(null);
      setArmed(false);
      refreshAfterMutation();
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    void run(async () => {
      const r = await apiPut<OfferSettingsDto>(`/api/players/${player.id}/offer-settings`, {
        transferListed: listDraft,
        minOfferPrice: minDraftValue,
        listPrice: listPriceValue,
        offerAuto: autoDraft,
        notForSale: nfsDraft,
      });
      // v6.55.0 对齐回执：标价低于最低报价被自动对齐时，用响应值回灌全部草稿（null → ''，
      // 直接 String(null) 会产出 "null" 字符串 → 脏判恒真 → 下次保存发 NaN），避免表单停留在脏草稿
      if (r.minOfferPriceAdjusted) {
        setListDraft(r.transferListed);
        setMinDraft(r.minOfferPrice === null ? '' : String(r.minOfferPrice));
        setListPriceDraft(r.listPrice === null ? '' : String(r.listPrice));
        setAutoDraft(r.offerAuto);
        setNfsDraft(r.notForSale);
        return `最低报价已随标价降至 ${r.minOfferPriceAdjusted.to} m（最低报价不能高于标价）`;
      }
      return '报价设置已保存。';
    });
  }

  // 激活提交（v6.60.0）：弹窗确认后才传 QQ 通知截图拿 key，再带 key 建激活挂牌。
  // 失败不在这里吞：抛回弹窗，让错误显示在用户正在看的表单里，可直接重试。
  async function confirmActivation(file: File) {
    if (busy) throw new Error('还有操作在处理中，稍后再试');
    setBusy(true);
    try {
      const up = await apiUpload<{ key: string }>('/api/media/activation', file.type, file);
      await apiPost('/api/market/activations', { playerId: player.id, proofMediaKey: up.key });
      show('激活挂牌已提交：5 分钟内出首价才算数。');
      setProofOpen(false);
      refreshAfterMutation();
    } finally {
      setBusy(false);
    }
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

  // 顶部只读块（§10.2 四态）：本队教练才渲染；球员本人的知情面走站内信，不占 SideOps。
  // 「已接受」的工资/违约金优先取待生效投影（与双版本合同同源），投影缺失时回退要求的 target/rc_floor。
  let demandNote: ReactElement | null = null;
  if (ownerView && (demand !== null || transferRequest !== null)) {
    let tone = '';
    let text: ReactElement;
    let action: ReactElement | null = null;
    if (demandOpen && demand !== null) {
      const rcPart = demand.rcFloor > 0 ? ` · 违约金提到 ${fmtShort(demand.rcFloor)}m` : '';
      const roundPart =
        demand.round > 0
          ? `上轮你出 ${demand.lastCounterWage === null ? '价' : `${fmt2(demand.lastCounterWage)}m`} 未成，还剩 ${Math.max(
              0,
              demand.maxRounds - demand.round,
            )} 轮。`
          : '';
      text = (
        <>
          {player.name}已提出涨薪要求（{fmt2(demand.targetWage)}m/窗{rcPart}），到 {fmt.time(demand.expiresAt)} 为止。
          {roundPart !== '' && ` ${roundPart}`}
        </>
      );
      action = (
        <Link className="side-demand-link" to={`/market/desk?tab=negotiations&demand=${demand.id}`}>
          去谈判桌处理 ›
        </Link>
      );
    } else if (demandAccepted && demand !== null) {
      const wage = contractPendingView?.wage ?? demand.targetWage;
      const rc = contractPendingView?.releaseFee ?? (demand.rcFloor > 0 ? demand.rcFloor : null);
      tone = ' ok';
      text = (
        <>
          已接受 · 关窗后生效（{fmt2(wage)}m/窗{rc !== null ? ` · 违约金 ${fmtShort(rc)}m` : ''}）。
        </>
      );
      action = (
        <button type="button" className="side-demand-link" onClick={onShowContract}>
          看双版本合同 ›
        </button>
      );
    } else if (transferRequest !== null && transferRequest.status === 'listed') {
      text = <>已挂牌，等出价。挂牌期间他的要求不会再变。</>;
    } else if (transferRequest !== null && (transferRequest.status === 'released' || transferRequest.source === 'direct')) {
      text = <>已明确放行：保护期已结束、全联盟已收通告，挂着「不满」标记。</>;
    } else if (transferRequest !== null) {
      text = <>转会申请挂着 · 下窗他会再提且开价更狠。</>;
    } else if (demandRejected) {
      text = <>已明确放行：保护期已结束、全联盟已收通告，挂着「不满」标记。</>;
    } else if (demandExpired) {
      tone = ' mut';
      text = <>这个窗口没有谈成。放任不理也算一次——再有下次，他就当被放人了。</>;
    } else {
      text = <>本窗他的合同谈判已经有结果。</>;
    }
    demandNote = (
      <div className={`side-demand-note${tone}`} role="status">
        <span>{text}</span>
        {action}
      </div>
    );
  }

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
          <span className="mono">{l ? `${money(l.askPrice)}m` : '—'}</span>
        </div>
        <div className="side-row">
          <span className="attr-name">最高出价</span>
          <span className="mono">{l?.highestBid != null ? `${money(l.highestBid)}m` : '暂无出价'}</span>
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
              <span className="mono">{money(l.askPrice)}m</span>
            </div>
            <div className="side-row">
              <span className="attr-name">当前最高</span>
              <span className="mono gold-text">
                {l.highestBidder ? `${l.highestBidder.name} · ${money(l.highestBid)}m` : l.highestBid != null ? `${money(l.highestBid)}m` : '暂无出价'}
              </span>
            </div>
            {canBid ? (
              <MarketBidForm
                mode={l.firstBidPending && isActivator ? 'activation-first' : 'normal'}
                askPrice={l.askPrice}
                nextMinBid={l.nextMinBid}
                available={availSnap?.available ?? null}
                creditLine={availSnap?.creditLine ?? null}
                onBid={submitBid}
              />
            ) : (
              <p className="side-sub">
                {!l.windowOpen
                  ? '这单所属的转会窗口已经关了，暂不能出价；开窗后再来。'
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
          {listDraft && (
            <label className="side-field">
              <span className="side-lab">
                <span>标价（m）· 公开</span>
                <span className="side-range mono">
                  {offerCap !== null ? `${Math.max(listingFloor ?? 1, minDraftValue ?? 0)}–${offerCap}` : '—'}
                </span>
              </span>
              <input
                className="mono"
                inputMode="decimal"
                min="1"
                step="0.5"
                placeholder="必填：其他队看得到"
                value={listPriceDraft}
                onChange={(e) => setListPriceDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="标价"
              />
            </label>
          )}
          <label className="side-field">
            <span className="side-lab">
              <span>最低报价（m）· 仅自己可见</span>
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
                disabled={busy || (listDraft ? listPriceValue === null : minDraftValue === null)}
                onClick={() => setAutoDraft(true)}
              >
                是
              </button>
              <button
                type="button"
                className={!autoDraft ? 'on' : ''}
                disabled={busy || (listDraft ? listPriceValue === null : minDraftValue === null)}
                onClick={() => setAutoDraft(false)}
              >
                否
              </button>
            </span>
          </div>
          <p className="side-sub">
            低于最低报价一律自动拒（与开关无关）；达线且开关开着才自动同意，否则进人工谈判。标价是进转会名单的必填项，其他队看得到；最低报价只有你自己看得见。
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
              {renewUse > 0 && <p className="side-sub credit-use-note">本次动用预期收入 {money(renewUse)} m（加价 30% 审核时收取）。</p>}
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
                      return `续约已提交：${r.oldReleaseFee.toFixed(2)} → ${r.newReleaseFee.toFixed(2)}m${
                        r.changeFee > 0 ? `，加价 30% 共 ${r.changeFee.toFixed(2)}m 待审核收取` : ''
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
                  <span className="side-range mono">{offerCap !== null ? `${listingFloor ?? 1}–${offerCap}` : '—'}</span>
                </span>
                <input
                  className="mono"
                  inputMode="decimal"
                  value={askPrice}
                  onChange={(e) => setAskPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                  aria-label="挂牌要价"
                />
              </label>
              <p className="side-sub">下限取违约金/身价五折取低（不低于 1m），上限违约金 1.5 倍。</p>
              {/* §10.2：挂牌/解约保留，但要让教练知道会作废要求或待生效变更 */}
              {demandOpen && <p className="side-sub">挂牌会作废他的涨薪要求。</p>}
              {contractPendingView !== null && <p className="side-sub">关窗前离队会让待生效的新合同作废。</p>}
              <OpsGateNote gate={listingGate} className="side-sub" />
              <div className="side-btns">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy || askPrice === '' || listingGate?.blocked}
                  onClick={() =>
                    void run(async () => {
                      const r = await apiPost<{ listingId: number; min: number; max: number }>('/api/market/listings', {
                        playerId: player.id,
                        askPrice: Number(askPrice),
                      });
                      return `挂牌成功（#${r.listingId}）：规则区间 ${r.min.toFixed(2)}–${r.max.toFixed(2)}m。`;
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
                {contract === null || releaseFee === null || releaseFee <= 0
                  ? '解约费 = 违约金 ×（3 − 效力赛季数）× 10%（效力满 3 赛季免费）'
                  : termSpend > 0
                    ? `本次解约费 ${money(termSpend)} m = 违约金 ×（3 − 效力 ${contract.serviceSeasons} 赛季）× 10%，审核时收取`
                    : `效力 ${contract.serviceSeasons} 赛季已满 3 赛季，本次解约免费`}
                ；被解约球员本窗全联盟禁签。再次点击确认。
              </p>
              {termUse > 0 && <p className="side-sub credit-use-note">本次动用预期收入 {money(termUse)} m（解约费审核时收取）。</p>}
              {demandOpen && <p className="side-sub">解约会作废他的涨薪要求。</p>}
              {contractPendingView !== null && <p className="side-sub">关窗前离队会让待生效的新合同作废。</p>}
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
                        r.terminationFee > 0 ? `解约费 ${r.terminationFee.toFixed(2)}m 待审核时回收` : '效力满 3 赛季免费'
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
              {/* 续约禁用矩阵（§10.2）：本窗存在 demand 行（含 expired/占位）一律禁用；
                  闹涨薪进行中 / 已有待生效变更 / 申请存续各有各自的说明。服务端仍会 409，这里只是前置。 */}
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !windowOpen || releaseFee === null || renewBlock !== null}
                title={renewBlock !== null ? renewBlockTitle[renewBlock] : undefined}
                onClick={() => setPanel('renew')}
              >
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
        <Link className="side-entry" to="/market/desk?tab=offers&box=in">
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
        <p className="side-sub">训练营球员：合同固定（工资 0.75m / 违约金 5m），只能被其他球队按激活转会带走。</p>
      </section>
    );
  } else if (player.notForSale) {
    body = (
      <section className="side-sec">
        <div className="side-sec-head">球队操作</div>
        <div className="side-btns">
          <button type="button" className="btn btn-sm" disabled title="此球员为非卖品">
            报价
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !windowOpen} onClick={() => setProofOpen(true)}>
            激活
          </button>
        </div>
        <p className="side-sub">此球员为非卖品！激活不受非卖品限制。</p>
      </section>
    );
  } else if (isFree || isCpu) {
    // E 态（v6.17.0）：开关不再看 windowOpen，以 seaSign 为准——窗口、归属、在途、本窗被解约
    // 这些拦截都在后端守卫链里判过一遍，前端只负责原样禁用并展示原因。
    // v6.50.0 海捞暗标段：收标期内这里换成密封标（金额保密 / 统一截止 / 价高者得），
    // 常规海捞表单原样留给明标段；两种表单的资格开关都是同一份 seaSign。
    // closing（已过截止、还没开标）既不能出标也不能走常规海捞：按钮只留禁用态，等 30s 轮询翻成 open。
    const canSeal = sealedPhase && mySealedBid?.status !== 'won' && mySealedBid?.status !== 'lost';
    const sealedClosing = seaPhase?.state === 'closing';
    body = (
      <section className="side-sec">
        <div className="side-sec-head">球队操作</div>
        {panel === 'sealed' ? (
          <>
            <label className="side-field">
              <span className="side-lab">
                <span>新违约金（m）</span>
                <span className="side-range mono">{signFee === null ? '—' : `冻结 ${signFee}`}</span>
              </span>
              <input
                className="mono"
                inputMode="decimal"
                value={freeFee}
                onChange={(e) => setFreeFee(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="新违约金"
              />
            </label>
            <SeaCompsBlock seaComps={seaComps} />
            <p className="side-sub">
              密封标：金额与出标方保密，统一截止后价高者得（同额先出的胜出）。出标即冻结签入费（新违约金的 30%），
              截止前可改可撤；胜出后进管理组审核 → 工资谈判。
            </p>
            {sealedUse > 0 && <p className="side-sub credit-use-note">本次动用预期收入 {money(sealedUse)} m。</p>}
            {sealedClosing ? (
              <p className="side-sub">收标已截止，等待管理组开标（页面每 30 秒自动刷新一次）：现在不能再出标或改标。</p>
            ) : (
              sealedPhase && (
                <p className="side-sub">
                  {sealedLeft === null ? '暗标段进行中' : `距截止还剩 ${fmtClock(sealedLeft)}`}
                  {seaPhase?.batch ? `（截止 ${fmt.time(seaPhase.batch.deadlineAt)}）` : ''}
                </p>
              )
            )}
            <div className="side-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !seaSign.eligible || freeFee === '' || !sealedPhase || sealedClosing}
                onClick={() =>
                  void run(async () => {
                    const r = await apiPost<SeaSubmitResult>('/api/transfers/sea-sealed', {
                      playerId: player.id,
                      newReleaseFee: Number(freeFee),
                    });
                    return r.updated
                      ? `密封标已改：新违约金 ${r.newReleaseFee.toFixed(2)}m（原冻结已刷新为 ${r.signFee.toFixed(2)}m）。`
                      : `密封标已提交：新违约金 ${r.newReleaseFee.toFixed(2)}m，签入费 ${r.signFee.toFixed(2)}m 已冻结，截止后统一开标。`;
                  })
                }
              >
                {mySealedBid?.status === 'sealed' ? '确认改标' : '确认出标'}
              </button>
              {mySealedBid?.status === 'sealed' && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={busy || !sealedPhase || sealedClosing}
                  onClick={() =>
                    void run(async () => {
                      await apiPost('/api/transfers/sea-sealed/withdraw', { playerId: player.id });
                      return '已撤标，冻结的签入费已解冻。';
                    })
                  }
                >
                  撤回出标
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setPanel(null)}>
                取消
              </button>
            </div>
          </>
        ) : panel === 'freeagent' ? (
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
            <SeaCompsBlock seaComps={seaComps} />
            <p className="side-sub">
              {signFee === null
                ? '签入即付海捞费（新违约金的 30%）并定新合同'
                : `海捞费 ${money(signFee)} m（新违约金的 30%），审核时收取并定新合同`}
              ；签完本窗内他队还能竞价挖角。
            </p>
            {seaSignUse > 0 && <p className="side-sub credit-use-note">本次动用预期收入 {money(seaSignUse)} m（签入费审核时收取）。</p>}
            <OpsGateNote gate={seaGate} className="side-sub" />
            <div className="side-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !seaSign.eligible || freeFee === '' || seaGate?.blocked}
                onClick={() =>
                  void run(async () => {
                    const r = await apiPost<FreeAgentResult>('/api/transfers/free-agent', {
                      playerId: player.id,
                      newReleaseFee: Number(freeFee),
                    });
                    return `海捞申请已提交：新违约金 ${r.newReleaseFee.toFixed(2)}m，签入费 ${r.signFee.toFixed(2)}m（新违约金的 30%）待审核时收，等管理组批准。`;
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
            {canSeal || sealedClosing ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !seaSign.eligible || sealedClosing}
                onClick={() => {
                  if (mySealedBid?.status === 'sealed') setFreeFee(String(mySealedBid.newReleaseFee));
                  setPanel('sealed');
                }}
              >
                {sealedClosing ? '收标已截止 · 等待开标' : mySealedBid?.status === 'sealed' ? '改标 / 撤标' : '暗标出标'}
              </button>
            ) : (
              <button type="button" className="btn btn-sm" disabled={busy || !seaSign.eligible} onClick={() => setPanel('freeagent')}>
                海捞签入
              </button>
            )}
          </div>
        )}
        {mySealedBid !== null && panel !== 'sealed' && (
          <p className="side-sub">
            你在本窗暗标段给这名球员出的标：
            <span className="mono"> {mySealedBid.newReleaseFee.toFixed(2)}m</span>
            {mySealedBid.status === 'sealed'
              ? sealedClosing
                ? '（收标已截止，等待开标）'
                : '（收标中，可改可撤）'
              : mySealedBid.status === 'won'
                ? '（胜出，等管理组审核）'
                : mySealedBid.status === 'lost'
                  ? '（未胜出，冻结已解冻）'
                  : `（${mySealedBid.voidReason === '' ? '已失效' : mySealedBid.voidReason}）`}
          </p>
        )}
        {seaSign.reason !== null && <p className="side-sub">{seaSign.reason}</p>}
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
            {player.listPrice !== null && (
              <p className="side-sub">
                对方标价 {player.listPrice}m：低于标价视为砍价（对方看不到你的诚意边界，但低于其底线会被自动拒）；达标价且对方开了自动同意才直接成交，否则进人工谈判。
              </p>
            )}
            <p className="side-sub">
              报价即冻结资金；
              {windowOpen
                ? '对方同意即自动挂牌，你的价锁成领先出价。'
                : '关窗期同意先挂「意向单」（不生成挂牌、冻结继续），开窗后由卖方确认才挂牌。'}
            </p>
            <OpsGateNote gate={offerGate} className="side-sub" />
            <div className="side-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || offerAmount === '' || offerGate?.blocked}
                onClick={() =>
                  void run(async () => {
                    const r = await apiPost<{ offerId: number; status: string }>('/api/offers', {
                      playerId: player.id,
                      amount: Number(offerAmount),
                      note: offerNote || undefined,
                    });
                    // 三态反馈（v6.33.0，用户措辞裁决 2026-10-05）：accepted 是「对方接受 → 挂牌进转会区」，
                    // 不是成交——报价方只是领先（视同出了第一笔出价），还要被别人竞价
                    return r.status === 'intent'
                      ? '关窗期谈成：已挂意向单（资金继续冻结），开窗后由卖方确认才挂牌。'
                      : r.status === 'accepted'
                        ? '对方已接受：球员已挂牌进入转会区，你暂时领先（视同你出了第一笔出价）。'
                        : r.status === 'rejected'
                          ? '低于对方底线，报价被自动拒，冻结已退回。'
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
        ) : (
          <div className="side-btns">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPanel('offer')}>
              报价
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !windowOpen} onClick={() => setProofOpen(true)}>
              激活
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="side-ops">
      {toastNode}
      {!windowOpen && (
        <div className="side-closed-note">
          转会窗未开放：续约 / 挂牌 / 解约 / 激活暂不可用；报价仍可送出，关窗期谈成先挂意向单，开窗后由卖方确认才挂牌
        </div>
      )}
      {demandNote}
      {shortlistQuery.data !== undefined && (
        <div className="side-shortlist">
          <span className="side-lab">候选名单</span>
          <button
            type="button"
            className={`btn btn-sm${shortlistEntry !== null ? ' on' : ''}`}
            aria-pressed={shortlistEntry !== null}
            disabled={starBusy}
            onClick={() => void toggleShortlist()}
          >
            {shortlistEntry !== null ? '✓ 已在候选名单（点击移出）' : '☆ 加入候选名单'}
          </button>
        </div>
      )}
      {body}
      {proofOpen && (
        <ActivationProofDialog
          playerName={player.name}
          opponentClubName={opponentClubName}
          myClubName={myClubName}
          onClose={() => setProofOpen(false)}
          onConfirm={confirmActivation}
        />
      )}
    </div>
  );
}

/* ---------- 近期成交参照（v6.17.0） ---------- */

/**
 * 违约金输入框下方的定价锚：同档成交（CA±5）、同档空时回落全局最近成交，一笔都没有就一句话空态。
 * 只在面板展开时渲染——收着的时候不占地方。
 */
function SeaCompsBlock({ seaComps }: { seaComps: SeaComps }) {
  if (seaComps.rows.length === 0) {
    // scope='none' 有两种来源（后端同形下发，无从区分，文案就不下断言）：
    // ①全服还没有海捞成交；②这名球员没过 ownership/status 关，后端按「没有参照意义」跳过计算
    return (
      <div className="sea-comps">
        <p className="side-sub">暂无成交参照。先自己定价——这笔成交之后就成了别人的锚。</p>
      </div>
    );
  }
  const scopeLabel = seaComps.scope === 'same_tier' ? '同档成交（CA±5）' : '全局最近成交';
  return (
    <div className="sea-comps">
      <p className="side-sub">
        近期成交参照 · {scopeLabel}：违约金 → 海捞费
      </p>
      {seaComps.rows.map((c, i) => (
        <div key={`${c.playerId}-${i}`} className="side-row">
          <span>
            {c.playerName}
            {c.playerCa !== null && <span className="muted mono"> CA {c.playerCa}</span>}
          </span>
          <span className="mono">
            {money(c.newReleaseFee)} → {money(c.signFee)}
          </span>
        </div>
      ))}
    </div>
  );
}
