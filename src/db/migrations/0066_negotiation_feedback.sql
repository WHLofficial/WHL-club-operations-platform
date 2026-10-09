-- v6.40.0 签约谈判对话式：逐轮经纪人反馈落库。
--
-- 语义（2026-10-09 设计稿 §7 + 用户裁决「甲」）：原来只有「最新失败轮」的满意度句在读列表时现算，
-- 逐轮反馈不落库，对话流只能画出我方报价一半。本迁移把每轮经纪人的反应句与风险布尔随 attempt 落库，
-- 供前端把每一轮画成左侧气泡；判定公式、概率、轮次规则一律不动（拒绝语义 R1 = 规则不动）。
-- feedback 存的是已成品句（satisfactionText 结果 + 可选「（报价过低，有谈崩风险）」后缀），
-- 与 lastSatisfaction 读时现算的口径逐字一致。
--
-- 回填：旧行 feedback 保持 NULL、risk 归 0；前端把 NULL 当「无反馈」处理（历史轮次只显示轮次/报价/结果）。
--
-- 回滚：ALTER TABLE 不便回滚，附加列保留不影响旧代码（旧 SELECT 不引用新列即行为不变）。
ALTER TABLE negotiation_attempts ADD COLUMN feedback TEXT;
ALTER TABLE negotiation_attempts ADD COLUMN risk INTEGER NOT NULL DEFAULT 0;
