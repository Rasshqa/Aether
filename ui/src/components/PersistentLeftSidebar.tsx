import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  useAetherStore,
  toggleAetherDriveSidebar,
  setAetherDriveActiveTab,
  toggleAetherDrivePathExpanded,
  readWorkspaceDirectory,
  searchWorkspaceFiles,
  readWorkspaceFile,
  claimModule,
  routePromptToAgent,
  sendPtyInput,
  runWorkflow,
  extractWorkflowParams,
  loadWorkflows,
  toggleAiAssistant,
  toggleAiSettings,
  toggleSidebarMinimized,
  WorkspaceFileEntry,
  WorkspaceSearchMatch,
  WorkspaceFileContent,
  AetherWorkflow,
} from '../stores/aetherStore';
import {
  FolderTree,
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  Terminal,
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Search,
  Workflow as WorkflowIcon,
  Play,
  Copy,
  Check,
  Lock,
  Sparkles,
  RefreshCw,
  X,
  Eye,
} from 'lucide-react';

// ==========================================
// Logo
// ==========================================

export const AetherCortexLogo: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`${className} shrink-0 select-none filter drop-shadow-[0_0_8px_rgba(0,240,255,0.4)]`}
    aria-label="AetherCortex Terminal Logo"
  >
    {/* Terminal Window Frame */}
    <rect x="8" y="14" width="84" height="72" rx="10" fill="#0E1418" stroke="#00F0FF" strokeWidth="3" />
    <line x1="8" y1="34" x2="92" y2="34" stroke="#162026" strokeWidth="2" />
    <circle cx="22" cy="24" r="3.5" fill="#FF3B5C" />
    <circle cx="34" cy="24" r="3.5" fill="#FFB800" />
    <circle cx="46" cy="24" r="3.5" fill="#00E599" />
    {/* Terminal Command Prompt >_ */}
    <path d="M26 48L42 60L26 72" stroke="#00F0FF" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="48" y1="72" x2="72" y2="72" stroke="#00F0FF" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);

// ==========================================
// File Tree Utilities
// ==========================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(name: string, isDir: boolean, isExpanded?: boolean) {
  if (isDir) {
    return isExpanded ? (
      <FolderOpen className="w-3.5 h-3.5 text-cortex-accent shrink-0" />
    ) : (
      <Folder className="w-3.5 h-3.5 text-cortex-textMuted shrink-0" />
    );
  }
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
    case 'txt':
      return <FileText className="w-3.5 h-3.5 text-cortex-accent/70 shrink-0" />;
    case 'rs':
      return <FileCode className="w-3.5 h-3.5 text-orange-400 shrink-0" />;
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'json':
      return <FileJson className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case 'sh':
    case 'bash':
    case 'zsh':
      return <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'toml':
    case 'yaml':
    case 'yml':
    case 'env':
    case 'ini':
    case 'conf':
      return <Settings className="w-3.5 h-3.5 text-cortex-textMuted shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-cortex-textMuted/60 shrink-0" />;
  }
}

// ==========================================
// Workspace Drive Panel (embedded in sidebar)
// ==========================================

const WorkspaceDrivePanel: React.FC = () => {
  const store = useAetherStore();
  const activePane = store.panes.find((p) => p.id === store.activePaneId);
  const activeWorktree = activePane?.worktreePath || '.';

  const [treeCache, setTreeCache] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileEntry | null>(null);
  const [fileContent, setFileContent] = useState<WorkspaceFileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileActionNotice, setFileActionNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const [workflowFilter, setWorkflowFilter] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState<AetherWorkflow | null>(null);
  const [workflowParams, setWorkflowParams] = useState<Record<string, string>>({});
  const [workflowRunNotice, setWorkflowRunNotice] = useState<string | null>(null);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoadingPaths((prev) => new Set(prev).add(dirPath));
    try {
      const entries = await readWorkspaceDirectory(dirPath);
      const sorted = [...entries].sort((a, b) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
      });
      setTreeCache((prev) => ({ ...prev, [dirPath]: sorted }));
    } catch (e) {
      console.warn(`Failed to read directory '${dirPath}':`, e);
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    void loadDirectory('');
  }, [loadDirectory, store.obsidianRefreshTick]);

  useEffect(() => {
    for (const p of store.aetherDriveExpandedPaths) {
      if (!treeCache[p] || store.obsidianRefreshTick > 0) {
        void loadDirectory(p);
      }
    }
  }, [store.aetherDriveExpandedPaths, treeCache, loadDirectory, store.obsidianRefreshTick]);

  useEffect(() => {
    if (store.aetherDriveActiveTab === 'workflows') {
      void loadWorkflows();
    }
  }, [store.aetherDriveActiveTab]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchWorkspaceFiles(q, 100);
        if (caseSensitive) {
          setSearchResults(results.filter((m) => m.line_content.includes(q)));
        } else {
          setSearchResults(results);
        }
      } catch (e) {
        console.warn('Workspace search failed:', e);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, caseSensitive]);

  const inspectFile = async (entry: WorkspaceFileEntry) => {
    setSelectedFile(entry);
    setFileActionNotice(null);
    setLoadingFile(true);
    try {
      const content = await readWorkspaceFile(entry.path);
      setFileContent(content);
    } catch (e) {
      setFileContent({
        relative_path: entry.path,
        content: `Error loading file: ${String(e)}`,
        total_bytes: entry.size_bytes,
        is_truncated: false,
      });
    } finally {
      setLoadingFile(false);
    }
  };

  const openInTerminal = async (path: string) => {
    const paneId = store.activePaneId;
    if (!paneId) { setFileActionNotice('No active terminal pane'); return; }
    await sendPtyInput(paneId, `cat ${path}\n`);
    setFileActionNotice(`cat ${path}`);
    setTimeout(() => setFileActionNotice(null), 2500);
  };

  const copyFilePath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setFileActionNotice('Path copied!');
      setTimeout(() => setFileActionNotice(null), 2000);
    } catch (e) {
      setFileActionNotice(`Copy failed: ${String(e)}`);
    }
  };

  const askAiAboutFile = async (path: string) => {
    const prompt = `Explain file: ${path}`;
    setFileActionNotice('Routing to AI...');
    const pane = await routePromptToAgent(prompt, store.activePaneId || undefined);
    if (pane) {
      setFileActionNotice(`Dispatched to ${pane.cliType}`);
    } else {
      setFileActionNotice('Could not dispatch');
    }
    setTimeout(() => setFileActionNotice(null), 3000);
  };

  const claimModuleLock = async (path: string) => {
    const activeAgent = activePane?.cliType || (activePane ? `pane-${activePane.id}` : 'user');
    setFileActionNotice('Requesting lock...');
    try {
      const res = await claimModule(activeAgent, [path], 'Inspected in Aether Drive');
      if (res.granted) {
        setFileActionNotice(`Lock acquired`);
      } else {
        setFileActionNotice(`Conflict: ${res.conflicts.join(', ')}`);
      }
    } catch (e) {
      setFileActionNotice(`Lock failed: ${String(e)}`);
    }
    setTimeout(() => setFileActionNotice(null), 3500);
  };

  const groupedSearchResults = useMemo(() => {
    const map = new Map<string, WorkspaceSearchMatch[]>();
    for (const match of searchResults) {
      const list = map.get(match.file_path) || [];
      list.push(match);
      map.set(match.file_path, list);
    }
    return Array.from(map.entries());
  }, [searchResults]);

  const filteredWorkflows = useMemo(() => {
    const q = workflowFilter.trim().toLowerCase();
    if (!q) return store.workflows;
    return store.workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [store.workflows, workflowFilter]);

  const activeParams = useMemo(() => {
    return selectedWorkflow ? extractWorkflowParams(selectedWorkflow.commandTemplate) : [];
  }, [selectedWorkflow]);

  const canRunWorkflow =
    selectedWorkflow && activeParams.every((p) => (workflowParams[p] || '').trim().length > 0);

  const handleRunWorkflow = async () => {
    if (!selectedWorkflow) return;
    const ok = await runWorkflow(
      selectedWorkflow.commandTemplate,
      workflowParams,
      store.activePaneId || undefined
    );
    setWorkflowRunNotice(ok ? 'Workflow executed!' : 'Failed: No active terminal pane');
    setTimeout(() => setWorkflowRunNotice(null), 3000);
  };

  const renderTreeItem = (entry: WorkspaceFileEntry, depth: number = 0) => {
    const isExpanded = store.aetherDriveExpandedPaths.includes(entry.path);
    const isLoading = loadingPaths.has(entry.path);
    const isSelected = selectedFile?.path === entry.path;
    const children = treeCache[entry.path] || [];

    return (
      <div key={entry.path} className="flex flex-col select-none">
        <div
          onClick={() => {
            if (entry.is_dir) {
              toggleAetherDrivePathExpanded(entry.path);
              if (!isExpanded && !treeCache[entry.path]) {
                void loadDirectory(entry.path);
              }
            } else {
              void inspectFile(entry);
            }
          }}
          className={`group flex items-center gap-1.5 py-1 px-2 cursor-pointer transition-colors text-xs font-mono ${
            isSelected
              ? 'bg-sky-500/10 text-sky-300 font-semibold border-l-2 border-cortex-accent'
              : 'hover:bg-cortex-surface2 text-cortex-textMuted hover:text-cortex-text'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {entry.is_dir ? (
            <span className="shrink-0">
              {isLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin text-cortex-accent" />
              ) : isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}

          {getFileIcon(entry.name, entry.is_dir, isExpanded)}

          <span className="truncate flex-1" title={entry.path}>
            {entry.name}
          </span>

          {!entry.is_dir && entry.size_bytes > 0 && (
            <span className="text-[9px] text-cortex-textMuted/50 hidden group-hover:inline font-mono">
              {formatBytes(entry.size_bytes)}
            </span>
          )}
        </div>

        {entry.is_dir && isExpanded && (
          <div className="flex flex-col">
            {children.length === 0 && !isLoading ? (
              <div
                className="py-1 text-[10px] text-cortex-textMuted/50 italic"
                style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
              >
                empty
              </div>
            ) : (
              children.map((child) => renderTreeItem(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 max-h-full flex flex-col overflow-hidden shrink-0 flex-1 animate-slideDown" data-testid="aether-drive-sidebar">
      {/* Workspace path label */}
      <div className="px-3 py-1.5 border-b border-cortex-border flex items-center justify-between text-[10px] text-cortex-textMuted">
        <span className="truncate font-mono" title={activeWorktree}>
          ROOT: <span className="text-cortex-text">{activeWorktree}</span>
        </span>
        <button
          onClick={() => loadDirectory('')}
          className="p-1 text-cortex-textMuted hover:text-cortex-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-cortex-border text-[10px] shrink-0">
        <button
          onClick={() => setAetherDriveActiveTab('tree')}
          className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors border-b-2 font-semibold ${
            store.aetherDriveActiveTab === 'tree'
              ? 'border-cortex-accent text-sky-300'
              : 'border-transparent text-cortex-textMuted hover:text-cortex-text'
          }`}
          data-testid="tab-tree"
        >
          <FolderTree className="w-3 h-3" />
          <span>Files</span>
        </button>

        <button
          onClick={() => setAetherDriveActiveTab('search')}
          className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors border-b-2 font-semibold ${
            store.aetherDriveActiveTab === 'search'
              ? 'border-cortex-accent text-sky-300'
              : 'border-transparent text-cortex-textMuted hover:text-cortex-text'
          }`}
          data-testid="tab-search"
        >
          <Search className="w-3 h-3" />
          <span>Search</span>
        </button>

        <button
          onClick={() => setAetherDriveActiveTab('workflows')}
          className={`flex-1 py-2 flex items-center justify-center gap-1 transition-colors border-b-2 font-semibold ${
            store.aetherDriveActiveTab === 'workflows'
              ? 'border-cortex-accent text-sky-300'
              : 'border-transparent text-cortex-textMuted hover:text-cortex-text'
          }`}
          data-testid="tab-workflows"
        >
          <WorkflowIcon className="w-3 h-3" />
          <span>Workflows</span>
        </button>
      </div>

      {/* Tab: Files */}
      {store.aetherDriveActiveTab === 'tree' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto p-1 space-y-px" data-testid="file-tree-container">
            {loadingPaths.has('') && !treeCache[''] ? (
              <div className="flex items-center justify-center p-6 text-xs text-cortex-textMuted gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-cortex-accent" />
                <span>Reading files...</span>
              </div>
            ) : (treeCache[''] || []).length === 0 ? (
              <div className="p-4 text-xs text-cortex-textMuted text-center">
                Workspace is empty.
              </div>
            ) : (
              (treeCache[''] || []).map((entry) => renderTreeItem(entry, 0))
            )}
          </div>

          {selectedFile && (
            <div
              className="border-t border-cortex-border bg-cortex-bg flex flex-col max-h-64 shrink-0"
              data-testid="file-inspection-card"
            >
              <div className="h-8 px-2.5 border-b border-cortex-border flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5 truncate text-cortex-textMuted">
                  <Eye className="w-3 h-3 text-cortex-accent shrink-0" />
                  <span className="font-mono text-cortex-text truncate">{selectedFile.name}</span>
                  <span>({formatBytes(selectedFile.size_bytes)})</span>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 text-cortex-textMuted hover:text-cortex-text"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {fileActionNotice && (
                <div className="px-2 py-1 bg-cortex-accent/10 border-b border-cortex-accent/20 text-[10px] text-cortex-accent flex items-center gap-1">
                  <Check className="w-3 h-3 shrink-0" />
                  <span className="truncate">{fileActionNotice}</span>
                </div>
              )}

              <div className="p-1.5 border-b border-cortex-border flex items-center gap-1 text-[10px] overflow-x-auto">
                <button
                  onClick={() => openInTerminal(selectedFile.path)}
                  className="px-2 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 text-cortex-text flex items-center gap-1 shrink-0 transition-colors border border-cortex-border"
                  title="cat file in terminal"
                  data-testid="btn-open-terminal"
                >
                  <Terminal className="w-3 h-3 text-cortex-accent" />
                  <span>Open</span>
                </button>

                <button
                  onClick={() => copyFilePath(selectedFile.path)}
                  className="px-2 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 text-cortex-text flex items-center gap-1 shrink-0 transition-colors border border-cortex-border"
                  title="Copy path"
                  data-testid="btn-copy-path"
                >
                  <Copy className="w-3 h-3 text-cortex-accent" />
                  <span>Copy</span>
                </button>

                <button
                  onClick={() => askAiAboutFile(selectedFile.path)}
                  className="px-2 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 text-cortex-text flex items-center gap-1 shrink-0 transition-colors border border-cortex-border"
                  title="Ask AI"
                  data-testid="btn-ask-ai"
                >
                  <Sparkles className="w-3 h-3 text-cortex-accent" />
                  <span>Ask AI</span>
                </button>

                <button
                  onClick={() => claimModuleLock(selectedFile.path)}
                  className="px-2 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 text-cortex-text flex items-center gap-1 shrink-0 transition-colors border border-cortex-border"
                  title="Claim lock"
                  data-testid="btn-claim-lock"
                >
                  <Lock className="w-3 h-3 text-cortex-textMuted" />
                  <span>Lock</span>
                </button>
              </div>

              <div className="flex-1 min-h-[60px] max-h-36 overflow-y-auto p-2 text-[10px] text-cortex-text font-mono leading-relaxed select-text">
                {loadingFile ? (
                  <div className="flex items-center gap-2 text-cortex-textMuted">
                    <RefreshCw className="w-3 h-3 animate-spin text-cortex-accent" />
                    <span>Loading preview...</span>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono">
                    {fileContent?.content || '(empty file)'}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Search */}
      {store.aetherDriveActiveTab === 'search' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-2 space-y-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-cortex-textMuted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workspace..."
              className="w-full pl-8 pr-7 py-1.5 bg-cortex-surface1 border border-cortex-border text-xs text-cortex-text placeholder-cortex-textMuted/50 focus:outline-none focus:border-cortex-accent font-mono"
              data-testid="input-workspace-search"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 text-cortex-textMuted hover:text-cortex-text">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-cortex-textMuted px-1">
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={`px-1.5 py-0.5 border transition-colors font-mono ${
                caseSensitive
                  ? 'bg-cortex-accent/10 border-cortex-accent/40 text-cortex-accent'
                  : 'border-cortex-border text-cortex-textMuted hover:text-cortex-text'
              }`}
            >
              Aa Match Case
            </button>
            <span>{searchResults.length} matches</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto space-y-1.5" data-testid="search-results-list">
            {searching ? (
              <div className="flex items-center justify-center p-6 text-xs text-cortex-textMuted gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-cortex-accent" />
                <span>Searching...</span>
              </div>
            ) : searchQuery && searchResults.length === 0 ? (
              <div className="p-4 text-xs text-cortex-textMuted text-center font-mono">
                No matches found.
              </div>
            ) : (
              groupedSearchResults.map(([filePath, matches]) => (
                <div key={filePath} className="border border-cortex-border overflow-hidden">
                  <div
                    onClick={() => {
                      void inspectFile({
                        name: filePath.split('/').pop() || filePath,
                        path: filePath,
                        is_dir: false,
                        is_symlink: false,
                        size_bytes: 0,
                      });
                      setAetherDriveActiveTab('tree');
                    }}
                    className="px-2 py-1 bg-cortex-surface1 flex items-center justify-between text-[10px] font-semibold text-cortex-text hover:bg-cortex-surface2 cursor-pointer transition-colors"
                  >
                    <span className="truncate flex-1 font-mono" title={filePath}>{filePath}</span>
                    <span className="text-[9px] text-cortex-accent bg-cortex-accent/10 px-1.5 py-0.5 font-mono ml-2">
                      {matches.length}
                    </span>
                  </div>

                  <div className="divide-y divide-cortex-border">
                    {matches.map((m, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          void inspectFile({
                            name: filePath.split('/').pop() || filePath,
                            path: filePath,
                            is_dir: false,
                            is_symlink: false,
                            size_bytes: 0,
                          });
                          setAetherDriveActiveTab('tree');
                        }}
                        className="p-1.5 hover:bg-cortex-surface2 cursor-pointer text-[10px] font-mono transition-colors flex gap-2"
                      >
                        <span className="text-cortex-textMuted select-none shrink-0 w-6 text-right">
                          {m.line_number}:
                        </span>
                        <span className="text-cortex-text truncate flex-1">{m.line_content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab: Workflows */}
      {store.aetherDriveActiveTab === 'workflows' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-2 space-y-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-cortex-textMuted" />
            <input
              type="text"
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              placeholder="Filter workflows..."
              className="w-full pl-8 pr-7 py-1.5 bg-cortex-surface1 border border-cortex-border text-xs text-cortex-text placeholder-cortex-textMuted/50 focus:outline-none focus:border-cortex-accent font-mono"
              data-testid="input-workflow-filter"
            />
            {workflowFilter && (
              <button onClick={() => setWorkflowFilter('')} className="absolute right-2 text-cortex-textMuted hover:text-cortex-text">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {workflowRunNotice && (
            <div className="px-2 py-1.5 bg-cortex-success/10 border border-cortex-success/30 text-[10px] text-cortex-success flex items-center gap-1.5">
              <Check className="w-3 h-3 shrink-0" />
              <span>{workflowRunNotice}</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto space-y-1.5" data-testid="workflows-list">
            {filteredWorkflows.length === 0 ? (
              <div className="p-4 text-xs text-cortex-textMuted text-center font-mono">
                No workflows match filter.
              </div>
            ) : (
              filteredWorkflows.map((wf) => {
                const isSelected = selectedWorkflow?.id === wf.id;
                const wfActiveParams = isSelected ? extractWorkflowParams(wf.commandTemplate) : [];
                const wfCanRun = isSelected && wfActiveParams.every((p) => (workflowParams[p] || '').trim().length > 0);

                return (
                  <div
                    key={wf.id}
                    className={`border transition-colors ${
                      isSelected
                        ? 'border-cortex-accent/40 bg-cortex-accent/5'
                        : 'border-cortex-border bg-cortex-surface1 hover:bg-cortex-surface2'
                    }`}
                  >
                    <div
                      onClick={() => {
                        if (isSelected) {
                          setSelectedWorkflow(null);
                        } else {
                          setSelectedWorkflow(wf);
                          setWorkflowParams({});
                        }
                      }}
                      className="p-2.5 cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-cortex-text">
                        <span>{wf.name}</span>
                        <WorkflowIcon className="w-3.5 h-3.5 text-cortex-accent shrink-0" />
                      </div>
                      <div className="text-[10px] text-cortex-textMuted mt-0.5 line-clamp-2">
                        {wf.description}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {wf.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[9px] px-1 py-px bg-cortex-surface2 text-cortex-textMuted font-mono border border-cortex-border"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>

                    {isSelected && (
                      <div className="p-2 border-t border-cortex-border space-y-2">
                        {wfActiveParams.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-semibold text-cortex-textMuted">Parameters:</span>
                            {wfActiveParams.map((param) => (
                              <div key={param} className="space-y-0.5">
                                <label className="text-[9px] font-mono text-cortex-textMuted uppercase">{param}</label>
                                <input
                                  type="text"
                                  value={workflowParams[param] || ''}
                                  onChange={(e) =>
                                    setWorkflowParams((prev) => ({ ...prev, [param]: e.target.value }))
                                  }
                                  placeholder={`Enter ${param}...`}
                                  className="w-full px-2 py-1 bg-cortex-bg border border-cortex-border text-[10px] text-cortex-text font-mono focus:outline-none focus:border-cortex-accent"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={handleRunWorkflow}
                          disabled={!wfCanRun && wfActiveParams.length > 0}
                          className={`w-full py-1.5 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors border ${
                            wfCanRun || wfActiveParams.length === 0
                              ? 'bg-cortex-accent text-cortex-bg border-cortex-accent hover:bg-cortex-accentHover'
                              : 'bg-cortex-surface2 text-cortex-textMuted/50 border-cortex-border cursor-not-allowed'
                          }`}
                          data-testid="btn-run-workflow"
                        >
                          <Play className="w-3 h-3" />
                          <span>Run Workflow</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// Main PersistentLeftSidebar (Unified)
// ==========================================

export interface PersistentLeftSidebarProps {
  activeSection?: 'terminal' | 'assistant' | 'workspace' | 'settings';
  onSelectSection?: (section: 'terminal' | 'assistant' | 'workspace' | 'settings') => void;
  onToggleAiAssistant?: () => void;
  aiAssistantOpen?: boolean;
}

export const PersistentLeftSidebar: React.FC<PersistentLeftSidebarProps> = ({
  activeSection,
  onSelectSection,
  onToggleAiAssistant,
  aiAssistantOpen,
}) => {
  const store = useAetherStore();

  const isAssistantActive = typeof aiAssistantOpen === 'boolean' ? aiAssistantOpen : store.aiAssistantOpen;
  const isWorkspaceActive = store.aetherDriveSidebarOpen;
  const isSettingsActive = store.aiSettingsOpen || store.themeModalOpen;
  const isTerminalActive =
    activeSection === 'terminal' ||
    (!isWorkspaceActive && !isAssistantActive && !isSettingsActive);

  const isMinimized = store.sidebarMinimized;
  // Sidebar collapses to w-16 when minimized; when expanded, it is w-72 if Workspace is active or w-[200px] default
  const sidebarWidth = isMinimized ? 'w-16' : isWorkspaceActive ? 'w-72' : 'w-[200px]';

  const handleNavClick = (section: 'terminal' | 'assistant' | 'workspace' | 'settings') => {
    if (onSelectSection) onSelectSection(section);

    if (section === 'workspace') {
      toggleAetherDriveSidebar(!isWorkspaceActive);
    } else if (section === 'assistant') {
      if (onToggleAiAssistant) {
        onToggleAiAssistant();
      } else {
        toggleAiAssistant();
      }
    } else if (section === 'settings') {
      toggleAiSettings(true);
    }
  };

  return (
    <aside
      className={`${sidebarWidth} h-full min-h-0 max-h-full flex flex-col overflow-hidden shrink-0 select-none bg-cortex-bgAlt border-r border-cortex-border font-sans z-30 transition-all duration-200`}
      data-testid="persistent-left-sidebar"
    >
      {/* Brand Header */}
      {isMinimized ? (
        <div className="py-3 px-2 flex flex-col items-center justify-center gap-2 border-b border-cortex-border shrink-0">
          <button
            onClick={() => toggleSidebarMinimized(false)}
            className="hover:scale-105 transition-transform cursor-pointer"
            title="Expand Sidebar"
            data-testid="btn-expand-sidebar"
          >
            <AetherCortexLogo className="w-8 h-8" />
          </button>
          <button
            onClick={() => toggleSidebarMinimized(false)}
            className="p-1 text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2 rounded transition-colors"
            title="Expand Sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="py-3.5 px-3 flex items-center justify-between border-b border-cortex-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <AetherCortexLogo className="w-8 h-8" />
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm tracking-tight text-cortex-text truncate">
                AetherCortex
              </span>
              <span className="text-[10px] text-cortex-textMuted font-mono truncate">
                {isWorkspaceActive ? 'Workspace Drive' : 'Terminal Studio'}
              </span>
            </div>
          </div>
          <button
            onClick={() => toggleSidebarMinimized(true)}
            className="p-1.5 text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2 rounded transition-colors shrink-0"
            title="Minimize Sidebar"
            data-testid="btn-minimize-sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className={`p-2 space-y-1 shrink-0 ${isMinimized ? 'flex flex-col items-center' : ''}`} aria-label="Main Navigation">
        {/* Terminal */}
        <button
          onClick={() => handleNavClick('terminal')}
          className={`relative flex items-center transition-colors text-left rounded-none ${
            isMinimized ? 'w-10 h-10 justify-center' : 'w-full gap-3 px-3 py-2.5 text-xs font-medium'
          } ${
            isTerminalActive
              ? 'text-cortex-text bg-cortex-surface1'
              : 'text-cortex-textMuted hover:text-cortex-text hover:bg-cortex-surface2'
          }`}
          data-testid="nav-terminal"
          title="Terminal"
        >
          {isTerminalActive && (
            <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-cortex-accent" />
          )}
          <span className="font-mono text-[11px] font-bold text-cortex-accent shrink-0">&gt;_</span>
          {!isMinimized && <span>Terminal</span>}
        </button>

        {/* AI Assistant */}
        <button
          onClick={() => handleNavClick('assistant')}
          className={`relative flex items-center transition-colors text-left rounded-none ${
            isMinimized ? 'w-10 h-10 justify-center' : 'w-full gap-3 px-3 py-2.5 text-xs font-medium'
          } ${
            isAssistantActive
              ? 'text-cortex-text bg-cortex-surface1'
              : 'text-cortex-textMuted hover:text-cortex-text hover:bg-cortex-surface2'
          }`}
          data-testid="nav-assistant"
          title="AI Assistant"
        >
          {isAssistantActive && (
            <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-cortex-accent" />
          )}
          <Sparkles className="w-3.5 h-3.5 text-cortex-accent shrink-0" />
          {!isMinimized && <span>AI Assistant</span>}
        </button>

        {/* Workspace */}
        <button
          onClick={() => {
            if (isMinimized) {
              toggleSidebarMinimized(false);
              toggleAetherDriveSidebar(true);
              if (onSelectSection) onSelectSection('workspace');
            } else {
              handleNavClick('workspace');
            }
          }}
          className={`relative flex items-center transition-colors text-left rounded-none ${
            isMinimized ? 'w-10 h-10 justify-center' : 'w-full gap-3 px-3 py-2.5 text-xs font-medium'
          } ${
            isWorkspaceActive
              ? 'text-cortex-text bg-cortex-surface1'
              : 'text-cortex-textMuted hover:text-cortex-text hover:bg-cortex-surface2'
          }`}
          data-testid="nav-workspace"
          title="Workspace (Ctrl+\)"
        >
          {isWorkspaceActive && (
            <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-cortex-accent" />
          )}
          <FolderTree className="w-3.5 h-3.5 text-cortex-accent shrink-0" />
          {!isMinimized && (
            <div className="flex-1 flex items-center justify-between min-w-0">
              <span>Workspace</span>
              <kbd className="text-[9px] font-mono px-1 py-px bg-cortex-surface2 border border-cortex-border text-cortex-textMuted shrink-0">
                Ctrl+\
              </kbd>
            </div>
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => handleNavClick('settings')}
          className={`relative flex items-center transition-colors text-left rounded-none ${
            isMinimized ? 'w-10 h-10 justify-center' : 'w-full gap-3 px-3 py-2.5 text-xs font-medium'
          } ${
            isSettingsActive
              ? 'text-cortex-text bg-cortex-surface1'
              : 'text-cortex-textMuted hover:text-cortex-text hover:bg-cortex-surface2'
          }`}
          data-testid="nav-settings"
          title="Settings"
        >
          {isSettingsActive && (
            <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-cortex-accent" />
          )}
          <Settings className="w-3.5 h-3.5 text-cortex-textMuted shrink-0" />
          {!isMinimized && <span>Settings</span>}
        </button>
      </nav>

      {/* Workspace Drive content: inline when active and not minimized */}
      {!isMinimized && isWorkspaceActive && (
        <div className="flex-1 min-h-0 max-h-full overflow-hidden border-t border-cortex-border flex flex-col shrink-0">
          <WorkspaceDrivePanel />
        </div>
      )}

      {/* Bottom Branding & Toggle */}
      <div className={`mt-auto border-t border-cortex-border ${isMinimized ? 'p-2 flex flex-col items-center gap-2' : 'p-3 flex items-center justify-between'}`}>
        {!isMinimized && (
          <div className="flex items-center gap-2 select-none min-w-0">
            <span className="w-[2px] h-6 bg-cortex-accent shrink-0" />
            <div className="flex flex-col text-[8px] font-bold uppercase tracking-wider text-cortex-textMuted leading-tight truncate">
              <span>BETTER TOOLS.</span>
              <span>BIGGER POSSIBILITIES.</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 3 Angled Cyan Blocks */}
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-3.5 bg-cortex-accent -skew-x-[24deg] shadow-[0_0_6px_rgba(0,240,255,0.4)]" />
            <span className="w-2.5 h-3.5 bg-cortex-accent -skew-x-[24deg] shadow-[0_0_6px_rgba(0,240,255,0.4)]" />
            <span className="w-2.5 h-3.5 bg-cortex-accent -skew-x-[24deg] shadow-[0_0_6px_rgba(0,240,255,0.4)]" />
            <span className="sr-only">///</span>
          </div>
          <button
            onClick={() => toggleSidebarMinimized(!isMinimized)}
            className="p-1 text-cortex-textMuted hover:text-cortex-accent hover:bg-cortex-surface2 rounded transition-colors ml-1"
            title={isMinimized ? 'Expand Sidebar' : 'Minimize Sidebar'}
            aria-label={isMinimized ? 'Expand Sidebar' : 'Minimize Sidebar'}
          >
            {isMinimized ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
};
