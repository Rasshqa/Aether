import React, { useState, useEffect, useMemo } from 'react';
import {
  useAetherStore,
  toggleObsidianSidebar,
  publishBlackboardEntry,
  readObsidianNote,
  updateObsidianTask,
  releaseModule,
  refreshSharedContext,
  BlackboardEntry,
  AGENT_PALETTES,
} from '../stores/aetherStore';
import { Lock } from 'lucide-react';

export const ObsidianSidebar: React.FC = () => {
  const state = useAetherStore();
  const [activeTab, setActiveTab] = useState<'blackboard' | 'obsidian'>('blackboard');

  // Blackboard Filters & State
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');
  const [showNewEntryForm, setShowNewEntryForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('DECISION');
  const [newAuthor, setNewAuthor] = useState('claude-code');
  const [newTarget, setNewTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Obsidian Vault State
  const [notePath, setNotePath] = useState('sprint.md');
  const [rawNoteContent, setRawNoteContent] = useState('');
  const [newTaskInput, setNewTaskInput] = useState('');
  const [loadingNote, setLoadingNote] = useState(false);
  const [vaultSearchQuery, setVaultSearchQuery] = useState('');

  // Initial load and periodic refresh of context
  useEffect(() => {
    if (state.obsidianSidebarOpen) {
      refreshSharedContext();
      loadNote(notePath);
    }
  }, [state.obsidianSidebarOpen]);

  // Auto-reload the open note when aetherd reports an external vault edit
  useEffect(() => {
    if (state.obsidianSidebarOpen && state.obsidianRefreshTick > 0) {
      loadNote(notePath);
    }
  }, [state.obsidianRefreshTick]);

  const loadNote = async (path: string) => {
    setLoadingNote(true);
    try {
      const content = await readObsidianNote(path);
      setRawNoteContent(content);
    } catch (e) {
      console.warn('Failed to load note:', e);
    } finally {
      setLoadingNote(false);
    }
  };

  const handlePostEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setSubmitting(true);
    try {
      await publishBlackboardEntry(
        newAuthor,
        newType,
        newTitle.trim(),
        newContent.trim(),
        newTarget.trim() ? newTarget.trim() : undefined
      );
      setNewTitle('');
      setNewContent('');
      setShowNewEntryForm(false);
    } catch (err) {
      console.error('Error posting blackboard entry:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Parse tasks from markdown note
  const parsedTasks = useMemo(() => {
    if (!rawNoteContent) return [];
    const lines = rawNoteContent.split('\n');
    const tasks: { line: string; taskText: string; completed: boolean; index: number }[] = [];

    lines.forEach((line, idx) => {
      const match = line.match(/^(\s*[-*]\s*\[([ xX])\]\s+)(.*)$/);
      if (match) {
        tasks.push({
          line,
          taskText: match[3],
          completed: match[2].toLowerCase() === 'x',
          index: idx,
        });
      }
    });

    if (vaultSearchQuery.trim()) {
      return tasks.filter((t) =>
        t.taskText.toLowerCase().includes(vaultSearchQuery.toLowerCase())
      );
    }
    return tasks;
  }, [rawNoteContent, vaultSearchQuery]);

  const handleToggleTask = async (taskText: string, currentCompleted: boolean) => {
    const nextCompleted = !currentCompleted;
    // Optimistic UI update
    const updated = rawNoteContent
      .split('\n')
      .map((l) => {
        if (l.includes(taskText)) {
          return nextCompleted
            ? l.replace(/\[\s\]/, '[x]')
            : l.replace(/\[[xX]\]/, '[ ]');
        }
        return l;
      })
      .join('\n');
    setRawNoteContent(updated);

    try {
      await updateObsidianTask(notePath, taskText, nextCompleted);
    } catch (e) {
      console.error('Failed to sync task change to Obsidian:', e);
      // Revert on error
      loadNote(notePath);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskInput.trim()) return;
    const taskLine = `- [ ] ${newTaskInput.trim()}`;
    const newContent = rawNoteContent ? `${rawNoteContent.trimEnd()}\n${taskLine}\n` : `${taskLine}\n`;
    setRawNoteContent(newContent);
    setNewTaskInput('');

    // In a real environment, update file via obsidian task IPC
    try {
      await updateObsidianTask(notePath, newTaskInput.trim(), false);
    } catch (e) {
      console.warn('Note task add sync fallback');
    }
  };

  const filteredBlackboard = useMemo(() => {
    return state.blackboard.filter((entry) => {
      if (typeFilter !== 'ALL' && entry.entry_type !== typeFilter) return false;
      if (agentFilter !== 'ALL' && entry.author_agent_id !== agentFilter) return false;
      return true;
    });
  }, [state.blackboard, typeFilter, agentFilter]);

  if (!state.obsidianSidebarOpen) {
    return null;
  }

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'API_CONTRACT':
        return 'bg-purple-950/80 text-purple-300 border-purple-700/60';
      case 'TASK_CLAIM':
        return 'bg-blue-950/80 text-blue-300 border-blue-700/60';
      case 'BUG_REPORT':
        return 'bg-rose-950/80 text-rose-300 border-rose-700/60';
      case 'DECISION':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60';
      case 'HANDOFF':
        return 'bg-amber-950/80 text-amber-300 border-amber-700/60';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-96 max-w-full h-full min-h-0 max-h-full bg-slate-950/95 backdrop-blur-md border-l border-slate-800/80 shadow-2xl flex flex-col overflow-hidden transition-all duration-300 select-none"
      aria-label="Obsidian & Blackboard Drawer"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <h2 className="text-sm font-semibold text-slate-100 tracking-wide uppercase font-mono">
            Collective Memory
          </h2>
        </div>
        <div className="flex items-center space-x-1">
          <span className="text-[10px] text-slate-400 font-mono bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60">
            Ctrl+B
          </span>
          <button
            onClick={() => toggleObsidianSidebar(false)}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close Drawer"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/30">
        <button
          onClick={() => setActiveTab('blackboard')}
          className={`flex-1 py-2 text-xs font-medium font-mono text-center border-b-2 transition-all ${
            activeTab === 'blackboard'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          Shared Blackboard ({state.blackboard.length})
        </button>
        <button
          onClick={() => setActiveTab('obsidian')}
          className={`flex-1 py-2 text-xs font-medium font-mono text-center border-b-2 transition-all ${
            activeTab === 'obsidian'
              ? 'border-purple-500 text-purple-400 bg-purple-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          Obsidian Vault
        </button>
      </div>

      {/* Content Container */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto px-4 py-3 space-y-4 font-sans text-xs">
        {/* ================= TAB 1: BLACKBOARD ================= */}
        {activeTab === 'blackboard' && (
          <div className="space-y-4">
            {/* Active File Locks Card */}
            {state.fileLocks.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-950/20 p-2.5">
                <div className="flex items-center justify-between text-amber-300 font-mono font-medium mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Active Module Claims ({state.fileLocks.length})</span>
                  </span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {state.fileLocks.map((lock, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-slate-900/80 px-2 py-1 rounded border border-slate-800 text-[11px]"
                    >
                      <div className="truncate pr-2 font-mono text-slate-300" title={lock.relative_file_path}>
                        {lock.relative_file_path}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                          {lock.locked_by_agent_id}
                        </span>
                        <button
                          onClick={() => releaseModule(lock.locked_by_agent_id, [lock.relative_file_path])}
                          className="text-[10px] text-rose-400 hover:text-rose-300 underline"
                          title="Release Lock"
                        >
                          release
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Controls Bar: Filters & New Entry Toggle */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-indigo-500 flex-1 font-mono"
                >
                  <option value="ALL">All Event Types</option>
                  <option value="API_CONTRACT">API Contract</option>
                  <option value="TASK_CLAIM">Task Claim</option>
                  <option value="BUG_REPORT">Bug Report</option>
                  <option value="DECISION">Architectural Decision</option>
                  <option value="HANDOFF">Agent Handoff</option>
                </select>

                <button
                  onClick={() => setShowNewEntryForm(!showNewEntryForm)}
                  className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-mono transition-colors shrink-0"
                >
                  {showNewEntryForm ? 'Cancel' : '+ New Note'}
                </button>
              </div>

              {/* Form to Broadcast Blackboard Entry */}
              {showNewEntryForm && (
                <form
                  onSubmit={handlePostEntry}
                  className="p-3 bg-slate-900/90 rounded-md border border-indigo-500/40 space-y-2"
                >
                  <div className="text-[11px] font-mono text-indigo-300 font-semibold">
                    Post to Shared Blackboard
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newAuthor}
                      onChange={(e) => setNewAuthor(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 font-mono"
                    >
                      {Object.keys(AGENT_PALETTES).map((k) => (
                        <option key={k} value={k}>
                          {AGENT_PALETTES[k].name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 font-mono"
                    >
                      <option value="DECISION">DECISION</option>
                      <option value="API_CONTRACT">API_CONTRACT</option>
                      <option value="TASK_CLAIM">TASK_CLAIM</option>
                      <option value="BUG_REPORT">BUG_REPORT</option>
                      <option value="HANDOFF">HANDOFF</option>
                    </select>
                  </div>

                  <input
                    type="text"
                    placeholder="Entry title (e.g. Auth Token Interface)"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />

                  <textarea
                    placeholder="Markdown content / context payload..."
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono resize-none"
                    required
                  />

                  <input
                    type="text"
                    placeholder="Optional target agent ID (e.g. opencode)"
                    value={newTarget}
                    onChange={(e) => setNewTarget(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300 font-mono"
                  />

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-[11px] font-mono transition-colors"
                  >
                    {submitting ? 'Broadcasting...' : 'Broadcast to Agents'}
                  </button>
                </form>
              )}
            </div>

            {/* Blackboard Entries Stream */}
            <div className="space-y-2.5">
              {filteredBlackboard.length === 0 ? (
                <div className="text-center py-8 text-slate-500 font-mono text-xs">
                  No blackboard entries recorded yet.
                </div>
              ) : (
                filteredBlackboard.map((entry) => {
                  const palette = AGENT_PALETTES[entry.author_agent_id] || {
                    name: entry.author_agent_id,
                    color: '#94a3b8',
                  };
                  return (
                    <article
                      key={entry.id}
                      className="bg-slate-900/60 rounded-md border border-slate-800/80 p-3 hover:border-slate-700 transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getTypeBadgeClass(
                            entry.entry_type
                          )}`}
                        >
                          {entry.entry_type}
                        </span>
                        <time className="text-[10px] text-slate-500 font-mono">
                          {entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : 'Just now'}
                        </time>
                      </div>

                      <div className="font-semibold text-slate-200 text-xs font-mono">{entry.title}</div>

                      <div className="text-slate-300 text-[11px] leading-relaxed whitespace-pre-wrap font-sans bg-slate-950/40 p-2 rounded border border-slate-800/50">
                        {entry.content_markdown}
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ backgroundColor: palette.color }}
                          />
                          <span>{palette.name}</span>
                        </div>
                        {entry.target_agent_id && (
                          <span className="text-amber-400/90 bg-amber-950/40 px-1 rounded border border-amber-800/40">
                            → {entry.target_agent_id}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ================= TAB 2: OBSIDIAN VAULT ================= */}
        {activeTab === 'obsidian' && (
          <div className="space-y-4">
            {/* Vault File Selector & Search */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={notePath}
                  onChange={(e) => setNotePath(e.target.value)}
                  placeholder="Note relative path (e.g. sprint.md)"
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-[11px] font-mono flex-1 focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={() => loadNote(notePath)}
                  disabled={loadingNote}
                  className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[11px] font-mono transition-colors shrink-0"
                >
                  {loadingNote ? 'Loading...' : 'Open'}
                </button>
              </div>

              <input
                type="text"
                value={vaultSearchQuery}
                onChange={(e) => setVaultSearchQuery(e.target.value)}
                placeholder="Filter tasks in note..."
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-300 text-[11px] font-mono focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Sprint Tasks Runner */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-mono text-[11px] border-b border-slate-800 pb-1">
                <span className="font-semibold text-purple-300">Sprint Tasks ({parsedTasks.length})</span>
                <span className="text-slate-500">
                  {parsedTasks.filter((t) => t.completed).length} / {parsedTasks.length} done
                </span>
              </div>

              {parsedTasks.length === 0 ? (
                <div className="text-center py-6 text-slate-500 font-mono text-xs">
                  {loadingNote ? 'Fetching note from .aether/vault...' : 'No markdown checklist items (- [ ] / - [x]) found.'}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {parsedTasks.map((t, idx) => (
                    <li
                      key={idx}
                      onClick={() => handleToggleTask(t.taskText, t.completed)}
                      className={`flex items-start gap-2.5 p-2 rounded border cursor-pointer select-none transition-colors ${
                        t.completed
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-slate-400'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={t.completed}
                        onChange={() => {}} // Handled by parent li onClick
                        className="mt-0.5 rounded bg-slate-950 border-slate-700 text-purple-600 focus:ring-0 cursor-pointer"
                      />
                      <span
                        className={`text-xs leading-tight font-sans ${
                          t.completed ? 'line-through text-slate-500' : 'text-slate-200'
                        }`}
                      >
                        {t.taskText}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Add New Task to Note */}
              <form onSubmit={handleAddTask} className="flex items-center gap-2 pt-2">
                <input
                  type="text"
                  placeholder="+ Add sprint task item..."
                  value={newTaskInput}
                  onChange={(e) => setNewTaskInput(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-purple-500"
                />
                <button
                  type="submit"
                  disabled={!newTaskInput.trim()}
                  className="px-2.5 py-1 bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 text-white rounded text-[11px] font-mono transition-colors shrink-0"
                >
                  Add
                </button>
              </form>
            </div>

            {/* Raw Markdown Preview Toggle */}
            <div className="pt-2 border-t border-slate-800">
              <details className="text-[11px] text-slate-400 font-mono">
                <summary className="cursor-pointer hover:text-slate-200 py-1">View Full Markdown</summary>
                <pre className="mt-2 p-2.5 bg-slate-950 rounded border border-slate-800 text-[10px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {rawNoteContent || '# Empty or uninitialized note'}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>

      {/* Footer / Status Bar */}
      <footer className="px-4 py-2 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>FTS5 Sync Active</span>
        </div>
        <span>.aether/vault</span>
      </footer>
    </aside>
  );
};
