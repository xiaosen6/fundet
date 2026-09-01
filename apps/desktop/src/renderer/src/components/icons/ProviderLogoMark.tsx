/**
 * 供应商单色官方 Logo（Cindy ProviderLogoMark 同源 path）。
 * 未知厂牌回落为首字母描边方盒。
 */
import { cn } from '../../lib/cn';
import {
  PROVIDER_LOGO_PATHS,
  providerMonogram,
  resolveVendorKind,
  type ProviderLogoKind,
} from '../../lib/providerBranding';
import { AnthropicMark } from './AnthropicMark';
import { OpenAIMark } from './OpenAIMark';

export interface ProviderLogoMarkProps {
  providerId?: string;
  name?: string;
  baseUrl?: string;
  modelId?: string;
  size?: number;
  className?: string;
}

export function ProviderLogoMark({
  providerId,
  name,
  baseUrl,
  modelId,
  size = 14,
  className,
}: ProviderLogoMarkProps): React.JSX.Element {
  const kind = resolveVendorKind({ providerId, name, baseUrl, modelId });
  if (kind === 'anthropic') return <AnthropicMark size={size} className={className} />;
  if (kind === 'openai') return <OpenAIMark size={size} className={className} />;
  if (kind && kind !== 'xd' && Object.prototype.hasOwnProperty.call(PROVIDER_LOGO_PATHS, kind)) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden
      >
        <path d={PROVIDER_LOGO_PATHS[kind as keyof typeof PROVIDER_LOGO_PATHS]} fill="currentColor" />
      </svg>
    );
  }
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[4px] border border-current font-semibold leading-none',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.62)) }}
      aria-hidden
    >
      {providerMonogram(name || modelId || '?')}
    </span>
  );
}

export type { ProviderLogoKind };
