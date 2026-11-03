// 转会台深链提示（v6.73.0 期 B）：?player= 指向的球员不在当前页签时，给出另外两个页签的入口，
// 不静默丢人。三个区块共用这一份文案，避免各写一套。
import { Fragment } from 'react';
import { Link } from 'react-router';

const LABEL: Record<'nego' | 'offers' | 'bids', string> = {
  nego: '签约谈判',
  offers: '报价',
  bids: '我的出价',
};

export default function DeskFocusHint({
  playerId,
  current,
}: {
  playerId: number;
  current: 'nego' | 'offers' | 'bids';
}) {
  const others = (['bids', 'offers', 'nego'] as const).filter((t) => t !== current);
  return (
    <p className="banner warn desk-focus-hint" role="status">
      这名球员不在本页签，可能已结束。去{' '}
      {others.map((t, i) => (
        <Fragment key={t}>
          {i > 0 && ' / '}
          <Link to={`/market/desk?tab=${t}&player=${playerId}`}>{LABEL[t]}</Link>
        </Fragment>
      ))}{' '}
      看看。
    </p>
  );
}
