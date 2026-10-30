// @vitest-environment jsdom
// v6.54.0 步骤 7 · ContractDualView 聚焦测试（设计 §10.4）：
// - 待生效双列：变化行带 +Δ、未变行降权保留、底部旧 RC 警告
// - 公开/他队视角（ownerView=false）：即使误传 pending 也只画现行列
// - 已生效态：单列新值 + 首窗小字
// - 无 pending：单列，不出现「待生效」
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContractDto, ContractPendingView } from '../lib/api.ts';
import { ContractDualView } from './ContractDualView.tsx';

const CONTRACT: ContractDto = {
  id: 1,
  clubId: 7,
  releaseFee: 20,
  wage: 2.5,
  contractType: 'formal',
  source: 'import',
  signedAt: '2026-07-01T00:00:00.000Z',
  effectiveFrom: '2026-07-01',
  serviceSeasons: 1.5,
  protected: true,
  protectionTicks: 9,
  signedSeason: 9,
  signedWindowSeq: 1,
};

const PENDING: ContractPendingView = {
  playerId: 7,
  playerName: '张三',
  source: 'demand',
  demandId: 3,
  wageCurrent: 2.5,
  releaseFeeCurrent: 20,
  protectionTicksCurrent: 9,
  wage: 3.7,
  releaseFee: 25,
  protectionTicks: null,
  effectiveWindowSeq: 2,
  rcFee: 0,
  freeRcChange: false,
};

afterEach(cleanup);

describe('ContractDualView（v6.54.0 §10.4）', () => {
  it('待生效：双列 + 变化行 +Δ + 未变行「不变」+ 旧 RC 警告', () => {
    render(<ContractDualView contract={CONTRACT} pending={PENDING} applied={null} ownerView />);
    expect(screen.getByText('1 份，待生效 1 版')).toBeTruthy();
    // 「当前生效」同时出现在时间箭头与表头（窄屏还有 data-label），用 getAllByText 断言存在即可
    expect(screen.getAllByText('当前生效').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('待生效（本窗关闭后）')).toBeTruthy();
    expect(screen.getByText('3.70m / 窗')).toBeTruthy();
    expect(screen.getByText('+1.20m')).toBeTruthy();
    expect(screen.getByText('25m')).toBeTruthy();
    expect(screen.getByText('+5m')).toBeTruthy();
    // 保护期/合同类型未变：保留值但弱化（这里断言「不变」文字确实在，不只靠颜色）
    expect(screen.getAllByText('不变').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/关窗前交易仍按当前违约金 20m；待生效 25m 不适用于本窗/)).toBeTruthy();
  });

  it('公开视角：ownerView=false 时只画现行列，不泄漏待生效工资/违约金', () => {
    render(<ContractDualView contract={CONTRACT} pending={PENDING} applied={null} ownerView={false} />);
    expect(screen.getByText('2.50m / 窗')).toBeTruthy();
    expect(screen.getByText('20m')).toBeTruthy();
    expect(screen.queryByText('待生效（本窗关闭后）')).toBeNull();
    expect(screen.queryByText('3.70m / 窗')).toBeNull();
    expect(screen.queryByText('25m')).toBeNull();
  });

  it('已生效态：单列新值 + 首窗旧值说明', () => {
    render(
      <ContractDualView
        contract={{ ...CONTRACT, wage: 3.7, releaseFee: 25 }}
        pending={null}
        applied={{ source: 'demand', appliedAt: '2026-10-20T00:00:00.000Z', oldWage: 2.5 }}
        ownerView
      />,
    );
    expect(screen.getByText(/新合同已生效 · 本窗工资已按旧值 2.50m 结算/)).toBeTruthy();
    expect(screen.queryByText('待生效')).toBeNull();
  });

  it('无 pending 且非教练：单列「现行」，不渲染待生效列', () => {
    render(<ContractDualView contract={CONTRACT} pending={null} applied={null} ownerView={false} />);
    expect(screen.getByText('现行')).toBeTruthy();
    expect(screen.queryByText('待生效')).toBeNull();
    expect(screen.queryByText('待生效（本窗关闭后）')).toBeNull();
  });

  it('免费续约（v6.62.0 §5.6）：freeRcChange=true 渲染「本次免费」徽标，false 不渲染', () => {
    render(<ContractDualView contract={CONTRACT} pending={{ ...PENDING, freeRcChange: true }} applied={null} ownerView />);
    expect(screen.getByText('本次免费')).toBeTruthy();

    cleanup();
    render(<ContractDualView contract={CONTRACT} pending={PENDING} applied={null} ownerView />);
    expect(screen.queryByText('本次免费')).toBeNull();
  });
});
