import { create } from 'zustand';
import { type TabId } from "@/components/layout/BottomNav";

interface GameState {
  // Navigation
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  // Initialization & Player
  isReady: boolean;
  setReady: (ready: boolean) => void;
  playerId: string | null;
  setPlayerId: (id: string | null) => void;
}

export const useGameStore = create<GameState>((set) => ({
  // Navigation
  activeTab: 'game',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Initialization & Player
  isReady: false,
  setReady: (ready) => set({ isReady: ready }),
  playerId: null,
  setPlayerId: (id) => set({ playerId: id }),
}));
