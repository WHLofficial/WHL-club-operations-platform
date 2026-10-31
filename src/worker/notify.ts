// bot 通知（TECH_DESIGN §12）：notifications 表排队 → HMAC 签名 POST 到 AstrBot 接收插件
// → 200 标 sent，否则留 pending 下轮 cron 重试（惰性重试，无退避表）。协议照抄竞猜系统
// docs/astrbot-sync-api.md：X-Timestamp/X-Sign = HMAC-SHA256(SYNC_SECRET, `method|path|ts|body`)，
// 时间窗 ±300s；文本在平台侧用纯代码模板渲染好，插件只负责发 QQ。
import type { Env } from './env.ts';
import { hmacHex } from '../lib/hmac.ts';
import { notificationRefOf } from '../core/notify-meta.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const DISPATCH_LIMIT = 50; // 每轮 cron 最多投递条数（§17 硬 LIMIT 纪律）
const NOTIFY_TIMEOUT_MS = 10_000;

/** 带签名的投递调用（竞猜 signAndFetch 同款规范串）。 */
async function signAndPost(env: Env, path: string, body: unknown): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const raw = JSON.stringify(body);
  const canonical = `POST|${path}|${ts}|${raw}`;
  const sign = await hmacHex(env.SYNC_SECRET ?? '', canonical);
  return fetch(`${env.SYNC_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Timestamp': ts, 'X-Sign': sign },
    body: raw,
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
}

// ---- 模板渲染（纯代码，无 LLM；§12）----

// offer_expired 的失效原因尾巴（v6.49.0 起由 reason 决定：sold/state 旧因 + deadline/ops_end 新因）
const OFFER_EXPIRED_TAIL: Record<string, string> = {
  sold: '（球员已被卖家挂牌，报价通道关闭，冻结已退回）',
  deadline: '（超过时限没有回应，自动结束，冻结已退回）',
  ops_end: '（报价通道已结束，自动结束，冻结已退回）',
  state: '（球员状态已变）',
};

export function renderNotification(template: string, data: Record<string, unknown>): string {
  switch (template) {
    case 'result_confirmed':
      return `📋 赛果已确认：${data.home} ${data.score} ${data.away}（S${data.season}·窗${data.windowSeq}${data.competition ? ` · ${data.competition}` : ''}）。`;
    case 'levelup':
      // v6.63.0：文案改 PlayStyle（Q1：「徽章」俗称只保留在消费中心商店语境）
      return `🎉 ${data.player} 升级完成：+${data.ca} CA${data.silver ? `，银 PlayStyle +${data.silver}` : ''}${data.gold ? `，金 PlayStyle +${data.gold}` : ''}。`;
    // 报价 / 议价（v6.3.0，设计 §5）：金额单位 m，均带 offerId 供跳转
    case 'offer_received':
      return `📩 收到报价：${data.amount} m 报 ${data.player}（对方已冻结资金），去谈判桌处理。`;
    case 'offer_countered':
      return `🔄 ${data.by}还价：${data.player} 报价抬到 ${data.amount} m，轮到你表态。`;
    case 'offer_accepted':
      return `🤝 报价已被同意：${data.player} 以 ${data.amount} m 达成协议，已自动挂牌并锁定你的出价为领先。`;
    case 'offer_rejected':
      return `🚫 报价被拒：${data.player} ${data.amount != null ? `的 ${data.amount} m 报价` : '的报价'}被卖家拒绝${data.reason === 'not_for_sale' ? '（球员被设为非卖品）' : ''}，冻结已退回。`;
    case 'offer_withdrawn':
      return `↩️ 报价撤回：对方撤回了对 ${data.player} 的 ${data.amount} m 报价。`;
    case 'offer_expired':
      return `⌛ 报价过期：${data.player} 的报价已失效${OFFER_EXPIRED_TAIL[String(data.reason)] ?? '（球员状态已变）'}，冻结已退回。`;
    // v6.49.0 到期引擎：距到点不足 24h 提醒在回合的一方（只发一次）
    case 'offer_deadline':
      return `⏳ 报价将到期：${data.player} 的报价还剩不到 24 小时（北京时间 ${data.deadline} 截止），到点未回应就自动结束、冻结退回。`;
    case 'offer_auto_accepted':
      // v6.33.0：文案不再说「最低报价线」——同意线来自公开标价，报价方自己的报价额就是参照
      return `🤝 自动同意：${data.player} 的 ${data.amount} m 报价达到对方的线，已自动同意并挂牌。`;
    case 'offer_auto_rejected':
      // v6.33.0：不再携带私密最低报价数值（防底牌泄漏，设计 §3）
      return `🚫 自动拒：${data.player} 的 ${data.amount} m 报价低于对方底线，直接被拒，冻结已退回。`;
    // 关窗期报价 / 意向单（v6.29.0）：同意不挂牌、开窗提醒、卖方确认挂牌、任一方了结（双方各收一条）
    case 'offer_intent_created':
      return `📝 意向单：${data.player} 的 ${data.amount} m 已谈拢，但转会窗没开——先挂成意向单，开窗后由卖方确认才生成挂牌。`;
    // v6.55.0 意向单多笔并存：开窗提醒按 role/buyers 分支（卖方合并择一确认 / 买方提示竞争），N=1 保持原文案
    case 'offer_intent_window_open': {
      const buyers = typeof data.buyers === 'number' && data.buyers > 1 ? data.buyers : 1;
      if (buyers > 1 && data.role === 'seller') {
        return `🔔 转会窗已开：${data.player} 有 ${buyers} 家求购意向，去转会台择一确认挂牌——确认一条后其余自动失效。`;
      }
      if (buyers > 1 && data.role === 'buyer') {
        return `🔔 转会窗已开：${data.player} 存在 ${buyers} 家意向竞争，等待卖方选择（可随时撤回解冻）。`;
      }
      return `🔔 转会窗已开：${data.player} 的意向单（${data.amount} m）可以推进了——卖方到谈判桌点确认即挂牌，不确认就继续挂着。`;
    }
    case 'offer_intent_confirmed':
      return `🤝 意向单已确认：${data.player} 以 ${data.amount} m 达成协议，已自动挂牌并锁定你的出价为领先。`;
    case 'offer_intent_closed':
      return `↩️ 意向单了结：${data.player} 的 ${data.amount} m 意向单已被对方${data.action}，冻结已退回。`;
    // 落选通知（v6.55.0）：卖方确认了别家的意向单，本方意向单被收口批自动失效（ref = 自己那张单）
    case 'offer_intent_lost':
      return `📉 意向落选：${data.player} 已与其他球队达成意向并挂牌，你的意向单自动失效，仍可去转会区出价竞争（冻结已解冻）。`;
    // 激活通知证据制（v6.4.0 改动 4）：激活必附 QQ 通知截图，被激活方可举报（举报不冻结匹配窗）
    case 'activation_notice':
      return `📣 激活通知：你的球员 ${data.player} 被「${data.activatorName}」按激活转会激活（金额 ${data.fee} m）。对方已提交 QQ 通知截图（管理端可查），如未收到 QQ 通知请到该球员页举报。`;
    case 'activation_reported':
      return `⚠️ 举报：对方俱乐部举报未收到激活的 QQ 通知（挂牌 #${data.listingId}），管理组将核查你提交的截图。`;
    case 'activation_matched':
      return `🛡 匹配：#${data.listingId} 的激活被对方匹配留队（新违约金 ${data.newReleaseFee} m > 你的出价 ${data.previousBid} m），资金已解冻。`;
    case 'activation_passed':
      return `✅ 放行：#${data.listingId} 的激活被对方放行，按竞价最高价成交进审核。`;
    case 'activation_match_expired':
      return `⌛ 匹配窗结束：#${data.listingId} 的激活匹配窗到期未匹配，按竞价最高价成交进审核。`;
    // 随机事件（v6.10.0，D 块）：即发型触发即广播；data.notes 是效果播报（资金/死忠/设施…）
    case 'event_triggered':
      return `🎲 ${data.club} 触发事件「${data.name}」：${data.text}${data.notes ? `（${data.notes}）` : ''}`;
    // 选择型（v6.11.0，D2）：结算回执 + 距时限 24h 提醒；data.how 已由结算方带「（超时自动结算）」尾注
    case 'event_resolved':
      return `🎲 ${data.club} 的事件「${data.name}」已结算：${data.how}${data.notes ? `（${data.notes}）` : ''}`;
    case 'event_deadline':
      return `⏳ ${data.club} 的事件「${data.name}」还有不到 24 小时可选（截止 ${data.deadline}），过期按资金最差结果自动结算。`;
    // 经营信号注记（v6.12.0，D3）：关窗批给有非中性信号的队单发一条；data.lines 已是人话注记行
    case 'window_signals':
      return `📶 ${data.club} 本窗（${data.window}）经营信号生效：${data.lines}。`;
    // 场馆档期（v6.53.0，§6.1）：开窗通知 / 关窗前档位提醒。slots 是容量派生的本窗档位数，
    // booked/remain 只来自 venue_bookings 的已排档位（不是「还剩几个空位」的实时估算）
    case 'venue_window_open':
      return `【场馆开窗】S${data.season} 第 ${data.windowSeq} 窗已开，本窗有 ${data.slots} 个档位可排，去「场馆经营」页安排。`;
    case 'venue_slot_reminder':
      return `【档期提醒】S${data.season} 第 ${data.windowSeq} 窗约 ${data.hoursLeft} 小时后关闭，你还有 ${data.remain} 个档位没排（已排 ${data.booked}/${data.slots}）。`;
    // 冠名深度（v6.13.0，C2）：情绪演化回执 / 品牌主动解约 / 联赛冠军加成
    case 'naming_mood':
      return `💙 品牌方情绪：${data.brand} ${data.from} → ${data.to}（${data.reason}）。`;
    case 'naming_terminated':
      return `💔 品牌「${data.brand}」对 ${data.club} 的满意度降至 ${data.satisfaction}（低于${data.tier}档地板 ${data.floor}），已解除冠名（无赔偿），可另签新品牌。`;
    case 'naming_champion':
      return `🏆 恭喜 ${data.club} 夺得 S${data.season} 联赛冠军！${data.brand ? `品牌「${data.brand}」热度 +${data.heat}，品牌方情绪 +${data.sat}。` : '（该队无生效冠名，加成无落点）'}`;
    // 招商轮（v6.14.0，C3）：开轮定向递价汇总 / 接班合同转正生效
    case 'naming_offer':
      return `📣 招商期开启：${data.club} 收到 ${data.count} 份品牌报价（${data.brands}），去「冠名市场」查看签约。`;
    case 'naming_offer_activated': {
      // v6.51.0 批 1：合同快照的落点名「品牌·球场名」为空（无球场名/老合同）时回落现状文案；
      // 批 2：尾附品牌署名行（有属地品牌带属地，无属地只署名）
      const venuePart =
        typeof data.venueName === 'string' && data.venueName !== ''
          ? `「${data.venueName}」正式启用`
          : `「${data.brand}」冠名 ${data.club} 正式生效`;
      const sign = typeof data.hq === 'string' && data.hq !== '' ? `—— ${data.brand}（${data.hq}）` : `—— ${data.brand}`;
      return `✅ 品牌接替生效：${venuePart}（${data.pkgName}套餐，${data.feePerWindow}M/窗 × ${data.windows} 窗）。\n${sign}`;
    }
    // 消费中心（v6.26.0）：工单生效回执 / 拒绝退款
    // 候选名单跟踪（v6.58.0）：被挂牌 / 被签走 / 解约变自由身；操作方 = 收藏者时不发（上游已排除）
    case 'shortlist_listed':
      return `你的候选名单球员 ${data.player} 已被 ${data.club} 俱乐部挂牌，挂牌价 ${data.price} m，预计竞价截止 ${data.deadline}。`;
    case 'shortlist_sold':
      return data.fee == null
        ? `你的候选名单球员 ${data.player} 已被 ${data.buyer} 俱乐部签走（自由身签入）。`
        : `你的候选名单球员 ${data.player} 已被 ${data.buyer} 俱乐部签走，成交价 ${data.fee} m。`;
    case 'shortlist_released':
      return `你的候选名单球员 ${data.player} 已与 ${data.club} 俱乐部解约，成为自由身。`;
    case 'shop_order_approved':
      return `🛒 消费工单已生效：${data.summary}${data.note ? `（备注：${data.note}）` : ''}${data.external ? '（外部录入）' : ''}。`;
    case 'shop_order_rejected': {
      // v6.58.0：券+现金双退，明细随 data 带上（老单只有现金退）
      const cash = typeof data.cashRefund === 'number' ? data.cashRefund : null;
      const voucher = typeof data.voucherRefund === 'number' ? data.voucherRefund : 0;
      const refundText =
        data.refund && voucher > 0
          ? `（已退回现金 ${cash ?? 0} m + 消费券 ${voucher} m）`
          : data.refund && cash !== null
            ? `（已退回 ${cash} m 到余额）`
            : data.refund
              ? '（费用已退回余额）'
              : '';
      return `🛒 消费工单被拒绝：${data.summary}。理由：${data.reason}${refundText}。`;
    }
    // 签约谈判超时（v6.49.0 到期引擎）：静默超时自动作废 / 距超时不足 24h 提醒
    case 'negotiation_timeout':
      return `⌛ 签约谈判超时：${data.player} 的签约谈判已自动作废（${data.reason}），冻结已退回、球员回到原俱乐部，可重新挂牌。`;
    case 'negotiation_deadline':
      return `⏳ 签约谈判将超时：${data.player} 的谈判还剩不到 24 小时（北京时间 ${data.deadline} 截止），到点没动作就自动作废。`;
    // 海捞两阶段·暗标段（v6.50.0）：胜出 / 未胜出或作废 / 开标公告 / 截止前提醒
    case 'sea_sealed_lead':
      return `🏆 暗标胜出：${data.player} 你以最高标 ${data.amount} m 拿下（签入费 ${data.signFee} m 在审核通过时收），接下来是审核 → 工资谈判 → 过户。`;
    case 'sea_sealed_lost':
      return data.reason === 'outbid'
        ? `📉 暗标没拿下：${data.player} 有更高的密封标（金额与出标方不公开），你的签入费冻结已解冻；明标段还能常规海捞。`
        : `⚠️ 暗标作废：${data.player} 的标没能生效（${data.voidReason}），你的签入费冻结已解冻。`;
    case 'sea_batch_open':
      return `📣 海捞暗标段已开标：本批 ${data.won} 名球员被签走（共 ${data.clubs} 家出标），胜出者与金额见海捞页公示。`;
    case 'sea_sealed_deadline':
      return `⏳ 海捞暗标段北京时间 ${data.deadline} 截止：你还压着 ${data.count} 份密封标，截止前可以改标或撤回。`;
    // 闹涨薪（v6.54.0）：要求生成 / 24h 截止提醒 / 终局回执（拒绝按档位分文案，升档的谈崩
    // 走直拒 grade）/ 直拒档全联盟通告（rc = 现行合同违约金，即关窗后可原价激活的数字）
    case 'demand_created':
      return `📩 ${data.player} 提出了涨薪要求：${data.target} m/窗（当前 ${data.wage}）${data.rcTo != null ? `，违约金 ${data.rcFrom} → ${data.rcTo}` : ''}，${data.deadline} 前答复，去「签约谈判」处理。`;
    case 'demand_deadline':
      return `⏳ 涨薪要求将到期：${data.player} 的要求还剩不到 24 小时（北京时间 ${data.deadline} 截止）。放任过期也算一次，下次他会开得更狠。`;
    case 'demand_resolved':
      if (data.outcome === 'accepted') {
        return `🤝 涨薪要求已接受：${data.player} 将按 ${data.wage} m/窗 续薪${data.rc != null ? `（违约金 ${data.rc} m）` : ''}，窗口关闭后生效，费用为 0。`;
      }
      if (data.escalated === true || data.source === 'direct') {
        return `🚫 涨薪要求已拒绝：${data.player} 被明确放行。保护期立即结束，任何球队都能按违约金原价激活；全联盟已收通告，他挂着『不满』标记，直到离队或重签。`;
      }
      return `🚫 涨薪要求没谈成：${data.source === 'lowball' ? '还价低于他的底线，视为拒绝整条要求' : '3 轮还价未达成'}。${data.player} 已提交转会申请，下个窗口他还会再提，而且直接开到市场价。`;
    case 'demand_rejected_public':
      return `📣 转会通告：「${data.club}」已明确放行 ${data.player}${data.rc != null ? `——保护期立即结束，可按违约金原价 ${data.rc} m 激活` : '——保护期立即结束'}，他挂着『不满』标记，直到离队或重签。`;
    default:
      return String(data.text ?? '');
  }
}

/**
 * 给一个俱乐部排通知（尽力而为：排队失败不抛——通知绝不阻塞主流程，§12-2）。
 * 双通道（v2.4.0 站内信）：web 行按绑定账号逐人写（status='sent' 免投递，收件篮读）；
 * QQ 行照旧只写给 qq_links 命中的账号。绑定真源在 auth 库（v1.0.0）：先按 club_id 从
 * AUTH_DB 取绑定账号，再查本地 qq_links；AUTH_DB 未配置回落本地休眠表（回滚通道）。
 */
export async function queueClubNotification(
  env: Env,
  clubId: number | null,
  template: string,
  data: Record<string, unknown>,
): Promise<number> {
  if (clubId === null) return 0;
  const db = env.DB;
  try {
    let accountIds: number[];
    if (env.AUTH_DB) {
      const bound = await env.AUTH_DB.prepare(
        `SELECT b.account_id AS user_id FROM team_binding b JOIN team t ON t.id = b.team_id
         WHERE t.club_id = ? ORDER BY b.account_id LIMIT 5`,
      )
        .bind(clubId)
        .all<{ user_id: number }>();
      accountIds = bound.results.map((r) => r.user_id);
    } else {
      const bound = await db.prepare('SELECT user_id FROM club_bindings WHERE club_id = ? ORDER BY user_id LIMIT 5')
        .bind(clubId)
        .all<{ user_id: number }>();
      accountIds = bound.results.map((r) => r.user_id);
    }
    if (accountIds.length === 0) return 0;
    const placeholders = accountIds.map(() => '?').join(', ');
    const qqs = await db
      .prepare(`SELECT user_id, qq FROM qq_links WHERE user_id IN (${placeholders}) ORDER BY user_id LIMIT 5`)
      .bind(...accountIds)
      .all<{ user_id: number; qq: string }>();
    const text = renderNotification(template, data);
    // v6.40.0：能定位的实体一起落库（收件篮整行跳转用）；无实体模板不带 ref，前端走类目固定落点。
    // v6.54.0 闹涨薪：落点 /market/desk?tab=negotiations&demand=<id> 不是 NotifyRef 三型之一，
    // 刻意不造 ref（通知评审修——此前注释声称「前端用 payload.demandId 深链」但 demandId 从未
    // 进库，深链无来源）；改为 ref 之外附加 payload.demandId（仅当生成点 data 带正整数时）。
    const ref = notificationRefOf(template, data);
    const demandId = typeof data.demandId === 'number' && Number.isInteger(data.demandId) && data.demandId > 0 ? data.demandId : null;
    // 每个绑定账号都有一条 web 行（收件篮，status='sent' 免投递）；绑了 QQ 的账号另有一条
    // QQ 投递行（status='pending'，cron 投递），两通道互不挤占
    await db.batch([
      ...accountIds.map((userId) =>
        db
          .prepare(
            `INSERT INTO notifications (club_id, user_id, channel, template, payload, status, created_at)
             VALUES (?, ?, 'web', ?, ?, 'sent', ${nowSql()})`,
          )
          .bind(
            clubId,
            userId,
            template,
            JSON.stringify({ text, ...(ref ? { ref } : {}), ...(demandId !== null ? { demandId } : {}) }),
          ),
      ),
      ...qqs.results.map((r) =>
        db
          .prepare(
            `INSERT INTO notifications (club_id, user_id, channel, template, payload, status, created_at)
             VALUES (?, ?, 'qq', ?, ?, 'pending', ${nowSql()})`,
          )
          .bind(clubId, r.user_id, template, JSON.stringify({ qq: r.qq, text })),
      ),
    ]);
    return accountIds.length + qqs.results.length;
  } catch {
    return 0;
  }
}

/**
 * 全联盟通告（v6.54.0 demand_rejected_public 直拒档）：发全部真人俱乐部（CPU 队没有
 * 收件人、也没有站内篮，跳过）。每队各自解析绑定与双通道，见 queueClubNotification；
 * 通告是尽力而为：任何一队失败不影响其余队，整体失败不抛（通知绝不阻塞主流程，§12-2）。
 */
export async function queueAllUserClubsNotification(
  env: Env,
  template: string,
  data: Record<string, unknown>,
): Promise<number> {
  try {
    const clubs = await env.DB.prepare(`SELECT id FROM clubs WHERE is_cpu = 0 ORDER BY id`).all<{ id: number }>();
    let queued = 0;
    for (const club of clubs.results) {
      queued += await queueClubNotification(env, club.id, template, data);
    }
    return queued;
  } catch {
    return 0;
  }
}

/**
 * 投递一轮 pending（cron 与手动 tick 共用）。200 → sent；超时/非 200 → 留 pending 下轮再试。
 * 未配置 SYNC_BASE_URL/SYNC_SECRET 时跳过（本地联调友好）。
 */
export async function dispatchPendingNotifications(env: Env): Promise<{
  checked: number;
  sent: number;
  failed: number;
  skipped: string;
}> {
  if (!env.SYNC_BASE_URL || !env.SYNC_SECRET) {
    return { checked: 0, sent: 0, failed: 0, skipped: 'unconfigured' };
  }
  const rows = await env.DB.prepare(
    `SELECT id, template, payload FROM notifications WHERE status = 'pending' AND channel = 'qq' ORDER BY id LIMIT ${DISPATCH_LIMIT}`,
  ).all<{ id: number; template: string; payload: string }>();

  let sent = 0;
  let failed = 0;
  for (const row of rows.results) {
    let body: { qq?: string; text?: string };
    try {
      body = JSON.parse(row.payload);
    } catch {
      // 坏 payload 永远发不出去，标 failed 防止每轮空转
      await env.DB.prepare(`UPDATE notifications SET status = 'failed', sent_at = ${nowSql()} WHERE id = ?`).bind(row.id).run();
      failed++;
      continue;
    }
    try {
      const res = await signAndPost(env, '/notify', { qq: body.qq, template: row.template, text: body.text });
      if (res.ok) {
        await env.DB.prepare(`UPDATE notifications SET status = 'sent', sent_at = ${nowSql()} WHERE id = ?`).bind(row.id).run();
        sent++;
      } else {
        failed++;
      }
    } catch {
      failed++; // 超时/网络错误：留 pending，下轮 cron 重试（§12）
    }
  }
  return { checked: rows.results.length, sent, failed, skipped: '' };
}
