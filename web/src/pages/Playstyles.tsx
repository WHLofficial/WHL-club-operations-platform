// PlayStyles 图鉴（v6.69.0）：36 条基础项按 EA 六类分组，每条给出银/金图标、中英名、
// 定位句与两档效果。入口在右上角 ≡ 菜单（公开页，不挂登录门）。
// 数据三源：名称/分类 ref/playstyle.json，描述 ref/playstyle-desc.json，图标 public/assets/icons/playstyles。
import { isGkPlaystyle, playstyleDescOf, playstyleIconUrl } from '../lib/ref.ts';
import playstyleRef from '../../assets/ref/playstyle.json';

const TYPE_ORDER = ['Finishing', 'Passing', 'Defending', 'Ballcontrol', 'Physical', 'Goalkeeper'] as const;

const TYPE_LABEL: Record<string, string> = {
  Finishing: '射门',
  Passing: '传球',
  Defending: '防守',
  Ballcontrol: '控球',
  Physical: '体格',
  Goalkeeper: '门将',
};

interface Row {
  id: number;
  en: string;
  chs: string;
  type: string;
}

const BASES = (playstyleRef as Row[])
  .filter((r) => r.id > 0 && r.id < 100)
  .sort((a, b) => a.id - b.id);

function Icon({ psid, gold }: { psid: number; gold: boolean }) {
  return (
    <img
      className={`ps-icon ps-card-icon ${gold ? 'ps-icon-gold' : 'ps-icon-silver'}${isGkPlaystyle(psid) ? ' ps-icon-gk' : ''}`}
      src={playstyleIconUrl(psid)}
      alt={gold ? '金徽图标' : '银徽图标'}
      loading="lazy"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

export default function Playstyles() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>PlayStyles 图鉴</h1>
        <p className="hint">
          同一球员最多 12 枚银徽 + 3 枚金徽；金徽是同名银徽的强化版，两者互斥。图标与文案仅作玩法说明。
        </p>
      </div>
      {TYPE_ORDER.map((type) => {
        const rows = BASES.filter((r) => r.type === type);
        if (rows.length === 0) return null;
        return (
          <section key={type} className="ps-section">
            <h2>{TYPE_LABEL[type] ?? type}</h2>
            <div className="ps-card-grid">
              {rows.map((r) => {
                const desc = playstyleDescOf(r.id);
                return (
                  <article key={r.id} className="ps-card">
                    <header className="ps-card-head">
                      <span className="ps-card-icons">
                        <Icon psid={r.id} gold={false} />
                        <Icon psid={r.id + 100} gold />
                      </span>
                      <span className="ps-card-name">
                        <strong>{r.chs || r.en}</strong>
                        <span className="ps-card-en">{r.en}</span>
                      </span>
                    </header>
                    {desc === null ? (
                      <p className="hint">暂无说明。</p>
                    ) : (
                      <>
                        <p className="ps-card-info">{desc.info}</p>
                        <dl className="ps-card-effects">
                          <div>
                            <dt>🥈 银徽</dt>
                            <dd>{desc.desc}</dd>
                          </div>
                          <div>
                            <dt>🥇 金徽</dt>
                            <dd>{desc.descPlus}</dd>
                          </div>
                        </dl>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
