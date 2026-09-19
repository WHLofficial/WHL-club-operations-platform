// 导入预览共享块（增量 15 commit 4）：统计卡 + 错误表 + 抽样表，A/B/C 三通道同构部分收编于此。
// 抽样列由调用方传入（通道间列不同），统计卡文案可覆盖（通道 C 是「新建/认领」）。
import type { ReactNode } from 'react';

interface PreviewLike<S> {
  stats: { total: number; valid: number; error: number; insertEstimate: number; updateEstimate: number };
  errors: { row: number; field: string; message: string }[];
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
        <div className="club-stat">
          <span className="stat-label">{insertLabel}</span>
          <span className="stat-value mono">{preview.stats.insertEstimate}</span>
        </div>
        <div className="club-stat">
          <span className="stat-label">{updateLabel}</span>
          <span className="stat-value mono">{preview.stats.updateEstimate}</span>
        </div>
      </div>
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
