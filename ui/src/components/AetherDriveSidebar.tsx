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
  renderWorkflowTemplate,
  loadWorkflows,
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
  ExternalLink,
  Eye,
  Sliders,
} from 'lucide-react';

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
      <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
    ) : (
      <Folder className="w-3.5 h-3.5 text-cyan-500/80 shrink-0" />
    );
  }
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
    case 'txt':
      return <FileText className="w-3.5 h-3.5 text-cyan-300 shrink-0" />;
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
      return <Settings className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  }
}

export const AetherDriveSidebar: React.FC = () => {
  const store = useAetherStore();
  const activePane = store.panes.find((p) => p.id === store.activePaneId);
  const activeWorktree = activePane?.worktreePath || '.';

  // --------------------------------------------------------------------------
  // File Tree State
  // --------------------------------------------------------------------------
  const [treeCache, setTreeCache] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileEntry | null>(null);
  const [fileContent, setFileContent] = useState<WorkspaceFileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileActionNotice, setFileActionNotice] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // Search State
  // --------------------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  // --------------------------------------------------------------------------
  // Workflows State
  // --------------------------------------------------------------------------
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState<AetherWorkflow | null>(null);
  const [workflowParams, setWorkflowParams] = useState<Record<string, string>>({});
  const [workflowRunNotice, setWorkflowRunNotice] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // Directory Loader
  // --------------------------------------------------------------------------
  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoadingPaths((prev) => new Set(prev).add(dirPath));
    try {
      const entries = await readWorkspaceDirectory(dirPath);
      // Sort directories first, then alphabetical
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

  // Initial root directory load
  useEffect(() => {
    if (store.aetherDriveSidebarOpen) {
      void loadDirectory('');
    }
  }, [store.aetherDriveSidebarOpen, loadDirectory, store.obsidianRefreshTick]);

  // Load expanded folders from store
  useEffect(() => {
    if (store.aetherDriveSidebarOpen) {
      for (const p of store.aetherDriveExpandedPaths) {
        if (!treeCache[p] || store.obsidianRefreshTick > 0) {
          void loadDirectory(p);
        }
      }
    }
  }, [store.aetherDriveSidebarOpen, store.aetherDriveExpandedPaths, treeCache, loadDirectory, store.obsidianRefreshTick]);

  // Sync workflows when switching to workflows tab
  useEffect(() => {
    if (store.aetherDriveSidebarOpen && store.aetherDriveActiveTab === 'workflows') {
      void loadWorkflows();
    }
  }, [store.aetherDriveSidebarOpen, store.aetherDriveActiveTab]);

  // --------------------------------------------------------------------------
  // Debounced Workspace Search
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // File Selection & Inspection
  // --------------------------------------------------------------------------
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
    if (!paneId) {
      setFileActionNotice('No active terminal pane');
      return;
    }
    await sendPtyInput(paneId, `cat ${path}\n`);
    setFileActionNotice(`Executed cat ${path} in active pane`);
    setTimeout(() => setFileActionNotice(null), 3000);
  };

  const copyFilePath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setFileActionNotice('Path copied to clipboard!');
      setTimeout(() => setFileActionNotice(null), 2500);
    } catch (e) {
      setFileActionNotice(`Copy failed: ${String(e)}`);
    }
  };

  const askAiAboutFile = async (path: string) => {
    const prompt = `Explain file: ${path}`;
    setFileActionNotice('Routing prompt to AI agent...');
    const pane = await routePromptToAgent(prompt, store.activePaneId || undefined);
    if (pane) {
      setFileActionNotice(`Dispatched to ${pane.cliType}`);
    } else {
      setFileActionNotice('Could not dispatch to agent');
    }
    setTimeout(() => setFileActionNotice(null), 3500);
  };

  const claimModuleLock = async (path: string) => {
    const activeAgent =
      activePane?.cliType || (activePane ? `pane-${activePane.id}` : 'user');
    setFileActionNotice('Requesting file lock...');
    try {
      const res = await claimModule(activeAgent, [path], 'Inspected in Aether Drive');
      if (res.granted) {
        setFileActionNotice(`Lock acquired for ${path}`);
      } else {
        setFileActionNotice(`Lock conflict: ${res.conflicts.join(', ')}`);
      }
    } catch (e) {
      setFileActionNotice(`Lock failed: ${String(e)}`);
    }
    setTimeout(() => setFileActionNotice(null), 4000);
  };

  // Group search results by file
  const groupedSearchResults = useMemo(() => {
    const map = new Map<string, WorkspaceSearchMatch[]>();
    for (const match of searchResults) {
      const list = map.get(match.file_path) || [];
      list.push(match);
      map.set(match.file_path, list);
    }
    return Array.from(map.entries());
  }, [searchResults]);

  // Filter workflows
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
    return selectedWorkflow
      ? extractWorkflowParams(selectedWorkflow.commandTemplate)
      : [];
  }, [selectedWorkflow]);

  const canRunWorkflow =
    selectedWorkflow &&
    activeParams.every((p) => (workflowParams[p] || '').trim().length > 0);

  const handleRunWorkflow = async () => {
    if (!selectedWorkflow) return;
    const ok = await runWorkflow(
      selectedWorkflow.commandTemplate,
      workflowParams,
      store.activePaneId || undefined
    );
    if (ok) {
      setWorkflowRunNotice('Workflow executed in active terminal!');
      setTimeout(() => setWorkflowRunNotice(null), 3000);
    } else {
      setWorkflowRunNotice('Failed: No active terminal pane');
      setTimeout(() => setWorkflowRunNotice(null), 3000);
    }
  };

  // Render tree item recursively
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
          className={`group flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer transition-colors text-xs font-mono ${
            isSelected
              ? 'bg-cyan-950/70 text-cyan-200 border-l-2 border-cyan-400'
              : 'hover:bg-slate-900 text-slate-300 hover:text-slate-100'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {entry.is_dir ? (
            <span className="p-0.5 text-slate-500 hover:text-slate-300">
              {isLoading ? (
                <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
              ) : isExpanded ? (
                <ChevronDown className="w-3 h-3 text-slate-400" />
              ) : (
                <ChevronRight className="w-3 h-3 text-slate-500" />
              )}
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {getFileIcon(entry.name, entry.is_dir, isExpanded)}

          <span className="truncate flex-1" title={entry.path}>
            {entry.name}
          </span>

          {!entry.is_dir && entry.size_bytes > 0 && (
            <span className="text-[10px] text-slate-600 hidden group-hover:inline font-mono">
              {formatBytes(entry.size_bytes)}
            </span>
          )}
        </div>

        {entry.is_dir && isExpanded && (
          <div className="flex flex-col">
            {children.length === 0 && !isLoading ? (
              <div
                className="py-1 text-[10px] text-slate-600 italic"
                style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}
              >
                (empty)
              </div>
            ) : (
              children.map((child) => renderTreeItem(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  };

  // If sidebar is closed, do not render into layout
  if (!store.aetherDriveSidebarOpen) {
    return null;
  }

  return (
    <aside
      className="w-80 border-r border-slate-800 shrink-0 h-full min-h-0 max-h-full flex flex-col overflow-hidden bg-slate-950/95 backdrop-blur z-20 select-none text-slate-200 font-mono"
      data-testid="aether-drive-sidebar"
    >
      {/* ================= HEADER ================= */}
      <div className="h-10 px-3 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/60">
        <div className="flex items-center gap-2 truncate">
          <FolderTree className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-xs font-bold tracking-wider text-slate-100 uppercase">
            Drive
          </span>
          <kbd className="text-[9px] bg-slate-900 text-slate-400 px-1 py-0.5 rounded border border-slate-800">
            Ctrl+\
          </kbd>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadDirectory('')}
            className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
            title="Refresh workspace directory"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => toggleAetherDriveSidebar(false)}
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Close sidebar (Ctrl+\)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ================= WORKSPACE DIRECTORY LABEL ================= */}
      <div className="px-3 py-1 bg-slate-950/80 border-b border-slate-900 flex items-center justify-between text-[10px] text-slate-500">
        <span className="truncate" title={activeWorktree}>
          ROOT: <span className="text-slate-300">{activeWorktree}</span>
        </span>
      </div>

      {/* ================= TAB SWITCHER ================= */}
      <div className="flex border-b border-slate-800 bg-slate-900/40 text-xs shrink-0">
        <button
          onClick={() => setAetherDriveActiveTab('tree')}
          className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors border-b-2 font-semibold ${
            store.aetherDriveActiveTab === 'tree'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
          data-testid="tab-tree"
        >
          <FolderTree className="w-3.5 h-3.5" />
          <span>Files</span>
        </button>

        <button
          onClick={() => setAetherDriveActiveTab('search')}
          className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors border-b-2 font-semibold ${
            store.aetherDriveActiveTab === 'search'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
          data-testid="tab-search"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search</span>
        </button>

        <button
          onClick={() => setAetherDriveActiveTab('workflows')}
          className={`flex-1 py-2 flex items-center justify-center gap-1.5 transition-colors border-b-2 font-semibold ${
            store.aetherDriveActiveTab === 'workflows'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
          data-testid="tab-workflows"
        >
          <WorkflowIcon className="w-3.5 h-3.5" />
          <span>Workflows</span>
        </button>
      </div>

      {/* ================= TAB 1: WORKSPACE FILE TREE & INSPECTION ================= */}
      {store.aetherDriveActiveTab === 'tree' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* File Tree List */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto p-1.5 space-y-0.5" data-testid="file-tree-container">
            {loadingPaths.has('') && !treeCache[''] ? (
              <div className="flex items-center justify-center p-6 text-xs text-slate-500 gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Reading workspace files...</span>
              </div>
            ) : (treeCache[''] || []).length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center">
                Workspace directory is empty.
              </div>
            ) : (
              (treeCache[''] || []).map((entry) => renderTreeItem(entry, 0))
            )}
          </div>

          {/* ================= FILE INSPECTION CARD ================= */}
          {selectedFile && (
            <div
              className="border-t border-slate-800 bg-slate-900/90 flex flex-col max-h-72 shrink-0 animate-fadeIn"
              data-testid="file-inspection-card"
            >
              <div className="h-8 px-2.5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950 text-xs">
                <div className="flex items-center gap-1.5 truncate">
                  <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="font-semibold text-slate-200 truncate" title={selectedFile.path}>
                    {selectedFile.name}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    ({formatBytes(selectedFile.size_bytes)})
                  </span>
                  {fileContent?.is_truncated && (
                    <span className="text-[9px] bg-amber-950 text-amber-300 px-1 py-0.2 rounded border border-amber-800">
                      truncated
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 rounded text-slate-400 hover:text-slate-100"
                  title="Close inspection card"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Action notice toast */}
              {fileActionNotice && (
                <div className="px-2 py-0.5 bg-cyan-950/80 border-b border-cyan-800/50 text-[10px] text-cyan-300 flex items-center gap-1">
                  <Check className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate">{fileActionNotice}</span>
                </div>
              )}

              {/* Action Buttons Toolbar */}
              <div className="p-1.5 bg-slate-950/60 border-b border-slate-800/60 flex items-center gap-1 text-[11px] overflow-x-auto">
                <button
                  onClick={() => openInTerminal(selectedFile.path)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 shrink-0 transition-colors"
                  title="Run cat <file> in active terminal pane"
                  data-testid="btn-open-terminal"
                >
                  <Terminal className="w-3 h-3 text-emerald-400" />
                  <span>Open</span>
                </button>

                <button
                  onClick={() => copyFilePath(selectedFile.path)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 shrink-0 transition-colors"
                  title="Copy relative file path to clipboard"
                  data-testid="btn-copy-path"
                >
                  <Copy className="w-3 h-3 text-sky-400" />
                  <span>Copy</span>
                </button>

                <button
                  onClick={() => askAiAboutFile(selectedFile.path)}
                  className="px-2 py-1 rounded bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-200 flex items-center gap-1 shrink-0 transition-colors"
                  title="Ask AI to explain file in agent pane"
                  data-testid="btn-ask-ai"
                >
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                  <span>Ask AI</span>
                </button>

                <button
                  onClick={() => claimModuleLock(selectedFile.path)}
                  className="px-2 py-1 rounded bg-purple-950/70 hover:bg-purple-900 border border-purple-700/50 text-purple-200 flex items-center gap-1 shrink-0 transition-colors"
                  title="Claim cooperative module lock"
                  data-testid="btn-claim-lock"
                >
                  <Lock className="w-3 h-3 text-purple-400" />
                  <span>Lock</span>
                </button>
              </div>

              {/* Content Preview */}
              <div className="flex-1 min-h-[80px] max-h-40 overflow-y-auto p-2 bg-slate-950/90 text-[10px] text-slate-300 font-mono leading-relaxed select-text">
                {loadingFile ? (
                  <div className="flex items-center justify-center p-4 gap-2 text-slate-500">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    <span>Loading file preview...</span>
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

      {/* ================= TAB 2: WORKSPACE TEXT SEARCH ================= */}
      {store.aetherDriveActiveTab === 'search' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-2 space-y-2">
          {/* Search Input Bar */}
          <div className="space-y-1.5">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search text in workspace..."
                className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-700/80 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                data-testid="input-workspace-search"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
              <button
                onClick={() => setCaseSensitive(!caseSensitive)}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  caseSensitive
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
                title="Match Case"
              >
                Aa Match Case
              </button>
              <span>{searchResults.length} matches</span>
            </div>
          </div>

          {/* Results List */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto space-y-2 pr-1" data-testid="search-results-list">
            {searching ? (
              <div className="flex items-center justify-center p-6 text-xs text-slate-500 gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Searching workspace...</span>
              </div>
            ) : searchQuery && searchResults.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center font-mono">
                No matching text found.
              </div>
            ) : (
              groupedSearchResults.map(([filePath, matches]) => (
                <div
                  key={filePath}
                  className="rounded border border-slate-800/80 bg-slate-900/60 overflow-hidden"
                >
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
                    className="px-2 py-1 bg-slate-950 flex items-center justify-between text-[11px] font-semibold text-slate-300 hover:bg-slate-900 cursor-pointer transition-colors"
                  >
                    <span className="truncate flex-1" title={filePath}>
                      {filePath}
                    </span>
                    <span className="text-[10px] text-cyan-400 bg-cyan-950/70 px-1.5 py-0.2 rounded font-mono">
                      {matches.length}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-800/40">
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
                        className="p-1.5 hover:bg-slate-800/40 cursor-pointer text-[10px] font-mono transition-colors flex gap-2"
                      >
                        <span className="text-slate-500 select-none shrink-0 w-6 text-right">
                          {m.line_number}:
                        </span>
                        <span className="text-slate-300 truncate flex-1">
                          {m.line_content}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: SAVED WORKFLOWS ================= */}
      {store.aetherDriveActiveTab === 'workflows' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-2 space-y-2">
          {/* Workflows Filter */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-500" />
            <input
              type="text"
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              placeholder="Filter workflows..."
              className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-700/80 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              data-testid="input-workflow-filter"
            />
            {workflowFilter && (
              <button
                onClick={() => setWorkflowFilter('')}
                className="absolute right-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Workflow Run Status Notice */}
          {workflowRunNotice && (
            <div className="px-2 py-1 bg-emerald-950/80 border border-emerald-700/60 rounded text-[10px] text-emerald-300 flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>{workflowRunNotice}</span>
            </div>
          )}

          {/* Workflows List */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto space-y-1.5 pr-1" data-testid="workflows-list">
            {filteredWorkflows.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 text-center font-mono">
                No workflows match filter.
              </div>
            ) : (
              filteredWorkflows.map((wf) => {
                const isSelected = selectedWorkflow?.id === wf.id;
                return (
                  <div
                    key={wf.id}
                    className={`rounded border transition-colors ${
                      isSelected
                        ? 'border-cyan-500/60 bg-cyan-950/20'
                        : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900'
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
                      className="p-2 cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                        <span>{wf.name}</span>
                        <WorkflowIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">
                        {wf.description}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {wf.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 font-mono"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Parameter inputs for selected workflow */}
                    {isSelected && (
                      <div className="p-2 border-t border-slate-800/80 bg-slate-950/80 space-y-2">
                        {activeParams.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-semibold text-slate-400">
                              Parameters:
                            </span>
                            {activeParams.map((param) => (
                              <div key={param} className="space-y-0.5">
                                <label className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">
                                  {param}
                                </label>
                                <input
                                  type="text"
                                  value={workflowParams[param] || ''}
                                  onChange={(e) =>
                                    setWorkflowParams((prev) => ({
                                      ...prev,
                                      [param]: e.target.value,
                                    }))
                                  }
                                  placeholder={`Value for ${param}...`}
                                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Live rendered command preview */}
                        <div className="text-[10px] font-mono text-slate-400 bg-slate-900 p-1.5 rounded border border-slate-800">
                          <span className="text-slate-600 select-none">$ </span>
                          <span className="text-cyan-300">
                            {renderWorkflowTemplate(
                              wf.commandTemplate,
                              workflowParams
                            )}
                          </span>
                        </div>

                        {/* Run in active pane */}
                        <button
                          onClick={handleRunWorkflow}
                          disabled={!canRunWorkflow}
                          className={`w-full py-1.5 rounded flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
                            canRunWorkflow
                              ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm shadow-cyan-600/30'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                          data-testid="btn-run-workflow"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Run in Active Pane</span>
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
    </aside>
  );
};
