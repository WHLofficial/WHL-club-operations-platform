// 球队详情页（增量 31 步骤 7–8，结构分析在步骤 11a 按用户裁决整改）：
// 阵容组 + 运营组 + 战绩组，登录者正是本队教练时再挂教练工作台。
// 每组内是「三格主指标 + 一行语义明细」，不是等权指标网格；三张结构图各用各的坐标语义（见文件中部注释）。
// URL 口径：/clubs/:id 的 :id 就是平台库 clubs.id（AGENTS.md「代码与提交」节，长期有效）。
// 读量：结构统计由 GET /api/clubs/:id 一次算完（生产实测 12 条语句 / 151–165 行，clubs scope 缓存 24h）；
// 名单复用公开的 GET /api/players?club_id=N（limit=100 一页装完），不新建读面；队徽走 /api/media/*（零 D1）。
// 排名由后端代理比赛系统公开积分榜，取不到时后端回 200 + note，这里只负责把 note 显示出来。
// 教练工作台走 /api/me/club（qk.myClub，与市场页、/club 壳同键，缓存热时不再读库）。
import { Fragment } from 'react';
import { Link, useParams } from 'react-router';
import { useClubDetail, useClubRoster, useClubStanding, useMyClub } from '../lib/queries.ts';
import CoachPanel from './club/CoachPanel.tsx';
import type { ClubBand, ClubFormRow, ClubTransferRow } from '../lib/api.ts';
import { TeamLogo } from '../components/TeamLogo.tsx';
import { TRANSFER_TYPE_LABEL } from '../lib/ref.ts';
import { playerPath } from '../lib/player-link.ts';
import { STATUS_BADGE, STATUS_LABEL } from '../lib/players-library.ts';

const TIER_LABEL: Record<'premier' | 'second', string> = {
  premier: '顶级联赛',
  second: '次级联赛',
};

// 金额口径与球员库一致（身价/工资都以「m」为单位存储）；null = 没录过，显示「—」
function money(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(2)} m`;
}

function num1(x: number | null): string {
  return x === null ? '—' : x.toFixed(1);
}

// 效力是 0.5 赛季的整数倍，直接按 1 位小数写；0 是「本窗刚签」而非缺值
function seasons(x: number | null): string {
  return x === null ? '—' : `${x.toFixed(1)} 赛季`;
}

const FORM_LABEL: Record<'win' | 'draw' | 'loss', string> = { win: '胜', draw: '平', loss: '负' };
const FORM_BADGE: Record<'win' | 'draw' | 'loss', string> = { win: 'green', draw: 'gray', loss: 'red' };

// 结构分析图全部 CSS 自绘（不引图表库）。三张图各用各的坐标语义（增量 31 步骤 11a，用户裁决）：
//   位置分布 → 不用图示，纯文字档位
//   年龄结构 → 等宽 3 岁箱 ⇒ 竖直直方图（柱相邻、面积=人数）
//   CA 结构  → 语义档不等宽（70–79 宽 10、80–84 宽 5）⇒ 一根水平柱按占比切段（100% 堆叠条）
//   效力年限 → 普通升序横向柱状图（BandChart）
// 三张图都只用百分比给尺寸，所以窄屏压容器不会把图形挤出去。
// 语义一律用 <ul>/<li> 而不是 role="img"：role="img" 会把整棵子树当装饰，档位标签与人数就读不到了；
// 图形本身纯装饰（aria-hidden），数据由「标签 + 人数」两段文字承载。
function BandChart({ bands, ariaLabel }: { bands: ClubBand[]; ariaLabel: string }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <ul className="band-chart" aria-label={ariaLabel}>
      {bands.map((b) => (
        <li className="band-row" key={b.key}>
          <span className="band-label">{b.label}</span>
          <span className="band-track" aria-hidden="true">
            {/* 0 人不出条：.band-bar 有 min-width 2px（小值也要看得见），给 0 画 2px 会读成「有一点」 */}
            {b.count > 0 && <span className="band-bar" style={{ width: `${(b.count / max) * 100}%` }} />}
          </span>
          <span className="band-count mono">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}

// 竖直直方图（年龄）：柱高 = 人数 / 最高档人数，人数标在柱顶（所以不画 y 轴）。
// 柱与柱之间不留缝——直方图的柱是相邻的箱，留缝就变成柱状图了；六个轨道底色相连，读成一块底板。
// 0 人的档不出柱（不设 min-height：给 0 画 2px 会假装有 1 人），柱顶的「0」才是事实。
function Histogram({ bins, ariaLabel }: { bins: ClubBand[]; ariaLabel: string }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <ul className="club-histogram" aria-label={ariaLabel}>
      {bins.map((b) => (
        <li className="club-hist-col" key={b.key}>
          <span className="club-hist-count mono">{b.count}</span>
          <span className="club-hist-track" aria-hidden="true">
            <span className="club-hist-bar" style={{ height: `${(b.count / max) * 100}%` }} />
          </span>
          <span className="club-hist-label">{b.label}</span>
        </li>
      ))}
    </ul>
  );
}

// CA 结构：一根水平柱子按占比切段（100% 堆叠条），上方 0–100% 刻度轴，下方图例给档位与人数。
// 段序由高到低（后端 CA_BANDS 已是降序），段色是同一主色的深浅阶梯——越强的档越深，颜色只写在
// CSS 里，段本身只带一个透明度。分母用「全队人数」而不是「各档之和」：有人缺 CA 时柱子填不满
// 100%，这是实话（缺的人没进任何档），底板的米色把没填满的那截显出来。
const SHARE_TICKS = [0, 25, 50, 75, 100];
const SEG_ALPHA = [1, 0.82, 0.63, 0.44, 0.27];

function ShareBar({ bands, total, ariaLabel }: { bands: ClubBand[]; total: number; ariaLabel: string }) {
  const denom = Math.max(1, total);
  const alphaOf = (i: number) => SEG_ALPHA[i] ?? 0.27;
  const pctOf = (count: number) => Math.round((count / denom) * 100);
  return (
    <div className="club-share">
      <div className="club-share-plot">
        <div className="club-share-axis" aria-hidden="true">
          {SHARE_TICKS.map((t) => (
            <span
              className={t === 0 || t === 100 ? 'club-share-tick' : 'club-share-tick club-share-tick-mid'}
              key={t}
              style={{ left: `${t}%` }}
            >
              {t}%
            </span>
          ))}
        </div>
        <div className="club-share-stack" aria-hidden="true">
          {bands.map((b, i) =>
            b.count === 0 ? null : (
              <span className="club-share-seg" key={b.key} style={{ width: `${(b.count / denom) * 100}%`, opacity: alphaOf(i) }} />
            ),
          )}
        </div>
      </div>
      <ul className="club-share-legend" aria-label={ariaLabel}>
        {bands.map((b, i) => (
          <li className="club-share-legend-row" key={b.key} title={`${b.label}：${b.count} 人 · 占全队 ${pctOf(b.count)}%`}>
            <span className="club-share-swatch" aria-hidden="true" style={{ opacity: alphaOf(i) }} />
            <span className="club-share-legend-label">{b.label}</span>
            <span className="club-share-legend-value mono">
              {b.count} 人 · {pctOf(b.count)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 主指标：大号数字，三格铺满一行。
// 与下方明细同住一个 .club-summary（淡奶油底 + 左侧一道焦橙竖线），所以「大数字 + 小字」是一块东西，
// 不是两块（增量 31 步骤 11b 用户反馈：小字与上方过于割裂）。
function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="club-hero-item">
      <dt>{label}</dt>
      <dd className="mono">
        {value}
        {hint !== undefined && <span className="club-hero-hint"> {hint}</span>}
      </dd>
    </div>
  );
}

// 明细行：按语义分组（能力/资产/荣誉…），组名 muted 加粗，组内用「·」分隔。
// 住在 .club-summary 里，与上面的大数字共用底色，所以不再画顶部分割线（那条线正是「割裂」的来源）。
function DetailLine({ groups }: { groups: { label: string; text: string }[] }) {
  return (
    <p className="club-detail-line">
      {groups.map((g) => (
        <span key={g.label}>
          <b>{g.label}</b>
          {g.text}
        </span>
      ))}
    </p>
  );
}

function TransferTable({ rows, empty, side }: { rows: ClubTransferRow[]; empty: string; side: 'in' | 'out' }) {
  if (rows.length === 0) {
    return <p className="muted club-sub-empty">{empty}</p>;
  }
  return (
    <div className="table-wrap">
      <table className="transfer-table">
        <thead>
          <tr>
            <th>完成时间</th>
            <th>类型</th>
            <th>球员</th>
            <th>{side === 'in' ? '来自' : '去向'}</th>
            <th>费用</th>
            <th>赛季</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.completedAt === null ? '—' : t.completedAt.slice(0, 10)}</td>
              <td>{TRANSFER_TYPE_LABEL[t.type] ?? t.type}</td>
              <td>
                {t.playerId === null ? (
                  t.playerName ?? '未知球员'
                ) : (
                  <Link to={playerPath({ id: t.playerId, fcId: t.playerFcId })}>{t.playerName ?? '未知球员'}</Link>
                )}
              </td>
              <td>
                {(() => {
                  const other = side === 'in' ? t.fromClubId : t.toClubId;
                  const name = side === 'in' ? t.fromClubName : t.toClubName;
                  if (other === null) return '自由身';
                  return <Link to={`/clubs/${other}`}>{name ?? '未知球队'}</Link>;
                })()}
              </td>
              <td className="num mono">
                {t.fee === null ? '—' : money(t.fee)}
                {t.extraFee !== null && t.extraFee > 0 ? ` +${t.extraFee.toFixed(2)}` : ''}
              </td>
              <td className="mono">
                {t.season === null ? '—' : `S${t.season}${t.windowSeq ? ` 第 ${t.windowSeq} 窗` : ''}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormRow({ row }: { row: ClubFormRow }) {
  const result = row.result;
  return (
    <li className="form-row">
      <span className="mono form-date">{row.finishedAt === null ? '—' : row.finishedAt.slice(0, 10)}</span>
      <span className="form-stage muted">
        {row.competitionType ?? '赛事'} {row.stageName ?? ''} {row.round === null ? '' : `第 ${row.round} 轮`}
      </span>
      <span className="form-teams">
        {row.homeTeam ?? '—'} <span className="mono">{row.scoreHome ?? '-'}</span> :{' '}
        <span className="mono">{row.scoreAway ?? '-'}</span> {row.awayTeam ?? '—'}
      </span>
      <span className="form-tail">
        {row.penHome !== null && row.penAway !== null && (
          <span className="muted mono" title="点球大战比分（不改 90 分钟判定）">
            点球 {row.penHome}:{row.penAway}
          </span>
        )}
        {result === null ? (
          <span className="badge gray">未知</span>
        ) : (
          <span className={`badge ${FORM_BADGE[result]}`}>{FORM_LABEL[result]}</span>
        )}
      </span>
    </li>
  );
}

export default function ClubDetail() {
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;

  const detailQuery = useClubDetail(valid ? id : 0);
  const standingQuery = useClubStanding(valid ? id : 0);
  const rosterQuery = useClubRoster(valid ? id : 0);
  // 这几个 hook 都必须在任何 early return 之前无条件调用
  const myClub = useMyClub();

  if (!valid) {
    return (
      <div className="container">
        <div className="banner bad">球队 ID 不对。</div>
        <p>
          <Link to="/clubs">回球队列表</Link>
        </p>
      </div>
    );
  }

  const detail = detailQuery.data ?? null;
  const roster = rosterQuery.data ?? null;

  if (detailQuery.isError) {
    return (
      <div className="container">
        <div className="banner bad">
          {detailQuery.error instanceof Error ? detailQuery.error.message : '球队档案打不开了，稍后再试'}
        </div>
        <p>
          <Link to="/clubs">回球队列表</Link>
        </p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="container">
        <p className="muted">正在翻查球队档案…</p>
      </div>
    );
  }

  const { club, squad, contracts, transfers, form } = detail;
  const standing = standingQuery.data?.standing ?? null;
  const standingNote = standingQuery.data?.note ?? null;
  const rosterRows = roster?.players ?? null;
  const rosterOverflow = roster !== null && roster.nextCursor !== null;

  return (
    <div className="container">
      <div className="club-detail-head">
        <TeamLogo name={club.name} logoKey={club.logoKey} size={48} />
        <div className="club-detail-title">
          <h1>{club.name}</h1>
          <div className="club-detail-meta">
            {club.tier === null ? <span className="badge gray">未定级</span> : <span className="badge sky">{TIER_LABEL[club.tier]}</span>}
            {club.isCpu && <span className="badge gray">CPU</span>}
            {standing !== null && <span className="badge blue">联赛第 {standing.position} 名</span>}
          </div>
        </div>
        <Link className="muted club-detail-back" to="/clubs">
          回球队列表
        </Link>
      </div>

      <section className="card club-block">
        <div className="tier-head">
          <h3>阵容组</h3>
          <span className="muted">在册球员与结构分析</span>
        </div>
        <div className="club-summary">
          <dl className="club-hero">
            <HeroStat
              label="阵容人数"
              value={`${squad.senior} 人`}
              hint={squad.trainee > 0 ? `+ ${squad.trainee} 青训` : undefined}
            />
            <HeroStat label="平均 CA" value={num1(squad.avgCa)} />
            <HeroStat label="总身价" value={money(squad.totalValue)} />
          </dl>
          <DetailLine
            groups={[
              {
                label: '能力',
                text: `最高 CA ${num1(squad.maxCa)} · 平均 PA ${num1(squad.avgPa)} · 成长空间 ${num1(squad.avgGrowth)}`,
              },
              {
                label: '资产',
                text: `工资总额 ${money(squad.totalWage)} · 平均工资 ${squad.avgWage === null ? '—' : money(squad.avgWage)}`,
              },
              { label: '荣誉', text: `金徽章 ${squad.badgesGold} 枚 · 银徽章 ${squad.badgesSilver} 枚` },
            ]}
          />
        </div>

        {/* 三张图并排铺满卡片宽度（auto-fit：窄屏自己折行），不留右侧一大片空白 */}
        <div className="club-figures">
          <div className="club-sub">
            <h4>位置分布</h4>
            {squad.size === 0 ? (
              <p className="muted club-sub-empty">队里还没有人。</p>
            ) : (
              // 四档恒出（含 0 人档）：「0 门将」本身就是要看见的信号。档内细位作 muted 明细。
              <dl className="club-position-list">
                {squad.byPosition.map((g) => (
                  <Fragment key={g.key}>
                    <dt>{g.label}</dt>
                    <dd>
                      <span className="mono">{g.count}</span> 人
                    </dd>
                    <dd className="club-position-detail">{g.detail === '' ? '—' : g.detail}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
          </div>

          <div className="club-sub">
            <h4>年龄结构</h4>
            <Histogram bins={squad.byAge} ariaLabel="年龄分布（等宽 3 岁分箱，柱高为该档人数）" />
          </div>

          <div className="club-sub">
            <h4>CA 结构</h4>
            <ShareBar bands={squad.byCa} total={squad.size} ariaLabel="CA 分档占全队比例" />
          </div>
        </div>

        <div className="club-sub">
          <h4>阵容名单</h4>
          {rosterRows === null ? (
            rosterQuery.isError ? (
              <p className="muted club-sub-empty">
                名单没拉下来（{rosterQuery.error instanceof Error ? rosterQuery.error.message : '未知错误'}），
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void rosterQuery.refetch()}>
                  重试
                </button>
              </p>
            ) : (
              <p className="muted club-sub-empty">正在点名…</p>
            )
          ) : rosterRows.length === 0 ? (
            <p className="muted club-sub-empty">队里还没有人。</p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>姓名</th>
                      <th>位置</th>
                      <th className="num">年龄</th>
                      <th className="num">CA</th>
                      <th className="num">PA</th>
                      <th>状态</th>
                      <th className="num">工资</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosterRows.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.uid.replace(/^fc/, '')}</td>
                        <td>
                          <Link to={playerPath(p)}>{p.name}</Link>
                        </td>
                        <td className="mono">{p.positions.length > 0 ? p.positions.join(' ') : '—'}</td>
                        <td className="num mono">{p.age ?? '—'}</td>
                        <td className="num mono">{p.ca}</td>
                        <td className="num mono">{p.pa}</td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[p.status] ?? 'gray'}`}>
                            {STATUS_LABEL[p.status] ?? p.status}
                          </span>
                        </td>
                        <td className="num mono">{p.wage === null ? '—' : money(p.wage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rosterOverflow && (
                <p className="muted club-sub-empty">
                  名单过长，这里只显示前 {rosterRows.length} 人 ——{' '}
                  <Link to={`/players?club_id=${club.id}`}>去球员库看全部</Link>
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="card club-block">
        <div className="tier-head">
          <h3>运营组</h3>
          <span className="muted">合同结构与转会往来</span>
        </div>
        {/* 左：合同结构；右：效力年限图。两列到窄屏折成一列（900px 断点）。 */}
        <div className="club-split">
          <div className="club-summary">
            <dl className="club-hero">
              <HeroStat label="在册合同" value={`${contracts.signed} 份`} />
              <HeroStat label="保护期内" value={`${contracts.protectedCount} 人`} />
              <HeroStat label="未保护" value={`${contracts.unprotected} 人`} />
            </dl>
            <DetailLine groups={[{ label: '效力', text: `平均 ${seasons(contracts.avgYears)}` }]} />
          </div>

          <div className="club-sub">
            <h4>效力年限</h4>
            <BandChart bands={contracts.byYears} ariaLabel="效力年限分档人数" />
          </div>
        </div>

        <div className="club-sub">
          <h4>转入</h4>
          <TransferTable rows={transfers.incoming} empty="还没有转入记录。" side="in" />
        </div>

        <div className="club-sub">
          <h4>转出</h4>
          <TransferTable rows={transfers.outgoing} empty="还没有转出记录。" side="out" />
        </div>
      </section>

      <section className="card club-block">
        <div className="tier-head">
          <h3>战绩组</h3>
          <span className="muted">当季联赛排名与近期比赛</span>
        </div>

        <div className="club-sub">
          <h4>联赛排名</h4>
          {standing === null ? (
            <p className="muted club-sub-empty">{standingNote ?? '排名暂不可用'}</p>
          ) : (
            <div className="club-summary">
              <dl className="club-hero">
                <HeroStat label="名次" value={`第 ${standing.position} 名`} />
                <HeroStat
                  label="积分"
                  value={standing.pts === null ? '—' : `${standing.pts}`}
                  hint={
                    standing.pointsDeducted !== null && standing.pointsDeducted > 0
                      ? `扣 ${standing.pointsDeducted}`
                      : undefined
                  }
                />
                <HeroStat
                  label="胜平负"
                  value={`${standing.won ?? 0} / ${standing.drawn ?? 0} / ${standing.lost ?? 0}`}
                />
              </dl>
              <DetailLine
                groups={[
                  { label: '场次', text: standing.played === null ? '—' : `${standing.played} 场` },
                  { label: '进失球', text: `${standing.goalsFor ?? 0} : ${standing.goalsAgainst ?? 0}` },
                ]}
              />
            </div>
          )}
        </div>

        <div className="club-sub">
          <h4>近期战绩</h4>
          {form.recent.length === 0 ? (
            <p className="muted club-sub-empty">本赛季还没有已确认的比赛。</p>
          ) : (
            <>
              <p className="muted club-sub-empty">
                近 {form.recent.length} 场：{form.wins} 胜 {form.draws} 平 {form.losses} 负（90 分钟口径，点球大战不改判定）
              </p>
              <ul className="form-list">
                {form.recent.map((r) => (
                  <FormRow key={r.matchId} row={r} />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* 教练工作台（步骤 8 从 /club 整体搬入）：只有本队教练看得到，观众与别队教练都不渲染。
          这里不套 card——CoachPanel 内部每一块自己就是 card，再套一层会变成卡中卡。 */}
      {myClub.club?.id === club.id && (
        <section className="club-block">
          <div className="tier-head">
            <h3>教练工作台</h3>
            <span className="muted">注册、设施、冠名与合同操作</span>
          </div>
          <CoachPanel />
        </section>
      )}
    </div>
  );
}
