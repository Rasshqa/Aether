import { useState, useEffect } from 'react';
import { invoke as tauriInvoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { applyTheme } from '../utils/themes';

export const isRunningInTauri = (): boolean => {
  try {
    return tauriIsTauri();
  } catch {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }
};

const invoke = async (cmd: string, args?: any): Promise<any> => {
  if (isRunningInTauri()) {
    try {
      return await tauriInvoke(cmd, args);
    } catch (err) {
      console.error(`Tauri command '${cmd}' failed:`, err);
      throw err;
    }
  }
  return null;
};

const listen = (event: string, handler: (event: any) => void) => {
  if (isRunningInTauri()) {
    return tauriListen(event, handler);
  }
  return Promise.resolve(() => {});
};

export interface AgentPane {
  id: string;
  cliType: string;
  pid?: number;
  status: 'IDLE' | 'THINKING' | 'EXECUTING' | 'WAITING_APPROVAL' | 'ERROR';
  worktreePath?: string;
  gitBranch?: string;
  openPorts: number[];
  color: string;
  lastExitCode?: number | null;
  viewMode?: 'raw' | 'blocks';
  inputBarOpen?: boolean;
  lastCommandFailed?: boolean;
}

export interface CommandBlock {
  id: string;
  paneId: string;
  command: string;
  cwd: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  outputText: string;
  isBookmarked?: boolean;
  isCollapsed?: boolean;
}

export interface AetherWorkflow {
  id: string;
  name: string;
  description: string;
  commandTemplate: string;
  tags: string[];
  /** Vault-relative markdown path when the workflow came from the vault. */
  relativePath?: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string; // Relative path from workspace root
  is_dir: boolean;
  is_symlink: boolean;
  size_bytes: number;
  extension?: string | null;
}

export interface WorkspaceSearchMatch {
  file_path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

export interface WorkspaceFileContent {
  relative_path: string;
  content: string;
  total_bytes: number;
  is_truncated: boolean;
}

export interface ProviderSettings {
  api_key: string;
  model: string;
  base_url?: string;
  display_name?: string;
  protocol?: string;
}

export interface CustomProviderConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'ollama' | 'openrouter';
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    provider?: string;
    model?: string;
    tokens?: number;
    latencyMs?: number;
    cards?: Array<{ key: string; value: string }>;
  };
  isStreaming?: boolean;
  error?: string;
}

export interface ChatHistoryEntry {
  role: string;
  content: string;
}

export interface AiSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model: string;
  systemPrompt?: string;
  messages: AiMessage[];
}

export interface AiCommandDefinition {
  command: string;
  aliases?: string[];
  syntax: string;
  description: string;
}

export const AI_COMMANDS: AiCommandDefinition[] = [
  {
    command: '/help',
    syntax: '/help',
    description: 'Tampilkan daftar lengkap command yang tersedia',
  },
  {
    command: '/new',
    aliases: ['/session new', '/reset'],
    syntax: '/new [judul]',
    description: 'Mulai sesi chat baru yang bersih',
  },
  {
    command: '/sessions',
    aliases: ['/session list'],
    syntax: '/sessions',
    description: 'Tampilkan seluruh sesi percakapan tersimpan',
  },
  {
    command: '/session switch',
    syntax: '/session switch <id_atau_indeks>',
    description: 'Beralih ke sesi percakapan tertentu',
  },
  {
    command: '/session rename',
    syntax: '/session rename <judul baru>',
    description: 'Ganti judul sesi percakapan saat ini',
  },
  {
    command: '/session delete',
    syntax: '/session delete [id_atau_indeks]',
    description: 'Hapus sesi percakapan tertentu atau sesi aktif',
  },
  {
    command: '/clear',
    syntax: '/clear',
    description: 'Hapus semua pesan di dalam sesi ini',
  },
  {
    command: '/model',
    syntax: '/model <nama_model>',
    description: 'Ganti model AI aktif (contoh: /model gpt-4o, /model Eris-Max)',
  },
  {
    command: '/provider',
    syntax: '/provider <nama_provider>',
    description: 'Ganti provider AI aktif (contoh: /provider openai, /provider openrouter)',
  },
  {
    command: '/system',
    syntax: '/system [instruksi]',
    description: 'Lihat atau atur system prompt untuk sesi ini',
  },
  {
    command: '/context',
    syntax: '/context',
    description: 'Sertakan output terminal aktif ke dalam sesi chat',
  },
  {
    command: '/status',
    aliases: ['/info'],
    syntax: '/status',
    description: 'Informasi status koneksi provider, model, dan sesi saat ini',
  },
  {
    command: '/export',
    syntax: '/export',
    description: 'Ekspor transkrip percakapan sesi ini ke format Markdown',
  },
  {
    command: '/app tabs',
    syntax: '/app tabs',
    description: 'Tampilkan semua tab dan pane terminal yang sedang aktif',
  },
  {
    command: '/fs list',
    syntax: '/fs list [path]',
    description: 'Daftar struktur direktori dan file dalam workspace',
  },
  {
    command: '/fs read',
    syntax: '/fs read <file_path>',
    description: 'Baca isi file dengan nomor baris',
  },
  {
    command: '/pane read',
    syntax: '/pane read [pane_id]',
    description: 'Baca tampilan layar terminal pane saat ini',
  },
  {
    command: '/pane send',
    syntax: '/pane send <pane_id> <teks>',
    description: 'Kirim input perintah ke terminal pane tertentu',
  },
];

export interface PendingAiApproval {
  id: string;
  tier: 1 | 2 | 3;
  actionType: string;
  toolName: string;
  args: Record<string, any>;
  payloadPreview: string;
  riskReason: string;
  resolve: (value: { approved: boolean; rememberSession?: boolean; rejectReason?: string }) => void;
}

export interface SecurityEvaluation {
  tier: 1 | 2 | 3;
  actionType: string;
  payloadPreview: string;
  riskReason: string;
}

export interface AppTabsAndPanesSummary {
  tabs: TerminalTab[];
  panes: AgentPane[];
  activeTabId: string | null;
  activePaneId: string | null;
  layout: LayoutNode | null;
  backgroundTasks: BackgroundTask[];
}

export interface ProviderMeta {
  id: string;
  name: string;
  tagline: string;
  defaultModel: string;
  defaultBaseUrl: string;
  docsUrl: string;
  requiresKey: boolean;
  protocol: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'ollama' | 'openrouter';
}

export const BUILT_IN_PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'Industry-standard frontier models (GPT-4o, GPT-4o-mini).',
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
    protocol: 'openai',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    tagline: 'Direct native Messages API for Claude 3.5 Sonnet and Haiku.',
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true,
    protocol: 'anthropic',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Fast multimodal models with large context windows via OpenAI-compat API.',
    defaultModel: 'gemini-1.5-pro',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    requiresKey: true,
    protocol: 'openai',
  },
  {
    id: 'groq',
    name: 'Groq',
    tagline: 'Ultra-low latency inference for open weights models (Llama 3.3 70B).',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    requiresKey: true,
    protocol: 'openai',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Universal gateway for frontier models (Claude, GPT, Llama).',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
    protocol: 'openai',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    tagline: 'Self-hosted local models without cloud dependencies or API costs.',
    defaultModel: 'llama3:latest',
    defaultBaseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://ollama.com',
    requiresKey: false,
    protocol: 'openai',
  },
];

export interface ProviderConfig {
  default_provider: string;
  providers: Record<string, ProviderSettings>;
}

export interface AiPilotStep {
  paneId: string;
  step: string;
  details?: string;
  timestamp: number;
}

export interface PipelineStage {
  targetCli: string;
  prompt: string;
}

export type LayoutNode =
  | { type: 'pane'; paneId: string }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      splitRatio: number; // 0.05 to 0.95, default 0.5
      children: [LayoutNode, LayoutNode];
    };

export interface TerminalTab {
  id: string;
  title: string;
  paneIds: string[];
  layout: LayoutNode | null;
  activePaneId: string | null;
  color?: string;
}

export interface BackgroundTask {
  id: string; // pane_id
  cliType: string;
  command: string;
  pid?: number;
  status: 'RUNNING' | 'EXITED' | 'ERROR';
  startedAt: number;
  openPorts: number[];
  recentOutput: string[];
}

export interface BlackboardEntry {
  id: number;
  workspace_id: string;
  author_agent_id: string;
  entry_type: 'API_CONTRACT' | 'TASK_CLAIM' | 'BUG_REPORT' | 'DECISION' | 'HANDOFF';
  title: string;
  content_markdown: string;
  target_agent_id?: string;
  is_resolved: boolean;
  created_at: string;
}

export interface FileLock {
  workspace_id: string;
  relative_file_path: string;
  locked_by_agent_id: string;
  intent?: string;
  locked_at: string;
}

export interface WorktreeDiff {
  pane_id: string;
  diff_unified: string;
  files_changed: string[];
  insertions: number;
  deletions: number;
}

export interface GitSnapshot {
  id: string;
  agent_id: string;
  git_tree_oid: string;
  summary: string;
  files_changed_count: number;
  created_at: string;
}

export interface AgentInfo {
  name: string;
  color: string;
  binary: string;
  category: 'agent' | 'shell';
}

export interface DetectedTool {
  id: string;
  name: string;
  binary: string;
  path: string;
  category: 'agent' | 'shell';
  color: string;
  description: string;
  is_system_default?: boolean;
}

export const AGENT_PALETTES: Record<string, AgentInfo> = {
  // Agentic AI CLI Orchestrators
  'claude-code': { name: 'Claude Code', color: '#D97757', binary: 'claude', category: 'agent' },
  'opencode': { name: 'OpenCode', color: '#3B82F6', binary: 'opencode', category: 'agent' },
  'codex': { name: 'OpenAI Codex', color: '#10B981', binary: 'codex', category: 'agent' },
  'antigravity': { name: 'Antigravity CLI', color: '#A855F7', binary: 'antigravity', category: 'agent' },
  'hermes': { name: 'Hermes Agent', color: '#EC4899', binary: 'hermes', category: 'agent' },
  'aider': { name: 'Aider AI', color: '#F59E0B', binary: 'aider', category: 'agent' },
  'goose': { name: 'Goose CLI', color: '#06B6D4', binary: 'goose', category: 'agent' },

  // Interactive Linux Shells
  'shell': { name: 'Default Shell ($SHELL)', color: '#818CF8', binary: 'shell', category: 'shell' },
  'fish': { name: 'Fish', color: '#FB923C', binary: 'fish', category: 'shell' },
  'bash': { name: 'Bash', color: '#4ADE80', binary: 'bash', category: 'shell' },
  'zsh': { name: 'Zsh', color: '#38BDF8', binary: 'zsh', category: 'shell' },
};

// Global Store State
let globalState = {
  workspaceId: 'default',
  defaultShell: (typeof localStorage !== 'undefined' && localStorage.getItem('aether_default_shell')) || 'shell',
  detectedTools: [] as DetectedTool[],
  panes: [] as AgentPane[],
  activePaneId: null as string | null,
  layout: null as LayoutNode | null,
  tabs: [] as TerminalTab[],
  activeTabId: null as string | null,
  backgroundTasks: [] as BackgroundTask[],
  backgroundDrawerOpen: false,
  confirmCloseModal: {
    isOpen: false,
    paneId: null as string | null,
    processName: '',
    pid: 0,
  },
  blackboard: [] as BlackboardEntry[],
  fileLocks: [] as FileLock[],
  orchestratorOpen: false,
  diffGatekeeperOpen: false,
  timeTravelOpen: false,
  obsidianSidebarOpen: false,
  customToolModalOpen: false,
  activeDiff: null as WorktreeDiff | null,
  snapshots: [] as GitSnapshot[],
  commandBlocks: [] as CommandBlock[],
  pipelineQueue: [] as PipelineStage[],
  pipelineActive: false,
  workflows: [] as AetherWorkflow[],
  workflowsModalOpen: false,
  commandPaletteOpen: false,
  themeModalOpen: false,
  currentTheme: typeof localStorage !== 'undefined' ? (localStorage.getItem('aether_theme') || 'aethercortex-dark') : 'aethercortex-dark',
  windowOpacity: typeof localStorage !== 'undefined' ? (parseFloat(localStorage.getItem('aether_opacity') || '0.95') || 0.95) : 0.95,
  obsidianRefreshTick: 0,
  aetherDriveSidebarOpen: typeof localStorage !== 'undefined'
    ? localStorage.getItem('aether_drive_sidebar_open') === 'true'
    : false,
  sidebarMinimized: typeof localStorage !== 'undefined'
    ? localStorage.getItem('aether_sidebar_minimized') === 'true'
    : false,
  aetherDriveActiveTab: (typeof localStorage !== 'undefined'
    && (localStorage.getItem('aether_drive_active_tab') as 'tree' | 'search' | 'workflows'))
    || ('tree' as 'tree' | 'search' | 'workflows'),
  aetherDriveExpandedPaths: (typeof localStorage !== 'undefined'
    ? (() => {
        try {
          const val = localStorage.getItem('aether_drive_expanded_paths');
          return val ? (JSON.parse(val) as string[]) : [];
        } catch {
          return [];
        }
      })()
    : []) as string[],
  aiAssistantOpen: typeof localStorage !== 'undefined'
    ? localStorage.getItem('aether_ai_assistant_open') === 'true'
    : false,
  aiSettingsOpen: false,
  aiProviderConfig: null as ProviderConfig | null,
  aiPilotRunning: false,
  aiPilotSteps: [] as AiPilotStep[],
  selectedAiProvider: (typeof localStorage !== 'undefined'
    && localStorage.getItem('aether_selected_ai_provider'))
    || 'openai',
  selectedAiModel: (typeof localStorage !== 'undefined'
    && localStorage.getItem('aether_selected_ai_model'))
    || 'gpt-4o',
  customProviders: (typeof localStorage !== 'undefined'
    ? (() => {
        try {
          const val = localStorage.getItem('aether_custom_providers');
          return val ? (JSON.parse(val) as CustomProviderConfig[]) : [];
        } catch {
          return [];
        }
      })()
    : []) as CustomProviderConfig[],
  aiSessions: (typeof localStorage !== 'undefined'
    ? (() => {
        try {
          const val = localStorage.getItem('aether_ai_sessions');
          if (val) {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
          }
        } catch {}
        try {
          const legacy = localStorage.getItem('aether_ai_messages');
          const msgs = legacy ? JSON.parse(legacy) : [];
          return [
            {
              id: 'session_default',
              title: Array.isArray(msgs) && msgs.length > 0 ? 'Percakapan Sebelumnya' : 'Percakapan Utama',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              provider: 'openai',
              model: 'gpt-4o',
              messages: Array.isArray(msgs) ? msgs : [],
            },
          ];
        } catch {
          return [
            {
              id: 'session_default',
              title: 'Percakapan Utama',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              provider: 'openai',
              model: 'gpt-4o',
              messages: [],
            },
          ];
        }
      })()
    : [
        {
          id: 'session_default',
          title: 'Percakapan Utama',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          provider: 'openai',
          model: 'gpt-4o',
          messages: [],
        },
      ]) as AiSession[],
  activeAiSessionId: (typeof localStorage !== 'undefined'
    && localStorage.getItem('aether_active_session_id'))
    || 'session_default',
  aiMessages: (typeof localStorage !== 'undefined'
    ? (() => {
        try {
          const val = localStorage.getItem('aether_ai_sessions');
          if (val) {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const activeId = localStorage.getItem('aether_active_session_id') || parsed[0].id;
              const active = parsed.find((s: AiSession) => s.id === activeId) || parsed[0];
              return active.messages || [];
            }
          }
        } catch {}
        try {
          const val = localStorage.getItem('aether_ai_messages');
          return val ? (JSON.parse(val) as AiMessage[]) : [];
        } catch {
          return [];
        }
      })()
    : []) as AiMessage[],
  aiLoading: false,
  aiError: null as string | null,
  aiPendingContext: null as string | null,
  pendingAiApproval: null as PendingAiApproval | null,
  aiSessionApprovedTier2: false,
};

// Initialize theme on app load
if (typeof window !== 'undefined') {
  try {
    applyTheme(globalState.currentTheme, globalState.windowOpacity);
  } catch (e) {
    console.warn('Failed to apply initial theme:', e);
  }
}

export async function detectAvailableTools(): Promise<DetectedTool[]> {
  if (invoke) {
    try {
      const list: DetectedTool[] = await invoke('cmd_detect_available_tools');
      if (Array.isArray(list) && list.length > 0) {
        globalState.detectedTools = list;
        const savedPref = typeof localStorage !== 'undefined' ? localStorage.getItem('aether_default_shell') : null;
        const sysDefault = list.find((t) => t.category === 'shell' && t.is_system_default);

        // If no user preference saved, or saved preference was generic 'shell', follow system default shell!
        if (!savedPref || savedPref === 'shell') {
          if (sysDefault) {
            globalState.defaultShell = sysDefault.id;
          }
        } else {
          const exists = list.some((t) => t.id === savedPref || t.binary === savedPref);
          if (exists) {
            globalState.defaultShell = savedPref;
          } else if (sysDefault) {
            globalState.defaultShell = sysDefault.id;
          }
        }
        notify();
        return list;
      }
    } catch (e) {
      console.warn('Tool detection failed, falling back to local list:', e);
    }
  }
  return [];
}

export async function validateCustomTool(binary: string): Promise<DetectedTool | null> {
  if (invoke) {
    try {
      const tool: DetectedTool = await invoke('cmd_validate_tool', { binary, category: 'agent' });
      if (tool) {
        if (!globalState.detectedTools.some((t) => t.id === tool.id || t.binary === tool.binary)) {
          globalState.detectedTools.push(tool);
          notify();
        }
        return tool;
      }
    } catch (e) {
      console.warn('Validate tool failed:', e);
    }
  }
  return null;
}

export function setDefaultShell(shell: string) {
  globalState.defaultShell = shell;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_default_shell', shell);
  }
  notify();
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}

export function useAetherStore() {
  const [state, setState] = useState(globalState);

  useEffect(() => {
    const onChange = () => setState({ ...globalState });
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return state;
}

export function getAetherState() {
  return globalState;
}

// ----------------------------------------------------------------------------
// Action Handlers & Layout Balancing
// ----------------------------------------------------------------------------

let splitCounter = 0;
export function createSplitId(): string {
  splitCounter += 1;
  return `split_${Date.now()}_${splitCounter}`;
}

export function countLeafPanes(node: LayoutNode | null): number {
  if (!node) return 0;
  if (node.type === 'pane') return 1;
  return countLeafPanes(node.children[0]) + countLeafPanes(node.children[1]);
}

export function extractPaneIds(node: LayoutNode | null): string[] {
  if (!node) return [];
  if (node.type === 'pane') return [node.paneId];
  return [...extractPaneIds(node.children[0]), ...extractPaneIds(node.children[1])];
}

export function balanceLayout(node: LayoutNode | null): LayoutNode | null {
  if (!node || node.type === 'pane') return node;
  const leftCount = countLeafPanes(node.children[0]);
  const rightCount = countLeafPanes(node.children[1]);
  const total = leftCount + rightCount;
  const splitRatio = total > 0 ? Number((leftCount / total).toFixed(4)) : 0.5;

  return {
    ...node,
    splitRatio,
    children: [
      balanceLayout(node.children[0])!,
      balanceLayout(node.children[1])!,
    ],
  };
}

export function updateSplitRatio(splitId: string, ratio: number) {
  const clamped = Math.max(0.05, Math.min(0.95, Number(ratio.toFixed(4))));
  function updateInTree(node: LayoutNode | null): LayoutNode | null {
    if (!node || node.type === 'pane') return node;
    if (node.id === splitId) {
      return {
        ...node,
        splitRatio: clamped,
      };
    }
    return {
      ...node,
      children: [
        updateInTree(node.children[0])!,
        updateInTree(node.children[1])!,
      ],
    };
  }

  globalState.layout = updateInTree(globalState.layout);
  syncActiveTab();
  notify();
}

export function equalizeLayout() {
  if (globalState.layout) {
    globalState.layout = balanceLayout(globalState.layout);
    syncActiveTab();
    notify();
  }
}

export function syncActiveTab() {
  if (!globalState.activeTabId) return;
  const tab = globalState.tabs.find((t) => t.id === globalState.activeTabId);
  if (tab) {
    tab.layout = globalState.layout;
    tab.activePaneId = globalState.activePaneId;
    tab.paneIds = extractPaneIds(globalState.layout);
  }
}

function splitNodeInTree(
  node: LayoutNode | null,
  targetPaneId: string,
  newPaneId: string,
  dir: 'horizontal' | 'vertical'
): LayoutNode {
  if (!node) return { type: 'pane', paneId: newPaneId };
  if (node.type === 'pane') {
    if (node.paneId === targetPaneId) {
      return {
        type: 'split',
        id: createSplitId(),
        direction: dir,
        splitRatio: 0.5,
        children: [node, { type: 'pane', paneId: newPaneId }],
      };
    }
    return node;
  }
  return {
    ...node,
    children: [
      splitNodeInTree(node.children[0], targetPaneId, newPaneId, dir),
      splitNodeInTree(node.children[1], targetPaneId, newPaneId, dir),
    ],
  };
}

export async function createTab(title?: string, initialCliType?: string): Promise<TerminalTab | null> {
  const targetCli = initialCliType || globalState.defaultShell || 'shell';
  const tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  syncActiveTab();

  const detected = globalState.detectedTools.find((t) => t.id === targetCli || t.binary === targetCli);
  const palette = detected
    ? { name: detected.name, color: detected.color, binary: detected.binary, category: detected.category }
    : AGENT_PALETTES[targetCli] || { name: targetCli, color: '#7aa2f7', binary: targetCli, category: 'agent' };

  const isShell = palette.category === 'shell' || targetCli === 'shell' || targetCli === 'bash' || targetCli === 'fish' || targetCli === 'zsh' || targetCli === 'sh';
  const shouldIsolate = !isShell;

  let newPane: AgentPane;
  if (isRunningInTauri() && invoke) {
    try {
      const info = await invoke('cmd_spawn_pane', {
        workspaceId: globalState.workspaceId,
        cliType: targetCli,
        command: palette.binary,
        args: [],
        workingDir: null,
        isolatedWorktree: shouldIsolate,
        cols: 80,
        rows: 24,
      });

      newPane = {
        id: info.pane_id,
        cliType: targetCli,
        pid: info.pid,
        status: 'IDLE',
        worktreePath: info.worktree_path,
        gitBranch: info.git_branch,
        openPorts: [],
        color: palette.color,
      };
    } catch (e) {
      console.error('Failed to spawn pane for new tab:', e);
      return null;
    }
  } else {
    const mockId = `mock_pane_${Date.now()}`;
    newPane = {
      id: mockId,
      cliType: targetCli,
      pid: 12345,
      status: 'IDLE',
      worktreePath: `.aether/worktrees/${mockId}`,
      gitBranch: `aether/${mockId}`,
      openPorts: [3000],
      color: palette.color,
    };
  }

  globalState.panes.push(newPane);

  const tabIndex = globalState.tabs.length + 1;
  const newTab: TerminalTab = {
    id: tabId,
    title: title || `Tab ${tabIndex}`,
    paneIds: [newPane.id],
    layout: { type: 'pane', paneId: newPane.id },
    activePaneId: newPane.id,
  };

  globalState.tabs.push(newTab);
  globalState.activeTabId = newTab.id;
  globalState.layout = newTab.layout;
  globalState.activePaneId = newPane.id;

  notify();
  return newTab;
}

export function switchTab(tabId: string) {
  if (globalState.activeTabId === tabId) return;

  syncActiveTab();

  const targetTab = globalState.tabs.find((t) => t.id === tabId);
  if (!targetTab) return;

  globalState.activeTabId = targetTab.id;
  globalState.layout = targetTab.layout;
  globalState.activePaneId = targetTab.activePaneId || targetTab.paneIds[0] || null;

  notify();
}

export async function closeTab(tabId: string) {
  const tabIndex = globalState.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) return;

  const tabToClose = globalState.tabs[tabIndex];

  for (const paneId of tabToClose.paneIds) {
    if (invoke) {
      try {
        await invoke('cmd_kill_pane', { paneId, signal: 15 });
      } catch (e) {
        console.warn('Kill pane error:', e);
      }
    }
    globalState.panes = globalState.panes.filter((p) => p.id !== paneId);
  }

  globalState.tabs.splice(tabIndex, 1);

  if (globalState.activeTabId === tabId) {
    if (globalState.tabs.length > 0) {
      const nextIndex = Math.min(tabIndex, globalState.tabs.length - 1);
      const nextTab = globalState.tabs[nextIndex];
      globalState.activeTabId = nextTab.id;
      globalState.layout = nextTab.layout;
      globalState.activePaneId = nextTab.activePaneId;
    } else {
      globalState.layout = null;
      globalState.activePaneId = null;
      globalState.activeTabId = null;
      await createTab('Tab 1', globalState.defaultShell || 'shell');
      return;
    }
  }

  notify();
}

export function renameTab(tabId: string, newTitle: string) {
  const tab = globalState.tabs.find((t) => t.id === tabId);
  if (tab && newTitle.trim()) {
    tab.title = newTitle.trim();
    notify();
  }
}

export function setTabColor(tabId: string, color?: string | null) {
  const tab = globalState.tabs.find((t) => t.id === tabId);
  if (tab) {
    tab.color = color || undefined;
    notify();
  }
}

export async function closeOtherTabs(tabId: string) {
  const otherTabs = globalState.tabs.filter((t) => t.id !== tabId);
  for (const other of otherTabs) {
    await closeTab(other.id);
  }
  switchTab(tabId);
}

export async function duplicateTab(tabId: string) {
  const tab = globalState.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const activePane = globalState.panes.find((p) => p.id === tab.activePaneId);
  const cli = activePane?.cliType || 'shell';
  const newTab = await createTab(`${tab.title} (copy)`, cli);
  if (newTab && tab.color) {
    newTab.color = tab.color;
    notify();
  }
}

export function nextTab() {
  if (globalState.tabs.length <= 1) return;
  const currentIndex = globalState.tabs.findIndex((t) => t.id === globalState.activeTabId);
  const nextIndex = (currentIndex + 1) % globalState.tabs.length;
  switchTab(globalState.tabs[nextIndex].id);
}

export function previousTab() {
  if (globalState.tabs.length <= 1) return;
  const currentIndex = globalState.tabs.findIndex((t) => t.id === globalState.activeTabId);
  const prevIndex = (currentIndex - 1 + globalState.tabs.length) % globalState.tabs.length;
  switchTab(globalState.tabs[prevIndex].id);
}

export async function spawnAgentPane(
  cliType: string = 'shell',
  isolatedWorktree?: boolean,
  splitDirection: 'horizontal' | 'vertical' = 'vertical',
  customCommand?: string
): Promise<AgentPane | null> {
  const detected = globalState.detectedTools.find((t) => t.id === cliType || t.binary === cliType);
  const palette = detected
    ? { name: detected.name, color: detected.color, binary: detected.binary, category: detected.category }
    : AGENT_PALETTES[cliType] || { name: cliType, color: '#7aa2f7', binary: customCommand || cliType, category: 'agent' };

  const isShell = palette.category === 'shell' || cliType === 'shell' || cliType === 'bash' || cliType === 'fish' || cliType === 'zsh' || cliType === 'sh';
  const shouldIsolate = isolatedWorktree !== undefined ? isolatedWorktree : !isShell;

  if (isRunningInTauri() && invoke) {
    try {
      const info = await invoke('cmd_spawn_pane', {
        workspaceId: globalState.workspaceId,
        cliType,
        command: customCommand || palette.binary,
        args: [],
        workingDir: null,
        isolatedWorktree: shouldIsolate,
        cols: 80,
        rows: 24,
      });

      const newPane: AgentPane = {
        id: info.pane_id,
        cliType,
        pid: info.pid,
        status: 'IDLE',
        worktreePath: info.worktree_path,
        gitBranch: info.git_branch,
        openPorts: [],
        color: palette.color,
      };

      const previousActiveId = globalState.activePaneId;
      globalState.panes.push(newPane);
      globalState.activePaneId = newPane.id;

      if (!globalState.layout) {
        globalState.layout = { type: 'pane', paneId: newPane.id };
      } else if (previousActiveId) {
        globalState.layout = balanceLayout(
          splitNodeInTree(globalState.layout, previousActiveId, newPane.id, splitDirection)
        );
      } else {
        globalState.layout = balanceLayout({
          type: 'split',
          id: createSplitId(),
          direction: splitDirection,
          splitRatio: 0.5,
          children: [globalState.layout, { type: 'pane', paneId: newPane.id }],
        });
      }

      if (!globalState.activeTabId) {
        const initialTab: TerminalTab = {
          id: `tab_${Date.now()}`,
          title: `@${newPane.cliType}`,
          paneIds: [newPane.id],
          layout: globalState.layout,
          activePaneId: newPane.id,
        };
        globalState.tabs = [initialTab];
        globalState.activeTabId = initialTab.id;
      } else {
        syncActiveTab();
      }

      notify();
      return newPane;
    } catch (e) {
      console.error('Failed to spawn pane:', e);
      return null;
    }
  } else {
    // Mock browser fallback
    const mockId = `mock_pane_${Date.now()}`;
    const newPane: AgentPane = {
      id: mockId,
      cliType,
      pid: 12345,
      status: 'IDLE',
      worktreePath: `.aether/worktrees/${mockId}`,
      gitBranch: `aether/${mockId}`,
      openPorts: [3000],
      color: palette.color,
    };
    const previousActiveId = globalState.activePaneId;
    globalState.panes.push(newPane);
    globalState.activePaneId = mockId;
    if (!globalState.layout) {
      globalState.layout = { type: 'pane', paneId: mockId };
    } else if (previousActiveId) {
      globalState.layout = balanceLayout(
        splitNodeInTree(globalState.layout, previousActiveId, mockId, splitDirection)
      );
    } else {
      globalState.layout = balanceLayout({
        type: 'split',
        id: createSplitId(),
        direction: splitDirection,
        splitRatio: 0.5,
        children: [globalState.layout, { type: 'pane', paneId: mockId }],
      });
    }

    if (!globalState.activeTabId) {
      const initialTab: TerminalTab = {
        id: `tab_${Date.now()}`,
        title: `@${newPane.cliType}`,
        paneIds: [newPane.id],
        layout: globalState.layout,
        activePaneId: newPane.id,
      };
      globalState.tabs = [initialTab];
      globalState.activeTabId = initialTab.id;
    } else {
      syncActiveTab();
    }

    notify();
    return newPane;
  }
}

export function setActivePane(id: string) {
  globalState.activePaneId = id;
  syncActiveTab();
  notify();
}

export function splitActivePane(direction: 'horizontal' | 'vertical', cliType?: string) {
  const active = globalState.panes.find((p) => p.id === globalState.activePaneId);
  const targetCli = cliType || active?.cliType || globalState.defaultShell || 'shell';
  const detected = globalState.detectedTools.find((t) => t.id === targetCli || t.binary === targetCli);
  const isAgent = detected ? detected.category === 'agent' : (targetCli !== 'shell' && targetCli !== 'bash' && targetCli !== 'zsh' && targetCli !== 'fish' && targetCli !== 'sh');
  return spawnAgentPane(targetCli, isAgent, direction);
}

export async function closePane(paneId: string) {
  if (invoke) {
    try {
      await invoke('cmd_kill_pane', { paneId, signal: 15 });
    } catch (e) {
      console.warn('Kill pane error:', e);
    }
  }

  globalState.panes = globalState.panes.filter((p) => p.id !== paneId);

  // Remove from layout tree
  function removeFromTree(node: LayoutNode | null): LayoutNode | null {
    if (!node) return null;
    if (node.type === 'pane') {
      return node.paneId === paneId ? null : node;
    }
    const left = removeFromTree(node.children[0]);
    const right = removeFromTree(node.children[1]);
    if (!left && !right) return null;
    if (!left) return right;
    if (!right) return left;
    return { ...node, children: [left, right] };
  }

  globalState.layout = removeFromTree(globalState.layout);
  if (globalState.layout) {
    globalState.layout = balanceLayout(globalState.layout);
  }

  if (globalState.activePaneId === paneId) {
    const remainingPaneIds = extractPaneIds(globalState.layout);
    globalState.activePaneId = remainingPaneIds[0] || null;
  }

  syncActiveTab();

  // If the active tab has 0 panes left and there are other tabs, close this tab!
  if (globalState.activeTabId && (!globalState.layout || extractPaneIds(globalState.layout).length === 0)) {
    if (globalState.tabs.length > 1) {
      await closeTab(globalState.activeTabId);
      return;
    }
  }

  notify();
}

export async function checkPaneRunningProcess(paneId: string): Promise<string | null> {
  const pane = globalState.panes.find((p) => p.id === paneId);
  if (!pane) return null;

  if (invoke && pane.pid) {
    try {
      const running: string | null = await invoke('cmd_check_pane_process', {
        pid: pane.pid,
        cliType: pane.cliType,
      });
      if (running) return running;
    } catch (e) {
      console.warn('Check process error:', e);
    }
  }

  const isGenericShell = ['shell', 'bash', 'fish', 'zsh', 'sh'].includes(pane.cliType.toLowerCase());
  if (!isGenericShell) {
    return pane.cliType;
  }
  return null;
}

export async function requestClosePane(paneId: string) {
  const pane = globalState.panes.find((p) => p.id === paneId);
  if (!pane) return;

  const running = await checkPaneRunningProcess(paneId);
  if (running) {
    globalState.confirmCloseModal = {
      isOpen: true,
      paneId: pane.id,
      processName: running,
      pid: pane.pid || 0,
    };
    notify();
    return;
  }

  await closePane(paneId);
}

export function cancelCloseModal() {
  globalState.confirmCloseModal = {
    isOpen: false,
    paneId: null,
    processName: '',
    pid: 0,
  };
  notify();
}

export async function confirmCloseModal() {
  const targetId = globalState.confirmCloseModal.paneId;
  cancelCloseModal();
  if (targetId) {
    await closePane(targetId);
  }
}

export function toggleBackgroundDrawer(open?: boolean) {
  globalState.backgroundDrawerOpen = open !== undefined ? open : !globalState.backgroundDrawerOpen;
  notify();
}

export async function spawnBackgroundCommand(command: string, cliType: string = 'shell'): Promise<BackgroundTask | null> {
  if (!command.trim()) return null;

  try {
    const info: any = await invoke('cmd_spawn_pane', {
      workspaceId: globalState.workspaceId,
      cliType,
      command: command.trim(),
      args: [],
      workingDir: null,
      isolatedWorktree: false,
      cols: 80,
      rows: 24,
    });

    const taskId = info.pane_id;
    const task: BackgroundTask = {
      id: taskId,
      cliType,
      command: command.trim(),
      pid: info.pid,
      status: 'RUNNING',
      startedAt: Date.now(),
      openPorts: [],
      recentOutput: [],
    };

    globalState.panes.push({
      id: taskId,
      cliType,
      pid: info.pid,
      status: 'EXECUTING',
      worktreePath: info.worktree_path,
      gitBranch: info.git_branch,
      openPorts: [],
      color: '#10b981',
    });

    globalState.backgroundTasks.push(task);
    notify();
    return task;
  } catch (e) {
    console.error('Failed to spawn background command:', e);
    return null;
  }
}

export function sendPaneToBackground(paneId: string) {
  const pane = globalState.panes.find((p) => p.id === paneId);
  if (!pane) return;

  function removeFromTree(node: LayoutNode | null): LayoutNode | null {
    if (!node) return null;
    if (node.type === 'pane') {
      return node.paneId === paneId ? null : node;
    }
    const left = removeFromTree(node.children[0]);
    const right = removeFromTree(node.children[1]);
    if (!left && !right) return null;
    if (!left) return right;
    if (!right) return left;
    return { ...node, children: [left, right] };
  }

  globalState.layout = removeFromTree(globalState.layout);
  if (globalState.layout) {
    globalState.layout = balanceLayout(globalState.layout);
  }

  const existingIndex = globalState.backgroundTasks.findIndex((t) => t.id === paneId);
  if (existingIndex === -1) {
    globalState.backgroundTasks.push({
      id: pane.id,
      cliType: pane.cliType,
      command: pane.cliType,
      pid: pane.pid,
      status: 'RUNNING',
      startedAt: Date.now(),
      openPorts: pane.openPorts || [],
      recentOutput: [],
    });
  }

  syncActiveTab();

  if (globalState.activePaneId === paneId) {
    const remainingPaneIds = extractPaneIds(globalState.layout);
    globalState.activePaneId = remainingPaneIds[0] || null;
  }

  notify();
}

export async function bringBackgroundToForeground(taskId: string, asNewTab: boolean = false) {
  const taskIndex = globalState.backgroundTasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return;

  const task = globalState.backgroundTasks[taskIndex];
  globalState.backgroundTasks.splice(taskIndex, 1);

  if (asNewTab) {
    const newTab: TerminalTab = {
      id: `tab_${Date.now()}`,
      title: task.command || `@${task.cliType}`,
      paneIds: [task.id],
      layout: { type: 'pane', paneId: task.id },
      activePaneId: task.id,
    };
    globalState.tabs.push(newTab);
    globalState.activeTabId = newTab.id;
    globalState.layout = newTab.layout;
    globalState.activePaneId = task.id;
  } else {
    if (!globalState.layout) {
      globalState.layout = { type: 'pane', paneId: task.id };
    } else {
      globalState.layout = balanceLayout({
        type: 'split',
        id: createSplitId(),
        direction: 'vertical',
        splitRatio: 0.5,
        children: [globalState.layout, { type: 'pane', paneId: task.id }],
      });
    }
    globalState.activePaneId = task.id;
    syncActiveTab();
  }

  notify();
}

export async function terminateBackgroundTask(taskId: string) {
  if (invoke) {
    try {
      await invoke('cmd_kill_pane', { paneId: taskId, signal: 15 });
    } catch (e) {
      console.warn('Kill background task error:', e);
    }
  }

  globalState.backgroundTasks = globalState.backgroundTasks.filter((t) => t.id !== taskId);
  globalState.panes = globalState.panes.filter((p) => p.id !== taskId);
  notify();
}

export function navigatePane(direction: 'left' | 'right' | 'up' | 'down') {
  if (!globalState.activePaneId || !globalState.layout) return;
  const paneIds = extractPaneIds(globalState.layout);
  if (paneIds.length <= 1) return;

  const currentEl = document.querySelector(`[data-pane-id="${globalState.activePaneId}"]`);
  if (!currentEl) {
    const idx = paneIds.indexOf(globalState.activePaneId);
    const nextIdx = direction === 'right' || direction === 'down'
      ? (idx + 1) % paneIds.length
      : (idx - 1 + paneIds.length) % paneIds.length;
    setActivePane(paneIds[nextIdx]);
    return;
  }

  const currentRect = currentEl.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;

  let bestPaneId: string | null = null;
  let minDistance = Infinity;

  for (const pid of paneIds) {
    if (pid === globalState.activePaneId) continue;
    const el = document.querySelector(`[data-pane-id="${pid}"]`);
    if (!el) continue;

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = centerX - currentCenterX;
    const dy = centerY - currentCenterY;

    let isValid = false;
    if (direction === 'left' && dx < -20) isValid = true;
    if (direction === 'right' && dx > 20) isValid = true;
    if (direction === 'up' && dy < -20) isValid = true;
    if (direction === 'down' && dy > 20) isValid = true;

    if (isValid) {
      const dist = Math.hypot(dx, dy);
      if (dist < minDistance) {
        minDistance = dist;
        bestPaneId = pid;
      }
    }
  }

  if (bestPaneId) {
    setActivePane(bestPaneId);
  } else {
    const idx = paneIds.indexOf(globalState.activePaneId);
    const nextIdx = direction === 'right' || direction === 'down'
      ? (idx + 1) % paneIds.length
      : (idx - 1 + paneIds.length) % paneIds.length;
    setActivePane(paneIds[nextIdx]);
  }
}

export function keyboardResizeSplit(delta: number) {
  if (!globalState.layout || !globalState.activePaneId) return;

  function findAndAdjust(node: LayoutNode | null): boolean {
    if (!node || node.type === 'pane') return false;
    const leftHas = extractPaneIds(node.children[0]).includes(globalState.activePaneId!);
    const rightHas = extractPaneIds(node.children[1]).includes(globalState.activePaneId!);

    if (leftHas || rightHas) {
      if (leftHas && findAndAdjust(node.children[0])) return true;
      if (rightHas && findAndAdjust(node.children[1])) return true;

      const adjustment = leftHas ? delta : -delta;
      node.splitRatio = Math.max(0.05, Math.min(0.95, Number((node.splitRatio + adjustment).toFixed(4))));
      return true;
    }
    return false;
  }

  findAndAdjust(globalState.layout);
  syncActiveTab();
  notify();
}

export function toggleOrchestrator(open?: boolean) {
  globalState.orchestratorOpen = open !== undefined ? open : !globalState.orchestratorOpen;
  notify();
}

export function toggleCommandPalette(open?: boolean) {
  globalState.commandPaletteOpen = open !== undefined ? open : !globalState.commandPaletteOpen;
  notify();
}

export function toggleThemeModal(open?: boolean) {
  globalState.themeModalOpen = open !== undefined ? open : !globalState.themeModalOpen;
  notify();
}

export function setAetherTheme(themeId: string) {
  globalState.currentTheme = themeId;
  applyTheme(themeId, globalState.windowOpacity);
  notify();
}

export function setTerminalOpacity(opacity: number) {
  globalState.windowOpacity = opacity;
  applyTheme(globalState.currentTheme, opacity);
  notify();
}

export function toggleCustomToolModal(open?: boolean) {
  globalState.customToolModalOpen = open !== undefined ? open : !globalState.customToolModalOpen;
  notify();
}

export async function openDiffGatekeeper(paneId?: string, targetBranch?: string) {
  const targetId = paneId || globalState.activePaneId;
  if (!targetId) return;

  try {
    const diff: WorktreeDiff = await invoke('cmd_get_worktree_diff', {
      paneId: targetId,
      targetBranch: targetBranch || null,
    });
    if (diff) {
      globalState.activeDiff = diff;
    }
  } catch (e) {
    console.error('Failed to load diff:', e);
    globalState.activeDiff = {
      pane_id: targetId,
      diff_unified: 'No unmerged changes detected in worktree branch.',
      files_changed: [],
      insertions: 0,
      deletions: 0,
    };
  }
  globalState.diffGatekeeperOpen = true;
  notify();
}

export function closeDiffGatekeeper() {
  globalState.diffGatekeeperOpen = false;
  notify();
}

export async function mergeWorktreeSquash(paneId: string, message: string, targetBranch?: string) {
  try {
    await invoke('cmd_merge_worktree', {
      paneId,
      targetBranch: targetBranch || null,
      squash: true,
      commitMessage: message,
    });
    closeDiffGatekeeper();
  } catch (e) {
    console.error('Merge failed:', e);
  }
}

export function toggleTimeTravel(open?: boolean) {
  globalState.timeTravelOpen = open !== undefined ? open : !globalState.timeTravelOpen;
  if (globalState.timeTravelOpen && globalState.activePaneId) {
    listSnapshots(globalState.activePaneId);
  }
  notify();
}

export async function listSnapshots(paneId?: string): Promise<GitSnapshot[]> {
  const targetId = paneId || globalState.activePaneId;
  if (!targetId) return [];

  try {
    const list = await invoke('cmd_list_snapshots', { paneId: targetId });
    if (Array.isArray(list)) {
      globalState.snapshots = list;
      notify();
      return list;
    }
  } catch (e) {
    console.warn('Failed to list snapshots:', e);
  }
  return [];
}

export async function createSnapshot(summary: string): Promise<string | null> {
  const targetId = globalState.activePaneId;
  if (!targetId) return null;

  try {
    const id = await invoke('cmd_create_snapshot', {
      paneId: targetId,
      summary,
    });
    await listSnapshots(targetId);
    return id;
  } catch (e) {
    console.error('Failed to create snapshot:', e);
    return null;
  }
}

export async function rollbackSnapshot(snapshotId: string): Promise<boolean> {
  const targetId = globalState.activePaneId;
  if (!targetId) return false;

  try {
    await invoke('cmd_rollback_snapshot', {
      paneId: targetId,
      snapshotId,
    });
    return true;
  } catch (e) {
    console.error('Failed to rollback snapshot:', e);
    return false;
  }
}

export function toggleObsidianSidebar(open?: boolean) {
  globalState.obsidianSidebarOpen = open !== undefined ? open : !globalState.obsidianSidebarOpen;
  notify();
}

export function toggleAetherDriveSidebar(open?: boolean) {
  globalState.aetherDriveSidebarOpen = open !== undefined ? open : !globalState.aetherDriveSidebarOpen;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_drive_sidebar_open', String(globalState.aetherDriveSidebarOpen));
  }
  if (globalState.aetherDriveSidebarOpen) {
    void loadWorkflows();
  }
  notify();
}

export const toggleSidebar = toggleAetherDriveSidebar;

export function toggleSidebarMinimized(minimized?: boolean) {
  globalState.sidebarMinimized = minimized !== undefined ? minimized : !globalState.sidebarMinimized;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_sidebar_minimized', String(globalState.sidebarMinimized));
  }
  notify();
}

export function toggleAiAssistant(open?: boolean) {
  globalState.aiAssistantOpen = open !== undefined ? open : !globalState.aiAssistantOpen;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_ai_assistant_open', String(globalState.aiAssistantOpen));
  }
  notify();
}

export function setAiAssistantOpen(open: boolean) {
  toggleAiAssistant(open);
}

export function setAetherDriveActiveTab(tab: 'tree' | 'search' | 'workflows') {
  globalState.aetherDriveActiveTab = tab;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_drive_active_tab', tab);
  }
  notify();
}

export function toggleAetherDrivePathExpanded(path: string, expanded?: boolean) {
  const current = new Set(globalState.aetherDriveExpandedPaths);
  const shouldExpand = expanded !== undefined ? expanded : !current.has(path);
  if (shouldExpand) {
    current.add(path);
  } else {
    current.delete(path);
  }
  globalState.aetherDriveExpandedPaths = Array.from(current);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('aether_drive_expanded_paths', JSON.stringify(globalState.aetherDriveExpandedPaths));
    } catch (e) {
      console.warn('Failed to persist expanded paths:', e);
    }
  }
  notify();
}

export function setAetherDriveExpandedPaths(paths: string[]) {
  globalState.aetherDriveExpandedPaths = paths;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('aether_drive_expanded_paths', JSON.stringify(paths));
    } catch (e) {
      console.warn('Failed to persist expanded paths:', e);
    }
  }
  notify();
}

export async function sendPtyInput(paneId: string, data: string | Uint8Array) {
  if (invoke) {
    try {
      const bytes = typeof data === 'string' ? Array.from(new TextEncoder().encode(data)) : Array.from(data);
      await invoke('cmd_send_pty_input', { paneId, data: bytes });
    } catch (e) {
      console.error('sendPtyInput error:', e);
    }
  }
}

export async function resizePanePty(paneId: string, cols: number, rows: number) {
  if (invoke && cols > 0 && rows > 0) {
    try {
      await invoke('cmd_resize_pane', { paneId, cols: Math.max(1, cols), rows: Math.max(1, rows) });
    } catch (e) {
      console.warn('resizePanePty error:', e);
    }
  }
}

// ----------------------------------------------------------------------------
// Real-time Event Subscriptions & Global Shortcuts Setup
// ----------------------------------------------------------------------------

export function setupGlobalShortcuts() {
  const onKeyDown = (e: KeyboardEvent) => {
    // Cmd+\ or Ctrl+\ -> Aether Drive Sidebar
    if ((e.ctrlKey || e.metaKey) && (e.key === '\\' || e.code === 'Backslash')) {
      e.preventDefault();
      toggleAetherDriveSidebar();
    }
    // Ctrl+P or Cmd+P -> Command Palette
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P') && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      toggleCommandPalette();
    }
    // Cmd+D or Ctrl+D -> Split Vertical; Cmd+Shift+D or Ctrl+Shift+D -> Split Horizontal
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && !e.altKey) {
      e.preventDefault();
      splitActivePane(e.shiftKey ? 'horizontal' : 'vertical');
    }
    // Ctrl+, or Cmd+, -> Theming / Appearance Modal
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      toggleThemeModal();
    }
    // Escape -> Close open modals
    if (e.key === 'Escape') {
      if (globalState.commandPaletteOpen) {
        e.preventDefault();
        toggleCommandPalette(false);
      }
      if (globalState.themeModalOpen) {
        e.preventDefault();
        toggleThemeModal(false);
      }
    }
    // Ctrl+Space -> Orchestrator Bar
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      toggleOrchestrator();
    }
    // Ctrl+T or Ctrl+Shift+T -> New Tab
    if (e.ctrlKey && (e.key === 't' || e.key === 'T') && !e.altKey) {
      e.preventDefault();
      createTab();
    }
    // Ctrl+Tab or Ctrl+PageDown -> Next Tab
    if (e.ctrlKey && (e.code === 'Tab' || e.code === 'PageDown') && !e.shiftKey) {
      e.preventDefault();
      nextTab();
    }
    // Ctrl+Shift+Tab or Ctrl+PageUp -> Previous Tab
    if (e.ctrlKey && (e.code === 'Tab' || e.code === 'PageUp') && e.shiftKey) {
      e.preventDefault();
      previousTab();
    }
    // Alt+E -> Equalize / Balance Panes
    if (e.altKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      equalizeLayout();
    }
    // Alt+1 .. Alt+9 -> Switch to Tab
    if (e.altKey && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      if (globalState.tabs[idx]) {
        e.preventDefault();
        switchTab(globalState.tabs[idx].id);
      }
    }
    // Alt+M -> Diff Gatekeeper
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      openDiffGatekeeper();
    }
    // Alt+Z -> Time Travel Snapshot Slider
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      toggleTimeTravel();
    }
    // Ctrl+B -> Obsidian Sidebar
    if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleObsidianSidebar();
    }
    // Alt+V -> Split Vertical
    if (e.altKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      splitActivePane('vertical');
    }
    // Alt+S -> Split Horizontal
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      splitActivePane('horizontal');
    }
    // Ctrl+W or Alt+W -> Close Active Pane (with safety check on running foreground processes)
    if ((e.ctrlKey || e.altKey) && (e.key === 'w' || e.key === 'W') && !e.shiftKey) {
      e.preventDefault();
      if (globalState.activePaneId) {
        requestClosePane(globalState.activePaneId);
      }
    }

    // Ctrl+Shift+W -> Close Current Tab
    if (e.ctrlKey && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      if (globalState.activeTabId) {
        closeTab(globalState.activeTabId);
      }
    }

    // Alt+B -> Send active pane to background
    if (e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      if (globalState.activePaneId) {
        sendPaneToBackground(globalState.activePaneId);
      }
    }

    // Alt+Shift+B -> Toggle Background Tasks Drawer
    if (e.altKey && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleBackgroundDrawer();
    }

    // Alt+R -> Aether Drive Workflow Palette
    if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      toggleWorkflowsModal();
    }
    // Alt+I -> Toggle Input Bar on active pane
    if (e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      if (globalState.activePaneId) {
        togglePaneInputBar(globalState.activePaneId);
      }
    }
    // Alt+Shift+P -> Advance pending pipeline stage
    if (e.altKey && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      advancePipelineStage();
    }
    // Directional Pane Navigation (Vim keys & Arrows)
    if (e.altKey && !e.shiftKey) {
      if (e.key === 'h' || e.key === 'H' || e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePane('left');
      } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
        e.preventDefault();
        navigatePane('right');
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigatePane('up');
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigatePane('down');
      }
    }

    // Keyboard Split Resizing (Alt+Shift+H/J/K/L & Alt+Shift+Arrows)
    if (e.altKey && e.shiftKey) {
      if (e.key === 'h' || e.key === 'H' || e.key === 'ArrowLeft') {
        e.preventDefault();
        keyboardResizeSplit(-0.05);
      } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
        e.preventDefault();
        keyboardResizeSplit(0.05);
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault();
        keyboardResizeSplit(-0.05);
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        e.preventDefault();
        keyboardResizeSplit(0.05);
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

export function subscribeAetherEvents(onPtyData?: (paneId: string, bytes: Uint8Array, offset?: number) => void) {
  if (!listen) return () => {};

  let unlistenPromise = listen('aether:event', (event: any) => {
    const payload = event.payload;
    if (!payload) return;

    if (payload.PtyOutput) {
      const { pane_id, data, offset = 0 } = payload.PtyOutput;
      const bytes = new Uint8Array(data);
      if (onPtyData) {
        onPtyData(pane_id, bytes, offset);
      }
      // Attribute output to the pane's active command block (Warp Block View).
      // Decode only when the pane is in 'blocks' view mode and a block is actually open:
      // decoding + ANSI-stripping every chunk is extremely expensive during interactive TUIs (agy, opencode)
      // and causes unnecessary main-thread locks and React re-renders when in normal terminal mode.
      const targetPane = globalState.panes.find((p) => p.id === pane_id);
      if (targetPane && targetPane.viewMode === 'blocks' && getOpenCommandBlock(pane_id)) {
        try {
          const decoded = new TextDecoder().decode(new Uint8Array(data));
          appendBlockOutput(pane_id, stripAnsi(decoded));
        } catch {}
      }
    } else if (payload.PaneExited) {
      const { pane_id, exit_code } = payload.PaneExited;
      finishCommandBlock(pane_id, exit_code);

      const bg = globalState.backgroundTasks.find((t) => t.id === pane_id);
      if (bg) {
        bg.status = exit_code === 0 ? 'EXITED' : 'ERROR';
      }
      const p = globalState.panes.find((pane) => pane.id === pane_id);
      if (p) {
        p.status = exit_code === 0 ? 'IDLE' : 'ERROR';
        p.lastExitCode = exit_code;
      }
      notify();
    } else if (payload.DelegationPaneRequested) {
      const { target_cli, prompt } = payload.DelegationPaneRequested;
      spawnAgentPane(target_cli, true).then((pane) => {
        if (pane) {
          setTimeout(() => {
            sendPtyInput(pane.id, `${prompt}\n`);
          }, 600);
        }
      });
    } else if (payload.ObsidianNoteUpdated || payload.WorkspaceFileChanged) {
      globalState.obsidianRefreshTick += 1;
      notify();
    } else if (payload.PaneStatusChanged) {
      const { pane_id, status } = payload.PaneStatusChanged;
      const p = globalState.panes.find((pane) => pane.id === pane_id);
      if (p) {
        p.status = status;
        notify();
      }
    } else if (payload.PortRadarDetected) {
      const { pane_id, ports } = payload.PortRadarDetected;
      const p = globalState.panes.find((pane) => pane.id === pane_id);
      if (p) {
        p.openPorts = ports;
        notify();
      }
    } else if (payload.BlackboardEntryCreated) {
      globalState.blackboard.unshift(payload.BlackboardEntryCreated);
      notify();
    } else if (payload.ModuleClaimed || payload.ModuleReleased || payload.FileLockChanged) {
      // Refresh locks
      refreshSharedContext();
    } else if (payload.GitSnapshotCreated) {
      if (globalState.activePaneId && payload.GitSnapshotCreated.pane_id === globalState.activePaneId) {
        listSnapshots(globalState.activePaneId);
      }
    } else if (payload.AiPilotEvent) {
      const { pane_id, step, details } = payload.AiPilotEvent;
      globalState.aiPilotSteps.push({
        paneId: pane_id,
        step,
        details,
        timestamp: Date.now(),
      });
      notify();
    }
  });

  return () => {
    unlistenPromise.then((unlisten: any) => unlisten && unlisten());
  };
}

export async function cleanupAllPanes(): Promise<void> {
  if (isRunningInTauri() && invoke) {
    try {
      await invoke('cmd_cleanup_all_panes');
    } catch (e) {
      console.warn('cmd_cleanup_all_panes failed, falling back to manual kill:', e);
      for (const p of globalState.panes) {
        try {
          await invoke('cmd_kill_pane', { paneId: p.id, signal: 9 });
        } catch {}
      }
    }
  }
  globalState.panes = [];
  globalState.tabs = [];
  globalState.activePaneId = null;
  globalState.activeTabId = null;
  globalState.layout = null;
  globalState.commandBlocks = [];
  notify();
}

export async function initFreshSession(): Promise<void> {
  // 1. Terminate any lingering background child processes / panes from daemon
  await cleanupAllPanes();

  // 2. Discover available CLI tools and shells
  try {
    await detectAvailableTools();
  } catch (e) {
    console.warn('Failed to detect tools on init:', e);
  }

  // 3. Open a clean, fresh shell tab with pristine terminal state
  await createTab('Main', globalState.defaultShell || 'shell');

  // 4. Automatically open a brand new clean AI assistant session
  try {
    createAiSession('Percakapan Baru');
  } catch (e) {
    console.warn('Failed to create fresh AI session on init:', e);
  }

  notify();
}

export async function restoreActivePanes(): Promise<void> {
  // Always initialize a clean session on launch to prevent background processing leaks
  await initFreshSession();
}

export async function refreshSharedContext(query?: string) {
  try {
    const summary = await invoke('cmd_get_shared_context', {
      workspaceId: globalState.workspaceId,
      query: query || null,
    });
    if (summary) {
      globalState.blackboard = summary.blackboard_entries || summary.recent_blackboard_entries || [];
      globalState.fileLocks = summary.active_file_locks || [];
      notify();
    }
  } catch (e) {
    console.warn('Failed to refresh shared context:', e);
  }
}

export async function publishBlackboardEntry(
  authorAgentId: string,
  entryType: string,
  title: string,
  contentMarkdown: string,
  targetAgentId?: string
) {
  if (invoke) {
    try {
      const id = await invoke('cmd_publish_blackboard', {
        workspaceId: globalState.workspaceId,
        authorAgentId,
        entryType,
        title,
        contentMarkdown,
        targetAgentId: targetAgentId || null,
      });
      await refreshSharedContext();
      return id;
    } catch (e) {
      console.error('Failed to publish blackboard entry:', e);
      throw e;
    }
  } else {
    // Fallback mock
    const entry: BlackboardEntry = {
      id: Date.now(),
      workspace_id: globalState.workspaceId,
      author_agent_id: authorAgentId,
      entry_type: entryType as any,
      title,
      content_markdown: contentMarkdown,
      target_agent_id: targetAgentId,
      is_resolved: false,
      created_at: new Date().toISOString(),
    };
    globalState.blackboard.unshift(entry);
    notify();
    return entry.id;
  }
}

export async function readObsidianNote(queryOrPath: string): Promise<string> {
  if (invoke) {
    try {
      return await invoke('cmd_read_obsidian_note', {
        workspaceId: globalState.workspaceId,
        queryOrPath,
      });
    } catch (e) {
      console.warn('Note read error:', e);
      return '';
    }
  } else {
    return `# Sprint & Architecture Notes\n\n- [ ] Scaffold AetherTerminal GUI with Tauri v2 and Xterm.js WebGL\n- [x] Implement aetherd SQLite WAL One Brain\n- [ ] Wire Obsidian vault bidirectional task synchronization\n- [x] Configure Linux Port Radar on /proc/net/tcp\n- [ ] Implement Multi-agent squash merge gatekeeper\n`;
  }
}

export async function updateObsidianTask(
  notePath: string,
  taskText: string,
  completed: boolean
): Promise<void> {
  if (invoke) {
    try {
      await invoke('cmd_update_obsidian_task', {
        workspaceId: globalState.workspaceId,
        notePath,
        taskText,
        completed,
      });
    } catch (e) {
      console.error('Failed to update obsidian task:', e);
      throw e;
    }
  }
}

export async function claimModule(
  agentId: string,
  files: string[],
  intent?: string
): Promise<{ granted: boolean; conflicts: string[] }> {
  if (invoke) {
    try {
      const [granted, conflicts] = await invoke('cmd_claim_module', {
        workspaceId: globalState.workspaceId,
        agentId,
        files,
        intent: intent || null,
      });
      await refreshSharedContext();
      return { granted, conflicts };
    } catch (e) {
      console.error('Failed to claim module:', e);
      return { granted: false, conflicts: [String(e)] };
    }
  } else {
    return { granted: true, conflicts: [] };
  }
}

export async function releaseModule(agentId: string, files: string[]): Promise<void> {
  if (invoke) {
    try {
      await invoke('cmd_release_module', {
        workspaceId: globalState.workspaceId,
        agentId,
        files,
      });
      await refreshSharedContext();
    } catch (e) {
      console.error('Failed to release module:', e);
    }
  }
}

// ----------------------------------------------------------------------------
// Warp-Style Command Blocks, Scrollback Restoration & Pipeline Orchestration
// ----------------------------------------------------------------------------

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export interface ScrollbackDataResult {
  data: Uint8Array;
  endOffset: number;
}

export async function getPaneScrollback(paneId: string): Promise<ScrollbackDataResult | null> {
  if (!isRunningInTauri()) return null;
  try {
    const res = (await invoke('cmd_get_scrollback', { paneId })) as { data: number[] | Uint8Array; end_offset?: number } | null;
    if (!res || !res.data) return null;
    const data = Array.isArray(res.data) ? new Uint8Array(res.data) : (res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data));
    const endOffset = typeof res.end_offset === 'number' ? res.end_offset : data.length;
    return { data, endOffset };
  } catch (e) {
    console.warn('getPaneScrollback failed:', e);
    return null;
  }
}

export function getPaneBlocks(paneId: string): CommandBlock[] {
  return globalState.commandBlocks.filter((b) => b.paneId === paneId);
}

export function startCommandBlock(paneId: string, command: string, cwd?: string): CommandBlock {
  const pane = globalState.panes.find((p) => p.id === paneId);
  const block: CommandBlock = {
    id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    paneId,
    command,
    cwd: cwd || pane?.worktreePath || '',
    startedAt: Date.now(),
    exitCode: null,
    outputText: '',
    isBookmarked: false,
    isCollapsed: false,
  };
  globalState.commandBlocks.push(block);
  if (pane) pane.status = 'EXECUTING';
  notify();
  return block;
}

let lastBlockNotify = 0;

export function getOpenCommandBlock(paneId: string): CommandBlock | undefined {
  const blocks = globalState.commandBlocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].paneId === paneId) {
      return blocks[i].exitCode === null ? blocks[i] : undefined;
    }
  }
  return undefined;
}

export function appendBlockOutput(paneId: string, text: string) {
  const blocks = globalState.commandBlocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].paneId === paneId) {
      // Only a block that is still running owns new output. Appending to a finished
      // block made the string grow without bound on every chunk.
      if (blocks[i].exitCode !== null) return;
      blocks[i].outputText += text;
      if (blocks[i].outputText.length > 200_000) {
        blocks[i].outputText = blocks[i].outputText.slice(-200_000);
      }
      // Throttle re-renders: output streams at high frequency
      const now = Date.now();
      if (now - lastBlockNotify > 250) {
        lastBlockNotify = now;
        notify();
      }
      return;
    }
  }
}

export function finishCommandBlock(paneId: string, exitCode: number | null) {
  const blocks = globalState.commandBlocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].paneId === paneId && blocks[i].finishedAt === undefined) {
      blocks[i].finishedAt = Date.now();
      blocks[i].exitCode = exitCode;
      const failed = exitCode !== null && exitCode !== 0;
      const pane = globalState.panes.find((p) => p.id === paneId);
      if (pane) pane.lastCommandFailed = failed;
      notify();
      return;
    }
  }
}

export function toggleBlockBookmark(blockId: string) {
  const block = globalState.commandBlocks.find((b) => b.id === blockId);
  if (block) {
    block.isBookmarked = !block.isBookmarked;
    notify();
  }
}

export function toggleBlockCollapsed(blockId: string) {
  const block = globalState.commandBlocks.find((b) => b.id === blockId);
  if (block) {
    block.isCollapsed = !block.isCollapsed;
    notify();
  }
}

export function setPaneViewMode(paneId: string, mode: 'raw' | 'blocks') {
  const pane = globalState.panes.find((p) => p.id === paneId);
  if (pane) {
    pane.viewMode = mode;
    notify();
  }
}

export function togglePaneInputBar(paneId: string, open?: boolean) {
  const pane = globalState.panes.find((p) => p.id === paneId);
  if (pane) {
    pane.inputBarOpen = open !== undefined ? open : !pane.inputBarOpen;
    notify();
  }
}

export function recentCommandsFor(paneId: string, limit = 20): string[] {
  return getPaneBlocks(paneId)
    .map((b) => b.command)
    .filter((c) => c.trim().length > 0)
    .slice(-limit)
    .reverse();
}

/**
 * Execute a command through a pane: registers a Command Block, echoes it into the PTY
 * and records the block as active so output streaming can be attributed to it.
 */
export async function executeCommandInPane(paneId: string, command: string) {
  if (!command.trim()) return;
  startCommandBlock(paneId, command.trim());
  await sendPtyInput(paneId, `${command}\n`);
}

export function dispatchToPeerAgent(command: string, output: string, targetCli?: string) {
  const target = targetCli || globalState.detectedTools.find((t) => t.category === 'agent')?.id || 'claude-code';
  const excerpt = output.split('\n').slice(-50).join('\n');
  const prompt = `Analyze and fix the issue in this command output:\n$ ${command}\n${excerpt}\n`;
  const existing = globalState.panes.find((p) => p.cliType === target);
  if (existing) {
    sendPtyInput(existing.id, prompt);
    return Promise.resolve(existing);
  }
  return spawnAgentPane(target, true).then((pane) => {
    if (pane) {
      setTimeout(() => sendPtyInput(pane.id, prompt), 600);
    }
    return pane;
  });
}

/**
 * Routes a natural language prompt to an active or newly spawned
 * AI agent pane without requiring manual '#' prefixing or causing shell syntax errors.
 *
 * @param instruction Natural language prompt (any leading '#' is stripped)
 * @param sourcePaneId The pane ID from which this prompt was initiated
 * @param targetCli Optional explicit target agent CLI (e.g. 'claude-code', 'opencode')
 * @returns The target AgentPane that received the prompt, or null on failure
 */
export async function routePromptToAgent(
  instruction: string,
  sourcePaneId?: string,
  targetCli?: string
): Promise<AgentPane | null> {
  const cleanInstruction = instruction.replace(/^#\s*/, '').trim();
  if (!cleanInstruction) return null;

  const detectedAgent = globalState.detectedTools.find((t) => t.category === 'agent');
  const fallbackAgent = detectedAgent?.id || 'claude-code';

  let targetPane: AgentPane | undefined;

  if (targetCli) {
    targetPane = globalState.panes.find((p) => p.cliType === targetCli);
  } else {
    // Check if the source pane itself is already an agent pane
    const sourcePane = sourcePaneId ? globalState.panes.find((p) => p.id === sourcePaneId) : undefined;
    const sourceIsAgent = sourcePane && (
      (AGENT_PALETTES[sourcePane.cliType]?.category ?? 'agent') === 'agent'
    );

    if (sourceIsAgent) {
      targetPane = sourcePane;
    } else {
      // Find any existing agent pane
      targetPane = globalState.panes.find((p) => {
        const cat = AGENT_PALETTES[p.cliType]?.category;
        return cat === 'agent' || (!cat && p.cliType !== 'shell' && p.cliType !== 'bash' && p.cliType !== 'zsh' && p.cliType !== 'fish');
      });
    }
  }

  if (targetPane) {
    setActivePane(targetPane.id);
    await sendPtyInput(targetPane.id, `${cleanInstruction}\n`);
    return targetPane;
  }

  const cliToSpawn = targetCli || fallbackAgent;
  const newPane = await spawnAgentPane(cliToSpawn, true);
  if (newPane) {
    setActivePane(newPane.id);
    setTimeout(async () => {
      await sendPtyInput(newPane.id, `${cleanInstruction}\n`);
    }, 500);
    return newPane;
  }

  return null;
}


// ------------------------------ Pipeline Queue ------------------------------

export function enqueuePipelineStage(stage: PipelineStage) {
  globalState.pipelineQueue.push(stage);
  globalState.pipelineActive = true;
  notify();
}

export function clearPipeline() {
  globalState.pipelineQueue = [];
  globalState.pipelineActive = false;
  notify();
}

export async function advancePipelineStage() {
  const next = globalState.pipelineQueue.shift();
  if (!next) {
    globalState.pipelineActive = false;
    notify();
    return;
  }
  notify();

  const existing = globalState.panes.find((p) => p.cliType === next.targetCli);
  if (existing) {
    await sendPtyInput(existing.id, `${next.prompt}\n`);
    return;
  }
  const created = await spawnAgentPane(next.targetCli, true);
  if (created) {
    setTimeout(() => {
      sendPtyInput(created.id, `${next.prompt}\n`);
    }, 600);
  }
}

// ------------------------------- Workflows ---------------------------------

export const BUILTIN_WORKFLOWS: AetherWorkflow[] = [
  {
    id: 'wf_worktree_cleanup',
    name: 'Git Worktree Cleanup',
    description: 'Prune stale worktrees and report remaining ones.',
    commandTemplate: 'git worktree prune && git worktree list',
    tags: ['git', 'maintenance'],
  },
  {
    id: 'wf_cargo_check',
    name: 'Cargo Workspace Check',
    description: 'Type-check every crate in the workspace.',
    commandTemplate: 'cargo check --package {{crate_name}} --all-targets',
    tags: ['rust', 'build'],
  },
  {
    id: 'wf_port_kill',
    name: 'Port Kill by Number',
    description: 'Free a TCP port held by a lingering process.',
    commandTemplate: 'fuser -k {{port}}/tcp || lsof -ti tcp:{{port}} | xargs -r kill -9',
    tags: ['network', 'process'],
  },
  {
    id: 'wf_broadcast_review',
    name: 'Broadcast Architecture Review',
    description: 'Ask every active agent to review the current architecture.',
    commandTemplate: 'echo "Architecture review requested for {{module}}: check boundaries, error handling, and tests."',
    tags: ['agents', 'review'],
  },
  {
    id: 'wf_docker_logs',
    name: 'Docker Container Logs',
    description: 'Tail the last 200 log lines of a container.',
    commandTemplate: 'docker logs --tail {{lines}} -f {{container}}',
    tags: ['docker', 'observability'],
  },
];

export async function loadWorkflows() {
  if (globalState.workflows.length === 0) {
    globalState.workflows = [...BUILTIN_WORKFLOWS];
    notify();
  }

  // Vault-backed workflows override built-ins with the same id.
  if (invoke) {
    try {
      const raw: {
        id: string;
        name: string;
        description: string;
        command_template: string;
        tags: string[];
        relative_path: string;
      }[] = await invoke('cmd_list_workflows', { workspaceId: globalState.workspaceId });

      if (raw && raw.length > 0) {
        const fromVault: AetherWorkflow[] = raw.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          commandTemplate: w.command_template,
          tags: w.tags,
          relativePath: w.relative_path,
        }));
        const byId = new Map(fromVault.map((w) => [w.id, w]));
        const merged = [
          ...fromVault,
          ...BUILTIN_WORKFLOWS.filter((b) => !byId.has(b.id)),
        ];
        globalState.workflows = merged;
        notify();
      }
    } catch (e) {
      console.warn('Vault workflow load failed, using built-ins:', e);
    }
  }

  return globalState.workflows;
}

export function toggleWorkflowsModal(open?: boolean) {
  globalState.workflowsModalOpen = open !== undefined ? open : !globalState.workflowsModalOpen;
  if (globalState.workflowsModalOpen) {
    // Fire and forget: built-ins show immediately, vault entries merge in after.
    void loadWorkflows();
  }
  notify();
}

export function extractWorkflowParams(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

export function renderWorkflowTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}

export async function runWorkflow(template: string, values: Record<string, string>, paneId?: string) {
  const targetPane = paneId || globalState.activePaneId;
  if (!targetPane) return false;
  const command = renderWorkflowTemplate(template, values);
  await executeCommandInPane(targetPane, command);
  return true;
}

// ----------------------------------------------------------------------------
// Aether Drive Workspace IPC Operations & Fallbacks
// ----------------------------------------------------------------------------

export const MOCK_WORKSPACE_ENTRIES: Record<string, WorkspaceFileEntry[]> = {
  '': [
    { name: '.aether', path: '.aether', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'crates', path: 'crates', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'ui', path: 'ui', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'Cargo.toml', path: 'Cargo.toml', is_dir: false, is_symlink: false, size_bytes: 1840, extension: 'toml' },
    { name: 'PROJECT.md', path: 'PROJECT.md', is_dir: false, is_symlink: false, size_bytes: 7390, extension: 'md' },
    { name: 'README.md', path: 'README.md', is_dir: false, is_symlink: false, size_bytes: 3200, extension: 'md' },
  ],
  'ui': [
    { name: 'src', path: 'ui/src', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'tests', path: 'ui/tests', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'package.json', path: 'ui/package.json', is_dir: false, is_symlink: false, size_bytes: 789, extension: 'json' },
    { name: 'tsconfig.json', path: 'ui/tsconfig.json', is_dir: false, is_symlink: false, size_bytes: 520, extension: 'json' },
    { name: 'vite.config.ts', path: 'ui/vite.config.ts', is_dir: false, is_symlink: false, size_bytes: 410, extension: 'ts' },
  ],
  'ui/src': [
    { name: 'components', path: 'ui/src/components', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'stores', path: 'ui/src/stores', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'utils', path: 'ui/src/utils', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'main.tsx', path: 'ui/src/main.tsx', is_dir: false, is_symlink: false, size_bytes: 22900, extension: 'tsx' },
    { name: 'index.css', path: 'ui/src/index.css', is_dir: false, is_symlink: false, size_bytes: 1450, extension: 'css' },
  ],
  'crates': [
    { name: 'aether-gui', path: 'crates/aether-gui', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'aether-protocol', path: 'crates/aether-protocol', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
    { name: 'aetherd', path: 'crates/aetherd', is_dir: true, is_symlink: false, size_bytes: 4096, extension: null },
  ],
};

export async function readWorkspaceDirectory(
  relativePath?: string,
  workspaceId?: string
): Promise<WorkspaceFileEntry[]> {
  const normPath = (relativePath || '').replace(/^\/+|\/+$/g, '');
  if (isRunningInTauri() && invoke) {
    try {
      const res = await invoke('cmd_read_workspace_directory', {
        workspaceId: workspaceId || globalState.workspaceId,
        workspace_id: workspaceId || globalState.workspaceId,
        relativePath: normPath || null,
        relative_path: normPath || null,
      });
      if (Array.isArray(res)) return res;
    } catch (e) {
      console.warn(`cmd_read_workspace_directory failed for '${normPath}', using fallback:`, e);
    }
  }

  // Fallback for web preview / non-Tauri / test environments
  if (MOCK_WORKSPACE_ENTRIES[normPath]) {
    return MOCK_WORKSPACE_ENTRIES[normPath];
  }
  return [
    {
      name: 'index.ts',
      path: normPath ? `${normPath}/index.ts` : 'index.ts',
      is_dir: false,
      is_symlink: false,
      size_bytes: 1024,
      extension: 'ts',
    },
  ];
}

export async function searchWorkspaceFiles(
  query: string,
  maxResults: number = 100,
  workspaceId?: string
): Promise<WorkspaceSearchMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (isRunningInTauri() && invoke) {
    try {
      const res = await invoke('cmd_search_workspace_files', {
        workspaceId: workspaceId || globalState.workspaceId,
        workspace_id: workspaceId || globalState.workspaceId,
        query: trimmed,
        maxResults,
        max_results: maxResults,
      });
      if (Array.isArray(res)) return res;
    } catch (e) {
      console.warn('cmd_search_workspace_files failed, using fallback:', e);
    }
  }

  // Fallback search matches for web preview / test environments
  const qLower = trimmed.toLowerCase();
  const mockMatches: WorkspaceSearchMatch[] = [
    {
      file_path: 'PROJECT.md',
      line_number: 13,
      line_content: 'Aether Drive Sidebar drawer (AetherDriveSidebar.tsx) on the left dock of <main>',
      match_start: 13,
      match_end: 13 + trimmed.length,
    },
    {
      file_path: 'ui/src/main.tsx',
      line_number: 125,
      line_content: '<AetherDriveSidebar /> docked alongside TerminalGrid',
      match_start: 1,
      match_end: 1 + trimmed.length,
    },
    {
      file_path: 'ui/src/stores/aetherStore.ts',
      line_number: 215,
      line_content: 'aetherDriveSidebarOpen: boolean persistence',
      match_start: 0,
      match_end: Math.min(trimmed.length, 22),
    },
    {
      file_path: 'ui/src/components/AetherDriveSidebar.tsx',
      line_number: 1,
      line_content: 'export const AetherDriveSidebar: React.FC = () => {',
      match_start: 13,
      match_end: 13 + trimmed.length,
    },
  ].filter((m) => m.line_content.toLowerCase().includes(qLower));

  return mockMatches.slice(0, maxResults);
}

export async function readWorkspaceFile(
  relativePath: string,
  maxBytes: number = 256 * 1024,
  workspaceId?: string
): Promise<WorkspaceFileContent> {
  const normPath = relativePath.replace(/^\/+/, '');
  if (isRunningInTauri() && invoke) {
    try {
      const res = await invoke('cmd_read_workspace_file', {
        workspaceId: workspaceId || globalState.workspaceId,
        workspace_id: workspaceId || globalState.workspaceId,
        relativePath: normPath,
        relative_path: normPath,
        maxBytes,
        max_bytes: maxBytes,
      });
      if (res && typeof res.content === 'string') return res;
    } catch (e) {
      console.warn(`cmd_read_workspace_file failed for '${normPath}', using fallback:`, e);
    }
  }

  // Fallback content preview for web preview / test environments
  const mockContent = `// File: ${normPath}\n// Aether Drive Preview\n\nexport const preview = {\n  file: "${normPath}",\n  ready: true,\n};\n`;
  return {
    relative_path: normPath,
    content: mockContent,
    total_bytes: mockContent.length,
    is_truncated: false,
  };
}

export function toggleAiSettings(open?: boolean): void {
  globalState.aiSettingsOpen = typeof open === 'boolean' ? open : !globalState.aiSettingsOpen;
  notify();
}

export function setSelectedAiProvider(providerId: string): void {
  globalState.selectedAiProvider = providerId;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_selected_ai_provider', providerId);
  }

  // Look up model: check custom providers first, then saved config, then BUILT_IN_PROVIDERS
  let targetModel = 'gpt-4o';
  const custom = globalState.customProviders.find((cp) => cp.id === providerId);
  if (custom && custom.model) {
    targetModel = custom.model;
  } else {
    const saved = globalState.aiProviderConfig?.providers[providerId];
    const meta = BUILT_IN_PROVIDERS.find((p) => p.id === providerId);
    targetModel = saved?.model || meta?.defaultModel || 'gpt-4o';
  }

  globalState.selectedAiModel = targetModel;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_selected_ai_model', targetModel);
  }
  notify();
}

export function setSelectedAiModel(model: string): void {
  globalState.selectedAiModel = model;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_selected_ai_model', model);
  }
  notify();
}

export async function addCustomProvider(
  config: Omit<CustomProviderConfig, 'id'>
): Promise<string> {
  const displayName = config.displayName ? config.displayName.trim() : '';
  const baseUrl = config.baseUrl ? config.baseUrl.trim().replace(/\/+$/, '') : '';
  const model = config.model ? config.model.trim() : '';
  const apiKey = config.apiKey ? config.apiKey.trim() : '';
  const protocol = config.protocol || 'openai';

  if (!displayName) {
    throw new Error('Display Name is required for custom provider.');
  }
  if (!baseUrl) {
    throw new Error('Base URL is required for custom provider.');
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`Invalid Base URL: "${baseUrl}". Must start with http:// or https://.`);
  }
  if (!model) {
    throw new Error('Model Identifier is required for custom provider.');
  }

  const id = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newCustom: CustomProviderConfig = {
    id,
    displayName,
    baseUrl,
    apiKey,
    model,
    protocol,
  };

  globalState.customProviders.push(newCustom);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_custom_providers', JSON.stringify(globalState.customProviders));
  }

  if (globalState.aiProviderConfig) {
    globalState.aiProviderConfig.providers[id] = {
      api_key: newCustom.apiKey,
      model: newCustom.model,
      base_url: newCustom.baseUrl,
      display_name: newCustom.displayName,
      protocol: newCustom.protocol,
    };
  }

  if (isRunningInTauri()) {
    try {
      await invoke('cmd_save_ai_provider_config', {
        provider: id,
        apiKey: newCustom.apiKey,
        api_key: newCustom.apiKey,
        model: newCustom.model,
        baseUrl: newCustom.baseUrl,
        base_url: newCustom.baseUrl,
        displayName: newCustom.displayName,
        display_name: newCustom.displayName,
        protocol: newCustom.protocol,
      });
    } catch (err) {
      console.warn('Failed to sync custom provider to Tauri backend:', err);
    }
  }

  notify();
  return id;
}

export async function updateCustomProvider(
  id: string,
  config: Partial<CustomProviderConfig>
): Promise<void> {
  const index = globalState.customProviders.findIndex((cp) => cp.id === id);
  if (index === -1) {
    throw new Error(`Custom provider with id '${id}' not found.`);
  }
  const existing = globalState.customProviders[index];

  const updatedDisplayName = config.displayName !== undefined ? config.displayName.trim() : existing.displayName;
  const updatedBaseUrl = config.baseUrl !== undefined ? config.baseUrl.trim().replace(/\/+$/, '') : existing.baseUrl;
  const updatedModel = config.model !== undefined ? config.model.trim() : existing.model;
  const updatedApiKey = config.apiKey !== undefined ? config.apiKey.trim() : existing.apiKey;
  const updatedProtocol = config.protocol !== undefined ? config.protocol : existing.protocol;

  if (!updatedDisplayName) {
    throw new Error('Display Name is required for custom provider.');
  }
  if (!updatedBaseUrl) {
    throw new Error('Base URL is required for custom provider.');
  }
  if (!/^https?:\/\//i.test(updatedBaseUrl)) {
    throw new Error(`Invalid Base URL: "${updatedBaseUrl}". Must start with http:// or https://.`);
  }
  if (!updatedModel) {
    throw new Error('Model Identifier is required for custom provider.');
  }

  const updated: CustomProviderConfig = {
    id,
    displayName: updatedDisplayName,
    baseUrl: updatedBaseUrl,
    apiKey: updatedApiKey,
    model: updatedModel,
    protocol: updatedProtocol,
  };

  globalState.customProviders[index] = updated;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_custom_providers', JSON.stringify(globalState.customProviders));
  }

  if (globalState.aiProviderConfig) {
    globalState.aiProviderConfig.providers[id] = {
      api_key: updated.apiKey,
      model: updated.model,
      base_url: updated.baseUrl,
      display_name: updated.displayName,
      protocol: updated.protocol,
    };
  }

  if (isRunningInTauri()) {
    try {
      await invoke('cmd_save_ai_provider_config', {
        provider: id,
        apiKey: updated.apiKey,
        api_key: updated.apiKey,
        model: updated.model,
        baseUrl: updated.baseUrl,
        base_url: updated.baseUrl,
        displayName: updated.displayName,
        display_name: updated.displayName,
        protocol: updated.protocol,
      });
    } catch (err) {
      console.warn('Failed to sync updated custom provider to Tauri backend:', err);
    }
  }

  if (globalState.selectedAiProvider === id && updated.model) {
    globalState.selectedAiModel = updated.model;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('aether_selected_ai_model', updated.model);
    }
  }

  notify();
}

export async function deleteCustomProvider(id: string): Promise<void> {
  const exists = globalState.customProviders.some((cp) => cp.id === id);
  if (!exists) {
    return;
  }
  globalState.customProviders = globalState.customProviders.filter((cp) => cp.id !== id);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_custom_providers', JSON.stringify(globalState.customProviders));
  }

  if (globalState.aiProviderConfig) {
    delete globalState.aiProviderConfig.providers[id];
  }

  if (isRunningInTauri()) {
    try {
      await invoke('cmd_delete_ai_provider_config', { provider: id });
    } catch (err) {
      console.warn('Failed to delete custom provider from Tauri backend:', err);
    }
  }

  if (globalState.selectedAiProvider === id) {
    setSelectedAiProvider('openai');
  } else {
    notify();
  }
}

export async function testProviderConnection(
  provider: string,
  config?: Partial<ProviderSettings>
): Promise<{ success: boolean; message: string }> {
  const meta = BUILT_IN_PROVIDERS.find((p) => p.id === provider);
  const custom = globalState.customProviders.find((cp) => cp.id === provider);
  const saved = globalState.aiProviderConfig?.providers[provider];

  const apiKey = (config?.api_key !== undefined
    ? config.api_key
    : (custom?.apiKey || saved?.api_key || '')).trim();

  const model = (config?.model !== undefined
    ? config.model
    : (custom?.model || saved?.model || meta?.defaultModel || '')).trim();

  const baseUrl = (config?.base_url !== undefined
    ? config.base_url
    : (custom?.baseUrl || saved?.base_url || meta?.defaultBaseUrl || '')).trim();

  const requiresKey = meta ? meta.requiresKey : true;

  if (requiresKey && !apiKey) {
    return {
      success: false,
      message: 'API key is required for connection testing.',
    };
  }

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return {
      success: false,
      message: `Invalid endpoint URL format: "${baseUrl}". Must start with http:// or https://.`,
    };
  }

  if (isRunningInTauri()) {
    try {
      const result: string = await invoke('cmd_test_ai_provider', {
        provider,
        apiKey,
        api_key: apiKey,
        model,
        baseUrl: baseUrl || null,
        base_url: baseUrl || null,
      });
      return { success: true, message: result };
    } catch (err: any) {
      let raw = String(err?.message || err);
      if (raw.includes('Connection closed by peer') || raw.includes('connection closed')) {
        raw = `Connection closed by peer: Endpoint di '${baseUrl || provider}' memutus koneksi. Pastikan URL endpoint (contoh: https://openrouter.ai/api/v1), API key, dan model valid.`;
      }
      return { success: false, message: raw };
    }
  }

  // Web / Test / Non-Tauri fallback environment
  if (
    apiKey.includes('invalid') ||
    apiKey.includes('fail') ||
    baseUrl.includes('offline') ||
    baseUrl.includes('fail')
  ) {
    return {
      success: false,
      message: `Connection test failed: Authentication or network error reaching endpoint for provider '${provider}'.`,
    };
  }

  const displayName = config?.display_name || custom?.displayName || meta?.name || provider;
  return {
    success: true,
    message: `Connected to ${displayName} (${model || 'default'}) successfully. Latency: 35ms.`,
  };
}

export async function testAiProviderConnection(
  provider: string,
  apiKey: string,
  model: string,
  baseUrl?: string
): Promise<{ success: boolean; message: string }> {
  return testProviderConnection(provider, {
    api_key: apiKey,
    model,
    base_url: baseUrl,
  });
}

export async function loadAiProviderConfig(): Promise<ProviderConfig | null> {
  if (!isRunningInTauri()) {
    // Web fallback for development/storybook preview
    const fallbackConfig: ProviderConfig = {
      default_provider: 'openrouter',
      providers: {
        openai: { api_key: '', model: 'gpt-4o', base_url: 'https://api.openai.com/v1', display_name: 'OpenAI', protocol: 'openai' },
        anthropic: { api_key: '', model: 'claude-3-5-sonnet-20241022', base_url: 'https://api.anthropic.com/v1', display_name: 'Anthropic', protocol: 'anthropic' },
        gemini: { api_key: '', model: 'gemini-1.5-pro', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', display_name: 'Google Gemini', protocol: 'openai' },
        groq: { api_key: '', model: 'llama-3.3-70b-versatile', base_url: 'https://api.groq.com/openai/v1', display_name: 'Groq', protocol: 'openai' },
        openrouter: { api_key: '', model: 'anthropic/claude-3.5-sonnet', base_url: 'https://openrouter.ai/api/v1', display_name: 'OpenRouter', protocol: 'openai' },
        ollama: { api_key: '', model: 'llama3:latest', base_url: 'http://localhost:11434/v1', display_name: 'Ollama (Local)', protocol: 'openai' },
      },
    };

    // Include custom providers
    for (const cp of globalState.customProviders) {
      fallbackConfig.providers[cp.id] = {
        api_key: cp.apiKey,
        model: cp.model,
        base_url: cp.baseUrl,
        display_name: cp.displayName,
        protocol: cp.protocol,
      };
    }

    // Preserve any existing in-memory provider configs
    if (globalState.aiProviderConfig?.providers) {
      for (const [k, v] of Object.entries(globalState.aiProviderConfig.providers)) {
        if (fallbackConfig.providers[k]) {
          fallbackConfig.providers[k] = { ...fallbackConfig.providers[k], ...v };
        } else {
          fallbackConfig.providers[k] = v;
        }
      }
    }

    globalState.aiProviderConfig = fallbackConfig;
    notify();
    return fallbackConfig;
  }
  try {
    const config: ProviderConfig = await invoke('cmd_get_ai_provider_config');
    if (config) {
      for (const cp of globalState.customProviders) {
        if (!config.providers[cp.id]) {
          config.providers[cp.id] = {
            api_key: cp.apiKey,
            model: cp.model,
            base_url: cp.baseUrl,
            display_name: cp.displayName,
            protocol: cp.protocol,
          };
        }
      }
      globalState.aiProviderConfig = config;
      notify();
    }
    return config;
  } catch (err) {
    console.error('Failed to load AI provider config:', err);
    return null;
  }
}

export async function saveAiProviderConfig(
  provider: string,
  apiKey: string,
  model: string,
  baseUrl?: string,
  displayName?: string,
  protocol?: string
): Promise<ProviderConfig | null> {
  if (!isRunningInTauri()) {
    if (!globalState.aiProviderConfig) {
      await loadAiProviderConfig();
    }
    if (globalState.aiProviderConfig) {
      globalState.aiProviderConfig.providers[provider] = {
        api_key: apiKey,
        model,
        base_url: baseUrl || undefined,
        display_name: displayName || undefined,
        protocol: protocol || undefined,
      };
      // If saving selected provider, sync model
      if (globalState.selectedAiProvider === provider) {
        globalState.selectedAiModel = model;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('aether_selected_ai_model', model);
        }
      }
      notify();
      return globalState.aiProviderConfig;
    }
    return null;
  }
  try {
    const config: ProviderConfig = await invoke('cmd_save_ai_provider_config', {
      provider,
      apiKey,
      api_key: apiKey,
      model,
      baseUrl: baseUrl || null,
      base_url: baseUrl || null,
      displayName: displayName || null,
      display_name: displayName || null,
      protocol: protocol || null,
    });
    globalState.aiProviderConfig = config;
    if (globalState.selectedAiProvider === provider) {
      globalState.selectedAiModel = model;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('aether_selected_ai_model', model);
      }
    }
    notify();
    return config;
  } catch (err) {
    console.error('Failed to save AI provider config:', err);
    throw err;
  }
}

export async function deleteAiProviderConfig(provider: string): Promise<ProviderConfig | null> {
  if (!isRunningInTauri()) {
    if (globalState.aiProviderConfig) {
      delete globalState.aiProviderConfig.providers[provider];
      if (globalState.aiProviderConfig.default_provider === provider) {
        globalState.aiProviderConfig.default_provider = 'openrouter';
      }
      if (globalState.selectedAiProvider === provider) {
        setSelectedAiProvider('openai');
      } else {
        notify();
      }
      return globalState.aiProviderConfig;
    }
    return null;
  }
  try {
    const config: ProviderConfig = await invoke('cmd_delete_ai_provider_config', { provider });
    globalState.aiProviderConfig = config;
    if (globalState.selectedAiProvider === provider) {
      setSelectedAiProvider('openai');
    } else {
      notify();
    }
    return config;
  } catch (err) {
    console.error('Failed to delete AI provider config:', err);
    throw err;
  }
}

export async function runAiPilotPrompt(
  paneId: string,
  instruction: string
): Promise<string> {
  if (!isRunningInTauri()) {
    return 'Not running inside desktop environment.';
  }
  globalState.aiPilotRunning = true;
  notify();
  try {
    const result: string = await invoke('cmd_run_ai_pilot_prompt', {
      paneId,
      pane_id: paneId,
      instruction,
    });
    return result;
  } finally {
    globalState.aiPilotRunning = false;
    notify();
  }
}

export function clearAiPilotSteps(paneId?: string): void {
  if (paneId) {
    globalState.aiPilotSteps = globalState.aiPilotSteps.filter((s) => s.paneId !== paneId);
  } else {
    globalState.aiPilotSteps = [];
  }
  notify();
}

// ==========================================
// Milestone 4: Collapsible AI Assistant Store Actions
// ==========================================

export function persistAiSessions(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('aether_ai_sessions', JSON.stringify(globalState.aiSessions));
      localStorage.setItem('aether_active_session_id', globalState.activeAiSessionId);
      if (globalState.aiMessages.length > 0) {
        localStorage.setItem('aether_ai_messages', JSON.stringify(globalState.aiMessages));
      } else {
        localStorage.removeItem('aether_ai_messages');
      }
    } catch (e) {
      console.warn('Failed to persist AI sessions to localStorage:', e);
    }
  }
}

function persistAiMessages(): void {
  persistAiSessions();
}

export function getActiveAiSession(): AiSession {
  let session = globalState.aiSessions.find((s) => s.id === globalState.activeAiSessionId);
  if (!session) {
    if (globalState.aiSessions.length > 0) {
      session = globalState.aiSessions[0];
      globalState.activeAiSessionId = session.id;
    } else {
      session = {
        id: `session_${Date.now()}`,
        title: 'Percakapan Utama',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider: globalState.selectedAiProvider || 'openai',
        model: globalState.selectedAiModel || 'gpt-4o',
        messages: globalState.aiMessages,
      };
      globalState.aiSessions.push(session);
      globalState.activeAiSessionId = session.id;
    }
  }

  // If globalState.aiMessages was externally cleared, keep active session in sync
  if (globalState.aiMessages.length === 0 && session.messages.length > 0) {
    session.messages = [];
  }

  return session;
}

export function createAiSession(title?: string, provider?: string, model?: string): string {
  const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newSession: AiSession = {
    id,
    title: title?.trim() || `Sesi ${globalState.aiSessions.length + 1}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider: provider || globalState.selectedAiProvider || 'openai',
    model: model || globalState.selectedAiModel || 'gpt-4o',
    messages: [],
  };
  globalState.aiSessions.unshift(newSession);
  globalState.activeAiSessionId = id;
  globalState.aiMessages = [];
  globalState.aiError = null;
  globalState.aiLoading = false;
  persistAiSessions();
  notify();
  return id;
}

export function switchAiSession(sessionId: string): void {
  const session = globalState.aiSessions.find((s) => s.id === sessionId);
  if (!session) return;
  globalState.activeAiSessionId = sessionId;
  globalState.aiMessages = session.messages || [];
  if (session.provider) {
    globalState.selectedAiProvider = session.provider;
  }
  if (session.model) {
    globalState.selectedAiModel = session.model;
  }
  globalState.aiError = null;
  globalState.aiLoading = false;
  persistAiSessions();
  notify();
}

export function renameAiSession(sessionId: string, newTitle: string): void {
  const session = globalState.aiSessions.find((s) => s.id === sessionId);
  if (!session) return;
  const trimmed = newTitle.trim();
  if (!trimmed) return;
  session.title = trimmed;
  session.updatedAt = Date.now();
  persistAiSessions();
  notify();
}

export function deleteAiSession(sessionId?: string): void {
  const targetId = sessionId || globalState.activeAiSessionId;
  const index = globalState.aiSessions.findIndex((s) => s.id === targetId);
  if (index === -1) return;

  globalState.aiSessions.splice(index, 1);
  if (globalState.aiSessions.length === 0) {
    const freshId = `session_${Date.now()}`;
    const fresh: AiSession = {
      id: freshId,
      title: 'Percakapan Utama',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider: globalState.selectedAiProvider || 'openai',
      model: globalState.selectedAiModel || 'gpt-4o',
      messages: [],
    };
    globalState.aiSessions.push(fresh);
    globalState.activeAiSessionId = freshId;
    globalState.aiMessages = [];
  } else {
    if (globalState.activeAiSessionId === targetId) {
      const nextSession = globalState.aiSessions[Math.min(index, globalState.aiSessions.length - 1)];
      globalState.activeAiSessionId = nextSession.id;
      globalState.aiMessages = nextSession.messages || [];
    }
  }
  persistAiSessions();
  notify();
}

export function clearCurrentAiSession(): void {
  const session = getActiveAiSession();
  session.messages = [];
  session.updatedAt = Date.now();
  globalState.aiMessages = [];
  globalState.aiLoading = false;
  globalState.aiError = null;
  globalState.aiPendingContext = null;
  persistAiSessions();
  notify();
}

export function clearAiMessages(): void {
  clearCurrentAiSession();
}

let activeAiAbortController: AbortController | null = null;

export function stopAiAssistant(): void {
  if (activeAiAbortController) {
    try {
      activeAiAbortController.abort();
    } catch {}
    activeAiAbortController = null;
  }

  globalState.aiLoading = false;
  globalState.aiPilotRunning = false;

  if (globalState.pendingAiApproval) {
    resolvePendingAiApproval(false, false, 'Action stopped by user');
  }

  const activePane = globalState.panes.find((p) => p.id === globalState.activePaneId);
  if (activePane && (activePane.status === 'EXECUTING' || activePane.status === 'THINKING')) {
    pane_send_keystroke(activePane.id, 'Ctrl+C');
    activePane.status = 'IDLE';
  }

  const session = getActiveAiSession();
  const lastMsg = session.messages[session.messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    if (!lastMsg.content.includes('(Stopped by user)')) {
      lastMsg.content += '\n\n*(Agent stopped by user)*';
    }
  } else {
    const stopMsg: AiMessage = {
      id: `msg_stop_${Date.now()}`,
      role: 'system',
      content: 'Agent execution stopped by user.',
      timestamp: Date.now(),
    };
    session.messages.push(stopMsg);
    globalState.aiMessages.push(stopMsg);
  }

  persistAiSessions();
  notify();
}

export function getOmniAssistantSystemPrompt(customInstructions?: string): string {
  const activePaneId = globalState.activePaneId || globalState.panes[0]?.id || 'terminal-1';
  const activePane = globalState.panes.find((p) => p.id === activePaneId);
  const cwd = activePane?.worktreePath || (typeof globalThis !== 'undefined' && (globalThis as any).process?.cwd ? (globalThis as any).process.cwd() : '/workspace');
  const cli = activePane?.cliType || globalState.defaultShell || 'shell';
  const tabCount = globalState.tabs.length;
  const paneCount = globalState.panes.length;

  return `You are AetherCortex, an autonomous AI assistant and omni-access controller embedded directly within the AetherTerminal desktop application.
You have direct programmatic inspection and control over all terminal tabs, split panes, background tasks, running processes, workspace files, and application features.

LIVE APPLICATION STATE:
- Active Tab: "${globalState.activeTabId || 'tab-1'}" (${tabCount} open tab(s))
- Active Terminal Pane: "${activePaneId}" (CLI: "${cli}", Status: "${activePane?.status || 'IDLE'}", Working Dir: "${cwd}")
- Total Panes: ${paneCount} open pane(s)

AVAILABLE APPLICATION & TERMINAL CONTROLLER TOOLS:
You can invoke tools whenever needed to fulfill the user's request. To execute one or more tools, emit a code block with the "tool_call" identifier and valid JSON:
\`\`\`tool_call
{
  "name": "<tool_name>",
  "arguments": { <parameters> }
}
\`\`\`

Tool Catalog:
1. "app_list_tabs_and_panes": {}
   Returns full hierarchy of all open tabs, paneIds, active layout trees, running cliType, pid, status, worktreePath, gitBranch, openPorts, and background tasks.

2. "app_operate_tab": { "action": "create" | "switch" | "close" | "rename" | "reorder", "tab_id"?: string, "title"?: string, "cli_type"?: string }
   Controls workspace tabs: create, switch, rename, reorder, or close tabs programmatically.

3. "app_operate_pane": { "action": "spawn" | "split_vertical" | "split_horizontal" | "focus" | "close" | "send_to_bg" | "attach_from_bg" | "equalize" | "resize", "pane_id"?: string, "cli_type"?: string, "ratio"?: number }
   Controls split panes: spawn new pane, split vertically/horizontally, focus, close, send to background, attach from background, or equalize layout.

4. "pane_read_screen": { "pane_id": string, "line_count"?: number }
   Fetches the latest scrollback buffer from aetherd and strips ANSI escape codes so you can read clean terminal output.

5. "pane_send_input": { "pane_id": string, "text": string, "submit_enter"?: boolean }
   Types commands or prompts into any active or background pane (with automatic 60ms delay before Enter for interactive TUIs).

6. "pane_send_keystroke": { "pane_id": string, "key": "Enter" | "Escape" | "Ctrl+C" | "Tab" | "Up" | "Down" | "y" | "n" }
   Sends raw control sequences to navigate menus or answer prompts inside agent TUIs.

7. "fs_list_directory": { "root_path"?: string, "recursive"?: boolean, "max_depth"?: number }
   Returns a clean file tree structure (automatically ignoring .git, node_modules, target, dist).

8. "fs_read_file": { "file_path": string, "start_line"?: number, "end_line"?: number }
   Reads file content line-by-line with line numbers.

9. "fs_write_or_edit_file": { "file_path": string, "operation": "write" | "replace_lines" | "apply_patch", "content": string }
   Creates or edits files atomically (automatically captures a zero-commit snapshot before modifying).

10. "fs_delete_path": { "file_path": string }
    Deletes a file or directory (must always trigger Security Gatekeeper approval).

11. "app_trigger_feature": { "feature": "diff_gatekeeper" | "squash_merge" | "create_snapshot" | "rollback_snapshot" | "publish_blackboard" | "toggle_obsidian_task", "params"?: object }
    Opens diffs, executes squash merges, captures/rolls back Git tree snapshots, posts to Shared Blackboard, or toggles Obsidian tasks.

RULES:
- When the user asks you to inspect, explore, create, edit, run, or operate anything in the workspace or terminal, DO NOT say you cannot access it. Immediately invoke the appropriate tool!
- You can explain what you are doing in concise text alongside or before your tool_call.
- Never write generic preamble or apologies. Be direct, authoritative, and actionable.
${customInstructions ? `\nUSER CUSTOM INSTRUCTIONS:\n${customInstructions}` : ''}`;
}

export function resolvePendingAiApproval(
  approved: boolean,
  rememberSession: boolean = false,
  rejectReason?: string
): void {
  if (!globalState.pendingAiApproval) return;
  const current = globalState.pendingAiApproval;
  if (approved && rememberSession && current.tier === 2) {
    globalState.aiSessionApprovedTier2 = true;
  }
  globalState.pendingAiApproval = null;
  notify();
  current.resolve({ approved, rememberSession, rejectReason });
}

export const DESTRUCTIVE_CMD_REGEX =
  /\b(rm\s|rmdir\b|sudo\b|chmod\b|chown\b|dd\b|mkfs\b|kill\s+-9\b|pkill\b|git\s+reset\s+--hard|git\s+push\s+.*--force|git\s+clean|\bcurl\b.*\|\s*(ba)?sh|\bwget\b|:\(\)\{:\|:&\};:|>(\s*\/dev\/sd|.*\/dev\/nvme))/i;

export function isSensitiveOrExternalPath(targetPath?: string): { isSensitive: boolean; reason?: string } {
  if (!targetPath) return { isSensitive: false };
  const normalized = targetPath.trim().replace(/\\/g, '/');

  const sensitivePatterns = [
    /(^|\/|\~)[\.]?ssh(\/|$)/i,
    /(^|\/|\~)[\.]?aws(\/|$)/i,
    /(^|\/|\~)[\.]?gnupg(\/|$)/i,
    /^\/etc(\/|$)/i,
    /(^|\/)\.env(\.|$)/i,
    /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.|$)/i,
    /(^|\/)(credentials|secrets|private_key)(\.|$)/i,
    /\.(pem|key)$/i,
  ];

  for (const pat of sensitivePatterns) {
    if (pat.test(normalized)) {
      return {
        isSensitive: true,
        reason: `Target path touches sensitive directory or credential file (${normalized})`,
      };
    }
  }

  // Path traversal outside workspace root
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    return {
      isSensitive: true,
      reason: `Path traversal targets directory outside workspace (${normalized})`,
    };
  }

  return { isSensitive: false };
}

export function evaluateActionSecurity(toolName: string, args: Record<string, any>): SecurityEvaluation {
  // Check sensitive / external path targets across any filesystem tool
  const rawPath = args.path || args.filePath || args.rootPath || args.file_path || args.root_path;
  const pathCheck = isSensitiveOrExternalPath(rawPath);
  if (pathCheck.isSensitive) {
    return {
      tier: 3,
      actionType: `Access Sensitive/External Path (${toolName})`,
      payloadPreview: `Path: ${rawPath}\nTool: ${toolName}`,
      riskReason: pathCheck.reason || 'Accesses sensitive files or path outside active workspace.',
    };
  }

  // Tier 3: Deleting files or folders
  if (toolName === 'fs_delete_path') {
    return {
      tier: 3,
      actionType: 'Delete Filesystem Path',
      payloadPreview: `Delete: ${args.path || args.file_path || '(unknown path)'}`,
      riskReason: 'Permanently deletes files or directories from the workspace.',
    };
  }

  // Tier 3: Merging worktrees (squash_merge) or rolling back snapshot (rollback_snapshot)
  if (toolName === 'app_trigger_feature') {
    const feat = args.featureName || args.feature;
    if (feat === 'squash_merge') {
      return {
        tier: 3,
        actionType: 'Git Squash Merge',
        payloadPreview: `Squash merge: ${JSON.stringify(args, null, 2)}`,
        riskReason: 'Performs Git branch squash merge which rewrites history and commits changes.',
      };
    }
    if (feat === 'rollback_snapshot') {
      return {
        tier: 3,
        actionType: 'Git Snapshot Rollback',
        payloadPreview: `Rollback to snapshot: ${args.snapshotId || args.id || '(unknown)'}`,
        riskReason: 'Discards uncommitted working directory changes and restores previous snapshot.',
      };
    }
    if (feat === 'create_snapshot' || feat === 'diff_gatekeeper') {
      return {
        tier: 1,
        actionType: `Trigger Feature: ${feat}`,
        payloadPreview: JSON.stringify(args, null, 2),
        riskReason: 'Safe zero-commit snapshot or read-only diff inspection. Auto-approved.',
      };
    }
    if (feat === 'publish_blackboard' || feat === 'toggle_obsidian_task') {
      return {
        tier: 2,
        actionType: `Trigger Feature: ${feat}`,
        payloadPreview: JSON.stringify(args, null, 2),
        riskReason: 'Updates workspace state or publishes blackboard announcement.',
      };
    }
  }

  // Tier 3: Interrupt Process Keystrokes
  if (toolName === 'pane_send_keystroke') {
    const k = String(args.key || args.keystroke || '').toLowerCase().replace(/[\s-_]/g, '');
    if (k.includes('ctrl+c') || k.includes('ctrlc') || k.includes('sigint') || k.includes('ctrl+d') || k.includes('ctrl+z')) {
      return {
        tier: 3,
        actionType: 'Interrupt Process (Keystroke)',
        payloadPreview: `Send keystroke: ${args.key || args.keystroke} to pane ${args.paneId || args.pane_id || 'active'}`,
        riskReason: 'Sends interrupt signal (SIGINT/EOF) which terminates running background process.',
      };
    }
    return {
      tier: 2,
      actionType: 'Send Terminal Keystroke',
      payloadPreview: `Send keystroke: ${args.key || args.keystroke} to pane ${args.paneId || args.pane_id || 'active'}`,
      riskReason: 'Sends navigational or interactive response keystroke to pane.',
    };
  }

  // Tier 3: Destructive shell command or sensitive file references in shell input
  if (toolName === 'pane_send_input' || toolName === 'sendPtyInput') {
    const text = String(args.text || args.data || '');
    const cmdPathCheck = isSensitiveOrExternalPath(text);
    if (DESTRUCTIVE_CMD_REGEX.test(text) || cmdPathCheck.isSensitive) {
      return {
        tier: 3,
        actionType: 'Execute High-Risk Shell Command',
        payloadPreview: text,
        riskReason: cmdPathCheck.isSensitive
          ? (cmdPathCheck.reason || 'Command references sensitive directory or credentials file.')
          : "Command contains potentially destructive shell patterns ('rm ', 'rmdir', 'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'kill -9', 'pkill', 'git reset --hard', 'git push --force', 'git clean', or 'curl | sh').",
      };
    }
    return {
      tier: 2,
      actionType: 'Execute Terminal Input',
      payloadPreview: text,
      riskReason: 'Sends shell command to terminal PTY session.',
    };
  }

  // Terminating an active pane with running foreground process is Tier 3
  if (toolName === 'app_operate_pane' && args.action === 'close') {
    const targetId = args.paneId || args.pane_id || globalState.activePaneId;
    const targetPane = globalState.panes.find((p) => p.id === targetId);
    if (targetPane && (targetPane.status === 'EXECUTING' || targetPane.status === 'THINKING' || (targetPane.pid && targetPane.pid > 0))) {
      return {
        tier: 3,
        actionType: 'Terminate Active Process in Pane',
        payloadPreview: `Close pane: ${targetId} (CLI: ${targetPane.cliType}, PID: ${targetPane.pid || 'running'}, status: ${targetPane.status})`,
        riskReason: 'Terminating an active pane that has a running foreground process interrupts execution and can lose unsaved state.',
      };
    }
    return {
      tier: 2,
      actionType: 'Close Terminal Pane',
      payloadPreview: `Close pane: ${targetId || 'active'}`,
      riskReason: 'Closes an idle terminal pane.',
    };
  }

  if (toolName === 'app_operate_pane') {
    if (args.action === 'spawn' || args.action === 'split' || args.action === 'split_vertical' || args.action === 'split_horizontal') {
      return {
        tier: 2,
        actionType: 'Spawn/Split Terminal Pane',
        payloadPreview: `Action: ${args.action}, Target: ${args.paneId || args.pane_id || 'active'}`,
        riskReason: 'Spawns or splits a new terminal pane process in the workspace.',
      };
    }
    if (args.action === 'focus' || args.action === 'equalize' || args.action === 'send_to_bg' || args.action === 'attach_from_bg') {
      return {
        tier: 1,
        actionType: `Pane Action: ${args.action}`,
        payloadPreview: JSON.stringify(args, null, 2),
        riskReason: 'Safe pane navigation or layout adjustment. Auto-approved.',
      };
    }
  }

  if (toolName === 'app_operate_tab') {
    if (args.action === 'close') {
      return {
        tier: 2,
        actionType: 'Close Terminal Tab',
        payloadPreview: `Close tab: ${args.tabId || args.tab_id || 'active'}`,
        riskReason: 'Closes a terminal tab and its contained terminal panes.',
      };
    }
    if (args.action === 'create') {
      return {
        tier: 2,
        actionType: 'Create Terminal Tab',
        payloadPreview: `Create tab: ${args.title || 'New Tab'} (CLI: ${args.cliType || args.cli_type || 'default'})`,
        riskReason: 'Creates a new terminal tab in the workspace.',
      };
    }
    return {
      tier: 1,
      actionType: `Tab Action: ${args.action}`,
      payloadPreview: JSON.stringify(args, null, 2),
      riskReason: 'Safe tab navigation or reordering. Auto-approved.',
    };
  }

  // Tier 2: Medium Risk / Workspace Mutation inside workspace
  if (toolName === 'fs_write_or_edit_file') {
    const path = args.path || args.filePath || args.file_path || '(unknown file)';
    const mode = args.operation || args.editMode || 'write';
    const content = String(args.content || '');
    const preview = `File: ${path} (${mode})\n---\n${content.slice(0, 500)}${content.length > 500 ? '\n... (truncated)' : ''}`;
    return {
      tier: 2,
      actionType: `Modify Workspace File: ${path}`,
      payloadPreview: preview,
      riskReason: 'Modifies source code on disk. A zero-commit snapshot is automatically captured before modification.',
    };
  }

  if (toolName === 'claim_module' || toolName === 'release_module') {
    return {
      tier: 2,
      actionType: `${toolName === 'claim_module' ? 'Claim' : 'Release'} File Lock`,
      payloadPreview: JSON.stringify(args, null, 2),
      riskReason: 'Claims or releases collaborative file locks on workspace modules.',
    };
  }

  // Tier 1: Safe / Read-Only / Non-destructive operations
  return {
    tier: 1,
    actionType: `Read-Only: ${toolName}`,
    payloadPreview: JSON.stringify(args, null, 2),
    riskReason: 'Safe inspection or non-destructive operation. Auto-approved.',
  };
}

export async function checkAndApproveAction(
  toolName: string,
  args: Record<string, any>
): Promise<{ approved: boolean; rejectReason?: string }> {
  const evaluation = evaluateActionSecurity(toolName, args);
  if (evaluation.tier === 1) {
    return { approved: true };
  }
  if (evaluation.tier === 2 && globalState.aiSessionApprovedTier2) {
    return { approved: true };
  }
  return new Promise<{ approved: boolean; rejectReason?: string }>((resolve) => {
    globalState.pendingAiApproval = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tier: evaluation.tier,
      actionType: evaluation.actionType,
      toolName,
      args,
      payloadPreview: evaluation.payloadPreview,
      riskReason: evaluation.riskReason,
      resolve: (res) => {
        resolve({ approved: res.approved, rejectReason: res.rejectReason });
      },
    };
    notify();
  });
}

export function stripAnsiCodes(text: string): string {
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

export function app_list_tabs_and_panes(): AppTabsAndPanesSummary {
  return {
    tabs: [...globalState.tabs],
    panes: [...globalState.panes],
    activeTabId: globalState.activeTabId,
    activePaneId: globalState.activePaneId,
    layout: globalState.layout,
    backgroundTasks: [...globalState.backgroundTasks],
  };
}

export async function app_operate_tab(
  action: 'create' | 'switch' | 'close' | 'rename' | 'reorder',
  tabId?: string,
  titleOrExtra?: string | Record<string, any>,
  cliType?: string
): Promise<{ success: boolean; message: string; tabId?: string }> {
  const extra: Record<string, any> =
    typeof titleOrExtra === 'object' && titleOrExtra !== null
      ? titleOrExtra
      : {
          title: typeof titleOrExtra === 'string' ? titleOrExtra : undefined,
          cliType: cliType,
        };

  switch (action) {
    case 'create': {
      const title = extra.title || `Tab ${globalState.tabs.length + 1}`;
      const cli = extra.cliType || cliType || globalState.defaultShell || 'shell';
      const newTab = await createTab(title, cli);
      if (!newTab) {
        return { success: false, message: 'Failed to create new tab' };
      }
      return { success: true, message: `Created tab ${newTab.title}`, tabId: newTab.id };
    }
    case 'switch': {
      if (!tabId) return { success: false, message: 'Missing tabId for switch action' };
      switchTab(tabId);
      return { success: true, message: `Switched to tab ${tabId}`, tabId };
    }
    case 'close': {
      const targetId = tabId || globalState.activeTabId;
      if (!targetId) return { success: false, message: 'No tab specified to close' };
      await closeTab(targetId);
      return { success: true, message: `Closed tab ${targetId}`, tabId: targetId };
    }
    case 'rename': {
      const newTitle = extra.title || (typeof titleOrExtra === 'string' ? titleOrExtra : undefined);
      if (!tabId || !newTitle) return { success: false, message: 'Missing tabId or new title' };
      renameTab(tabId, newTitle);
      return { success: true, message: `Renamed tab ${tabId} to ${newTitle}`, tabId };
    }
    case 'reorder': {
      if (!tabId || typeof extra.newIndex !== 'number') {
        return { success: false, message: 'Missing tabId or newIndex' };
      }
      const currentIndex = globalState.tabs.findIndex((t) => t.id === tabId);
      if (currentIndex === -1) return { success: false, message: 'Tab not found' };
      const [moved] = globalState.tabs.splice(currentIndex, 1);
      const targetIndex = Math.max(0, Math.min(extra.newIndex, globalState.tabs.length));
      globalState.tabs.splice(targetIndex, 0, moved);
      notify();
      return { success: true, message: `Reordered tab ${tabId} to index ${targetIndex}`, tabId };
    }
    default:
      return { success: false, message: `Unknown tab action: ${action}` };
  }
}

export async function app_operate_pane(
  action:
    | 'spawn'
    | 'split_vertical'
    | 'split_horizontal'
    | 'focus'
    | 'close'
    | 'send_to_bg'
    | 'attach_from_bg'
    | 'equalize'
    | 'split'
    | 'resize',
  paneId?: string,
  cliTypeOrExtra?: string | Record<string, any>
): Promise<{ success: boolean; message: string; paneId?: string }> {
  const extra: Record<string, any> =
    typeof cliTypeOrExtra === 'object' && cliTypeOrExtra !== null
      ? cliTypeOrExtra
      : {
          cliType: typeof cliTypeOrExtra === 'string' ? cliTypeOrExtra : undefined,
        };
  const targetId = paneId || globalState.activePaneId || globalState.panes[0]?.id || 'terminal-1';

  switch (action) {
    case 'spawn': {
      const cli = extra.cliType || extra.cli_type || 'shell';
      const newPane = await spawnAgentPane(cli, true);
      return { success: !!newPane, message: `Spawned new pane ${newPane?.id}`, paneId: newPane?.id };
    }
    case 'split_vertical': {
      const cli = extra.cliType || extra.cli_type || 'shell';
      setActivePane(targetId);
      const newPane = await splitActivePane('vertical', cli);
      return { success: true, message: `Split pane ${targetId} vertically`, paneId: newPane?.id };
    }
    case 'split_horizontal': {
      const cli = extra.cliType || extra.cli_type || 'shell';
      setActivePane(targetId);
      const newPane = await splitActivePane('horizontal', cli);
      return { success: true, message: `Split pane ${targetId} horizontally`, paneId: newPane?.id };
    }
    case 'split': {
      const dir = (extra.direction === 'horizontal' ? 'horizontal' : 'vertical') as 'vertical' | 'horizontal';
      const cli = extra.cliType || extra.cli_type || 'shell';
      setActivePane(targetId);
      const newPane = await splitActivePane(dir, cli);
      return { success: true, message: `Split pane ${targetId} (${dir})`, paneId: newPane?.id };
    }
    case 'focus': {
      setActivePane(targetId);
      return { success: true, message: `Focused pane ${targetId}`, paneId: targetId };
    }
    case 'close': {
      await closePane(targetId);
      return { success: true, message: `Closed pane ${targetId}`, paneId: targetId };
    }
    case 'send_to_bg': {
      sendPaneToBackground(targetId);
      return { success: true, message: `Sent pane ${targetId} to background tasks`, paneId: targetId };
    }
    case 'attach_from_bg': {
      const asNewTab = !!(extra.asNewTab || extra.as_new_tab);
      await bringBackgroundToForeground(targetId, asNewTab);
      return { success: true, message: `Attached background task ${targetId} to foreground`, paneId: targetId };
    }
    case 'equalize': {
      equalizeLayout();
      return { success: true, message: 'Layout panes equalized', paneId: targetId };
    }
    case 'resize': {
      if (typeof extra.ratio === 'number') {
        const adjustRatio = (node: LayoutNode | null): boolean => {
          if (!node) return false;
          if (node.type === 'split') {
            const hasTarget = (n: LayoutNode): boolean => {
              if (n.type === 'pane') return n.paneId === targetId;
              return hasTarget(n.children[0]) || hasTarget(n.children[1]);
            };
            if (hasTarget(node.children[0]) || hasTarget(node.children[1])) {
              node.splitRatio = Math.max(0.1, Math.min(0.9, extra.ratio));
              return true;
            }
            return adjustRatio(node.children[0]) || adjustRatio(node.children[1]);
          }
          return false;
        };
        adjustRatio(globalState.layout);
        notify();
      }
      return { success: true, message: `Resized pane ${targetId}`, paneId: targetId };
    }
    default:
      return { success: false, message: `Unknown pane action: ${action}` };
  }
}

export async function pane_read_screen(
  paneId?: string,
  maxLines: number = 100
): Promise<{ paneId: string; lines: string[]; text: string }> {
  const targetId = paneId || globalState.activePaneId || globalState.panes[0]?.id || 'terminal-1';
  let rawText = '';

  try {
    const scrollback = await getPaneScrollback(targetId);
    if (scrollback && scrollback.data && scrollback.data.length > 0) {
      rawText = new TextDecoder('utf-8', { fatal: false }).decode(scrollback.data);
    }
  } catch (err) {
    console.warn('Scrollback read error:', err);
  }

  if (!rawText.trim()) {
    const blocks = getPaneBlocks(targetId);
    if (blocks.length > 0) {
      rawText = blocks
        .map((b) => `$ ${b.command}\n${b.outputText || ''}`)
        .join('\n');
    }
  }

  if (!rawText.trim()) {
    const pane = globalState.panes.find((p) => p.id === targetId);
    rawText = `[Pane ${targetId}] CLI: ${pane?.cliType || 'sh'}, Status: ${pane?.status || 'IDLE'}, CWD: ${pane?.worktreePath || '.'}`;
  }

  const clean = stripAnsiCodes(rawText);
  const allLines = clean.split(/\r?\n/);
  const lines = allLines.slice(-Math.max(1, maxLines));

  return {
    paneId: targetId,
    lines,
    text: lines.join('\n'),
  };
}

export async function pane_send_input(
  paneId?: string,
  text: string = '',
  appendNewline: boolean = true
): Promise<{ success: boolean; paneId: string }> {
  const targetId = paneId || globalState.activePaneId || globalState.panes[0]?.id || 'terminal-1';
  if (!text) {
    return { success: true, paneId: targetId };
  }

  if (appendNewline) {
    await sendPtyInput(targetId, text);
    // 60ms delay before sending Enter to ensure interactive CLI sub-agents do not drop prompt
    await new Promise((resolve) => setTimeout(resolve, 60));
    await sendPtyInput(targetId, '\r');
  } else {
    await sendPtyInput(targetId, text);
  }

  return { success: true, paneId: targetId };
}

export async function pane_send_keystroke(
  paneId?: string,
  keystrokeOrKey: string = ''
): Promise<{ success: boolean; paneId: string }> {
  const targetId = paneId || globalState.activePaneId || globalState.panes[0]?.id || 'terminal-1';
  let seq = keystrokeOrKey;
  const lower = keystrokeOrKey.toLowerCase().replace(/[\s-_]/g, '');

  if (lower === 'ctrl+c' || lower === 'ctrlc' || lower === 'sigint') {
    seq = '\x03';
  } else if (lower === 'ctrl+d' || lower === 'ctrld' || lower === 'eof') {
    seq = '\x04';
  } else if (lower === 'ctrl+z' || lower === 'ctrlz' || lower === 'sigtstp') {
    seq = '\x1a';
  } else if (lower === 'enter' || lower === 'return') {
    seq = '\r';
  } else if (lower === 'escape' || lower === 'esc') {
    seq = '\x1b';
  } else if (lower === 'tab') {
    seq = '\t';
  } else if (lower === 'backspace') {
    seq = '\x7f';
  } else if (lower === 'up' || lower === 'arrowup') {
    seq = '\x1b[A';
  } else if (lower === 'down' || lower === 'arrowdown') {
    seq = '\x1b[B';
  } else if (lower === 'right' || lower === 'arrowright') {
    seq = '\x1b[C';
  } else if (lower === 'left' || lower === 'arrowleft') {
    seq = '\x1b[D';
  } else if (lower === 'y') {
    seq = 'y';
  } else if (lower === 'n') {
    seq = 'n';
  }

  await sendPtyInput(targetId, seq);
  return { success: true, paneId: targetId };
}

export async function app_trigger_feature(
  featureName: string,
  payload?: Record<string, any>
): Promise<{ success: boolean; message: string }> {
  switch (featureName) {
    case 'diff_gatekeeper':
      globalState.diffGatekeeperOpen = true;
      notify();
      return { success: true, message: 'Diff gatekeeper modal opened' };
    case 'squash_merge':
      if (isRunningInTauri() && invoke) {
        await invoke('cmd_git_squash_merge', payload || {});
      }
      return { success: true, message: 'Squash merge triggered' };
    case 'create_snapshot': {
      const summary = payload?.summary || payload?.label || 'Manual Snapshot';
      const snapId = await createSnapshot(summary);
      return { success: !!snapId, message: snapId ? `Snapshot created: ${snapId}` : 'Snapshot creation failed' };
    }
    case 'rollback_snapshot': {
      const snapId = payload?.snapshotId || payload?.id;
      if (!snapId) return { success: false, message: 'Missing snapshot ID for rollback' };
      const ok = await rollbackSnapshot(snapId);
      return { success: ok, message: ok ? `Rolled back to snapshot: ${snapId}` : 'Rollback failed' };
    }
    case 'publish_blackboard': {
      const id = await publishBlackboardEntry(
        payload?.authorAgentId || 'AI Assistant',
        payload?.entryType || 'ANNOUNCEMENT',
        payload?.title || 'Blackboard Broadcast',
        payload?.contentMarkdown || '',
        payload?.targetAgentId
      );
      return { success: true, message: `Published to blackboard with ID: ${id}` };
    }
    case 'toggle_obsidian_task': {
      await updateObsidianTask(
        payload?.notePath || '',
        payload?.taskText || '',
        payload?.completed ?? true
      );
      globalState.obsidianRefreshTick += 1;
      notify();
      return { success: true, message: 'Obsidian task state toggled' };
    }
    default:
      return { success: false, message: `Unknown feature name: ${featureName}` };
  }
}

export async function fs_list_directory(path: string = '.', maxDepth: number = 3): Promise<any> {
  if (isRunningInTauri() && invoke) {
    try {
      return await invoke('cmd_fs_list_directory', { rootPath: path, root_path: path, maxDepth, max_depth: maxDepth });
    } catch (err: any) {
      throw new Error(err?.message || String(err) || 'Failed to list directory');
    }
  }
  return {
    path,
    entries: [
      { name: 'src', path: `${path}/src`, is_dir: true, size: 4096, modified_at: Date.now() },
      { name: 'Cargo.toml', path: `${path}/Cargo.toml`, is_dir: false, size: 1024, modified_at: Date.now() },
      { name: 'package.json', path: `${path}/package.json`, is_dir: false, size: 1200, modified_at: Date.now() },
    ],
  };
}

export async function fs_read_file(
  path: string,
  startLine: number = 1,
  lineCount: number = 500
): Promise<{ path: string; lines: Array<{ line: number; content: string }>; totalLines: number; content: string }> {
  if (isRunningInTauri() && invoke) {
    try {
      const endLine = startLine + lineCount - 1;
      const res: any = await invoke('cmd_fs_read_file', {
        filePath: path,
        file_path: path,
        startLine,
        start_line: startLine,
        endLine,
        end_line: endLine,
      });
      const content = res.content || '';
      const rawLines = content.split(/\r?\n/);
      const lines = rawLines.map((lineText: string, idx: number) => ({
        line: (res.start_line ?? startLine) + idx,
        content: lineText,
      }));
      return {
        path: res.file_path || path,
        lines,
        totalLines: res.total_lines ?? lines.length,
        content,
      };
    } catch (err: any) {
      throw new Error(err?.message || String(err) || 'Failed to read file');
    }
  }
  const mockLines = [
    { line: 1, content: `// File: ${path}` },
    { line: 2, content: `// Workspace file content mock for preview` },
  ];
  return {
    path,
    lines: mockLines,
    totalLines: 2,
    content: mockLines.map((l) => l.content).join('\n'),
  };
}

export async function fs_write_or_edit_file(
  path: string,
  content: string,
  editMode: 'overwrite' | 'replace_lines' | 'append' = 'overwrite',
  startLine?: number,
  endLine?: number
): Promise<{ success: boolean; path: string; bytesWritten: number; message: string }> {
  // Pre-edit zero-commit Git snapshot for 1-click rollback via TimeTravel slider
  try {
    await createSnapshot(`Pre-edit AI snapshot: ${path}`);
  } catch (snapErr) {
    console.warn('Pre-edit snapshot warning:', snapErr);
  }

  if (isRunningInTauri() && invoke) {
    try {
      const res: any = await invoke('cmd_fs_write_or_edit_file', {
        filePath: path,
        file_path: path,
        operation: editMode,
        content,
      });
      globalState.obsidianRefreshTick += 1;
      notify();
      return {
        success: true,
        path: res.file_path || path,
        bytesWritten: res.bytes_written ?? content.length,
        message: 'File written successfully',
      };
    } catch (err: any) {
      throw new Error(err?.message || String(err) || 'Failed to write file');
    }
  }

  globalState.obsidianRefreshTick += 1;
  notify();
  return {
    success: true,
    path,
    bytesWritten: content.length,
    message: 'File written successfully (mock)',
  };
}

export async function fs_delete_path(path: string): Promise<{ success: boolean; path: string; message: string }> {
  try {
    await createSnapshot(`Pre-delete AI snapshot: ${path}`);
  } catch (snapErr) {
    console.warn('Pre-delete snapshot warning:', snapErr);
  }

  if (isRunningInTauri() && invoke) {
    try {
      const res: any = await invoke('cmd_fs_delete_path', { filePath: path, file_path: path });
      globalState.obsidianRefreshTick += 1;
      notify();
      return {
        success: true,
        path: typeof res === 'string' ? res : path,
        message: 'Path deleted successfully',
      };
    } catch (err: any) {
      throw new Error(err?.message || String(err) || 'Failed to delete path');
    }
  }

  globalState.obsidianRefreshTick += 1;
  notify();
  return {
    success: true,
    path,
    message: 'Path deleted successfully (mock)',
  };
}

export async function executeAiToolCall(toolName: string, args: Record<string, any>): Promise<any> {
  switch (toolName) {
    case 'app_list_tabs_and_panes':
      return app_list_tabs_and_panes();
    case 'app_operate_tab':
      return await app_operate_tab(
        args.action,
        args.tab_id || args.tabId,
        args.title || args,
        args.cli_type || args.cliType
      );
    case 'app_operate_pane':
      return await app_operate_pane(
        args.action,
        args.pane_id || args.paneId,
        args.cli_type || args.cliType || args
      );
    case 'pane_read_screen':
      return await pane_read_screen(
        args.pane_id || args.paneId,
        args.line_count || args.lineCount || args.maxLines
      );
    case 'pane_send_input':
      return await pane_send_input(
        args.pane_id || args.paneId,
        args.text,
        args.submit_enter ?? args.submitEnter ?? args.appendNewline ?? true
      );
    case 'pane_send_keystroke':
      return await pane_send_keystroke(
        args.pane_id || args.paneId,
        args.key || args.keystroke
      );
    case 'app_trigger_feature':
      return await app_trigger_feature(
        args.feature || args.featureName,
        args.params || args.payload || args
      );
    case 'fs_list_directory':
      return await fs_list_directory(
        args.root_path || args.rootPath || args.path || '.',
        args.max_depth || args.maxDepth || 3
      );
    case 'fs_read_file':
      return await fs_read_file(
        args.file_path || args.filePath || args.path,
        args.start_line || args.startLine,
        args.end_line || args.lineCount || args.line_count || 500
      );
    case 'fs_write_or_edit_file':
      return await fs_write_or_edit_file(
        args.file_path || args.filePath || args.path,
        args.content,
        args.operation || args.editMode || 'write',
        args.start_line || args.startLine,
        args.end_line || args.endLine
      );
    case 'fs_delete_path':
      return await fs_delete_path(args.file_path || args.filePath || args.path);
    default:
      throw new Error(`Unknown AI tool: ${toolName}`);
  }
}

export interface ExtractedToolCall {
  name: string;
  arguments: Record<string, any>;
  raw: string;
}

export function extractToolCalls(content: string): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  const codeBlockRegex = /```(?:tool_call|tool|json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const name = parsed.name || parsed.tool || parsed.action || parsed.tool_name;
        const args = parsed.arguments || parsed.args || parsed.parameters || parsed.payload || {};
        if (name && typeof name === 'string') {
          calls.push({ name, arguments: typeof args === 'object' ? args : {}, raw: match[0] });
        }
      }
    } catch {}
  }

  const xmlRegex = /<tool_call(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/tool_call>/g;
  while ((match = xmlRegex.exec(content)) !== null) {
    const attrName = match[1];
    const body = match[2].trim();
    try {
      const parsed = JSON.parse(body);
      const name = attrName || parsed.name || parsed.tool || parsed.action;
      const args = parsed.arguments || parsed.args || parsed.parameters || parsed;
      if (name && typeof name === 'string') {
        calls.push({ name, arguments: typeof args === 'object' ? args : {}, raw: match[0] });
      }
    } catch {
      if (attrName) {
        calls.push({ name: attrName, arguments: {}, raw: match[0] });
      }
    }
  }

  return calls;
}

export async function executeAiCommand(commandLine: string): Promise<{ handled: boolean; output?: string }> {
  const raw = commandLine.trim();
  if (!raw.startsWith('/')) {
    return { handled: false };
  }

  const parts = raw.slice(1).split(/\s+/);
  const root = parts[0]?.toLowerCase();
  const sub = parts[1]?.toLowerCase();
  const args = parts.slice(sub ? 2 : 1).join(' ').trim();

  const appendOutput = (content: string, cards?: Array<{ key: string; value: string }>) => {
    const sysMsg: AiMessage = {
      id: `cmd_out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'system',
      content,
      timestamp: Date.now(),
      metadata: cards ? { cards } : undefined,
    };
    const session = getActiveAiSession();
    session.messages.push(sysMsg);
    session.updatedAt = Date.now();
    globalState.aiMessages.push(sysMsg);
    persistAiSessions();
    notify();
  };

  if (root === 'help') {
    let out = `### Daftar Command AetherCortex AI\n\n`;
    for (const cmd of AI_COMMANDS) {
      out += `- \`${cmd.syntax}\`: ${cmd.description}\n`;
    }
    out += `\n*Tips: Ketik \`/\` pada kolom input untuk melihat daftar saran command secara langsung.*`;
    appendOutput(out);
    return { handled: true, output: out };
  }

  if (root === 'new' || root === 'reset' || (root === 'session' && sub === 'new')) {
    const title = root === 'session' ? args : parts.slice(1).join(' ').trim();
    const newId = createAiSession(title || undefined);
    const active = getActiveAiSession();
    appendOutput(`Sesi baru **${active.title}** (\`${newId}\`) telah dibuat dan aktif.`);
    return { handled: true };
  }

  if (root === 'sessions' || (root === 'session' && (!sub || sub === 'list'))) {
    let out = `### Sesi Percakapan AetherCortex (${globalState.aiSessions.length})\n\n`;
    globalState.aiSessions.forEach((s, idx) => {
      const isCurrent = s.id === globalState.activeAiSessionId;
      const marker = isCurrent ? '**[AKTIF]** ' : '';
      const timeStr = new Date(s.updatedAt).toLocaleTimeString();
      out += `${idx + 1}. ${marker}**${s.title}**: \`${s.messages.length} pesan\` (ID: \`${s.id}\`, diperbarui ${timeStr})\n`;
    });
    out += `\n*Gunakan \`/session switch <id_atau_nomor>\` untuk berpindah sesi.*`;
    appendOutput(out);
    return { handled: true, output: out };
  }

  if (root === 'session' && sub === 'switch') {
    const target = args || parts[2];
    if (!target) {
      appendOutput(`Sintaks salah. Contoh: \`/session switch 1\` atau \`/session switch session_123\``);
      return { handled: true };
    }
    const num = parseInt(target, 10);
    let targetSession: AiSession | undefined;
    if (!isNaN(num) && num >= 1 && num <= globalState.aiSessions.length) {
      targetSession = globalState.aiSessions[num - 1];
    } else {
      targetSession = globalState.aiSessions.find((s) => s.id === target || s.id.includes(target));
    }
    if (!targetSession) {
      appendOutput(`Sesi dengan ID/indeks "${target}" tidak ditemukan.`);
      return { handled: true };
    }
    switchAiSession(targetSession.id);
    appendOutput(`Beralih ke sesi **${targetSession.title}** (\`${targetSession.id}\`).`);
    return { handled: true };
  }

  if (root === 'session' && sub === 'rename') {
    const newTitle = args || parts.slice(2).join(' ').trim();
    if (!newTitle) {
      appendOutput(`Sintaks salah. Contoh: \`/session rename Debugging Server API\``);
      return { handled: true };
    }
    renameAiSession(globalState.activeAiSessionId, newTitle);
    appendOutput(`Judul sesi berhasil diubah menjadi **${newTitle}**.`);
    return { handled: true };
  }

  if (root === 'session' && sub === 'delete') {
    const target = args || parts[2];
    let targetId = globalState.activeAiSessionId;
    if (target) {
      const num = parseInt(target, 10);
      if (!isNaN(num) && num >= 1 && num <= globalState.aiSessions.length) {
        targetId = globalState.aiSessions[num - 1].id;
      } else {
        const found = globalState.aiSessions.find((s) => s.id === target || s.id.includes(target));
        if (found) targetId = found.id;
      }
    }
    deleteAiSession(targetId);
    appendOutput(`Sesi \`${targetId}\` telah dihapus.`);
    return { handled: true };
  }

  if (root === 'clear') {
    clearCurrentAiSession();
    appendOutput(`Riwayat percakapan pada sesi ini telah dibersihkan.`);
    return { handled: true };
  }

  if (root === 'model') {
    const modelName = parts.slice(1).join(' ').trim();
    if (!modelName) {
      appendOutput(`Model saat ini: **${globalState.selectedAiModel}**\nGunakan: \`/model <nama_model>\` untuk mengganti.`);
      return { handled: true };
    }
    setSelectedAiModel(modelName);
    const session = getActiveAiSession();
    session.model = modelName;
    persistAiSessions();
    appendOutput(`Model aktif berhasil diubah ke **${modelName}**.`);
    return { handled: true };
  }

  if (root === 'provider') {
    const provName = parts.slice(1).join(' ').trim();
    if (!provName) {
      appendOutput(`Provider saat ini: **${globalState.selectedAiProvider}**\nGunakan: \`/provider <nama_provider>\` untuk mengganti.`);
      return { handled: true };
    }
    setSelectedAiProvider(provName);
    const session = getActiveAiSession();
    session.provider = provName;
    persistAiSessions();
    appendOutput(`Provider aktif berhasil diubah ke **${provName}**.`);
    return { handled: true };
  }

  if (root === 'system') {
    const promptText = parts.slice(1).join(' ').trim();
    const session = getActiveAiSession();
    if (!promptText) {
      const cur = session.systemPrompt || 'Standar (AetherCortex AI Terminal)';
      appendOutput(`### System Prompt Sesi Ini\n\n\`\`\`\n${cur}\n\`\`\`\nGunakan \`/system <instruksi>\` untuk mengubah.`);
      return { handled: true };
    }
    session.systemPrompt = promptText;
    persistAiSessions();
    appendOutput(`System prompt sesi ini berhasil diperbarui.`);
    return { handled: true };
  }

  if (root === 'context') {
    insertTerminalContextToAi();
    return { handled: true };
  }

  if (root === 'status' || root === 'info') {
    const session = getActiveAiSession();
    const prov = globalState.selectedAiProvider;
    const mod = globalState.selectedAiModel;
    const cardData = [
      { key: 'Sesi Aktif', value: session.title },
      { key: 'Session ID', value: session.id },
      { key: 'Provider', value: prov },
      { key: 'Model', value: mod },
      { key: 'Total Pesan', value: String(session.messages.length) },
      { key: 'Dibuat', value: new Date(session.createdAt).toLocaleTimeString() },
    ];
    let out = `### Status AI Assistant\n\n`;
    out += `- **Sesi**: ${session.title} (\`${session.id}\`)\n`;
    out += `- **Provider**: \`${prov}\`\n`;
    out += `- **Model**: \`${mod}\`\n`;
    out += `- **Jumlah Pesan**: ${session.messages.length}\n`;
    appendOutput(out, cardData);
    return { handled: true, output: out };
  }

  if (root === 'export') {
    const session = getActiveAiSession();
    let md = `# Transkrip Sesi: ${session.title}\n\n`;
    md += `*Provider: ${session.provider} | Model: ${session.model} | Waktu: ${new Date(session.updatedAt).toLocaleString()}*\n\n---\n\n`;
    for (const m of session.messages) {
      const author = m.role === 'user' ? '**User**' : m.role === 'assistant' ? '**Assistant**' : '**System**';
      md += `### ${author} (${new Date(m.timestamp).toLocaleTimeString()})\n\n${m.content}\n\n`;
    }
    appendOutput(`### Transkrip Sesi Diekspor\n\n\`\`\`markdown\n${md}\n\`\`\``);
    return { handled: true };
  }

  if (root === 'app') {
    if (sub === 'tabs' || sub === 'list' || !sub) {
      const summary = app_list_tabs_and_panes();
      let out = `### Workspace Tabs & Panes Overview\n\n`;
      out += `- **Active Tab**: \`${summary.activeTabId || 'None'}\`\n`;
      out += `- **Active Pane**: \`${summary.activePaneId || 'None'}\`\n`;
      out += `- **Total Tabs**: ${summary.tabs.length}\n`;
      out += `- **Total Panes**: ${summary.panes.length}\n\n`;
      out += `#### Tabs\n`;
      summary.tabs.forEach((t, i) => {
        const activeMarker = t.id === summary.activeTabId ? ' (Active)' : '';
        out += `${i + 1}. **${t.title}** [\`${t.id}\`]${activeMarker}\n`;
      });
      out += `\n#### Panes\n`;
      summary.panes.forEach((p, i) => {
        const activeMarker = p.id === summary.activePaneId ? ' (Focused)' : '';
        out += `${i + 1}. **Pane [${p.id}]** - CLI: \`${p.cliType}\` | Status: \`${p.status}\` | Path: \`${p.worktreePath || '.'}\`${activeMarker}\n`;
      });
      appendOutput(out);
      return { handled: true, output: out };
    }
  }

  if (root === 'fs') {
    if (sub === 'list') {
      const targetPath = args || '.';
      try {
        const res = await fs_list_directory(targetPath, 2);
        let out = `### Directory Listing: \`${targetPath}\`\n\n`;
        const entries = res.entries || (Array.isArray(res) ? res : []);
        if (Array.isArray(entries) && entries.length > 0) {
          entries.forEach((e: any) => {
            const kind = e.is_dir ? '[DIR]' : '[FILE]';
            const sizeStr = typeof e.size === 'number' ? `(${e.size} bytes)` : '';
            out += `- ${kind} **${e.name}** ${sizeStr}\n`;
          });
        } else {
          out += `\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``;
        }
        appendOutput(out);
        return { handled: true, output: out };
      } catch (err: any) {
        appendOutput(`Gagal membaca direktori: ${err?.message || String(err)}`);
        return { handled: true };
      }
    }

    if (sub === 'read') {
      const filePath = args || parts[2];
      if (!filePath) {
        appendOutput(`Sintaks salah. Contoh: \`/fs read src/main.rs\``);
        return { handled: true };
      }
      try {
        const res = await fs_read_file(filePath, 1, 100);
        let out = `### File: \`${filePath}\` (${res.totalLines} baris)\n\n\`\`\`\n`;
        res.lines.forEach((l) => {
          out += `${String(l.line).padStart(4, ' ')} | ${l.content}\n`;
        });
        out += `\`\`\``;
        appendOutput(out);
        return { handled: true, output: out };
      } catch (err: any) {
        appendOutput(`Gagal membaca file: ${err?.message || String(err)}`);
        return { handled: true };
      }
    }
  }

  if (root === 'pane') {
    if (sub === 'read') {
      const targetPane = args || globalState.activePaneId || globalState.panes[0]?.id;
      try {
        const screen = await pane_read_screen(targetPane, 30);
        let out = `### Terminal Screen: \`${screen.paneId}\`\n\n\`\`\`\n`;
        out += screen.lines.join('\n');
        out += `\n\`\`\``;
        appendOutput(out);
        return { handled: true, output: out };
      } catch (err: any) {
        appendOutput(`Gagal membaca screen pane: ${err?.message || String(err)}`);
        return { handled: true };
      }
    }

    if (sub === 'send') {
      const paneId = parts[2];
      const cmdText = parts.slice(3).join(' ').trim();
      if (!paneId || !cmdText) {
        appendOutput(`Sintaks salah. Contoh: \`/pane send terminal-1 cargo check\``);
        return { handled: true };
      }
      const approval = await checkAndApproveAction('pane_send_input', { paneId, text: cmdText });
      if (!approval.approved) {
        appendOutput(`Perintah dibatalkan oleh Security Gatekeeper: ${approval.rejectReason || 'Ditolak oleh user'}`);
        return { handled: true };
      }
      await pane_send_input(paneId, cmdText, true);
      appendOutput(`Perintah \`${cmdText}\` berhasil dikirim ke \`${paneId}\`.`);
      return { handled: true };
    }
  }

  appendOutput(`Command \`/${root}\` tidak dikenali. Ketik \`/help\` untuk melihat daftar command yang tersedia.`);
  return { handled: true };
}

export function setAiLoading(loading: boolean): void {
  globalState.aiLoading = loading;
  notify();
}

export function setAiError(error: string | null): void {
  globalState.aiError = error;
  notify();
}

export function insertTerminalContextToAi(paneId?: string): void {
  const targetId = paneId || globalState.activePaneId || globalState.panes[0]?.id || 'terminal-1';
  const targetPane = globalState.panes.find((p) => p.id === targetId);
  const recentCmds = recentCommandsFor(targetId, 5);
  const blocks = getPaneBlocks(targetId);
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;

  const cwd = targetPane?.worktreePath || (typeof globalThis !== 'undefined' && (globalThis as any).process?.cwd ? (globalThis as any).process.cwd() : '/workspace');
  const branch = targetPane?.gitBranch ? ` (${targetPane.gitBranch})` : '';
  const status = targetPane?.status || 'IDLE';
  const cli = targetPane?.cliType || 'sh';
  const ports = targetPane?.openPorts && targetPane.openPorts.length > 0 ? targetPane.openPorts.join(', ') : 'None';
  const lastCmd = lastBlock?.command || (recentCmds.length > 0 ? recentCmds[0] : 'ls -la');
  const lastExit = lastBlock?.exitCode !== null && lastBlock?.exitCode !== undefined
    ? String(lastBlock.exitCode)
    : String(targetPane?.lastExitCode ?? 0);
  const outputSnippet = lastBlock?.outputText ? lastBlock.outputText.trim().slice(-300) : '';

  let content = `### Terminal Context Attached\n\n`;
  content += `- **Active Pane**: \`${targetId}\`\n`;
  content += `- **Working Directory**: \`${cwd}\`${branch}\n`;
  content += `- **CLI Environment**: \`${cli}\` (Status: \`${status}\`)\n`;
  content += `- **Open Ports**: \`${ports}\`\n`;
  content += `- **Recent Command**: \`${lastCmd}\` (Exit Code: \`${lastExit}\`)\n`;
  if (outputSnippet) {
    content += `\n\`\`\`bash\n${outputSnippet}\n\`\`\`\n`;
  }

  const contextMsg: AiMessage = {
    id: `msg_ctx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role: 'system',
    content,
    timestamp: Date.now(),
    metadata: {
      cards: [
        { key: 'Pane', value: targetId },
        { key: 'Directory', value: cwd },
        { key: 'CLI', value: cli },
        { key: 'Status', value: status },
        { key: 'Exit Code', value: lastExit },
      ],
    },
  };

  const session = getActiveAiSession();
  session.messages.push(contextMsg);
  session.updatedAt = Date.now();
  globalState.aiMessages.push(contextMsg);
  globalState.aiPendingContext = content;
  globalState.aiAssistantOpen = true;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aether_ai_assistant_open', 'true');
  }
  persistAiSessions();
  notify();
}

function generateMockAiResponse(prompt: string, provider: string, model: string): string {
  const lower = prompt.toLowerCase();
  if ((lower.includes('tab') || lower.includes('pane')) && (lower.includes('list') || lower.includes('show') || lower.includes('inspect'))) {
    return `### Workspace Inspection\n\nI will inspect the active tabs and panes across the workspace.\n\n\`\`\`tool_call\n{\n  "name": "app_list_tabs_and_panes",\n  "arguments": {}\n}\n\`\`\``;
  }
  if ((lower.includes('file') || lower.includes('dir')) && (lower.includes('list') || lower.includes('show') || lower.includes('tree') || lower.includes('explore') || lower.includes('scan'))) {
    return `### Filesystem Directory Inspection\n\nI will scan the workspace directory.\n\n\`\`\`tool_call\n{\n  "name": "fs_list_directory",\n  "arguments": {\n    "path": ".",\n    "maxDepth": 2\n  }\n}\n\`\`\``;
  }
  if (lower.includes('read screen') || lower.includes('terminal screen') || lower.includes('read pane') || lower.includes('scrollback')) {
    return `### Terminal Screen Inspection\n\nI will read the scrollback buffer from the terminal pane.\n\n\`\`\`tool_call\n{\n  "name": "pane_read_screen",\n  "arguments": {\n    "maxLines": 50\n  }\n}\n\`\`\``;
  }
  if (lower.includes('write file') || lower.includes('create file') || lower.includes('save to file')) {
    return `### Workspace File Modification\n\nI will write the file to the workspace.\n\n\`\`\`tool_call\n{\n  "name": "fs_write_or_edit_file",\n  "arguments": {\n    "path": "test_output.txt",\n    "content": "AetherTerminal AI verified output\\n",\n    "editMode": "overwrite"\n  }\n}\n\`\`\``;
  }
  if (lower.includes('delete file') || lower.includes('remove path') || lower.includes('fs delete')) {
    return `### Workspace File Deletion\n\nI will delete the requested path.\n\n\`\`\`tool_call\n{\n  "name": "fs_delete_path",\n  "arguments": {\n    "path": "test_output.txt"\n  }\n}\n\`\`\``;
  }
  if (lower.includes('git')) {
    return `### Git Command Recommendation\n\nHere is the recommended workflow for your repository:\n\n- Inspect status: verify uncommitted changes.\n- Check recent log: view branch history.\n\n\`\`\`bash\ngit status\ngit log --oneline -n 5\n\`\`\`\n\nRun the above commands in your active terminal pane.`;
  }
  if (lower.includes('cargo') || lower.includes('rust')) {
    return `### Rust / Cargo Verification\n\nTo verify and run your Rust workspace:\n\n- Run fast compiler check:\n- Execute unit tests:\n\n\`\`\`bash\ncargo check --workspace\ncargo test --workspace\n\`\`\`\n\nBoth checks will run in parallel across your workspace crates.`;
  }
  if (lower.includes('node') || lower.includes('npm') || lower.includes('test')) {
    return `### Node.js Test Execution\n\nExecute tests using the native Node test runner:\n\n\`\`\`bash\nnode --test tests/*.test.ts\n\`\`\`\n\nAll test suites run with high performance and zero external runner dependencies.`;
  }
  return `### Analysis & Solution\n\nProcessed query via **${provider}** (\`${model}\`).\n\n- Analyzed terminal environment.\n- Formatted recommended shell script:\n\n\`\`\`bash\necho "AetherCortex AI Execution Ready"\n\`\`\`\n\nFeel free to execute this or request further optimizations.`;
}

export async function sendAiMessage(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  // Check for slash commands
  if (trimmed.startsWith('/')) {
    const userCmdMsg: AiMessage = {
      id: `msg_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    const session = getActiveAiSession();
    session.messages.push(userCmdMsg);
    session.updatedAt = Date.now();
    globalState.aiMessages.push(userCmdMsg);
    persistAiSessions();
    notify();

    await executeAiCommand(trimmed);
    return;
  }

  const provider = globalState.selectedAiProvider || 'openai';
  const model = globalState.selectedAiModel || 'gpt-4o';
  const session = getActiveAiSession();

  // 1. Append user message
  const userMsg: AiMessage = {
    id: `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role: 'user',
    content: trimmed,
    timestamp: Date.now(),
  };

  session.messages.push(userMsg);
  session.updatedAt = Date.now();
  // Auto-title session if it has default title and this is the first user message
  const userMsgs = session.messages.filter((m) => m.role === 'user');
  if (userMsgs.length === 1 && (session.title === 'Percakapan Utama' || session.title.startsWith('Sesi '))) {
    session.title = trimmed.length > 28 ? trimmed.slice(0, 28) + '...' : trimmed;
  }

  globalState.aiMessages = session.messages;
  globalState.aiLoading = true;
  globalState.aiError = null;
  persistAiSessions();
  notify();

  const startTime = Date.now();

  // Test error trigger simulation for error recovery testing
  if (trimmed.startsWith('SIMULATE_ERROR') || trimmed.includes('[SIMULATE_ERROR]')) {
    const errorMsg = 'Simulated connection failure: 503 Service Unavailable';
    globalState.aiLoading = false;
    globalState.aiError = errorMsg;
    const errorAssistantMsg: AiMessage = {
      id: `msg_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'assistant',
      content: `Request failed: ${errorMsg}`,
      timestamp: Date.now(),
      error: errorMsg,
      metadata: {
        provider,
        model,
        cards: [
          { key: 'Provider', value: provider },
          { key: 'Model', value: model },
          { key: 'Status', value: 'Error' },
        ],
      },
    };
    session.messages.push(errorAssistantMsg);
    globalState.aiMessages = session.messages;
    persistAiSessions();
    notify();
    return;
  }

  activeAiAbortController = new AbortController();
  const effectiveSystemPrompt = getOmniAssistantSystemPrompt(session.systemPrompt);

  try {
    let assistantReply = '';
    if (isRunningInTauri()) {
      try {
        const history: ChatHistoryEntry[] = session.messages
          .slice(0, -1)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }));

        const res = await invoke('cmd_ai_chat', {
          provider,
          model,
          prompt: trimmed,
          system_prompt: effectiveSystemPrompt,
          history,
        });
        assistantReply = typeof res === 'string' ? res : (res?.content || JSON.stringify(res));
      } catch (err: any) {
        if (activeAiAbortController?.signal.aborted) return;
        throw new Error(err?.message || (typeof err === 'string' ? err : 'Tauri AI chat invocation failed.'));
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (activeAiAbortController?.signal.aborted) return;
      assistantReply = generateMockAiResponse(trimmed, provider, model);
    }

    if (activeAiAbortController?.signal.aborted) return;

    const latencyMs = Math.max(15, Date.now() - startTime);
    const estimatedTokens = Math.max(18, Math.round((trimmed.length + assistantReply.length) / 4));

    const calls = extractToolCalls(assistantReply);
    let toolExecutionNotes = '';
    const executedToolOutputs: string[] = [];
    const executionCards: Array<{ key: string; value: string }> = [
      { key: 'Provider', value: provider },
      { key: 'Model', value: model },
      { key: 'Tokens', value: String(estimatedTokens) },
      { key: 'Latency', value: `${latencyMs}ms` },
      { key: 'Status', value: '200 OK' },
    ];

    if (calls.length > 0) {
      for (const call of calls) {
        if (activeAiAbortController?.signal.aborted) break;

        const check = await checkAndApproveAction(call.name, call.arguments);
        if (activeAiAbortController?.signal.aborted) break;

        if (!check.approved) {
          toolExecutionNotes += `\n\n> **Security Gatekeeper**: Tool \`${call.name}\` was blocked. Reason: *${check.rejectReason || 'Action rejected by user'}*`;
          executionCards.push({ key: `Tool: ${call.name}`, value: 'Rejected by User' });
        } else {
          try {
            const toolResult = await executeAiToolCall(call.name, call.arguments);
            const resSnippet = JSON.stringify(toolResult);
            executedToolOutputs.push(`Tool: ${call.name}\n${resSnippet}`);
            const displaySnippet = resSnippet.length > 300 ? resSnippet.slice(0, 300) + '...' : resSnippet;
            toolExecutionNotes += `\n\n**Tool Executed**: \`${call.name}\`\n\`\`\`json\n${displaySnippet}\n\`\`\``;
            executionCards.push({ key: `Tool: ${call.name}`, value: 'Executed' });
          } catch (execErr: any) {
            toolExecutionNotes += `\n\n> **Tool Error** (\`${call.name}\`): ${execErr?.message || String(execErr)}`;
            executionCards.push({ key: `Tool: ${call.name}`, value: 'Execution Error' });
          }
        }
      }
    }

    if (activeAiAbortController?.signal.aborted) return;

    // Follow-up synthesis if assistant output was purely a tool call block and in Tauri
    const cleanReplyWithoutToolCalls = assistantReply
      .replace(/```(?:tool_call|tool|json)?\s*\n?[\s\S]*?```/g, '')
      .replace(/<tool_call[\s\S]*?<\/tool_call>/g, '')
      .trim();

    if (
      cleanReplyWithoutToolCalls.length < 50 &&
      executedToolOutputs.length > 0 &&
      isRunningInTauri() &&
      !activeAiAbortController?.signal.aborted
    ) {
      try {
        const followUpHistory: ChatHistoryEntry[] = session.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }));

        const followUpRes = await invoke('cmd_ai_chat', {
          provider,
          model,
          prompt: `Tool results:\n${executedToolOutputs.join('\n\n')}\n\nPlease summarize these findings and conclude concisely.`,
          system_prompt: effectiveSystemPrompt,
          history: followUpHistory,
        });
        const followUpText = typeof followUpRes === 'string' ? followUpRes : (followUpRes?.content || '');
        if (followUpText.trim() && !activeAiAbortController?.signal.aborted) {
          toolExecutionNotes += `\n\n${followUpText.trim()}`;
        }
      } catch {}
    }

    if (activeAiAbortController?.signal.aborted) return;

    const finalContent = assistantReply + toolExecutionNotes;

    const assistantMsg: AiMessage = {
      id: `msg_asst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'assistant',
      content: finalContent,
      timestamp: Date.now(),
      metadata: {
        provider,
        model,
        tokens: estimatedTokens,
        latencyMs,
        cards: executionCards,
      },
    };

    session.messages.push(assistantMsg);
    session.updatedAt = Date.now();
    globalState.aiMessages = session.messages;
    globalState.aiLoading = false;
    globalState.aiError = null;
    globalState.aiPendingContext = null;
    persistAiSessions();
    notify();
  } catch (err: any) {
    if (activeAiAbortController?.signal.aborted) return;

    const errorMsg = err?.message || String(err) || 'Failed to complete AI request.';
    globalState.aiError = errorMsg;
    globalState.aiLoading = false;

    const errorAssistantMsg: AiMessage = {
      id: `msg_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'assistant',
      content: `Request failed: ${errorMsg}`,
      timestamp: Date.now(),
      error: errorMsg,
      metadata: {
        provider,
        model,
        cards: [
          { key: 'Provider', value: provider },
          { key: 'Model', value: model },
          { key: 'Status', value: 'Error' },
        ],
      },
    };
    session.messages.push(errorAssistantMsg);
    session.updatedAt = Date.now();
    globalState.aiMessages = session.messages;
    persistAiSessions();
    notify();
  } finally {
    activeAiAbortController = null;
    globalState.aiLoading = false;
  }
}

export async function retryLastAiMessage(): Promise<void> {
  const userMessages = globalState.aiMessages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) return;
  const lastUserMsg = userMessages[userMessages.length - 1];

  // Remove trailing assistant error message or response
  while (
    globalState.aiMessages.length > 0 &&
    globalState.aiMessages[globalState.aiMessages.length - 1].role === 'assistant'
  ) {
    globalState.aiMessages.pop();
  }

  // Remove the last user message so sendAiMessage freshly appends it
  const lastIdx = globalState.aiMessages.lastIndexOf(lastUserMsg);
  if (lastIdx !== -1) {
    globalState.aiMessages.splice(lastIdx, 1);
  }

  globalState.aiError = null;
  persistAiMessages();
  notify();

  await sendAiMessage(lastUserMsg.content);
}


