// 战绩组页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 战绩组搬入，访客与自家都可见）。
// 排名来自常驻的 useClubStanding（取不到时后端回 200 + note，这里只负责把 note 显示出来），
// 近期战绩来自 useClubDetail —— 本组件不发新请求。
import type { ClubFormRow, ClubStanding } from '../../lib/api.ts';
import { DetailLine, FormRow, HeroStat } from './parts.tsx';

export default function ResultsTab({
  standing,
  standingNote,
  form,
}: {
  standing: ClubStanding['standing'];
  standingNote: string | null;
  form: { recent: ClubFormRow[]; wins: number; draws: number; losses: number };
}) {
  return (
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
  );
}
