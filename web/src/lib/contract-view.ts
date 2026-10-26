// 双版本合同（v6.54.0 步骤 7）的纯格式化层：不碰 React、不做 IO，便于直接测。
// 口径（设计 §10.4「格式约定」）：
//   桌面行内小字 = `(+1.20)3.70`（差额在前，方便与 current 主值比）；
//   窄屏第三行   = `3.70(+1.20)`（新值在前，读起来像完整合同值）；
//   两套格式不混用；小字不写「关窗后」「免费」，这类信息只在完整合同卡/确认弹窗里说。
import type { ContractAppliedNotice, ContractPendingView } from './api.ts';

export type PendingSource = ContractPendingView['source'];

/** 来源徽标文案（与收件箱五态卡同词） */
export const PENDING_SOURCE_LABEL: Record<PendingSource, string> = {
  demand: '球员要求',
  renewal: '普通续约',
  rejection: '保护期调整',
};

/** 两位小数（金额口径统一） */
export function fmt2(x: number): string {
  return (Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** 去掉无意义的尾零（违约金多为整数：25 而不是 25.00） */
export function fmtShort(x: number): string {
  return String(Math.round((x + Number.EPSILON) * 100) / 100);
}

/** 带符号差额：+1.20 / -0.30 / 0.00 */
export function delta2(delta: number): string {
  const v = Math.round((delta + Number.EPSILON) * 100) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** 带符号差额（违约金，去尾零）：+5 / -2.5 / 0 */
export function deltaShort(delta: number): string {
  const v = Math.round((delta + Number.EPSILON) * 100) / 100;
  return `${v > 0 ? '+' : ''}${fmtShort(v)}`;
}

/**
 * 桌面工资小字：`(+1.20)3.70`。无待生效工资或与现行相同 ⇒ null（不渲染第二行）。
 * current 为空（无合同）时也不渲染——没有可比的旧值。
 */
export function pendingWageSmall(current: number | null, next: number | null | undefined): string | null {
  if (current === null || next === null || next === undefined) return null;
  if (Math.abs(next - current) < 0.005) return null;
  return `(${delta2(next - current)})${fmt2(next)}`;
}

/** 桌面违约金小字：`(+5)25`。releaseFee 待生效值为 null = 不变 ⇒ null */
export function pendingFeeSmall(current: number | null, next: number | null | undefined): string | null {
  if (current === null || next === null || next === undefined) return null;
  if (Math.abs(next - current) < 0.005) return null;
  return `(${deltaShort(next - current)})${fmtShort(next)}`;
}

/** 窄屏第三行（新值在前）：`工资 3.70(+1.20) · 违约金 25(+5)`；无任何变化 ⇒ null */
export function pendingNarrowText(row: {
  wage: number | null;
  pendingWage?: number | null;
  releaseFee?: number | null;
  pendingReleaseFee?: number | null;
}): string | null {
  const parts: string[] = [];
  const wage = row.pendingWage;
  if (row.wage !== null && wage !== null && wage !== undefined && Math.abs(wage - row.wage) >= 0.005) {
    parts.push(`工资 ${fmt2(wage)}(${delta2(wage - row.wage)})`);
  }
  const fee = row.pendingReleaseFee;
  const feeCurrent = row.releaseFee ?? null;
  if (feeCurrent !== null && fee !== null && fee !== undefined && Math.abs(fee - feeCurrent) >= 0.005) {
    parts.push(`违约金 ${fmtShort(fee)}(${deltaShort(fee - feeCurrent)})`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * 保护期文案：`至第 N 窗` / `已结束` / `无保护期`。
 * `protectedNow` 只用于现行列——服务端已判好布尔，ticks 只作展示刻度。
 */
export function protectionText(ticks: number | null, protectedNow?: boolean): string {
  if (ticks === null) return '无保护期';
  if (protectedNow === false || ticks === 0) return '已结束';
  return `至第 ${ticks} 窗`;
}

/** 已生效小字（§10.4）：有旧工资就写出来；普通续约审批单不存旧值，退化为不带数字的版本 */
export function appliedNoticeText(applied: ContractAppliedNotice): string {
  return applied.oldWage === null
    ? '新合同已生效 · 本窗工资仍按旧值结算，下一窗起按新数字扣。'
    : `新合同已生效 · 本窗工资已按旧值 ${fmt2(applied.oldWage)}m 结算，下一窗起按新数字扣。`;
}

/** 可访问性长句（每行 aria-label，§10.4 规则 9） */
export function contractRowAria(label: string, current: string, next: string | null): string {
  return next === null ? `${label} ${current}` : `${label}当前 ${current}；待生效 ${next}，窗口关闭后生效`;
}
