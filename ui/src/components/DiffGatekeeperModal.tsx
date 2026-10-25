import React, { useMemo, useState } from 'react';
import {
  closeDiffGatekeeper,
  mergeWorktreeSquash,
  useAetherStore,
} from '../stores/aetherStore';
import {
  GitPullRequest,
  GitMerge,
  Check,
  X,
  FileCode,
  Plus,
  Minus,
  Copy,
  Search,
  Filter,
} from 'lucide-react';

export const DiffGatekeeperModal: React.FC = () => {
  const store = useAetherStore();
  const [commitMessage, setCommitMessage] = useState('feat: agent implementation squashed');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const diff = store.activeDiff;

  // Filter modified files list (called unconditionally to preserve hook order)
  const filteredFiles = useMemo(() => {
    if (!diff) return [];
    if (!fileFilter.trim()) return diff.files_changed;
    return diff.files_changed.filter((f) =>
      f.toLowerCase().includes(fileFilter.toLowerCase())
    );
  }, [diff, fileFilter]);

  // Extract per-file diff section if a file is selected (called unconditionally to preserve hook order)
  const displayedDiffLines = useMemo(() => {
    if (!diff) return [];
    const rawLines = diff.diff_unified.split('\n');
    if (!selectedFile) return rawLines;

    const result: string[] = [];
    let capturing = false;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.startsWith('diff --git ')) {
        // e.g. "diff --git a/foo/bar.ts b/foo/bar.ts"
        if (line.includes(`/${selectedFile}`) || line.endsWith(`/${selectedFile}`)) {
          capturing = true;
          result.push(line);
        } else {
          capturing = false;
        }
      } else if (capturing) {
        result.push(line);
      }
    }

    return result.length > 0 ? result : rawLines;
  }, [diff, selectedFile]);

  if (!store.diffGatekeeperOpen || !diff) return null;

  const handleMerge = () => {
    mergeWorktreeSquash(diff.pane_id, commitMessage);
  };

  const handleCopyDiff = async () => {
    try {
      await navigator.clipboard.writeText(diff.diff_unified);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy diff to clipboard', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-5xl h-[85vh] bg-tokyo-panel border border-tokyo-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
        {/* Header */}
        <div className="h-14 px-5 flex items-center justify-between border-b border-tokyo-border bg-tokyo-bgDark">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-tokyo-blue/10 border border-tokyo-blue/30 text-tokyo-blue">
              <GitPullRequest className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>Unified 3-Way Diff Gatekeeper</span>
                <span className="text-xs text-tokyo-cyan font-mono bg-tokyo-cyan/10 px-2 py-0.5 rounded border border-tokyo-cyan/20">
                  aether/{diff.pane_id} → master
                </span>
              </div>
              <div className="text-[11px] text-tokyo-comment flex items-center gap-3 mt-0.5">
                <span>{diff.files_changed.length} files changed</span>
                <span className="text-tokyo-green flex items-center gap-0.5 font-mono">
                  <Plus className="w-3 h-3" />
                  {diff.insertions}
                </span>
                <span className="text-tokyo-red flex items-center gap-0.5 font-mono">
                  <Minus className="w-3 h-3" />
                  {diff.deletions}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyDiff}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700"
              title="Copy entire unified diff to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Diff</span>
                </>
              )}
            </button>
            <button
              onClick={closeDiffGatekeeper}
              className="p-1.5 text-tokyo-comment hover:text-white rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left: Files Changed Sidebar */}
          <div className="w-72 border-r border-tokyo-border bg-tokyo-bgDark/60 flex flex-col p-3 min-h-0 overflow-hidden shrink-0">
            <div className="flex items-center justify-between text-xs font-semibold text-tokyo-comment uppercase tracking-wider mb-2 shrink-0">
              <span>Modified Files ({diff.files_changed.length})</span>
              {selectedFile && (
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-[10px] text-cyan-400 hover:underline normal-case font-normal"
                >
                  Show all
                </button>
              )}
            </div>

            {/* File search filter */}
            <div className="relative mb-2 shrink-0">
              <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
              <input
                type="text"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="Filter files..."
                className="w-full pl-6 pr-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 font-mono"
              />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain pointer-events-auto flex flex-col gap-1">
              {filteredFiles.map((file, i) => {
                const isSelected = selectedFile === file;
                const fileName = file.split('/').pop() || file;
                const dirPath = file.substring(0, file.lastIndexOf('/'));

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedFile(isSelected ? null : file)}
                    className={`flex items-center gap-2 p-1.5 rounded text-xs font-mono transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-cyan-950/40 text-cyan-200 border-cyan-700/60 font-semibold'
                        : 'bg-tokyo-panel/40 border-tokyo-border/50 text-tokyo-fg hover:bg-slate-800'
                    }`}
                    title={file}
                  >
                    <FileCode className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-cyan-400' : 'text-tokyo-blue'}`} />
                    <div className="min-w-0 flex-1 truncate">
                      <div className="truncate">{fileName}</div>
                      {dirPath && (
                        <div className="text-[10px] text-slate-500 truncate leading-tight">
                          {dirPath}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredFiles.length === 0 && (
                <div className="text-xs text-tokyo-comment italic p-2 text-center">
                  No files match filter.
                </div>
              )}
            </div>
          </div>

          {/* Right: Unified Diff Viewer */}
          <div className="flex-1 min-h-0 bg-tokyo-bgDark p-4 overflow-auto font-mono text-xs overscroll-contain pointer-events-auto select-text">
            {selectedFile && (
              <div className="mb-2 px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-slate-300 text-[11px] flex items-center justify-between">
                <span>Showing diff for: <strong className="text-cyan-300">{selectedFile}</strong></span>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-[10px] text-cyan-400 hover:underline"
                >
                  View full diff
                </button>
              </div>
            )}
            <pre className="text-tokyo-fg leading-relaxed">
              {displayedDiffLines.map((line, idx) => {
                let lineClass = 'text-tokyo-comment';
                if (line.startsWith('+') && !line.startsWith('+++')) {
                  lineClass = 'text-tokyo-green bg-tokyo-green/10 px-1 rounded-sm block';
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                  lineClass = 'text-tokyo-red bg-tokyo-red/10 px-1 rounded-sm block';
                } else if (line.startsWith('@@')) {
                  lineClass = 'text-tokyo-cyan bg-tokyo-cyan/5 px-1 rounded-sm block my-1 font-bold';
                } else if (line.startsWith('diff --git')) {
                  lineClass = 'text-slate-200 bg-slate-800/80 px-1.5 py-0.5 rounded block my-1 font-semibold border-l-2 border-cyan-400';
                }

                return (
                  <span key={idx} className={lineClass}>
                    {line}
                    {'\n'}
                  </span>
                );
              })}
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="h-16 px-6 border-t border-tokyo-border bg-tokyo-bgDark flex items-center justify-between gap-4">
          <div className="flex-1 max-w-md">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Squash commit message..."
              className="w-full h-9 px-3 bg-tokyo-panel border border-tokyo-border rounded text-xs text-white placeholder-tokyo-comment focus:outline-none focus:border-tokyo-blue font-mono"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={closeDiffGatekeeper}
              className="px-4 py-2 rounded text-xs font-semibold text-tokyo-comment hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              className="flex items-center gap-2 px-4 py-2 rounded bg-tokyo-green text-tokyo-bgDark font-bold text-xs hover:bg-tokyo-green/90 transition-all shadow-md shadow-tokyo-green/20"
            >
              <GitMerge className="w-4 h-4" />
              <span>Squash & Merge to Master</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
