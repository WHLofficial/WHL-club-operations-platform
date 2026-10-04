// 转会组页签（v6.30.0 A 段：自 pages/ClubDetail.tsx 运营组搬入，访客与自家都可见）。
// 数据全部来自常驻的 useClubDetail（合同结构 + 转入/转出），本组件不发新请求。
import type { ClubContractStructure, ClubTransferRow } from '../../lib/api.ts';
import { BandChart, DetailLine, HeroStat, TransferTable, seasons } from './parts.tsx';

export default function TransfersTab({
  contracts,
  transfers,
}: {
  contracts: ClubContractStructure;
  transfers: { incoming: ClubTransferRow[]; outgoing: ClubTransferRow[] };
}) {
  return (
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
  );
}
