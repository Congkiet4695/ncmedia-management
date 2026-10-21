'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * `true` khi media query đang khớp — đọc trực tiếp `window.matchMedia`, tự cập nhật khi đổi kích thước.
 *
 * Phía server (và lúc hydrate) trả `serverValue` để markup hai phía khớp nhau; ngay sau hydrate
 * giá trị thật của trình duyệt được áp dụng.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
