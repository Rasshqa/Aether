import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAetherStore,
  executeCommandInPane,
  recentCommandsFor,
  sendPtyInput,
  routePromptToAgent,
  runAiPilotPrompt,
  setSelectedAiProvider,
  setSelectedAiModel,
  togglePaneInputBar,
  BUILT_IN_PROVIDERS,
  AGENT_PALETTES,
  stopAiAssistant,
} from '../stores/aetherStore';
import {
  CornerDownLeft,
  Terminal,
  Sparkles,
  Folder,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Square,
} from 'lucide-react';
import { classifyCommand } from '../utils/commandClassifier';
import type { ClassificationResult } from '../utils/commandClassifier';

export interface InputBarProps {
  paneId?: string;
  activePaneId?: string;
  cliType?: string;
  isAgentPane?: boolean;
  onClose?: () => void;
  onExecuteCommand?: (command: string) => void;
  onSendAiPrompt?: (prompt: string, provider: string, model: string) => void;
}

export type InputMode = 'cmd' | 'ai';

const COMMON_COMMAND_PRESETS = [
  'git status',
  'git diff',
  'git log --oneline -n 10',
  'git add .',
  'git commit -m ""',
  'cargo check',
  'cargo test',
  'cargo build --release',
  'npm run dev',
  'npm run build',
  'npm test',
  'pnpm dev',
  'pnpm build',
  'ls -la',
  'pwd',
  'clear',
  'fastfetch',
  'htop',
  'docker ps',
];

export const InputBar: React.FC<InputBarProps> = ({
  paneId,
  activePaneId,
  cliType,
  isAgentPane,
  onClose,
  onExecuteCommand,
  onSendAiPrompt,
}) => {
  const store = useAetherStore();
  const targetPaneId = paneId || activePaneId || store.activePaneId || 'default';
  const pane = store.panes.find((p) => p.id === targetPaneId);
  const resolvedCliType = cliType || pane?.cliType || 'sh';
  const resolvedIsAgentPane =
    isAgentPane !== undefined
      ? isAgentPane
      : Boolean(pane && (AGENT_PALETTES[pane.cliType]?.category ?? 'shell') === 'agent');

  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [manualModeOverride, setManualModeOverride] = useState<InputMode | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const history = useMemo(() => recentCommandsFor(targetPaneId, 30), [targetPaneId, value]);

  const detectedToolNames = useMemo(
    () => store.detectedTools.map((t) => t.binary.toLowerCase()),
    [store.detectedTools]
  );

  const classification: ClassificationResult = useMemo(() => {
    return classifyCommand(value, detectedToolNames);
  }, [value, detectedToolNames]);

  // Mode resolution: explicit prefix takes highest priority, then manual pin, then classifier
  const mode: InputMode = useMemo(() => {
    const trimmed = value.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('@')) return 'ai';
    if (trimmed.startsWith('$ ') || trimmed === '$' || (trimmed.startsWith('$') && !trimmed.startsWith('$$'))) return 'cmd';
    if (manualModeOverride !== null) return manualModeOverride;
    if (classification.type === 'natural_language') return 'ai';
    return classification.suggestedMode;
  }, [value, manualModeOverride, classification.suggestedMode, classification.type]);

  // Multiline automatic height adjustment between 32px and 160px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const targetHeight = Math.min(Math.max(el.scrollHeight, 32), 160);
    el.style.height = `${targetHeight}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [targetPaneId]);

  // Smart Autocomplete
  const suggestion = useMemo(() => {
    if (!value.trim() || historyIndex !== -1) return '';
    if (mode === 'ai') return '';

    const historyMatch = history.find(
      (h) => h.toLowerCase().startsWith(value.toLowerCase()) && h !== value
    );
    if (historyMatch) {
      return historyMatch.slice(value.length);
    }

    const commonMatch = COMMON_COMMAND_PRESETS.find(
      (c) => c.toLowerCase().startsWith(value.toLowerCase()) && c !== value
    );
    if (commonMatch) {
      return commonMatch.slice(value.length);
    }

    return '';
  }, [value, history, historyIndex, mode]);

  const toggleMode = () => {
    const nextMode: InputMode = mode === 'cmd' ? 'ai' : 'cmd';
    setManualModeOverride(nextMode);
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      togglePaneInputBar(targetPaneId, false);
    }
  };

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // 1. Explicit pilot directive (!ai)
    if (trimmed.startsWith('!ai')) {
      const instruction = trimmed.replace(/^!ai\s*/, '').trim();
      if (instruction) {
        runAiPilotPrompt(targetPaneId, instruction);
      }
      setValue('');
      setHistoryIndex(-1);
      setManualModeOverride(null);
      return;
    }

    // 2. Explicit prefix indicators
    const isExplicitShell = trimmed.startsWith('$ ') || trimmed.startsWith('$');
    const isExplicitAi = trimmed.startsWith('#') || trimmed.startsWith('@');
    const isNaturalLanguage = classification.type === 'natural_language';

    // 3. Shell protection guard:
    // Any natural language instruction or #/@ prompt without explicit $ must route to AI
    const isIntendedForAi = (isExplicitAi || mode === 'ai' || isNaturalLanguage) && !isExplicitShell;

    if (isIntendedForAi) {
      // STRICT PREVENTION: Under no circumstances send to executeCommandInPane!
      const cleanPrompt = trimmed.replace(/^[#@]\s*/, '').trim();
      if (!cleanPrompt) return;

      if (onSendAiPrompt) {
        onSendAiPrompt(cleanPrompt, store.selectedAiProvider, store.selectedAiModel);
      }

      if (resolvedIsAgentPane) {
        await sendPtyInput(targetPaneId, `${cleanPrompt}\n`);
      } else {
        await routePromptToAgent(cleanPrompt, targetPaneId);
      }

      setValue('');
      setHistoryIndex(-1);
      setManualModeOverride(null);
      return;
    }

    // 4. Shell Execution Mode (only when explicit $ or verified shell command)
    const cleanCmd = trimmed.replace(/^\$\s*/, '').trim();
    if (!cleanCmd) return;

    // Defensive guard: if natural language with high confidence slipped through, block shell execution
    if (!isExplicitShell && isNaturalLanguage && classification.confidence >= 0.75) {
      if (onSendAiPrompt) {
        onSendAiPrompt(cleanCmd, store.selectedAiProvider, store.selectedAiModel);
      }
      await routePromptToAgent(cleanCmd, targetPaneId);
      setValue('');
      setHistoryIndex(-1);
      setManualModeOverride(null);
      return;
    }

    if (onExecuteCommand) {
      onExecuteCommand(cleanCmd);
    }
    await executeCommandInPane(targetPaneId, cleanCmd);

    setValue('');
    setHistoryIndex(-1);
    setManualModeOverride(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
      return;
    }
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      setValue(value + suggestion);
      return;
    }
    if (e.key === 'ArrowRight' && suggestion && textareaRef.current) {
      if (textareaRef.current.selectionStart === value.length) {
        e.preventDefault();
        setValue(value + suggestion);
        return;
      }
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setValue(history[next]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setValue('');
        return;
      }
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(history[next]);
    }
  };

  const worktreeShort = pane?.worktreePath
    ? pane.worktreePath.split('/').pop() || pane.worktreePath
    : 'workspace';

  return (
    <div
      className="border-t border-[#162026] bg-[#0B1013] px-3 py-2 flex flex-col gap-2 select-none font-sans"
      data-testid="input-bar"
    >
      {/* Top Metadata & Synchronized Provider Row */}
      <div className="flex items-center justify-between text-[10px] font-mono text-[#8E9BA4]">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {/* CWD Charm */}
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0E1418] text-[#F8F9FA] border border-[#162026]"
            title={`Working directory: ${pane?.worktreePath || 'Root workspace'}`}
          >
            <Folder className="w-3 h-3 text-[#00F0FF]" />
            <span className="truncate max-w-[140px]">{worktreeShort}</span>
          </div>

          {/* Git Charm */}
          {pane?.gitBranch && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#00F0FF]/10 text-[#00F0FF] border border-[#00F0FF]/30"
              title={`Git branch: ${pane.gitBranch}`}
            >
              <GitBranch className="w-3 h-3 text-[#00F0FF]" />
              <span className="truncate max-w-[120px]">{pane.gitBranch}</span>
            </div>
          )}

          {/* Exit Code Charm */}
          {pane?.lastExitCode !== undefined && pane.lastExitCode !== null && (
            <div
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] ${
                pane.lastExitCode === 0
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                  : 'bg-rose-950/40 text-rose-400 border-rose-800/40'
              }`}
              title={`Last exit status: ${pane.lastExitCode}`}
            >
              {pane.lastExitCode === 0 ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <AlertCircle className="w-3 h-3" />
              )}
              <span>exit {pane.lastExitCode}</span>
            </div>
          )}
        </div>

        {/* Synchronized AI Provider and Model Selector directly embedded in Input Bar */}
        <div
          className="flex items-center gap-1.5 shrink-0 bg-[#0E1418] px-2 py-0.5 rounded border border-[#162026]"
          data-testid="inputbar-provider-selector"
        >
          <Cpu className="w-3 h-3 text-[#00F0FF]" />
          <select
            value={store.selectedAiProvider}
            onChange={(e) => setSelectedAiProvider(e.target.value)}
            className="bg-transparent text-[#F8F9FA] text-[10px] font-mono focus:outline-none cursor-pointer"
            data-testid="inputbar-provider-select"
            title="Synchronized AI Provider"
          >
            {BUILT_IN_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#0B1013] text-[#F8F9FA]">
                {p.name}
              </option>
            ))}
            {store.customProviders.map((cp) => (
              <option key={cp.id} value={cp.id} className="bg-[#0B1013] text-[#F8F9FA]">
                {cp.displayName || cp.id}
              </option>
            ))}
          </select>

          <span className="text-[#162026]">|</span>

          <span
            className="text-[10px] text-[#8E9BA4] truncate max-w-[150px] font-mono"
            title={`Active Model: ${store.selectedAiModel}`}
            data-testid="inputbar-model-label"
          >
            {store.selectedAiModel}
          </span>
        </div>
      </div>

      {/* Main Input Row */}
      <div className="flex items-start gap-2">
        {/* Mode Distinction Badge */}
        <button
          type="button"
          onClick={toggleMode}
          className={`mt-0.5 shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border transition-all cursor-pointer ${
            mode === 'ai'
              ? 'bg-[#A855F7]/15 text-[#A855F7] border-[#A855F7]/50 hover:bg-[#A855F7]/25'
              : 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/50 hover:bg-[#00F0FF]/25'
          }`}
          title={`Mode: ${mode === 'ai' ? 'AI Agent' : 'Shell Command'}${manualModeOverride !== null ? ' (Pinned)' : ' (Auto-detected)'}\nClick to toggle mode`}
          data-testid="inputbar-mode-badge"
        >
          {mode === 'ai' ? (
            <Sparkles className="w-3.5 h-3.5 text-[#A855F7]" />
          ) : (
            <Terminal className="w-3.5 h-3.5 text-[#00F0FF]" />
          )}
          <span>
            {mode === 'ai'
              ? value.trim().startsWith('#')
                ? '# AI'
                : manualModeOverride === 'ai'
                ? 'AI (Pinned)'
                : 'AI'
              : value.trim().startsWith('$')
              ? '$ CMD'
              : manualModeOverride === 'cmd'
              ? '$ CMD (Pinned)'
              : '$ CMD'}
          </span>
        </button>

        {/* Multiline Textarea with Dynamic Height Adjustment between 32px and 160px */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask AetherCortex or enter a command..."
            className="w-full resize-none bg-[#050809] border border-[#162026] rounded px-3 py-1.5 text-xs font-mono text-[#F8F9FA] placeholder-[#8E9BA4] focus:outline-none focus:border-[#00F0FF] overflow-y-auto no-scrollbar"
            style={{ minHeight: '32px', maxHeight: '160px' }}
            spellCheck={false}
            data-testid="inputbar-textarea"
          />
          {suggestion && (
            <span className="pointer-events-none absolute left-3 top-1.5 text-xs font-mono text-[#8E9BA4] opacity-50 select-none">
              <span className="invisible">{value}</span>
              {suggestion}
            </span>
          )}
        </div>

        {/* Run / Stop Button */}
        {store.aiLoading || store.aiPilotRunning ? (
          <button
            onClick={() => stopAiAssistant()}
            className="mt-0.5 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded bg-cortex-error hover:bg-rose-500 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
            title="Stop Agent (Esc)"
            data-testid="inputbar-stop-btn"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            onClick={submit}
            className="mt-0.5 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#00F0FF] hover:bg-[#00F0FF]/80 text-[#050809] text-xs font-semibold transition-colors shadow-sm"
            title="Execute (Enter)"
            data-testid="inputbar-submit-btn"
          >
            {mode === 'ai' ? (
              <Sparkles className="w-3.5 h-3.5" />
            ) : (
              <CornerDownLeft className="w-3.5 h-3.5" />
            )}
            <span>Run</span>
          </button>
        )}
      </div>

      {/* Footer shortcut helper */}
      <div className="flex items-center justify-between text-[10px] text-[#8E9BA4] font-mono px-0.5">
        <div className="flex items-center gap-2">
          <span>Enter submit</span>
          <span>·</span>
          <span>Shift+Enter newline</span>
          <span>·</span>
          <span>$ for shell</span>
          <span>·</span>
          <span># for AI</span>
          <span>·</span>
          <span>Esc close</span>
        </div>

        <span>{history.length} in history</span>
      </div>
    </div>
  );
};
