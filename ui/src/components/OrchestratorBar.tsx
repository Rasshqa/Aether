import React, { useState, useEffect, useRef } from 'react';
import {
  toggleOrchestrator,
  useAetherStore,
  spawnAgentPane,
  sendPtyInput,
  enqueuePipelineStage,
  runAiPilotPrompt,
  clearAiPilotSteps,
  toggleAiSettings,
  stopAiAssistant,
} from '../stores/aetherStore';
import {
  Sparkles,
  ArrowRight,
  X,
  Bot,
  Send,
  Cpu,
  Terminal,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Settings,
  Clock,
  Square,
} from 'lucide-react';

export const OrchestratorBar: React.FC = () => {
  const store = useAetherStore();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'pipeline' | 'pilot'>('pipeline');
  const [selectedPaneId, setSelectedPaneId] = useState<string>('');
  const [pilotOutput, setPilotOutput] = useState<string | null>(null);
  const [pilotError, setPilotError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (store.orchestratorOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setPilotOutput(null);
      setPilotError(null);
      if (store.activePaneId) {
        setSelectedPaneId(store.activePaneId);
      } else if (store.panes.length > 0) {
        setSelectedPaneId(store.panes[0].id);
      }
    }
  }, [store.orchestratorOpen, store.activePaneId, store.panes]);

  // Auto-switch mode if user types !ai prefix
  useEffect(() => {
    if (query.trim().startsWith('!ai')) {
      if (mode !== 'pilot') setMode('pilot');
    }
  }, [query, mode]);

  useEffect(() => {
    if (stepsEndRef.current) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [store.aiPilotSteps]);

  if (!store.orchestratorOpen) return null;

  const normalizeCliType = (tag: string): string => {
    const lower = tag.toLowerCase();
    const detected = store.detectedTools.find(
      (t) => t.id === lower || t.binary.toLowerCase() === lower || t.name.toLowerCase() === lower
    );
    if (detected) return detected.id;
    if (lower === 'claude') return 'claude-code';
    if (lower === 'bash' || lower === 'zsh') return 'shell';
    return lower;
  };

  const handleExecute = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (mode === 'pilot' || trimmed.startsWith('!ai')) {
      const instruction = trimmed.replace(/^!ai\s*/, '').trim();
      if (!instruction) return;

      const targetPane = selectedPaneId || store.activePaneId || (store.panes[0]?.id ?? '');
      if (!targetPane) {
        setPilotError('No active terminal pane available. Spawn a terminal pane first.');
        return;
      }

      setPilotOutput(null);
      setPilotError(null);
      clearAiPilotSteps(targetPane);

      try {
        const result = await runAiPilotPrompt(targetPane, instruction);
        setPilotOutput(result);
      } catch (err: any) {
        setPilotError(String(err?.message || err));
      }
      return;
    }

    // Pipeline syntax: "@agent1 prompt -> @agent2 prompt -> ..."
    const stages = trimmed.split('->').map((s) => s.trim()).filter(Boolean);

    const parsed = stages.map((stage) => {
      const match = stage.match(/@([\w-]+)/);
      const rawTag = match ? match[1] : 'claude-code';
      return {
        targetCli: normalizeCliType(rawTag),
        prompt: stage.replace(/@[\w-]+/, '').trim(),
      };
    });

    const runStage = async (stage: { targetCli: string; prompt: string }) => {
      const existingPane = store.panes.find((p) => p.cliType === stage.targetCli);
      if (existingPane) {
        await sendPtyInput(existingPane.id, `${stage.prompt}\n`);
        return;
      }
      const newlyCreated = await spawnAgentPane(stage.targetCli, true);
      if (newlyCreated) {
        setTimeout(() => {
          sendPtyInput(newlyCreated.id, `${stage.prompt}\n`);
        }, 600);
      }
    };

    if (parsed.length > 0) {
      await runStage(parsed[0]);
      for (const stage of parsed.slice(1)) {
        enqueuePipelineStage(stage);
      }
    }

    setQuery('');
    toggleOrchestrator(false);
  };

  const insertSuggestion = (text: string, targetMode: 'pipeline' | 'pilot' = 'pipeline') => {
    setQuery(text);
    setMode(targetMode);
    inputRef.current?.focus();
  };

  const relevantSteps = store.aiPilotSteps.filter(
    (s) => !selectedPaneId || s.paneId === selectedPaneId
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/70 backdrop-blur-sm animate-fadeIn select-none">
      <div className="w-full max-w-3xl bg-tokyo-panel border border-tokyo-border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-scaleUp">
        {/* Mode Selector Header Bar */}
        <div className="h-10 px-4 bg-tokyo-bgDark border-b border-tokyo-border/70 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMode('pipeline')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                mode === 'pipeline'
                  ? 'bg-tokyo-blue/20 text-tokyo-blue border border-tokyo-blue/40'
                  : 'text-tokyo-comment hover:text-tokyo-fg'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Estafet Pipeline</span>
            </button>
            <button
              onClick={() => setMode('pilot')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                mode === 'pilot'
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50'
                  : 'text-tokyo-comment hover:text-tokyo-fg'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Autonomous AI Pilot</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'pilot' && (
              <button
                onClick={() => toggleAiSettings(true)}
                className="text-[11px] text-tokyo-comment hover:text-indigo-300 flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
                title="Configure AI Provider and API Keys"
              >
                <Settings className="w-3 h-3" />
                <span>Provider Settings</span>
              </button>
            )}
            <button
              onClick={() => toggleOrchestrator(false)}
              className="p-1 text-tokyo-comment hover:text-white rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Top Input Bar */}
        <div className="h-14 px-4 flex items-center gap-3 border-b border-tokyo-border/70 bg-tokyo-bgDark/80">
          {mode === 'pilot' ? (
            <Bot className="w-5 h-5 text-indigo-400 flex-shrink-0 animate-pulse" />
          ) : (
            <Sparkles className="w-5 h-5 text-tokyo-blue flex-shrink-0 animate-pulse" />
          )}

          {mode === 'pilot' && store.panes.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-300">
              <Terminal className="w-3 h-3 text-cyan-400" />
              <select
                value={selectedPaneId}
                onChange={(e) => setSelectedPaneId(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-mono"
              >
                {store.panes.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.id} ({p.cliType})
                  </option>
                ))}
              </select>
            </div>
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExecute();
              if (e.key === 'Escape') {
                if (store.aiPilotRunning) {
                  stopAiAssistant();
                } else {
                  toggleOrchestrator(false);
                }
              }
            }}
            placeholder={
              mode === 'pilot'
                ? "Instruct AI Pilot: e.g. 'Read terminal screen, diagnose compile error, and test fix'"
                : "Dispatch prompt: @claude create auth -> @codex write tests (or '!ai' for Pilot)"
            }
            className="flex-1 bg-transparent text-sm text-white placeholder-tokyo-comment focus:outline-none font-mono"
          />

          {store.aiPilotRunning ? (
            <button
              onClick={() => stopAiAssistant()}
              title="Stop Autonomous Pilot Agent (Esc)"
              className="px-3 py-1.5 rounded-md font-semibold text-xs flex items-center gap-1.5 transition-colors bg-cortex-error/20 hover:bg-cortex-error/30 text-cortex-error border border-cortex-error/40 cursor-pointer shadow-sm"
              data-testid="orchestrator-stop-btn"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={handleExecute}
              disabled={!query.trim()}
              className={`px-3 py-1.5 rounded-md font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === 'pilot'
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                  : 'bg-tokyo-blue hover:bg-tokyo-cyan text-tokyo-bgDark'
              }`}
            >
              <span>Run</span>
              <Send className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Pilot Execution Steps & Live Progress Logging */}
        {mode === 'pilot' && (store.aiPilotRunning || relevantSteps.length > 0 || pilotOutput || pilotError) && (
          <div className="p-4 border-b border-tokyo-border/70 bg-slate-950/90 flex flex-col gap-2 max-h-60 overflow-y-auto font-mono text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" />
                <span>Pilot Supervisor Live Action Log</span>
              </span>
              {store.aiPilotRunning && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Autonomous cycle in progress...</span>
                  </span>
                  <button
                    onClick={() => stopAiAssistant()}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cortex-error/20 hover:bg-cortex-error/30 text-cortex-error border border-cortex-error/40 text-[10px] font-mono cursor-pointer transition-colors"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                    <span>Stop</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              {relevantSteps.map((s, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[11px] flex items-start gap-2 text-slate-300"
                >
                  <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                  <div className="flex-1 overflow-hidden">
                    <span className="font-semibold text-slate-200">{s.step}</span>
                    {s.details && (
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate font-mono">
                        {s.details}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={stepsEndRef} />
            </div>

            {pilotOutput && (
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-emerald-300 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="whitespace-pre-wrap">{pilotOutput}</div>
              </div>
            )}

            {pilotError && (
              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="whitespace-pre-wrap">{pilotError}</div>
              </div>
            )}
          </div>
        )}

        {/* Suggestions & Shortcuts list */}
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-tokyo-comment">
            {mode === 'pilot' ? 'AI Pilot Directives' : 'Agentic Pipeline Presets'}
          </div>

          <div className="flex flex-col gap-2">
            {mode === 'pilot' ? (
              <>
                <button
                  onClick={() =>
                    insertSuggestion(
                      '!ai Inspect terminal screen, diagnose any errors, and execute fix',
                      'pilot'
                    )
                  }
                  className="w-full p-2.5 rounded-lg bg-tokyo-bgDark/60 border border-tokyo-border hover:border-indigo-500/50 text-left transition-all group flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs text-tokyo-fg font-mono">
                      !ai Inspect terminal screen, diagnose any errors, and execute fix
                    </span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tokyo-comment group-hover:text-indigo-400 transition-colors" />
                </button>

                <button
                  onClick={() =>
                    insertSuggestion(
                      '!ai Monitor Claude Code interactive prompt and type \'y\' to confirm permissions',
                      'pilot'
                    )
                  }
                  className="w-full p-2.5 rounded-lg bg-tokyo-bgDark/60 border border-tokyo-border hover:border-indigo-500/50 text-left transition-all group flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-tokyo-fg font-mono">
                      !ai Monitor Claude Code interactive prompt and type 'y' to confirm permissions
                    </span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tokyo-comment group-hover:text-indigo-400 transition-colors" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() =>
                    insertSuggestion(
                      '@claude refactor src/auth.rs to Argon2id -> @codex write unit tests in tests/auth_test.rs',
                      'pipeline'
                    )
                  }
                  className="w-full p-2.5 rounded-lg bg-tokyo-bgDark/60 border border-tokyo-border hover:border-tokyo-blue/50 text-left transition-all group flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#D97757]" />
                    <span className="text-xs text-tokyo-fg font-mono">
                      @claude refactor auth.rs <span className="text-tokyo-blue">-&gt;</span> @codex write unit tests
                    </span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tokyo-comment group-hover:text-tokyo-blue transition-colors" />
                </button>

                <button
                  onClick={() =>
                    insertSuggestion(
                      '@claude design REST API schema -> @opencode implement route handlers -> @codex audit security',
                      'pipeline'
                    )
                  }
                  className="w-full p-2.5 rounded-lg bg-tokyo-bgDark/60 border border-tokyo-border hover:border-tokyo-purple/50 text-left transition-all group flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#3B82F6]" />
                    <span className="text-xs text-tokyo-fg font-mono">
                      @claude design schema <span className="text-tokyo-blue">-&gt;</span> @opencode implement <span className="text-tokyo-blue">-&gt;</span> @codex audit
                    </span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-tokyo-comment group-hover:text-tokyo-purple transition-colors" />
                </button>
              </>
            )}
          </div>

          <div className="mt-2 pt-3 border-t border-tokyo-border/50 flex items-center justify-between text-[11px] text-tokyo-comment">
            <span>
              {mode === 'pilot'
                ? 'Pilot Mode: Autonomous supervisor reading terminal output and sending keystrokes.'
                : 'Pipeline Mode: Type @agent to target CLI, -> to chain estafet tasks.'}
            </span>
            <span>Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
};
