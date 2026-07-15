'use client';

import { useEffect, useState } from 'react';

/**
 * Trả về true sau khi component đã mount ở client.
 * Dùng để tránh hydration mismatch cho nội dung phụ thuộc client.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
