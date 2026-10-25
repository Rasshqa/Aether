import React from 'react';
import {
  AgentPane,
  requestClosePane,
  sendPaneToBackground,
  openDiffGatekeeper,
  splitActivePane,
  setPaneViewMode,
  togglePaneInputBar,
  sendPtyInput,
} from '../stores/aetherStore';
import {
  GitBranch,
  Radio,
  SplitSquareVertical,
  SplitSquareHorizontal,
  X,
  ShieldCheck,
  ArrowDownToLine,
  ListTree,
  Terminal as TerminalIcon,
  TextCursorInput,
  Square,
} from 'lucide-react';

interface Props {
  pane: AgentPane;
  isActive: boolean;
}

export const AgentHeaderPill: React.FC<Props> = ({ pane, isActive }) => {
  const getStatusBadge = () => {
    switch (pane.status) {
      case 'THINKING':
        return (
          <span className="flex items-center gap-1.5 text-xs text-cortex-accent bg-cortex-accent/10 px-2 py-0.5 rounded-full border border-cortex-accent/30 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-cortex-accent"></span>
            THINKING
          </span>
        );
      case 'EXECUTING':
        return (
          <span className="flex items-center gap-1.5 text-xs text-cortex-warning bg-cortex-warning/10 px-2 py-0.5 rounded-full border border-cortex-warning/30 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-cortex-warning"></span>
            EXECUTING
          </span>
        );
      case 'ERROR':
        return (
          <span className="flex items-center gap-1.5 text-xs text-cortex-error bg-cortex-error/10 px-2 py-0.5 rounded-full border border-cortex-error/30">
            <span className="w-1.5 h-1.5 rounded-full bg-cortex-error"></span>
            ERROR
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 text-xs text-cortex-success bg-cortex-success/10 px-2 py-0.5 rounded-full border border-cortex-success/20">
            <span className="w-1.5 h-1.5 rounded-full bg-cortex-success"></span>
            IDLE
          </span>
        );
    }
  };

  return (
    <div
      className={`h-9 px-3 flex items-center justify-between border-b transition-colors ${
        isActive
          ? 'bg-cortex-bgAlt border-cortex-border shadow-sm'
          : 'bg-cortex-bg border-cortex-border/70 opacity-85 hover:opacity-100'
      }`}
    >
      {/* Left: Agent Pill & Status */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-2.5 h-2.5 rounded-full shadow-[0_0_6px_rgba(0,240,255,0.4)]"
          style={{ backgroundColor: pane.color || '#00F0FF' }}
          title={pane.cliType}
        />
        <span className="font-semibold text-xs text-cortex-text tracking-wide font-mono">
          @{pane.cliType}
        </span>
        {pane.pid && (
          <span className="text-[10px] text-cortex-textMuted font-mono">
            PID:{pane.pid}
          </span>
        )}

        {getStatusBadge()}

        {(pane.status === 'EXECUTING' || pane.status === 'THINKING') && (
          <button
            onClick={() => {
              sendPtyInput(pane.id, '\x03');
              pane.status = 'IDLE';
            }}
            title="Stop Process / Agent (Ctrl+C)"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cortex-error/20 hover:bg-cortex-error/30 text-cortex-error border border-cortex-error/40 text-[10px] font-mono font-bold transition-colors cursor-pointer"
            data-testid={`btn-stop-agent-pane-${pane.id}`}
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            <span>Stop</span>
          </button>
        )}

        {/* Git Worktree Branch badge */}
        {pane.gitBranch && (
          <div className="flex items-center gap-1 text-[11px] text-cortex-accent bg-cortex-accent/10 px-2 py-0.5 rounded border border-cortex-accent/20 font-mono">
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{pane.gitBranch}</span>
          </div>
        )}

        {/* Landlock Sandbox badge */}
        <div className="flex items-center gap-1 text-[10px] text-cortex-textMuted bg-cortex-surface2 px-1.5 py-0.5 rounded border border-cortex-border font-mono">
          <ShieldCheck className="w-3 h-3 text-cortex-success" />
          <span>workspace-only</span>
        </div>

        {/* Port Radar: Live detected TCP listening ports */}
        {pane.openPorts && pane.openPorts.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-cortex-warning bg-cortex-warning/10 px-2 py-0.5 rounded border border-cortex-warning/20 font-mono">
            <Radio className="w-3 h-3 animate-pulse" />
            <span>:{pane.openPorts.join(', :')}</span>
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <div className="flex items-center rounded border border-cortex-border overflow-hidden mr-1">
          <button
            onClick={() => setPaneViewMode(pane.id, 'raw')}
            title="Raw Terminal View"
            className={`px-1.5 py-1 transition-colors ${
              pane.viewMode !== 'blocks'
                ? 'bg-cortex-surface2 text-cortex-accent font-medium'
                : 'text-cortex-textMuted hover:text-cortex-text'
            }`}
          >
            <TerminalIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => setPaneViewMode(pane.id, 'blocks')}
            title="Warp Block View"
            className={`px-1.5 py-1 transition-colors ${
              pane.viewMode === 'blocks'
                ? 'bg-cortex-surface2 text-cortex-accent font-medium'
                : 'text-cortex-textMuted hover:text-cortex-text'
            }`}
          >
            <ListTree className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={() => togglePaneInputBar(pane.id)}
          title="Toggle Input Bar (Alt+I)"
          className={`p-1 rounded transition-colors ${
            pane.inputBarOpen
              ? 'text-cortex-accent bg-cortex-accent/10'
              : 'text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2'
          }`}
        >
          <TextCursorInput className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendPaneToBackground(pane.id)}
          title="Send to Background (Alt+B)"
          className="p-1 rounded text-cortex-textMuted hover:text-cortex-success hover:bg-cortex-surface2 transition-colors"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => openDiffGatekeeper(pane.id)}
          title="Review 3-Way Diff (Alt+M)"
          className="p-1 rounded text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2 transition-colors"
        >
          <GitBranch className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => splitActivePane('vertical')}
          title="Split Vertically (Alt+V)"
          className="p-1 rounded text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2 transition-colors"
        >
          <SplitSquareVertical className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => splitActivePane('horizontal')}
          title="Split Horizontally (Alt+S)"
          className="p-1 rounded text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2 transition-colors"
        >
          <SplitSquareHorizontal className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => requestClosePane(pane.id)}
          title="Close Pane (Ctrl+W / Alt+W)"
          className="p-1 rounded text-cortex-textMuted hover:text-cortex-error hover:bg-cortex-surface2 transition-colors ml-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
