// 双版本合同卡（v6.54.0 步骤 7，设计 §10.4 方案 C）：
//   单卡双列（当前生效 → 待生效）+ 顶部时间箭头；变化行高亮并带 +Δ，未变行降权保留；
//   只有本队教练能看到待生效列（pending/current 的归属由服务端判，组件再兜一层 ownerView）。
// 术语纪律：只用「当前生效 / 待生效（本窗关闭后）」，禁止「旧合同 / 新合同 / pending」。
// 已生效态：单列新值 + 顶部一行小字（生效后首个窗口内），不画「因离队未生效」——
// 那件事发生在球员已离队之后，呈现面是收件箱历史行 + 站内信（§10.4 void 澄清）。
import type { ContractAppliedNotice, ContractDto, ContractPendingView } from '../lib/api.ts';
import { CONTRACT_TYPE_LABEL } from '../lib/ref.ts';
import {
  PENDING_SOURCE_LABEL,
  appliedNoticeText,
  contractRowAria,
  delta2,
  deltaShort,
  fmt2,
  fmtShort,
  protectionText,
} from '../lib/contract-view.ts';

interface RowSpec {
  key: string;
  label: string;
  current: string;
  /** 待生效值；null = 只有一列（访客/无 pending） */
  next: string | null;
  changed: boolean;
  delta: string | null;
  aria: string;
}

function rowsOf(contract: ContractDto, pending: ContractPendingView | null): RowSpec[] {
  const wageCurrent = contract.wage;
  const releaseCurrent = contract.releaseFee;
  const protectionCurrent = contract.protectionTicks ?? null;
  const typeCurrent = CONTRACT_TYPE_LABEL[contract.contractType] ?? contract.contractType;

  const wageText = wageCurrent === null ? '—' : `${fmt2(wageCurrent)}m / 窗`;
  const feeText = releaseCurrent === null ? '—' : `${fmtShort(releaseCurrent)}m`;
  const protectionTextCur = protectionText(protectionCurrent, contract.protected);

  if (pending === null) {
    return [
      { key: 'wage', label: '工资 / 窗', current: wageText, next: null, changed: false, delta: null, aria: contractRowAria('工资', wageText, null) },
      { key: 'fee', label: '违约金', current: feeText, next: null, changed: false, delta: null, aria: contractRowAria('违约金', feeText, null) },
      {
        key: 'protection',
        label: '保护期',
        current: protectionTextCur,
        next: null,
        changed: false,
        delta: null,
        aria: contractRowAria('保护期', protectionTextCur, null),
      },
      {
        key: 'type',
        label: '合同类型',
        current: typeCurrent,
        next: null,
        changed: false,
        delta: null,
        aria: contractRowAria('合同类型', typeCurrent, null),
      },
    ];
  }

  const wageChanged = wageCurrent !== null && Math.abs(pending.wage - wageCurrent) >= 0.005;
  // 从「无违约金条款」变成有限额也算变化（虽然现有写路径到不了，别留死分支）
  const feeChanged =
    pending.releaseFee !== null &&
    (releaseCurrent === null || Math.abs(pending.releaseFee - releaseCurrent) >= 0.005);
  const protectionChanged = pending.protectionTicks !== null && pending.protectionTicks !== protectionCurrent;
  const wageNext = `${fmt2(pending.wage)}m / 窗`;
  const feeNext = pending.releaseFee === null ? null : `${fmtShort(pending.releaseFee)}m`;
  const protectionNext =
    pending.protectionTicks === null ? null : protectionText(pending.protectionTicks, pending.protectionTicks !== 0);

  return [
    {
      key: 'wage',
      label: '工资 / 窗',
      current: wageText,
      next: wageNext,
      changed: wageChanged,
      // 工资差额固定两位（设计 §10.4 的 +1.20），违约金去尾零（+5）
      delta: wageChanged && wageCurrent !== null ? `${delta2(pending.wage - wageCurrent)}m` : null,
      aria: contractRowAria('工资', wageText, wageNext),
    },
    {
      key: 'fee',
      label: '违约金',
      current: feeText,
      next: feeNext ?? '不变',
      changed: feeChanged,
      delta:
        feeChanged && releaseCurrent !== null && pending.releaseFee !== null
          ? `${deltaShort(pending.releaseFee - releaseCurrent)}m`
          : null,
      aria: contractRowAria('违约金', feeText, feeNext ?? '不变'),
    },
    {
      key: 'protection',
      label: '保护期',
      current: protectionTextCur,
      next: protectionNext ?? '不变',
      changed: protectionChanged,
      delta: null,
      aria: contractRowAria('保护期', protectionTextCur, protectionNext ?? '不变'),
    },
    {
      key: 'type',
      label: '合同类型',
      current: typeCurrent,
      next: '不变',
      changed: false,
      delta: null,
      aria: contractRowAria('合同类型', typeCurrent, '不变'),
    },
  ];
}

/**
 * @param contract    现行合同（公开面唯一真源）
 * @param pending     待生效投影（仅本队教练非空）
 * @param applied     已生效首窗提示（仅本队教练）
 * @param ownerView   是否本队教练视角——false 时即使误传 pending 也只画现行列
 */
export function ContractDualView({
  contract,
  pending,
  applied,
  ownerView,
}: {
  contract: ContractDto;
  pending: ContractPendingView | null;
  applied: ContractAppliedNotice | null;
  ownerView: boolean;
}) {
  const showPending = ownerView && pending !== null;
  const rows = rowsOf(contract, showPending ? pending : null);
  return (
    <div className={showPending ? 'cv cv-has-pending' : 'cv'}>
      <div className="cv-head">
        <span className="cv-title">合同</span>
        <span className="muted cv-sub">{showPending ? '1 份，待生效 1 版' : '1 份'}</span>
      </div>
      {ownerView && applied !== null && <div className="cv-applied">✓ {appliedNoticeText(applied)}</div>}
      {showPending && (
        <div className="cv-flow">
          <span className="cv-now">当前生效</span>
          <span className="cv-arrow" aria-hidden="true">
            ────▶
          </span>
          <span className="cv-next">待生效（本窗关闭后）</span>
          <span className="cv-badge">{PENDING_SOURCE_LABEL[pending.source]}</span>
          {pending.freeRcChange && <span className="cv-badge">本次免费</span>}
          <span className="cv-badge">本窗关闭时</span>
        </div>
      )}
      {/* 窄屏保底（v6.20.0 TC-SWP-01 全树扫描）：表格必须由 .table-wrap 紧邻包裹 */}
      <div className="table-wrap">
        <table className={showPending ? 'cv-table' : 'cv-table cv-table-single'}>
          <thead>
            <tr>
              <th scope="col">项目</th>
              <th scope="col">{showPending ? '当前生效' : '现行'}</th>
              {showPending && <th scope="col">待生效</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={showPending && r.changed ? 'cv-row-chg' : showPending ? 'cv-row-dim' : ''} aria-label={r.aria}>
                <th scope="row">{r.label}</th>
                <td data-label="当前生效" className="mono">
                  {r.current}
                </td>
                {showPending && (
                  <td data-label="待生效" className="mono">
                    {r.changed ? (
                      <>
                        {r.next}
                        {r.delta !== null && <small className="cv-delta">{r.delta}</small>}
                      </>
                    ) : (
                      <span className="cv-unchanged">{r.next ?? '不变'}</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPending && (
        <p className="cv-warn">
          ⚠{' '}
          {pending!.releaseFee !== null && contract.releaseFee !== null
            ? `关窗前交易仍按当前违约金 ${fmtShort(contract.releaseFee)}m；待生效 ${fmtShort(pending!.releaseFee)}m 不适用于本窗。`
            : contract.releaseFee !== null
              ? `关窗前交易仍按当前违约金 ${fmtShort(contract.releaseFee)}m。`
              : '关窗前交易仍按现行合同；待生效条款不适用于本窗。'}
        </p>
      )}
    </div>
  );
}
