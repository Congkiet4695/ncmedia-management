'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useMounted } from '@/hooks/use-mounted';
import { useThemeStore } from '@/stores/theme.store';

/** Nút bật/tắt giao diện sáng–tối. Tránh hydration mismatch bằng useMounted. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const mounted = useMounted();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('theme.toggle')}
      onClick={toggle}
      disabled={!mounted}
    >
      {mounted && theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
