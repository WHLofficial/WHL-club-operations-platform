// v6.49.0 教练侧闸门的纯逻辑与单例取数：五态→能不能点/为什么不能点，以及「全站 60s 一次」。
// 渲染层（置灰 + 提示条 + 读秒）由各页面的组件测试覆盖，这里只锁口径。
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('./api.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./api.ts')>();
  return { ...mod, api: apiMock };
});

import { opsGateOf, opsScheduleSnapshot, refreshOpsSchedule, resetOpsSchedule, type OpsGate } from './ops-gate.ts';
import type { OpsScheduleView, OpsStatusRow } from './api.ts';

function row(over: Partial<OpsStatusRow>): OpsStatusRow {
  return {
    key: 'transfer_listing',
    label: '挂牌竞价',
    group: 'transfer',
    desc: '',
    startAnchor: 'none',
    startAt: null,
    endAnchor: 'none',
    endAt: null,
    requiresWindow: true,
    closeInflight: false,
    note: '',
    state: 'open',
    stateLabel: '进行中',
    resolvedStartAt: null,
    resolvedEndAt: null,
    endIsWindowClose: false,
    ...over,
  };
}

function view(rows: OpsStatusRow[]): OpsScheduleView {
  return { now: '2026-10-14T12:00:00.000Z', window: null, rows };
}

beforeEach(() => {
  apiMock.mockReset();
  resetOpsSchedule();
});

describe('opsGateOf（五态 → 闸门）', () => {
  it('未开始 ⇒ 挡住，文案是「还没开始」', () => {
    const gate = opsGateOf(view([row({ state: 'not_started', resolvedStartAt: '2026-10-15T04:00:00.000Z' })]), 'transfer_listing') as OpsGate;
    expect(gate.blocked).toBe(true);
    expect(gate.hint).toBe('挂牌竞价还没开始');
    expect(gate.deadlineAt).toBeNull();
  });

  it('已结束（随关窗止且窗口已关）⇒ 挡住，文案点出窗口', () => {
    const gate = opsGateOf(
      view([row({ state: 'closed', endAnchor: 'window_close', endIsWindowClose: true })]),
      'transfer_listing',
    ) as OpsGate;
    expect(gate.blocked).toBe(true);
    expect(gate.hint).toBe('挂牌竞价已结束（转会窗口已关）');
  });

  it('已结束（具体时间止）⇒ 挡住，文案不点窗口', () => {
    const gate = opsGateOf(
      view([row({ state: 'closed', endAnchor: 'absolute', endIsWindowClose: false, resolvedEndAt: '2026-10-14T10:00:00.000Z' })]),
      'transfer_listing',
    ) as OpsGate;
    expect(gate.blocked).toBe(true);
    expect(gate.hint).toBe('挂牌竞价已结束');
  });

  it('进行中且终点是具体时间 ⇒ 不挡，带读秒锚', () => {
    const gate = opsGateOf(
      view([row({ state: 'open', endAnchor: 'absolute', resolvedEndAt: '2026-10-16T04:00:00.000Z' })]),
      'transfer_listing',
    ) as OpsGate;
    expect(gate.blocked).toBe(false);
    expect(gate.deadlineAt).toBe('2026-10-16T04:00:00.000Z');
  });

  it('进行中但随关窗止 / 不限制 ⇒ 不挡，无读秒锚', () => {
    for (const r of [row({ state: 'open', endAnchor: 'window_close', endIsWindowClose: true }), row({ state: 'unrestricted' })]) {
      const gate = opsGateOf(view([r]), 'transfer_listing') as OpsGate;
      expect(gate.blocked).toBe(false);
      expect(gate.deadlineAt).toBeNull();
    }
  });

  it('视图未加载 / 键不存在 ⇒ null（调用方不禁用）', () => {
    expect(opsGateOf(null, 'transfer_listing')).toBeNull();
    expect(opsGateOf(undefined, 'transfer_listing')).toBeNull();
    expect(opsGateOf(view([row({})]), 'transfer_sea_open')).toBeNull();
  });
});

describe('单例取数（全站一份、60s 一次）', () => {
  it('首次订阅拉一次，TTL 内不再拉；force 与 reset 后可再拉', async () => {
    apiMock.mockResolvedValue(view([row({})]));
    await refreshOpsSchedule();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/api/ops-schedule');
    expect(opsScheduleSnapshot()?.rows).toHaveLength(1);

    await refreshOpsSchedule();
    expect(apiMock).toHaveBeenCalledTimes(1);

    await refreshOpsSchedule(true);
    expect(apiMock).toHaveBeenCalledTimes(2);

    resetOpsSchedule();
    expect(opsScheduleSnapshot()).toBeNull();
    await refreshOpsSchedule();
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it('并发调用只发一次请求（inflight 合流）', async () => {
    apiMock.mockResolvedValue(view([row({})]));
    await Promise.all([refreshOpsSchedule(), refreshOpsSchedule(), refreshOpsSchedule()]);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('取不到 ⇒ 快照保持 null，不抛（真闸在服务端）', async () => {
    apiMock.mockRejectedValue(new Error('网络炸了'));
    await expect(refreshOpsSchedule()).resolves.toBeUndefined();
    expect(opsScheduleSnapshot()).toBeNull();
    expect(opsGateOf(opsScheduleSnapshot(), 'transfer_listing')).toBeNull();
  });
});
