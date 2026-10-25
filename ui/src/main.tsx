import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';

import {
  useAetherStore,
  setupGlobalShortcuts,
  subscribeAetherEvents,
  refreshSharedContext,
  restoreActivePanes,
  initFreshSession,
  cleanupAllPanes,
} from './stores/aetherStore';

import { TerminalGrid } from './components/TerminalGrid';
import { TopBar } from './components/TopBar';
import { PersistentLeftSidebar } from './components/PersistentLeftSidebar';

import { OrchestratorBar } from './components/OrchestratorBar';
import { DiffGatekeeperModal } from './components/DiffGatekeeperModal';
import { TimeTravelSlider } from './components/TimeTravelSlider';
import { ObsidianSidebar } from './components/ObsidianSidebar';
import { CustomToolModal } from './components/CustomToolModal';
import { ConfirmCloseModal } from './components/ConfirmCloseModal';
import { BackgroundTasksDrawer } from './components/BackgroundTasksDrawer';
import { WorkflowsModal } from './components/WorkflowsModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { ThemeModal } from './components/ThemeModal';
import { AiSettingsModal } from './components/AiSettingsModal';
import { AiAssistantPanel } from './components/AiAssistantPanel';
import { AiApprovalModal } from './components/AiApprovalModal';

import { Radio } from 'lucide-react';

const App: React.FC = () => {
  const store = useAetherStore();

  // Map of paneId -> termWriter function
  const termWritersRef = useRef<Map<string, (data: Uint8Array | string, offset?: number) => void>>(new Map());
  // Pending PTY chunks arriving before the terminal component mounts and registers its writer
  const pendingPtyBuffersRef = useRef<Map<string, { bytes: Uint8Array; offset: number }[]>>(new Map());

  const registerTermWriter = useCallback(
    (paneId: string, writer: (data: Uint8Array | string, offset?: number) => void) => {
      termWritersRef.current.set(paneId, writer);
      // Flush any pending bytes that arrived while component was mounting
      const pending = pendingPtyBuffersRef.current.get(paneId);
      if (pending && pending.length > 0) {
        for (const chunk of pending) {
          writer(chunk.bytes, chunk.offset);
        }
        pendingPtyBuffersRef.current.delete(paneId);
      }
      return () => {
        termWritersRef.current.delete(paneId);
        pendingPtyBuffersRef.current.delete(paneId);
      };
    },
    []
  );

  useEffect(() => {
    // 1. Setup keyboard shortcuts: Ctrl+Space, Alt+M, Alt+Z, Ctrl+B, Alt+V, Alt+S, Alt+W
    const cleanupShortcuts = setupGlobalShortcuts();

    // 2. Subscribe to background events from aetherd (PTY outputs, status, ports, blackboard)
    const cleanupEvents = subscribeAetherEvents((paneId, bytes, offset = 0) => {
      const writer = termWritersRef.current.get(paneId);
      if (writer) {
        writer(bytes, offset);
      } else {
        // Buffer bytes until the pane mounts and registers its writer!
        let buf = pendingPtyBuffersRef.current.get(paneId);
        if (!buf) {
          buf = [];
          pendingPtyBuffersRef.current.set(paneId, buf);
        }
        buf.push({ bytes, offset });
      }
    });

    // 3. Initialize fresh terminal session & fresh AI session on launch
    void initFreshSession();

    // 4. Initial load of blackboard entries and file claims
    refreshSharedContext();

    const handleBeforeUnload = () => {
      void cleanupAllPanes();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupShortcuts();
      cleanupEvents();
      void cleanupAllPanes();
    };
  }, []);

  const activePane = store.panes.find((p) => p.id === store.activePaneId);

  return (
    <div className="flex flex-row h-screen w-screen bg-cortex-bg text-cortex-text font-sans overflow-hidden">
      {/* ================= PERSISTENT LEFT SIDEBAR ================= */}
      <PersistentLeftSidebar />

      {/* ================= MAIN APPLICATION VIEWPORT ================= */}
      <div className="flex flex-col flex-1 h-full min-w-0 min-h-0 overflow-hidden">
        {/* ================= TOP APPLICATION BAR ================= */}
        <TopBar />

      {/* ================= MAIN TERMINAL AREA ================= */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-row w-full relative bg-cortex-bg">
        <div className="flex-1 h-full relative overflow-hidden min-w-0">
          <TerminalGrid registerTermWriter={registerTermWriter} />
        </div>
        <AiAssistantPanel />
      </main>


      {/* ================= BOTTOM STATUS FOOTER ================= */}
      <footer className="h-6 bg-cortex-bgAlt border-t border-cortex-border px-3 flex items-center justify-between text-[10px] text-cortex-textMuted shrink-0 z-20">
        {/* Left: Active Pane & Port Status */}
        <div className="flex items-center space-x-3 truncate">
          {activePane ? (
            <>
              <span className="text-slate-400">
                ACTIVE: <span className="text-slate-200">{activePane.id}</span> ({activePane.status})
              </span>
              {activePane.worktreePath && (
                <span className="hidden md:inline text-slate-500 truncate" title={activePane.worktreePath}>
                  DIR: {activePane.worktreePath}
                </span>
              )}
              {activePane.openPorts && activePane.openPorts.length > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  <span>PORTS: {activePane.openPorts.join(', ')}</span>
                </span>
              )}
            </>
          ) : (
            <span>No active terminal pane</span>
          )}
        </div>

        {/* Right: Keybinding cheat-sheet */}
        <div className="hidden sm:flex items-center space-x-2 text-slate-400">
          <span>
            <kbd className="text-cyan-300 bg-slate-800 px-1 py-0.5 rounded border border-slate-700">Ctrl+P</kbd> Palette
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Ctrl+T</kbd> Tab
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Ctrl+W</kbd> Close
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Cmd+D</kbd> Split
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Alt+H/J/K/L</kbd> Nav
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Alt+E</kbd> Balance
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Alt+B</kbd> Detach
          </span>
          <span>
            <kbd className="text-slate-300 bg-slate-800 px-1 py-0.5 rounded">Alt+Shift+B</kbd> Bg
          </span>
        </div>
      </footer>
      </div>

      {/* ================= MODALS & DRAWERS ================= */}
      <CommandPaletteModal />
      <ThemeModal />
      <OrchestratorBar />
      <DiffGatekeeperModal />
      <TimeTravelSlider />
      <ObsidianSidebar />
      <CustomToolModal />
      <ConfirmCloseModal />
      <BackgroundTasksDrawer />
      <WorkflowsModal />
      <AiSettingsModal />
      <AiApprovalModal />
    </div>
  );
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Unhandled React Error in AetherTerminal:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-[#16161e] text-[#c0caf5] flex flex-col items-center justify-center p-8 select-none font-mono">
          <div className="max-w-md w-full bg-slate-900/90 border border-red-500/40 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400 font-bold text-sm">
              <span>AetherTerminal UI Recovered</span>
            </div>
            <p className="text-xs text-slate-300">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold transition-colors"
              >
                Reload Window
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors"
              >
                Reset State & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
