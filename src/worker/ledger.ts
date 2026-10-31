// 账本原语（TECH_DESIGN §7.4，仿 revenue 插件 claim_* 模式）：
// 余额变更 = 账户 upsert（批首，幂等闸 + guardSql 对批前状态求值）+ 流水（以账户 changes()>0 为闸，
// balance_after 读同批更新后的余额）。两条语句必须进同一个 D1 batch 才是原子的。
// 流水自带幂等闸：同一 (club, kind, ref) 只记一次，并发重放时账户的 NOT EXISTS 闸不通过、
// changes()=0，流水整段不落（完成过户/下架费等自动路径靠它防重复记账）。
export interface MovementInput {
  clubId: number;
  /** 正=入账 负=出账（m） */
  delta: number;
  kind: string;
  refType: string | null;
  refId: number | null;
  memo: string;
  /**
   * 幂等闸：默认按 (club_id, kind, ref_type, ref_id) 查重，已有流水则整段跳过。
   * 人工记账等允许重复的类型传 false。闸必须带 club 维度：窗末结算多队共用
   * 同一 (kind, 'window', refId)，全局查重会把第 2 队起的流水全部闸掉。
   */
  idempotent?: boolean;
  /** 额外守卫 SQL（布尔表达式，追加在两条语句的 WHERE 后，参数跟在 params 之后） */
  guardSql?: string;
  guardParams?: unknown[];
}

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export function ledgerMovement(db: D1Database, input: MovementInput): D1PreparedStatement[] {
  const guardParts = ['1=1'];
  const guardParams: unknown[] = [];
  if (input.idempotent !== false) {
    guardParts.push('NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = ? AND ref_type IS ? AND ref_id IS ? AND club_id = ?)');
    guardParams.push(input.kind, input.refType, input.refId, input.clubId);
  }
  if (input.guardSql) {
    guardParts.push(`(${input.guardSql})`);
    guardParams.push(...(input.guardParams ?? []));
  }
  const where = guardParts.join(' AND ');

  return [
    // 1) 账户差额 upsert（批首）：幂等闸 + guardSql 都在这里对**批前状态**求值——余额类守卫
    //    （如消费扣费）必须在这一条上判断，否则流水语句会读到本批扣完的余额（v6.26.0 教训）。
    //    守卫在语句里出现两次，占位符也按两次绑定（node:sqlite/D1 缺位绑定会静默落 NULL）。
    db
      .prepare(
        `INSERT INTO ledger_accounts (club_id, balance, updated_at)
         SELECT ?, ?, ${nowSql()} WHERE ${where}
         ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
         WHERE ${where}`,
      )
      .bind(input.clubId, input.delta, ...guardParams, ...guardParams),
    // 2) 流水：以「账户语句真的动了账（changes() > 0）」为闸——幂等重放 / 守卫没过时账户
    //    changes=0，流水整段不落，两段始终同生共死。balance_after 读同批更新后的余额（§7.4 防错账）。
    db
      .prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
         SELECT ?, ?, ?, (SELECT balance FROM ledger_accounts WHERE club_id = ?), ?, ?, ?, ${nowSql()} WHERE changes() > 0`,
      )
      .bind(input.clubId, input.kind, input.delta, input.clubId, input.refType, input.refId, input.memo),
  ];
}

// ── 预期收入额度（设计 §1：窗口内预支未到账的卖人收入）────────────────────────
// 在途卖人收入的税后净额 × k 进「可支配」，让卖方在成交单真正过户前先周转。
//   源① listings：仍可竞价（listed/bidding）、非 activation 且有 active 出价 → 取最高 active 出价额；
//   源③（v6.64.0）被激活挂牌：type='activation' 且 activated_by 非空（激活动作必带值）、仍在
//        listed/bidding → 取 MAX(最高 active 出价, 激活价 ask_price)。激活价是激活方已提交
//        申请的保底收入（作废占一窗一次额度、激活前查过资金门槛）；激活作废（窗内未落价）
//        或落价进 matched_pending 后本源退出，额度随实时公式收缩（§2.4 自然收缩）。
//        v6.57.0 注释曾说「激活是签入方掏钱不产生卖方收入」——那是错的：激活挂牌的
//        seller_club_id 是球员现属队、成交后收钱（源② transfers type='activation' 一直计）。
//        当时不计的真实原因是首价窗在途态还没进设计；现按 grilling Q1-Q4 裁决纳入。
//   源② transfers：待审/签约中（pending_review/signing）且**只认成交类**
//        （transfer/activation/forced_auction）——rc_change/match/free_agent/termination
//        的 from_club_id 也会等于本队、fee 写的是新违约金/差额，但永远不产生卖方收入，
//        不筛类型就是凭空造额度（rc_change 交 30% 新老差额就能挂出约 1.5×RC 的假额度）。
// 同一球员多源只取毛额最高的一份（同一份未来收入不重复计）；强制拍卖按 auction_tax_rate
// 整单税率，其余分段累进（与过户实算 transfers.ts:222-224 同源）。
// ⚠️ 本片段是公式的**单点定义**：迁移 0081 的三个资金触发器内嵌同一段文本（占位符换成
//   NEW.club_id），同源由 tests/expected-income.test.ts 的文本锁 + 行为锁兜住，改这里必须同步改那里。
const EXPECTED_INCOME_RATE_SQL = `MIN(MAX(CAST(COALESCE((SELECT value FROM config WHERE key = 'expected_income_rate'), '1.0') AS REAL), 0), 1)`;

// 分段税率是逗号串（'0.10,0.20,0.40'），不能用 json_extract（非 JSON 会打断 INSERT），
// 用 instr/substr 三段提取；缺逗号时该段解析为 NULL（整行净额 NULL ⇒ 不计额度，fail 严格方向）。
const TAX_RATES_ROW_SQL = `(SELECT CAST(NULLIF(substr(v, 1, instr(v, ',') - 1), '') AS REAL) AS r1,
              CAST(NULLIF(substr(v, instr(v, ',') + 1, instr(substr(v, instr(v, ',') + 1), ',') - 1), '') AS REAL) AS r2,
              CAST(NULLIF(substr(v, instr(v, ',') + instr(substr(v, instr(v, ',') + 1), ',') + 1), '') AS REAL) AS r3,
              COALESCE(CAST(NULLIF((SELECT value FROM config WHERE key = 'auction_tax_rate'), '') AS REAL), 0.5) AS auction
       FROM (SELECT COALESCE((SELECT value FROM config WHERE key = 'tax_rates'), '0.10,0.20,0.40') AS v))`;

/** 在途收入逐笔明细（未去重，同一球员可能多行；净额/税额由 SQL 算，应用层不重算税率） */
function inflightIncomeSql(clubRef: string): string {
  return `SELECT d.source AS source,
             d.ref_id AS ref_id,
             d.player_id AS player_id,
             d.gross AS gross,
             d.tax AS tax,
             d.gross - d.tax AS net
      FROM (SELECT src.source AS source,
                   src.ref_id AS ref_id,
                   src.player_id AS player_id,
                   src.gross AS gross,
                   ROUND(CASE WHEN src.forced = 1
                              THEN src.gross * r.auction
                              ELSE MIN(src.gross, COALESCE(c.release_fee, 0)) * r.r1
                                   + MAX(0, MIN(src.gross, COALESCE(c.release_fee, 0) * 1.5) - COALESCE(c.release_fee, 0)) * r.r2
                                   + MAX(0, src.gross - COALESCE(c.release_fee, 0) * 1.5) * r.r3
                         END, 2) AS tax
            FROM (SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS gross,
                         CASE WHEN l.type = 'forced' THEN 1 ELSE 0 END AS forced
                  FROM listings l
                  WHERE l.seller_club_id = ${clubRef}
                    AND l.status IN ('listed', 'bidding')
                    AND l.type NOT IN ('activation')
                    AND EXISTS (SELECT 1 FROM bids b WHERE b.listing_id = l.id AND b.status = 'active')
                  UNION ALL
                  SELECT 'listing' AS source,
                         l.id AS ref_id,
                         l.player_id AS player_id,
                         MAX(COALESCE((SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active'), 0), l.ask_price) AS gross,
                         0 AS forced
                  FROM listings l
                  WHERE l.seller_club_id = ${clubRef}
                    AND l.type = 'activation'
                    AND l.activated_by IS NOT NULL
                    AND l.status IN ('listed', 'bidding')
                  UNION ALL
                  SELECT 'transfer' AS source,
                         t.id AS ref_id,
                         t.player_id AS player_id,
                         t.fee AS gross,
                         CASE WHEN t.type = 'forced_auction' THEN 1 ELSE 0 END AS forced
                  FROM transfers t
                  WHERE t.from_club_id = ${clubRef}
                    AND t.status IN ('pending_review', 'signing')
                    AND t.type IN ('transfer', 'activation', 'forced_auction')
                    AND t.fee IS NOT NULL) AS src
            LEFT JOIN contracts c ON c.player_id = src.player_id AND c.is_active = 1
            CROSS JOIN ${TAX_RATES_ROW_SQL} AS r) AS d`;
}

/** 每球员取毛额最高的一份（SQLite 裸列语义：与 MAX(gross) 同行取净额/来源/单号）。裸子查询，供 WITH 物化共用 */
function pickedRowsSql(clubRef: string): string {
  return `SELECT dd.player_id AS player_id,
                 MAX(dd.gross) AS gross,
                 dd.source AS source,
                 dd.ref_id AS ref_id,
                 dd.tax AS tax,
                 dd.net AS net
          FROM (${inflightIncomeSql(clubRef)}) AS dd
          GROUP BY dd.player_id`;
}

/** FROM 子句形态（带括号与别名 p）——触发器内嵌文本走这个；文本锁逐字比对 */
function pickedIncomeSql(clubRef: string): string {
  return `(${pickedRowsSql(clubRef)}) AS p`;
}

/**
 * 预期收入额度（m）= 在途卖人净收入 × k。三份资金触发器内嵌同一段文本（见文件头注释）。
 * k 走钳制式：config 缺行按 1.0；写非法值（如 'abc'）被 CAST 成 0.0 ⇒ 额度归零（fail 严格方向）。
 */
export function creditLineSql(clubRef: string): string {
  return `COALESCE(ROUND((SELECT SUM(p.net) * ${EXPECTED_INCOME_RATE_SQL} FROM ${pickedIncomeSql(clubRef)}), 2), 0)`;
}

/**
 * 触发器之外的手写守卫要内嵌额度片段时用这个：片段里的 clubRef 一律写成 '?'，
 * 参数按占位符出现次数重复 clubId。必须与同一片段的 SQL 成对绑定——漏绑会静默落 NULL
 * （D1/node:sqlite 对缺位参数不报错），守卫就退化成恒假或恒真。
 */
export function creditLineGuard(clubId: number): { sql: string; params: number[] } {
  const sql = creditLineSql('?');
  return { sql, params: clubParams(sql, clubId) };
}

function paramCount(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

/** 片段里的 clubRef 一律写成 '?'，按出现次数产出绑定参数（顺序即文本顺序） */
function clubParams(sql: string, clubId: number): number[] {
  return Array.from({ length: paramCount(sql) }, () => clubId);
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export interface BalanceSnapshot {
  balance: number;
  /** 全部现行冻结（出价 / 报价 / 海捞） */
  held: number;
  /** 在途卖人收入（税后净额，未乘 k） */
  expectedIncome: number;
  /** 预期收入额度 = expectedIncome × k */
  creditLine: number;
  /** v6.64.0：被激活挂牌在途税后净额（未乘 k，expectedIncome 的组成部分，与主数同源同一次明细） */
  activationIncome: number;
  /** v6.64.0：activationIncome × k（财政页「其中被激活挂牌」展示口径，与 creditLine 同层真部分和） */
  activationCredit: number;
  /** 可支配 = balance − held + creditLine */
  available: number;
}

/**
 * 余额快照（/api/club/balance 与展示层共用）：余额 / 冻结 / 预期收入 / 额度 / 可支配，
 * 另带被激活挂牌部分（v6.64.0：activationIncome 未乘 k、activationCredit ×k 后与 creditLine 同层）。
 * 一次查询算完——CTE 把在途明细物化一次，expectedIncome / activationIncome / creditLine 同源。
 */
export async function balanceSnapshot(db: D1Database, clubId: number): Promise<BalanceSnapshot> {
  const picked = pickedRowsSql('?');
  const row = await db
    .prepare(
      `WITH picked AS (${picked}),
            agg AS (
              SELECT COALESCE((SELECT ROUND(SUM(p.net), 2) FROM picked p), 0) AS expected,
                     COALESCE((SELECT ROUND(SUM(p.net), 2) FROM picked p
                               WHERE p.source = 'listing'
                                 AND EXISTS (SELECT 1 FROM listings al WHERE al.id = p.ref_id
                                               AND al.type = 'activation' AND al.activated_by IS NOT NULL)), 0) AS activation
            )
       SELECT b.balance AS balance, b.held AS held, a.expected AS expected_income, a.activation AS activation_income,
              ROUND(a.expected * ${EXPECTED_INCOME_RATE_SQL}, 2) AS credit_line,
              ROUND(a.activation * ${EXPECTED_INCOME_RATE_SQL}, 2) AS activation_credit
       FROM (SELECT COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0) AS balance,
                    COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0) AS held) AS b
       CROSS JOIN agg AS a`,
    )
    .bind(...clubParams(picked, clubId), clubId, clubId)
    .first<{
      balance: number;
      held: number;
      expected_income: number;
      activation_income: number;
      credit_line: number;
      activation_credit: number;
    }>();
  const balance = row?.balance ?? 0;
  const held = row?.held ?? 0;
  const expectedIncome = row?.expected_income ?? 0;
  const activationIncome = row?.activation_income ?? 0;
  const creditLine = row?.credit_line ?? 0;
  const activationCredit = row?.activation_credit ?? 0;
  return {
    balance,
    held,
    expectedIncome,
    creditLine,
    activationIncome,
    activationCredit,
    available: round2(balance - held + creditLine),
  };
}

export interface ExpectedIncomeItem {
  /** listing = 挂牌在途出价；transfer = 待审/签约中的成交单 */
  source: 'listing' | 'transfer';
  /** 挂牌 id 或转会单 id */
  refId: number;
  playerId: number;
  /** 毛额（m） */
  gross: number;
  /** 交易税（m，已按现行 RC / 拍卖税率算好） */
  tax: number;
  /** 税后净额（m） */
  net: number;
  /** v6.64.0：本行来自被激活挂牌（type='activation' 且 activated_by 非空，毛额 = MAX(出价, 激活价)） */
  activation: boolean;
}

/**
 * 逐笔在途源明细（同一球员只出被计入的那一份，SUM(net) 即 expectedIncome）。
 * 前端「预计收入」拆解与测试对账用，不做 IO 以外的加工。
 */
export async function expectedIncomeBreakdown(db: D1Database, clubId: number): Promise<ExpectedIncomeItem[]> {
  const picked = pickedIncomeSql('?');
  const rows = await db
    .prepare(
      `SELECT p.source AS source, p.ref_id AS ref_id, p.player_id AS player_id,
              p.gross AS gross, p.tax AS tax, p.net AS net,
              (p.source = 'listing' AND EXISTS (SELECT 1 FROM listings al WHERE al.id = p.ref_id
                                                  AND al.type = 'activation' AND al.activated_by IS NOT NULL)) AS activation
       FROM ${picked}
       ORDER BY p.net DESC, p.player_id`,
    )
    .bind(...clubParams(picked, clubId))
    .all<{
      source: 'listing' | 'transfer';
      ref_id: number;
      player_id: number;
      gross: number;
      tax: number;
      net: number;
      activation: number;
    }>();
  return rows.results.map((r) => ({
    source: r.source,
    refId: r.ref_id,
    playerId: r.player_id,
    gross: r.gross,
    tax: r.tax,
    net: r.net,
    activation: r.activation === 1,
  }));
}

// 可用余额 = 余额 − 全部现行冻结 + 预期收入额度（出价校验口径；0081 的三个资金触发器在事务内兜底同一公式）
export async function availableBalance(db: D1Database, clubId: number): Promise<number> {
  const credit = creditLineSql('?');
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0)
              - COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0)
              + ${credit} AS available`,
    )
    .bind(clubId, clubId, ...clubParams(credit, clubId))
    .first<{ available: number }>();
  return row?.available ?? 0;
}
