import { create } from 'zustand';

const SIDEBAR_COLLAPSED_KEY = 'ncmedia-sidebar-collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // bỏ qua lỗi storage (private mode…) — chỉ mất phần ghi nhớ, thao tác vẫn chạy.
  }
}

/**
 * Store UI toàn cục.
 *
 * - `sidebarOpen`: drawer menu trên MOBILE (mở / đóng).
 * - `sidebarCollapsed`: sidebar DESKTOP thu gọn chỉ còn icon — ghi nhớ theo trình duyệt. `init()` đọc lại
 *   sau khi mount (không đọc lúc tạo store ⇒ server và lần render đầu ở client khớp nhau, không lệch hydration).
 */
interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  initSidebar: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => {
    writeCollapsed(collapsed);
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebarCollapsed: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  initSidebar: () => set({ sidebarCollapsed: readCollapsed() }),
}));
