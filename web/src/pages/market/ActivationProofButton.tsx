// 激活凭证按钮（v6.68.2 期 C，Q12 裁决）：只给「这单挂牌的卖方 + 管理员」看。
//
// 为什么按钮自己探一次而不是由父组件传 hasProof：挂牌的公开 feed 故意不下发凭证字段
// （它是匿名端点），所以前端唯一能知道「有没有凭证」的办法就是问一次受权限保护的端点。
// 未登录 / 不是卖方 / 这单没有凭证都返回非 200 —— 这里一律安静不渲染，
// 不把 403 变成页面上的一条红字（卖方在自己页面上看到「无权查看」只会更困惑）。
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

export default function ActivationProofButton({ listingId, label = '凭证' }: { listingId: number; label?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    api<{ url: string }>(`/api/market/listings/${listingId}/proof`)
      .then((r) => {
        if (alive) setUrl(r.url);
      })
      .catch(() => {
        /* 没权限或没凭证：不显示按钮 */
      });
    return () => {
      alive = false;
    };
  }, [listingId]);

  if (url === null) return null;
  return (
    <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}
