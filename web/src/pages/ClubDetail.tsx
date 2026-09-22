// 球队详情页（增量 31 步骤 7）：阵容组 + 运营组 + 战绩组，不含财政与主场（主场档案在 /club 教练中心）。
// URL 口径：/clubs/:id 的 :id 就是平台库 clubs.id（AGENTS.md「代码与提交」节，长期有效）。
// 读量：结构统计由 GET /api/clubs/:id 一次算完（生产实测 12 条语句 / 151–165 行，clubs scope 缓存 24h）；
// 名单复用公开的 GET /api/players?club_id=N（limit=100 一页装完），不新建读面；队徽走 /api/media/*（零 D1）。
// 排名由后端代理比赛系统公开积分榜，取不到时后端回 200 + note，这里只负责把 note 显示出来。
import { Link, useParams } from 'react-router';
import { useClubDetail, useClubRoster, useClubStanding } from '../lib/queries.ts';
import type { ClubBand, ClubFormRow, ClubTransferRow } from '../lib/api.ts';
import { TeamLogo } from '../components/TeamLogo.tsx';
import { TRANSFER_TYPE_LABEL } from '../lib/ref.ts';
import { STATUS_BADGE, STATUS_LABEL } from '../lib/players-library.ts';

const TIER_LABEL: Record<'premier' | 'second', string> = {
  premier: '顶级联赛',
  second: '次级联赛',
};

// 金额口径与球员库一致（身价/工资都以「m」为单位存储）
function money(x: number): string {
  return `${x.toFixed(2)} m`;
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

// 结构分析柱状图：CSS 自绘（不引图表库）。轨道 flex:1 + min-width:0，条形宽度按百分比给，
// 所以窄屏只会把轨道压短，不会把条形挤出容器。
// 语义上用 <ul> 而不是 role="img"：role="img" 会把整棵子树当装饰，档位标签与人数就读不到了。
// 条形本身纯装饰（aria-hidden），数据由「标签 + 人数」两段文字承载。
function BandChart({ bands, ariaLabel }: { bands: ClubBand[]; ariaLabel: string }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <ul className="band-chart" aria-label={ariaLabel}>
      {bands.map((b) => (
        <li className="band-row" key={b.key}>
          <span className="band-label">{b.label}</span>
          <span className="band-track" aria-hidden="true">
            <span className="band-bar" style={{ width: `${(b.count / max) * 100}%` }} />
          </span>
          <span className="band-count mono">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="club-stat">
      <dt>{label}</dt>
      <dd className="mono">
        {value}
        {hint !== undefined && <span className="muted"> {hint}</span>}
      </dd>
    </div>
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
                  <Link to={`/players/${t.playerId}`}>{t.playerName ?? '未知球员'}</Link>
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
        <dl className="club-stats">
          <Stat
            label="阵容人数"
            value={`${squad.senior} 人`}
            hint={squad.trainee > 0 ? `+ ${squad.trainee} 青训` : undefined}
          />
          <Stat label="平均 CA" value={num1(squad.avgCa)} />
          <Stat label="最高 CA" value={num1(squad.maxCa)} />
          <Stat label="平均 PA" value={num1(squad.avgPa)} />
          <Stat label="平均成长空间" value={num1(squad.avgGrowth)} />
          <Stat label="总身价" value={money(squad.totalValue)} />
          <Stat label="工资总额" value={money(squad.totalWage)} />
          <Stat label="平均工资" value={squad.avgWage === null ? '—' : money(squad.avgWage)} />
          <Stat label="银徽章" value={`${squad.badgesSilver} 枚`} />
          <Stat label="金徽章" value={`${squad.badgesGold} 枚`} />
        </dl>

        <div className="club-sub">
          <h4>位置分布</h4>
          {squad.byPosition.length === 0 ? (
            <p className="muted club-sub-empty">队里还没有人。</p>
          ) : (
            <div className="club-pos-chips">
              {squad.byPosition.map((p) => (
                <span className="club-pos-chip" key={p.position}>
                  <span className="club-pos-chip-name">{p.position}</span>
                  <span className="mono">{p.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="club-sub">
          <h4>年龄结构</h4>
          <BandChart bands={squad.byAge} ariaLabel="年龄分档人数" />
        </div>

        <div className="club-sub">
          <h4>CA 结构</h4>
          <BandChart bands={squad.byCa} ariaLabel="CA 分档人数" />
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
                          <Link to={`/players/${p.id}`}>{p.name}</Link>
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
        <dl className="club-stats">
          <Stat label="在册合同" value={`${contracts.signed} 份`} />
          <Stat label="保护期内" value={`${contracts.protectedCount} 人`} />
          <Stat label="未保护" value={`${contracts.unprotected} 人`} />
          <Stat label="平均效力" value={seasons(contracts.avgYears)} />
        </dl>

        <div className="club-sub">
          <h4>效力年限</h4>
          <BandChart bands={contracts.byYears} ariaLabel="效力年限分档人数" />
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
            <dl className="club-stats">
              <Stat label="名次" value={`第 ${standing.position} 名`} />
              <Stat label="场次" value={standing.played === null ? '—' : `${standing.played} 场`} />
              <Stat
                label="胜平负"
                value={`${standing.won ?? 0} / ${standing.drawn ?? 0} / ${standing.lost ?? 0}`}
              />
              <Stat
                label="进失球"
                value={`${standing.goalsFor ?? 0} : ${standing.goalsAgainst ?? 0}`}
              />
              <Stat
                label="积分"
                value={standing.pts === null ? '—' : `${standing.pts}`}
                hint={
                  standing.pointsDeducted !== null && standing.pointsDeducted > 0
                    ? `（扣 ${standing.pointsDeducted}）`
                    : undefined
                }
              />
            </dl>
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
    </div>
  );
}
