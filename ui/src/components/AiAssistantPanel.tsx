import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  useAetherStore,
  toggleAiAssistant,
  clearAiMessages,
  sendAiMessage,
  retryLastAiMessage,
  insertTerminalContextToAi,
  setSelectedAiProvider,
  setSelectedAiModel,
  BUILT_IN_PROVIDERS,
  createAiSession,
  switchAiSession,
  renameAiSession,
  deleteAiSession,
  clearCurrentAiSession,
  AI_COMMANDS,
  stopAiAssistant,
} from '../stores/aetherStore';
import type { AiMessage, AiSession, AiCommandDefinition } from '../stores/aetherStore';
import {
  Sparkles,
  ChevronUp,
  ChevronDown,
  Trash2,
  Send,
  Terminal,
  Copy,
  Check,
  AlertCircle,
  RotateCcw,
  Plus,
  MessageSquare,
  Edit2,
  X,
  Command,
  Square,
} from 'lucide-react';

export interface AiAssistantPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
  activePaneId?: string;
}

// ==========================================
// Syntax Highlighting & Code Block
// ==========================================

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'export', 'import', 'from',
  'if', 'else', 'match', 'for', 'while', 'fn', 'pub', 'use', 'struct', 'impl',
  'type', 'async', 'await', 'cargo', 'git', 'npm', 'node', 'pnpm', 'run',
  'check', 'test', 'build', 'echo', 'cat', 'grep', 'cd', 'ls', 'mkdir', 'curl',
  'sudo', 'rm', 'cp', 'mv', 'chmod', 'true', 'false', 'null', 'undefined'
]);

function highlightCodeLine(line: string): React.ReactNode[] {
  if (line.trim().startsWith('$ ')) {
    const promptIdx = line.indexOf('$ ');
    const before = line.slice(0, promptIdx);
    const after = line.slice(promptIdx + 2);
    return [
      before ? <span key="b">{before}</span> : null,
      <span key="prompt" className="text-sky-300 font-bold select-none">$ </span>,
      ...tokenizeLine(after, 'cmd-')
    ];
  }
  const trimmed = line.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return [<span key="c" className="text-cortex-textMuted italic">{line}</span>];
  }
  return tokenizeLine(line, 't-');
}

function tokenizeLine(line: string, prefix: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const regex = /(\"[^\"]*\"|'[^']*'|`[^`]*`|\b\d+\b|\b[a-zA-Z_][a-zA-Z0-9_-]*\b|[^\s\w]+|\s+)/g;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(line)) !== null) {
    const token = match[0];
    const key = `${prefix}${i++}`;
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      tokens.push(<span key={key} className="text-cortex-success">{token}</span>);
    } else if (/^\d+$/.test(token)) {
      tokens.push(<span key={key} className="text-cortex-warning font-mono">{token}</span>);
    } else if (KEYWORDS.has(token.toLowerCase())) {
      tokens.push(<span key={key} className="text-sky-300 font-semibold">{token}</span>);
    } else {
      tokens.push(<span key={key} className="text-cortex-text">{token}</span>);
    }
  }
  return tokens.length > 0 ? tokens : [<span key="empty">{line}</span>];
}

export const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div className="my-2 border border-cortex-border bg-cortex-bg rounded-lg overflow-hidden font-mono text-xs select-text">
      <div className="h-7 px-2.5 bg-cortex-surface2 border-b border-cortex-border flex items-center justify-between text-[10px] text-cortex-textMuted select-none">
        <span className="font-bold tracking-wider uppercase text-sky-300" data-testid="code-language-tag">
          {language || 'CODE'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 hover:text-cortex-text hover:bg-cortex-surface1 transition-colors border border-cortex-border text-cortex-textMuted rounded"
          data-testid="code-copy-button"
          data-copied={copied ? 'true' : 'false'}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-cortex-success" />
              <span className="text-cortex-success font-semibold">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-cortex-text leading-relaxed whitespace-pre font-mono text-xs">
        <code>
          {lines.map((line, idx) => (
            <div key={idx} className="table-row">
              <span className="table-cell select-none pr-3 text-right text-[10px] text-cortex-textMuted/40 font-mono">
                {idx + 1}
              </span>
              <span className="table-cell whitespace-pre">
                {highlightCodeLine(line)}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
};

// ==========================================
// Markdown Parser
// ==========================================

function parseInlineFormatting(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(<span key={`txt-${keyIndex++}`}>{text.substring(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      elements.push(
        <code key={`code-${keyIndex++}`} className="font-mono bg-cortex-surface2 px-1.5 py-0.5 text-sky-300 text-[11px] border border-cortex-border rounded font-medium">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      elements.push(<strong key={`bold-${keyIndex++}`} className="font-bold text-cortex-text">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      elements.push(<em key={`em-${keyIndex++}`} className="italic text-cortex-textMuted">{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(<span key={`txt-${keyIndex++}`}>{text.substring(lastIndex)}</span>);
  }

  return elements.length > 0 ? elements : [<span key="txt-0">{text}</span>];
}

export const MarkdownContent: React.FC<{ content: string }> = ({ content }) => {
  const blocks = useMemo(() => {
    const list: Array<{ type: 'code'; language: string; code: string } | { type: 'text'; text: string }> = [];
    const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = fenceRegex.exec(content)) !== null) {
      if (match.index > lastIdx) {
        list.push({ type: 'text', text: content.slice(lastIdx, match.index) });
      }
      list.push({ type: 'code', language: match[1]?.trim() || 'code', code: match[2].replace(/\n$/, '') });
      lastIdx = fenceRegex.lastIndex;
    }

    if (lastIdx < content.length) {
      list.push({ type: 'text', text: content.slice(lastIdx) });
    }
    return list;
  }, [content]);

  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-cortex-text select-text">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return <CodeBlock key={idx} code={block.code} language={block.language} />;
        }

        const lines = block.text.split('\n');
        const elements: React.ReactNode[] = [];
        let listItems: React.ReactNode[] = [];
        let inList = false;

        const flushList = () => {
          if (inList && listItems.length > 0) {
            elements.push(
              <ul key={`ul-${elements.length}`} className="my-1.5 space-y-1 pl-1">
                {listItems}
              </ul>
            );
            listItems = [];
            inList = false;
          }
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('# ')) {
            flushList();
            elements.push(<h1 key={`h1-${lineIdx}`} className="text-sm font-bold text-cortex-text border-b border-cortex-border pb-1 mt-2 mb-1">{parseInlineFormatting(trimmed.slice(2))}</h1>);
            return;
          }
          if (trimmed.startsWith('## ')) {
            flushList();
            elements.push(<h2 key={`h2-${lineIdx}`} className="text-xs font-bold text-sky-300 uppercase tracking-wide mt-2 mb-1">{parseInlineFormatting(trimmed.slice(3))}</h2>);
            return;
          }
          if (trimmed.startsWith('### ')) {
            flushList();
            elements.push(<h3 key={`h3-${lineIdx}`} className="text-xs font-semibold text-cortex-text mt-1.5 mb-0.5">{parseInlineFormatting(trimmed.slice(4))}</h3>);
            return;
          }
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            inList = true;
            listItems.push(
              <li key={`li-${lineIdx}`} className="flex items-start gap-2">
                <span className="text-sky-400 select-none font-bold mt-0.5">•</span>
                <div className="flex-1">{parseInlineFormatting(trimmed.slice(2))}</div>
              </li>
            );
            return;
          }
          const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
          if (numMatch) {
            inList = true;
            listItems.push(
              <li key={`oli-${lineIdx}`} className="flex items-start gap-2">
                <span className="text-cortex-textMuted font-mono text-[11px] select-none pt-0.5">{numMatch[1]}.</span>
                <div className="flex-1">{parseInlineFormatting(numMatch[2])}</div>
              </li>
            );
            return;
          }
          flushList();
          if (trimmed) {
            elements.push(<p key={`p-${lineIdx}`} className="my-0.5 text-cortex-text">{parseInlineFormatting(line)}</p>);
          }
        });

        flushList();
        return <React.Fragment key={idx}>{elements}</React.Fragment>;
      })}
    </div>
  );
};

// ==========================================
// Neo-Brutalist Key-Value Info Cards
// ==========================================

export const InfoCards: React.FC<{ cards?: Array<{ key: string; value: string }> }> = ({ cards }) => {
  if (!cards || cards.length === 0) return null;

  const systemInfoCards = cards.slice(0, 8);
  const hardwareCards = cards.slice(8, 11);
  const diskCards = cards.slice(11);

  return (
    <div
      className="mt-3 p-4 bg-[#050D11] border border-[#0F222B] rounded-xl relative overflow-hidden border-r-2 border-r-[#38BDF8] shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      data-testid="ai-info-cards"
    >
      <div className="absolute right-0 top-3 bottom-3 w-[2px] bg-[#38BDF8] shadow-[0_0_8px_#38BDF8]" />

      <div className="space-y-3 font-mono text-xs">
        <div>
          <span className="text-xs font-bold text-sky-300 tracking-wider block mb-1.5 font-sans">
            System Information
          </span>
          <div className="space-y-0.5 text-[11px]">
            {systemInfoCards.map((c, idx) => (
              <div key={idx} className="flex items-center text-[11px]" data-testid="ai-info-card">
                <span className="text-cortex-textMuted w-28 shrink-0 font-mono">{c.key}</span>
                <span className="text-cortex-textMuted pr-2">:</span>
                <span className="text-cortex-text truncate font-mono" title={c.value} data-testid="ai-info-card-value">
                  {c.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {hardwareCards.length > 0 && (
          <div>
            <span className="text-xs font-bold text-sky-300 tracking-wider block mb-1.5 font-sans">
              Hardware
            </span>
            <div className="space-y-0.5 text-[11px]">
              {hardwareCards.map((c, idx) => (
                <div key={idx} className="flex items-center text-[11px]" data-testid="ai-info-card">
                  <span className="text-cortex-textMuted w-28 shrink-0 font-mono">{c.key}</span>
                  <span className="text-cortex-textMuted pr-2">:</span>
                  <span className="text-cortex-text truncate font-mono" title={c.value} data-testid="ai-info-card-value">
                    {c.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {diskCards.length > 0 && (
          <div>
            <span className="text-xs font-bold text-sky-300 tracking-wider block mb-1.5 font-sans">
              Disk Usage
            </span>
            <div className="space-y-0.5 text-[11px]">
              {diskCards.map((c, idx) => (
                <div key={idx} className="flex items-center text-[11px]" data-testid="ai-info-card">
                  <span className="text-cortex-textMuted w-28 shrink-0 font-mono">{c.key}</span>
                  <span className="text-cortex-textMuted pr-2">:</span>
                  <span className="text-cortex-text truncate font-mono" title={c.value} data-testid="ai-info-card-value">
                    {c.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-2 border-t border-[#0F222B] text-[10px] text-cortex-textMuted font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] shadow-[0_0_4px_#38BDF8]" />
          <span>AetherCortex Environment Context</span>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// AetherCortex Avatar
// ==========================================

const AiAvatar: React.FC = () => (
  <div className="w-8 h-8 rounded-lg bg-sky-500 shrink-0 flex items-center justify-center shadow-[0_0_12px_rgba(56,189,248,0.3)]">
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
      <ellipse
        cx="50"
        cy="52"
        rx="42"
        ry="16"
        stroke="#000000"
        strokeWidth="3.5"
        strokeDasharray="4 2"
      />
      <circle cx="50" cy="52" r="7" fill="#000000" />
      <polygon points="50,14 62,38 38,38" fill="#000000" />
    </svg>
  </div>
);

const UserBubble: React.FC<{ msg: AiMessage }> = ({ msg }) => (
  <div className="flex justify-end" data-testid="ai-message-user">
    <div className="max-w-[85%] bg-[#0D151A] border border-[#182631] rounded-xl px-4 py-3 text-[13px] text-cortex-text leading-relaxed select-text shadow-sm">
      <p className="whitespace-pre-wrap">{msg.content}</p>
    </div>
  </div>
);

const AssistantBubble: React.FC<{ msg: AiMessage; model: string; onRetry: () => void }> = ({ msg, onRetry }) => (
  <div className="flex items-start gap-3" data-testid="ai-message-assistant">
    <AiAvatar />
    <div className="flex-1 min-w-0">
      {msg.error ? (
        <div className="p-3 bg-red-950/30 border border-cortex-error text-red-200 text-xs rounded-xl flex flex-col gap-2" data-testid="ai-error-card">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-cortex-error shrink-0 mt-0.5" />
            <span className="leading-snug">{msg.error}</span>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="self-start flex items-center gap-1 px-2.5 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 border border-cortex-error text-xs font-mono text-cortex-text rounded transition-colors"
            data-testid="ai-retry-button"
          >
            <RotateCcw className="w-3 h-3 text-sky-400" />
            <span>Retry</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <MarkdownContent content={msg.content} />
        </div>
      )}
    </div>
  </div>
);

const SystemBubble: React.FC<{ msg: AiMessage }> = ({ msg }) => (
  <div className="px-3 py-2 bg-cortex-bg border border-cortex-border rounded-lg text-xs font-mono space-y-1.5" data-testid="ai-message-system">
    <div className="flex items-center justify-between text-[10px] text-cortex-textMuted border-b border-cortex-border pb-1">
      <span className="font-bold text-sky-300 tracking-wider flex items-center gap-1">
        <Terminal className="w-3 h-3 text-sky-400" />
        <span>SYSTEM DIRECTIVE</span>
      </span>
      <span className="font-mono">{new Date(msg.timestamp).toLocaleTimeString()}</span>
    </div>
    <MarkdownContent content={msg.content} />
  </div>
);

// ==========================================
// Main Panel
// ==========================================

export const AiAssistantPanel: React.FC<AiAssistantPanelProps> = ({
  isOpen,
  onClose,
  className,
  activePaneId,
}) => {
  const store = useAetherStore();
  const resolvedOpen = isOpen !== undefined ? isOpen : store.aiAssistantOpen;

  const [inputVal, setInputVal] = useState('');
  const [sessionsDropdownOpen, setSessionsDropdownOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitleVal, setNewTitleVal] = useState('');
  const [selectedCmdIndex, setSelectedCmdIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const targetPaneId = activePaneId || store.activePaneId || store.panes[0]?.id || 'terminal-1';

  const activeSession: AiSession = useMemo(() => {
    return (
      store.aiSessions.find((s) => s.id === store.activeAiSessionId) ||
      store.aiSessions[0] || {
        id: 'session_default',
        title: 'Percakapan Utama',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider: store.selectedAiProvider || 'openai',
        model: store.selectedAiModel || 'gpt-4o',
        messages: store.aiMessages,
      }
    );
  }, [store.aiSessions, store.activeAiSessionId, store.aiMessages, store.selectedAiProvider, store.selectedAiModel]);

  // Autocomplete suggestions when typing slash commands
  const filteredCommands: AiCommandDefinition[] = useMemo(() => {
    const trimmed = inputVal.trim();
    if (!trimmed.startsWith('/')) return [];
    const query = trimmed.toLowerCase();
    return AI_COMMANDS.filter((cmd) => {
      if (cmd.command.toLowerCase().startsWith(query)) return true;
      if (cmd.aliases?.some((a) => a.toLowerCase().startsWith(query))) return true;
      return false;
    }).slice(0, 6);
  }, [inputVal]);

  useEffect(() => {
    setSelectedCmdIndex(0);
  }, [filteredCommands.length]);

  useEffect(() => {
    if (resolvedOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [store.aiMessages.length, store.aiLoading, resolvedOpen]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputVal]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSessionsDropdownOpen(false);
      }
    };
    if (sessionsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [sessionsDropdownOpen]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      toggleAiAssistant(false);
    }
  };

  const handleSend = async () => {
    const trimmed = inputVal.trim();
    if (!trimmed || store.aiLoading) return;
    setInputVal('');
    await sendAiMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate command autocomplete if active
    if (filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCmdIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCmdIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && filteredCommands[selectedCmdIndex])) {
        e.preventDefault();
        const selected = filteredCommands[selectedCmdIndex];
        setInputVal(`${selected.command} `);
        return;
      }
    }

    if (e.key === 'Escape' && store.aiLoading) {
      e.preventDefault();
      stopAiAssistant();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const availableModels = useMemo(() => {
    const provider = store.selectedAiProvider;
    const custom = store.customProviders.find((cp) => cp.id === provider);
    if (custom) return [custom.model];
    switch (provider) {
      case 'openai': return ['gpt-4o', 'gpt-4o-mini', 'o1-preview'];
      case 'anthropic': return ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];
      case 'gemini': return ['gemini-1.5-pro', 'gemini-1.5-flash'];
      case 'groq': return ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
      case 'openrouter': return ['auto', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o'];
      case 'ollama': return ['llama3.2', 'deepseek-r1', 'qwen2.5-coder'];
      default: return [store.selectedAiModel || 'default'];
    }
  }, [store.selectedAiProvider, store.selectedAiModel, store.customProviders]);

  const activeProviderName = useMemo(() => {
    const custom = store.customProviders.find((cp) => cp.id === store.selectedAiProvider);
    if (custom) return custom.displayName;
    const builtIn = BUILT_IN_PROVIDERS.find((p) => p.id === store.selectedAiProvider);
    return builtIn ? builtIn.name : store.selectedAiProvider;
  }, [store.selectedAiProvider, store.customProviders]);

  if (!resolvedOpen) {
    return null;
  }

  const isEmpty = store.aiMessages.length === 0;

  return (
    <aside
      className={`w-[380px] shrink-0 h-full flex flex-col bg-cortex-bg border-l border-cortex-border z-20 overflow-hidden font-sans select-none ${className || ''}`}
      data-testid="ai-assistant-panel"
      aria-label="AI Assistant Panel"
    >
      {/* Top Header */}
      <div className="h-12 px-4 bg-cortex-bg border-b border-cortex-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-sky-400 fill-sky-400" />
          <span className="font-bold text-sm tracking-tight text-cortex-text" data-testid="ai-panel-title">
            AI Assistant
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-mono px-2 py-0.5 bg-cortex-surface2 border border-cortex-border text-sky-300 rounded"
            data-testid="ai-provider-badge"
            title={`${activeProviderName} / ${store.selectedAiModel}`}
          >
            {activeProviderName}
          </span>
          <button
            type="button"
            onClick={() => clearAiMessages()}
            className="p-1 text-cortex-textMuted hover:text-cortex-text transition-colors"
            data-testid="ai-clear-history-button"
            title="Bersihkan pesan sesi ini (/clear)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 text-cortex-textMuted hover:text-sky-300 transition-colors"
            data-testid="ai-panel-close-button"
            title="Tutup AI Assistant"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Session Management Bar */}
      <div className="px-3 py-1.5 bg-cortex-surface1 border-b border-cortex-border flex items-center justify-between gap-2 text-xs font-mono relative">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <MessageSquare className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          {editingTitle ? (
            <input
              type="text"
              value={newTitleVal}
              onChange={(e) => setNewTitleVal(e.target.value)}
              onBlur={() => {
                if (newTitleVal.trim()) {
                  renameAiSession(activeSession.id, newTitleVal.trim());
                }
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (newTitleVal.trim()) {
                    renameAiSession(activeSession.id, newTitleVal.trim());
                  }
                  setEditingTitle(false);
                } else if (e.key === 'Escape') {
                  setEditingTitle(false);
                }
              }}
              autoFocus
              className="bg-cortex-bg text-cortex-text text-xs px-1.5 py-0.5 border border-sky-400 rounded outline-none flex-1 min-w-0 font-sans"
            />
          ) : (
            <button
              type="button"
              onClick={() => setSessionsDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1 text-cortex-text hover:text-sky-300 truncate transition-colors text-left font-semibold text-xs font-sans"
              title="Klik untuk memilih atau berpindah sesi"
            >
              <span className="truncate">{activeSession.title}</span>
              <ChevronDown className="w-3 h-3 text-cortex-textMuted shrink-0 ml-0.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setNewTitleVal(activeSession.title);
              setEditingTitle(true);
            }}
            className="p-1 text-cortex-textMuted hover:text-sky-300 transition-colors"
            title="Ganti nama sesi (/session rename)"
          >
            <Edit2 className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              createAiSession();
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-cortex-surface2 hover:bg-sky-500/10 hover:text-sky-300 text-cortex-text border border-cortex-border rounded transition-colors text-[10px] font-sans"
            title="Mulai sesi baru (/new)"
          >
            <Plus className="w-3 h-3 text-sky-400" />
            <span>Sesi Baru</span>
          </button>
        </div>

        {/* Sessions Dropdown Popup */}
        {sessionsDropdownOpen && (
          <div
            ref={dropdownRef}
            className="absolute left-2 right-2 top-full mt-1 bg-cortex-bgAlt border border-cortex-borderStrong rounded-lg shadow-2xl z-30 overflow-hidden font-sans max-h-60 flex flex-col"
          >
            <div className="px-3 py-1.5 border-b border-cortex-border flex items-center justify-between text-[11px] font-bold text-sky-300 bg-cortex-surface1">
              <span>Sesi Tersimpan ({store.aiSessions.length})</span>
              <button
                type="button"
                onClick={() => setSessionsDropdownOpen(false)}
                className="text-cortex-textMuted hover:text-cortex-text p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-cortex-border/50">
              {store.aiSessions.map((s) => {
                const isCurrent = s.id === activeSession.id;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                      isCurrent
                        ? 'bg-sky-500/10 text-sky-300 font-medium'
                        : 'text-cortex-text hover:bg-cortex-surface2'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        switchAiSession(s.id);
                        setSessionsDropdownOpen(false);
                      }}
                      className="flex-1 text-left truncate mr-2"
                    >
                      <div className="truncate font-semibold">{s.title}</div>
                      <div className="text-[10px] text-cortex-textMuted font-mono">
                        {s.messages.length} pesan • {new Date(s.updatedAt).toLocaleTimeString()}
                      </div>
                    </button>
                    {store.aiSessions.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteAiSession(s.id);
                        }}
                        className="p-1 text-cortex-textMuted hover:text-red-400 transition-colors"
                        title="Hapus sesi ini"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Synchronized Selectors (Compact Toolbar) */}
      <div className="px-3 py-1.5 bg-cortex-bgAlt border-b border-cortex-border flex items-center gap-2 text-[11px]">
        <div className="relative flex-1">
          <select
            data-testid="ai-panel-provider-select"
            value={store.selectedAiProvider}
            onChange={(e) => setSelectedAiProvider(e.target.value)}
            className="w-full appearance-none bg-cortex-surface1 border border-cortex-border text-cortex-text text-[11px] pl-2 pr-6 py-1 font-mono rounded focus:border-sky-400 focus:outline-none cursor-pointer transition-colors"
            style={{ backgroundColor: 'var(--cortex-bg-alt)', color: 'var(--cortex-text)' }}
            title="AI Provider"
          >
            {BUILT_IN_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--cortex-bg-alt)', color: 'var(--cortex-text)' }}>
                {p.name}
              </option>
            ))}
            {store.customProviders.map((cp) => (
              <option key={cp.id} value={cp.id} style={{ backgroundColor: 'var(--cortex-bg-alt)', color: 'var(--cortex-text)' }}>
                {cp.displayName}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-sky-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
        </div>

        <div className="relative flex-1">
          <select
            data-testid="ai-panel-model-select"
            value={store.selectedAiModel}
            onChange={(e) => setSelectedAiModel(e.target.value)}
            className="w-full appearance-none bg-cortex-surface1 border border-cortex-border text-cortex-text text-[11px] pl-2 pr-6 py-1 font-mono rounded focus:border-sky-400 focus:outline-none cursor-pointer transition-colors"
            style={{ backgroundColor: 'var(--cortex-bg-alt)', color: 'var(--cortex-text)' }}
            title="AI Model"
          >
            {availableModels.map((m) => (
              <option key={m} value={m} style={{ backgroundColor: 'var(--cortex-bg-alt)', color: 'var(--cortex-text)' }}>
                {m}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-sky-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
        </div>

        <button
          type="button"
          onClick={() => insertTerminalContextToAi(targetPaneId)}
          className="shrink-0 flex items-center gap-1 px-2 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 text-cortex-textMuted hover:text-sky-300 text-[10px] font-mono border border-cortex-border rounded transition-colors"
          data-testid="ai-add-context-button"
          title="Lampirkan konteks terminal aktif (/context)"
        >
          <Terminal className="w-3 h-3 text-sky-400" />
          <span>+ Context</span>
        </button>
      </div>

      {/* Message List */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 font-sans select-text"
        data-testid="ai-messages-list"
      >
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <AiAvatar />
            <div className="space-y-1.5">
              <span className="font-bold text-sm text-cortex-text block">AetherCortex Assistant</span>
              <p className="text-[13px] text-cortex-textMuted max-w-[260px] leading-relaxed">
                Asisten AI untuk automasi terminal dan eksekusi command.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[280px]">
              <button
                type="button"
                onClick={() => {
                  setInputVal('/help');
                  textareaRef.current?.focus();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cortex-surface1 hover:bg-sky-500/10 text-sky-300 text-xs font-mono border border-cortex-border rounded-lg transition-colors"
              >
                <Command className="w-3.5 h-3.5 text-sky-400" />
                <span>Lihat Command (/help)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputVal('bagaimana cara cek status git dan branch aktif?');
                }}
                className="w-full text-left px-3 py-2 rounded-lg bg-[#0D151A] border border-[#182631] hover:border-sky-400/60 text-xs text-cortex-text transition-colors"
              >
                &ldquo;bagaimana cara cek status git dan branch aktif?&rdquo;
              </button>
              <button
                type="button"
                onClick={() => insertTerminalContextToAi(targetPaneId)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cortex-surface1 hover:bg-cortex-surface2 text-cortex-text text-xs font-mono border border-cortex-border rounded-lg transition-colors"
              >
                <Terminal className="w-3.5 h-3.5 text-sky-400" />
                <span>Attach Terminal Context</span>
              </button>
            </div>
          </div>
        ) : (
          store.aiMessages.map((msg: AiMessage) => {
            if (msg.role === 'system') return <SystemBubble key={msg.id} msg={msg} />;
            if (msg.role === 'user') return <UserBubble key={msg.id} msg={msg} />;
            return (
              <AssistantBubble
                key={msg.id}
                msg={msg}
                model={store.selectedAiModel}
                onRetry={() => retryLastAiMessage()}
              />
            );
          })
        )}

        {store.aiLoading && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-sky-950/20 border border-sky-800/30 mb-2" data-testid="ai-loading-indicator">
            <div className="flex items-center gap-2">
              <AiAvatar />
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-[11px] text-cortex-textMuted font-mono">Agent working...</span>
            </div>
            <button
              type="button"
              onClick={() => stopAiAssistant()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cortex-error/20 hover:bg-cortex-error/30 text-cortex-error border border-cortex-error/40 text-xs font-mono font-bold transition-colors cursor-pointer"
              data-testid="btn-stop-agent-pill"
              title="Stop Agent Execution (Esc)"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop Agent (Esc)</span>
            </button>
          </div>
        )}

        {store.aiError && !store.aiMessages.some((m) => m.error === store.aiError) && (
          <div className="p-3 bg-red-950/30 border border-cortex-error text-red-200 text-xs rounded-xl flex flex-col gap-2" data-testid="ai-error-card">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-cortex-error shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold block text-cortex-error">Request Error</span>
                <span className="text-[11px] leading-snug">{store.aiError}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => retryLastAiMessage()}
              className="self-start flex items-center gap-1.5 px-3 py-1 bg-cortex-surface1 hover:bg-cortex-surface2 border border-cortex-error text-xs font-mono text-cortex-text rounded transition-colors"
              data-testid="ai-retry-button"
            >
              <RotateCcw className="w-3 h-3 text-sky-400" />
              <span>Retry</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <div className="p-4 bg-cortex-bg border-t border-cortex-border shrink-0 select-text relative">
        {/* Command Autocomplete Suggestions */}
        {filteredCommands.length > 0 && (
          <div className="mb-2 bg-cortex-bgAlt border border-cortex-borderStrong rounded-lg shadow-xl overflow-hidden font-mono text-xs">
            <div className="px-2.5 py-1 bg-cortex-surface2 border-b border-cortex-border text-[10px] text-sky-300 font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Saran Command ({filteredCommands.length})</span>
              <span className="text-cortex-textMuted text-[9px] font-sans">Tekan Tab atau klik untuk memilih</span>
            </div>
            <div className="max-h-36 overflow-y-auto">
              {filteredCommands.map((cmd, idx) => (
                <button
                  key={cmd.command}
                  type="button"
                  onClick={() => {
                    setInputVal(`${cmd.command} `);
                    textareaRef.current?.focus();
                  }}
                  className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between hover:bg-sky-500/10 transition-colors ${
                    idx === selectedCmdIndex ? 'bg-sky-500/15' : ''
                  }`}
                >
                  <span className="text-sky-300 font-bold">{cmd.syntax}</span>
                  <span className="text-cortex-textMuted text-[10px] font-sans truncate ml-2">
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative flex items-center bg-[#050D11] border border-cortex-border focus-within:border-sky-400 focus-within:shadow-[0_0_15px_rgba(56,189,248,0.2)] rounded-xl px-4 py-3 transition-all">
          <textarea
            ref={textareaRef}
            data-testid="ai-panel-input"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={store.aiLoading}
            rows={1}
            placeholder="Tanya Aether atau ketik / untuk command..."
            className="flex-1 bg-transparent text-[13px] text-cortex-text placeholder:text-[#7E8F9B] resize-none focus:outline-none font-sans leading-relaxed min-h-[24px] max-h-[120px]"
          />
          {store.aiLoading ? (
            <button
              type="button"
              onClick={() => stopAiAssistant()}
              data-testid="ai-panel-stop-button"
              className="px-3 py-1.5 rounded-lg bg-cortex-error hover:bg-rose-500 text-white flex items-center gap-1.5 shrink-0 transition-all shadow-md active:scale-95 font-sans font-semibold text-xs ml-2 cursor-pointer"
              title="Stop Agent (Esc)"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputVal.trim()}
              data-testid="ai-panel-send-button"
              className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 flex items-center justify-center shrink-0 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ml-2"
              title="Kirim (Enter)"
            >
              <Send className="w-4 h-4 fill-slate-950 stroke-slate-950" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
