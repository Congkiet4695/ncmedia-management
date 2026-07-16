'use client';

import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ncmedia-theme';

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // bỏ qua lỗi storage (private mode…)
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  /** Đồng bộ state với localStorage / hệ điều hành khi app khởi động. */
  init: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },
  init: () => {
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme: Theme =
      stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';
    applyTheme(theme);
    set({ theme });
  },
}));
