import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.ts';
import longmaLogo from '../assets/logo.png';
import fundetLogo from '../assets/logo-fundet.png';

const isFundet = brand.id === 'fundet';
const logoUrl = isFundet ? fundetLogo : longmaLogo;
// 未灵（fundet）logo 为正方形圆形图（512×512）；LongMa 旧图 581×567
const aspect = isFundet ? 1 : 581 / 567;

interface BrandMarkProps {
  /** 图形高度；宽度按原图比例 */
  size?: number;
  className?: string;
}

/** 品牌图形（未灵：圆形透明底 PNG；深浅色都能叠） */
export function BrandMark({ size = 22, className }: BrandMarkProps): React.JSX.Element {
  return (
    <img
      src={logoUrl}
      alt=""
      width={Math.round(size * aspect)}
      height={size}
      draggable={false}
      className={cn('shrink-0 select-none', className)}
    />
  );
}
