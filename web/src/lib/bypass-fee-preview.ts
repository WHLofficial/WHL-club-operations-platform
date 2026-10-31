// 旁路费用预览（v6.63.3）：解约确认面板与海捞表单在确认前给教练看的费用数字，
// 全部派生自 src/core 的同名规则（单一出处，不在此复制公式）；服务端提交时仍按
// 同一函数实算并重做资金预检，这里的数字只负责「确认前让人看见要花多少」。
import { freeAgentFee, terminationFee } from '../../../src/core/bypass-rules.ts';

/**
 * 解约费预览（规则 4.4.4）：违约金 ×（3 − 效力赛季数）× 10%，效力满 3 赛季免费（0）。
 * core terminationFee 按窗刻度取效力（1 常规窗 = 0.5 赛季），详情 / 名册下发的
 * serviceSeasons 已是赛季数 —— ×2 还原成已关常规窗数差，签约基数取 0（函数只用两者之差）。
 * 违约金缺失 / 非正、效力缺失回 null：调用侧整段退回公式文案，不冒充免费。
 */
export function terminationFeePreview(
  releaseFee: number | null,
  serviceSeasons: number | null,
): number | null {
  if (releaseFee === null || !Number.isFinite(releaseFee) || releaseFee <= 0) return null;
  if (serviceSeasons === null || !Number.isFinite(serviceSeasons)) return null;
  return terminationFee(releaseFee, 0, serviceSeasons * 2);
}

/** 海捞费预览（规则 4.4.3）：新违约金 × 30%。输入草稿空 / 非数 / 非正回 null。 */
export function freeAgentFeePreview(newReleaseFeeDraft: string): number | null {
  const n = Number(newReleaseFeeDraft);
  if (newReleaseFeeDraft.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  return freeAgentFee(n);
}
