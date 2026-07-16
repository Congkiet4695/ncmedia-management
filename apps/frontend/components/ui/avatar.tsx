import * as React from 'react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/format';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  className?: string;
}

/** Avatar: ảnh nếu có, fallback chữ cái đầu. Không phụ thuộc Radix. */
export function Avatar({ src, name, className }: AvatarProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? 'avatar'}
        className={cn('size-9 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary',
        className,
      )}
    >
      {getInitials(name)}
    </span>
  );
}
