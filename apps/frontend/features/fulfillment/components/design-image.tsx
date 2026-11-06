'use client';

import { getImageProps } from 'next/image';
import { useState } from 'react';
import { isOptimizableDesignUrl } from '../design-image-source';

const STORAGE_PUBLIC_URLS = process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URLS;

interface DesignImageProps {
  /** `fileUrl` của design: file in gốc. Bấm mở bộ xem ảnh vẫn dùng file này. */
  src: string;
  /** Bản thu nhỏ tạo sẵn lúc lưu file. NULL với design chưa được bổ sung. */
  thumbnailUrl?: string | null;
  alt: string;
  /** Cỡ hiển thị (px), để bộ tối ưu của Next tạo đúng cỡ khi chưa có bản thu nhỏ. */
  size: number;
  className?: string;
  loading?: 'lazy' | 'eager';
}

type Stage = 'THUMBNAIL' | 'OPTIMIZED' | 'ORIGINAL';

/**
 * Ảnh xem trước của design, KHÔNG tải file in khi còn đường khác.
 *
 * 🔴 File in trung bình 17 MB, lớn nhất gần 100 MB. Dùng thẳng làm ảnh 36px thì mỗi ô phải tải và giải mã cả file; qua bộ
 * tối ưu của Next thì server vẫn phải tải cả file ở lần đầu. Bản thu nhỏ tạo sẵn chỉ vài chục KB và không tốn gì của server.
 *
 * Mỗi bước lỗi ⇒ sang bước sau đúng một lần, ảnh vẫn hiện: thumbnail → bộ tối ưu của Next → file gốc.
 */
export function DesignImage({ src, thumbnailUrl, alt, size, className, loading }: DesignImageProps) {
  const sourceKey = `${thumbnailUrl ?? ''}|${src}`;
  const [failed, setFailed] = useState<{ key: string; stages: Stage[] }>({ key: sourceKey, stages: [] });
  const failedStages = failed.key === sourceKey ? failed.stages : [];
  const fail = (stage: Stage) => setFailed({ key: sourceKey, stages: [...failedStages, stage] });

  if (thumbnailUrl && !failedStages.includes('THUMBNAIL')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailUrl}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
        onError={() => fail('THUMBNAIL')}
      />
    );
  }

  if (isOptimizableDesignUrl(src, STORAGE_PUBLIC_URLS) && !failedStages.includes('OPTIMIZED')) {
    const { props } = getImageProps({ src, alt, width: size, height: size, quality: 75, loading });
    // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element -- `alt` nằm trong `props`.
    return <img {...props} className={className} onError={() => fail('OPTIMIZED')} />;
  }

  // Host không thuộc Storage nên không qua được next/image, hoặc mọi bước trên đã lỗi.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading={loading} decoding="async" />;
}
