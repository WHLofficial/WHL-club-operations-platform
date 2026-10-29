// 激活通知截图弹窗（v6.60.0）：先讲清合格标准，再让玩家选图预览，确认后才上传。
// 两个激活入口（转会市场激活页 / 球员页 SideOps）共用，避免文案与校验各写一份。
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FALLBACK_EXAMPLE =
  '国际米兰主教练您好，我是利物浦主教练，我方即将激活您的球员「阿切尔比」，请在竞价结束后根据规则选择是否匹配。';

export type ActivationProofDialogProps = {
  playerName: string;
  opponentClubName?: string | null;
  myClubName?: string | null;
  onClose: () => void;
  onConfirm: (file: File) => Promise<void>;
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function checkFile(file: File): string | null {
  if (file.size === 0) return '截图是空的，换一张试试';
  if (!ALLOWED_TYPES.has(file.type.toLowerCase())) return '只支持 png、jpg、webp 图片';
  if (file.size > MAX_PROOF_BYTES) return '截图超过 5MB，压缩后再传';
  return null;
}

export function ActivationProofDialog({
  playerName,
  opponentClubName,
  myClubName,
  onClose,
  onConfirm,
}: ActivationProofDialogProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 预览地址只在当前文件生命周期内有效；换图或卸载都要释放，避免手机端内存里堆图。
  useEffect(() => {
    if (file === null || typeof URL.createObjectURL !== 'function') {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (submitting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  // 打开时焦点落在可操作区；选完图后直接落在「确认激活」，键盘用户少走一步。
  useEffect(() => {
    if (file === null) dropRef.current?.focus();
    else confirmRef.current?.focus();
  }, [file]);

  function acceptFile(next: File | undefined) {
    if (!next) return;
    const problem = checkFile(next);
    if (problem !== null) {
      setFile(null);
      setError(problem);
      return;
    }
    setFile(next);
    setError(null);
  }

  function openPicker() {
    if (submitting) return;
    inputRef.current?.click();
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    if (submitting) return;
    acceptFile(e.dataTransfer.files?.[0]);
  }

  async function confirm() {
    if (file === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败，请重试');
      setSubmitting(false);
    }
  }

  const example =
    myClubName && myClubName.trim() !== ''
      ? `${opponentClubName ?? '对方俱乐部'}主教练您好，我是${myClubName}主教练，我方即将激活您的球员「${playerName}」，请在竞价结束后根据规则选择是否匹配。`
      : FALLBACK_EXAMPLE;

  return (
    <div className="modal-mask" onClick={submitting ? undefined : onClose}>
      <div
        className="modal-card card proof-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title" id={titleId}>
          上传激活通知截图
        </h3>
        <p className="side-sub">激活前，先在 QQ 私信对方主教练，再把通知截图传上来。</p>

        <div className="proof-checklist">
          <p>截图里要看清三样：</p>
          <ul>
            <li>你的俱乐部名</li>
            <li>球员名</li>
            <li>一句提醒：竞价结束后请选择是否匹配</li>
          </ul>
        </div>

        <details className="proof-example">
          <summary>看一条示例</summary>
          <p>{example}</p>
        </details>

        {file !== null ? (
          <div className="proof-preview">
            {previewUrl !== null && <img src={previewUrl} alt="激活通知截图预览" />}
            <div className="proof-preview-meta">
              <span className="proof-preview-name">{file.name}</span>
              <span className="proof-preview-size">{formatSize(file.size)}</span>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" disabled={submitting} onClick={openPicker}>
              重新选择
            </button>
          </div>
        ) : (
          <button
            ref={dropRef}
            type="button"
            className={dragOver ? 'proof-drop over' : 'proof-drop'}
            disabled={submitting}
            onClick={openPicker}
            onDragOver={(e) => {
              e.preventDefault();
              if (!submitting) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <span className="proof-drop-main">把截图拖到这里，或点此选择文件</span>
            <span className="proof-drop-hint">png、jpg、webp，最大 5MB</span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          className="proof-file-input"
          accept="image/png,image/jpeg,image/webp"
          aria-label="选择激活通知截图"
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = '';
            acceptFile(next);
          }}
        />

        {error !== null && (
          <p className="proof-error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <button type="button" className="btn btn-sm btn-ghost" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button ref={confirmRef} type="button" className="btn btn-sm" disabled={file === null || submitting} onClick={confirm}>
            {submitting ? '提交中…' : '确认激活'}
          </button>
        </div>
      </div>
    </div>
  );
}
