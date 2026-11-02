import { useCallback, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { useToast } from '../lib/toast';

/** 后台要引用的实体种类；词表统一，避免各处自造文案。 */
export type IdKind = '挂牌' | '出价' | '报价' | '谈判' | '转会' | '球员' | '俱乐部' | '工单';

/** 灰色 `#123` 文本按钮：点一下复制编号（v6.68.0 期 A）。
 *
 *  存在的意义是「UI 上能读到 ID，不用先去别处查」——管理动作里所有需要填 ID
 *  的地方，都能从列表行里直接复制。不是权限展示，编号本身随各列表可见。
 */
export function IdTag({ kind, value, className }: { kind: IdKind; value: number | string; className?: string }) {
  const { show, toastNode } = useToast();
  const [failed, setFailed] = useState(false);

  const onClick = useCallback(async () => {
    const ok = await copyText(String(value));
    setFailed(!ok);
    show(ok ? `已复制 ${kind} #${value}` : `复制失败，请手动选择 #${value}`, !ok);
  }, [kind, value, show]);

  return (
    <>
      <button
        type="button"
        className={`id-tag${failed ? ' failed' : ''}${className ? ` ${className}` : ''}`}
        title={`点击复制${kind} #${value}`}
        aria-label={`${kind} #${value}，点击复制`}
        onClick={onClick}
      >
        #{value}
      </button>
      {toastNode}
    </>
  );
}
