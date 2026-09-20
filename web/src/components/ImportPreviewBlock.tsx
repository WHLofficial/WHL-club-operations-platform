// 导入预览共享块（增量 15 commit 4）：统计卡 + 错误/警告表 + 抽样表，A/B/C 三通道同构部分收编于此。
// 抽样列由调用方传入（通道间列不同），统计卡文案可覆盖（通道 C 是「新建/认领」）；
// 换版统计（成长中球员/将清零经验）与警告表只在服务端给出时渲染（增量 22）。
import type { ReactNode } from 'react';

interface PreviewLike<S> {
  stats: {
    total: number;
    valid: number;
    error: number;
    insertEstimate: number;
    updateEstimate: number;
    warning?: number;
    growthPlayers?: number;
    xpToWipe?: number;
  };
  errors: { row: number; field: string; message: string }[];
  warnings?: { row: number; field: string; message: string }[];
  samples: S[];
}

export interface SampleColumn<S> {
  label: string;
  render: (s: S) => ReactNode;
  num?: boolean; // 加 num 对齐
  mono?: boolean;
}

interface ImportPreviewBlockProps<S> {
  preview: PreviewLike<S>;
  sampleKey: (s: S) => string | number;
  sampleColumns: SampleColumn<S>[];
  insertLabel?: string; // 缺省「新增预估」
  updateLabel?: string; // 缺省「覆盖预估」
}

export default function ImportPreviewBlock<S>({ preview, sampleKey, sampleColumns, insertLabel = '新增预估', updateLabel = '覆盖预估' }: ImportPreviewBlockProps<S>) {
  const hasErrors = preview.stats.error > 0;
  return (
    <>
      <div className="preview-stats">
        <div className="club-stat">
          <span className="stat-label">总行数</span>
          <span className="stat-value mono">{preview.stats.total}</span>
        </div>
        <div className="club-stat">
          <span className="stat-label">有效</span>
          <span className="stat-value mono">{preview.stats.valid}</span>
        </div>
        <div className="club-stat">
          <span className="stat-label">错误</span>
          <span className={`stat-value mono${hasErrors ? ' bad-text' : ''}`}>{preview.stats.error}</span>
        </div>
        {preview.stats.warning !== undefined && (
          <div className="club-stat">
            <span className="stat-label">警告</span>
            <span className={`stat-value mono${preview.stats.warning > 0 ? ' bad-text' : ''}`}>{preview.stats.warning}</span>
          </div>
        )}
        <div className="club-stat">
          <span className="stat-label">{insertLabel}</span>
          <span className="stat-value mono">{preview.stats.insertEstimate}</span>
        </div>
        <div className="club-stat">
          <span className="stat-label">{updateLabel}</span>
          <span className="stat-value mono">{preview.stats.updateEstimate}</span>
        </div>
      </div>
      {preview.stats.growthPlayers !== undefined && preview.stats.growthPlayers > 0 && (
        <div className="banner info">
          换版影响：成长中的球员 {preview.stats.growthPlayers} 人。
          {(preview.stats.xpToWipe ?? 0) > 0
            ? `当前按大换版执行：这些人的成长经验合计 ${preview.stats.xpToWipe} 将清零，成长 CA 与徽章各保留 1/3（向上取整）。`
            : '小换版成长全保留，CA 增量随新源值平移。'}
        </div>
      )}
      {hasErrors && <div className="banner bad">还有 {preview.stats.error} 行没通过校验，修正源文件后再来。</div>}
      {preview.errors.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">行号</th>
                <th>字段</th>
                <th>问题</th>
              </tr>
            </thead>
            <tbody>
              {preview.errors.slice(0, 50).map((e, i) => (
                <tr key={`${e.row}-${e.field}-${i}`}>
                  <td className="num mono">{e.row}</td>
                  <td className="mono">{e.field}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(preview.stats.warning ?? 0) > 0 && (preview.warnings?.length ?? 0) > 0 && (
        <>
          <h3>警告（不挡落库，落库前扫一眼）</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">行号</th>
                  <th>字段</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {preview.warnings!.slice(0, 50).map((e, i) => (
                  <tr key={`${e.row}-${e.field}-${i}`}>
                    <td className="num mono">{e.row}</td>
                    <td className="mono">{e.field}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {preview.samples.length > 0 && (
        <>
          <h3>抽样</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {sampleColumns.map((c) => (
                    <th key={c.label} className={c.num ? 'num' : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.samples.map((s) => (
                  <tr key={sampleKey(s)}>
                    {sampleColumns.map((c) => (
                      <td key={c.label} className={`${c.num ? 'num ' : ''}${c.mono ? 'mono' : ''}`.trim() || undefined}>
                        {c.render(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
