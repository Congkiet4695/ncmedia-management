import { create } from 'zustand';

/**
 * Store UI toàn cục (ví dụ minh hoạ pattern Zustand).
 * Store nghiệp vụ (auth, org...) sẽ bổ sung theo module — chưa implement.
 */
interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
