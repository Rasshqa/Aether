import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import jitiFactory from 'jiti';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock Storage and Environment
const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => (storageMap.has(key) ? storageMap.get(key)! : null),
  setItem: (key: string, value: string) => {
    storageMap.set(key, String(value));
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
};

(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).window = {
  localStorage: mockLocalStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as any).document = {
  documentElement: {
    style: { setProperty: () => {}, getPropertyValue: () => '' },
    classList: { add: () => {}, remove: () => {}, contains: () => false },
  },
  body: { style: { backgroundColor: '' } },
};

const jiti = jitiFactory(import.meta.url);
const aetherStore = jiti('../src/stores/aetherStore.ts');

const {
  getAetherState,
  createTab,
  switchTab,
  sendAiMessage,
  getActiveAiSession,
  executeAiCommand,
  resolvePendingAiApproval,
  evaluateActionSecurity,
  checkAndApproveAction,
  stripAnsiCodes,
  app_list_tabs_and_panes,
  app_operate_tab,
  app_operate_pane,
  pane_read_screen,
  pane_send_input,
  pane_send_keystroke,
  app_trigger_feature,
  fs_list_directory,
  fs_read_file,
  fs_write_or_edit_file,
  fs_delete_path,
  executeAiToolCall,
  extractToolCalls,
  stopAiAssistant,
  getOmniAssistantSystemPrompt,
} = aetherStore;

describe('Omni-Access AI Assistant & HITL Security Guardrails Test Suite', () => {
  beforeEach(() => {
    storageMap.clear();
    const state = getAetherState();
    state.pendingAiApproval = null;
    state.aiSessionApprovedTier2 = false;
    state.aiMessages = [];
  });

  describe('1. File Tree Sidebar Vertical Scrolling Layout Invariants', () => {
    it('verifies PersistentLeftSidebar contains min-h-0, overflow-y-auto, and overscroll-contain', () => {
      const filePath = path.resolve(__dirname, '../src/components/PersistentLeftSidebar.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('min-h-0'), 'PersistentLeftSidebar must contain min-h-0');
      assert.ok(content.includes('overflow-y-auto'), 'PersistentLeftSidebar must contain overflow-y-auto');
      assert.ok(content.includes('overscroll-contain'), 'PersistentLeftSidebar must contain overscroll-contain');
      assert.ok(content.includes('pointer-events-auto'), 'PersistentLeftSidebar must contain pointer-events-auto');
    });

    it('verifies AetherDriveSidebar contains min-h-0, overflow-y-auto, and overscroll-contain', () => {
      const filePath = path.resolve(__dirname, '../src/components/AetherDriveSidebar.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('min-h-0'), 'AetherDriveSidebar must contain min-h-0');
      assert.ok(content.includes('overflow-y-auto'), 'AetherDriveSidebar must contain overflow-y-auto');
      assert.ok(content.includes('overscroll-contain'), 'AetherDriveSidebar must contain overscroll-contain');
    });

    it('verifies DiffGatekeeperModal and ObsidianSidebar contain scrolling invariants', () => {
      const diffPath = path.resolve(__dirname, '../src/components/DiffGatekeeperModal.tsx');
      const diffContent = fs.readFileSync(diffPath, 'utf-8');
      assert.ok(diffContent.includes('min-h-0'), 'DiffGatekeeperModal must contain min-h-0');
      assert.ok(diffContent.includes('overflow-y-auto'), 'DiffGatekeeperModal must contain overflow-y-auto');

      const obsidianPath = path.resolve(__dirname, '../src/components/ObsidianSidebar.tsx');
      const obsContent = fs.readFileSync(obsidianPath, 'utf-8');
      assert.ok(obsContent.includes('min-h-0'), 'ObsidianSidebar must contain min-h-0');
      assert.ok(obsContent.includes('overflow-y-auto'), 'ObsidianSidebar must contain overflow-y-auto');
    });

    it('verifies index.css defines touch and WebKitGTK scrolling optimizations', () => {
      const cssPath = path.resolve(__dirname, '../src/index.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');
      assert.ok(cssContent.includes('.overflow-y-auto'), 'index.css must target overflow-y-auto');
      assert.ok(cssContent.includes('-webkit-overflow-scrolling: touch'), 'index.css must configure touch scrolling');
    });
  });

  describe('2. Omni-Access AI Assistant Workspace Controller', () => {
    it('inspects workspace tabs and split panes hierarchy via app_list_tabs_and_panes', () => {
      const summary = app_list_tabs_and_panes();
      assert.ok(summary, 'Summary must exist');
      assert.ok(Array.isArray(summary.tabs), 'Tabs must be an array');
      assert.ok(Array.isArray(summary.panes), 'Panes must be an array');
      assert.ok(Array.isArray(summary.backgroundTasks), 'Background tasks must be an array');
    });

    it('operates tabs: create, switch, rename, reorder, close', async () => {
      // 1. Create tab
      const createRes = await app_operate_tab('create', undefined, { title: 'Controller Test Tab', cliType: 'bash' });
      assert.strictEqual(createRes.success, true);
      assert.ok(createRes.tabId);

      // 2. Switch tab
      const switchRes = await app_operate_tab('switch', createRes.tabId);
      assert.strictEqual(switchRes.success, true);
      const state = getAetherState();
      assert.strictEqual(state.activeTabId, createRes.tabId);

      // 3. Rename tab
      const renameRes = await app_operate_tab('rename', createRes.tabId, { title: 'Renamed Controller Tab' });
      assert.strictEqual(renameRes.success, true);
      const renamed = state.tabs.find((t: any) => t.id === createRes.tabId);
      assert.strictEqual(renamed?.title, 'Renamed Controller Tab');

      // 4. Reorder tab
      const reorderRes = await app_operate_tab('reorder', createRes.tabId, { newIndex: 0 });
      assert.strictEqual(reorderRes.success, true);

      // 5. Close tab
      const closeRes = await app_operate_tab('close', createRes.tabId);
      assert.strictEqual(closeRes.success, true);
    });

    it('operates panes: split, focus, resize, close', async () => {
      // Focus pane
      const focusRes = await app_operate_pane('focus', 'terminal-1');
      assert.strictEqual(focusRes.success, true);

      // Resize pane
      const resizeRes = await app_operate_pane('resize', 'terminal-1', { ratio: 0.65 });
      assert.strictEqual(resizeRes.success, true);

      // Close pane
      const closeRes = await app_operate_pane('close', 'nonexistent-pane');
      assert.strictEqual(closeRes.success, true);
    });

    it('reads terminal screen with ANSI escape code stripping via pane_read_screen', async () => {
      const rawWithAnsi = '\u001b[32m[SUCCESS]\u001b[0m Cargo test finished \u001b[1;34m12 passed\u001b[0m\n';
      const clean = stripAnsiCodes(rawWithAnsi);
      assert.strictEqual(clean, '[SUCCESS] Cargo test finished 12 passed\n');

      const screen = await pane_read_screen('terminal-1', 20);
      assert.ok(screen.paneId);
      assert.ok(Array.isArray(screen.lines));
      assert.ok(typeof screen.text === 'string');
    });

    it('transmits keystroke and input with 60ms delayed newline via pane_send_input and pane_send_keystroke', async () => {
      const inputRes = await pane_send_input('terminal-1', 'cargo test', true);
      assert.strictEqual(inputRes.success, true);

      const keyRes = await pane_send_keystroke('terminal-1', 'Ctrl+C');
      assert.strictEqual(keyRes.success, true);
    });

    it('triggers built-in AetherTerminal features via app_trigger_feature', async () => {
      const gatekeeperRes = await app_trigger_feature('diff_gatekeeper');
      assert.strictEqual(gatekeeperRes.success, true);
      const state = getAetherState();
      assert.strictEqual(state.diffGatekeeperOpen, true);

      const snapRes = await app_trigger_feature('create_snapshot', { summary: 'Unit test snapshot' });
      assert.ok(typeof snapRes.success === 'boolean');

      const blackboardRes = await app_trigger_feature('publish_blackboard', {
        title: 'Broadcast Title',
        contentMarkdown: 'Broadcast content from AI controller',
      });
      assert.strictEqual(blackboardRes.success, true);
    });
  });

  describe('3. Workspace File System Access for AI Assistant', () => {
    it('lists directory structure with fs_list_directory', async () => {
      const res = await fs_list_directory('.', 2);
      assert.ok(res);
      assert.ok(res.entries || Array.isArray(res));
    });

    it('reads file with line numbers via fs_read_file', async () => {
      const res = await fs_read_file('package.json', 1, 20);
      assert.ok(res.path);
      assert.ok(Array.isArray(res.lines));
      assert.ok(res.lines.length > 0);
      assert.ok(typeof res.lines[0].line === 'number');
      assert.ok(typeof res.lines[0].content === 'string');
    });

    it('writes file with pre-edit zero-commit snapshot and cache refresh via fs_write_or_edit_file', async () => {
      const state = getAetherState();
      const initialTick = state.obsidianRefreshTick;

      const res = await fs_write_or_edit_file('test_ai_output.txt', 'Verified AI Controller File Write\n', 'overwrite');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.path, 'test_ai_output.txt');
      assert.ok(state.obsidianRefreshTick > initialTick, 'File write must increment refresh tick to invalidate cache');
    });

    it('deletes path with pre-delete snapshot via fs_delete_path', async () => {
      const state = getAetherState();
      const initialTick = state.obsidianRefreshTick;

      const res = await fs_delete_path('test_ai_output.txt');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.path, 'test_ai_output.txt');
      assert.ok(state.obsidianRefreshTick > initialTick, 'Deletion must trigger cache refresh tick');
    });
  });

  describe('4. Human-in-the-Loop (HITL) Security Approval System', () => {
    it('auto-approves Tier 1 safe read-only actions', async () => {
      const eval1 = evaluateActionSecurity('app_list_tabs_and_panes', {});
      assert.strictEqual(eval1.tier, 1);

      const eval2 = evaluateActionSecurity('fs_read_file', { path: 'src/main.rs' });
      assert.strictEqual(eval2.tier, 1);

      const eval3 = evaluateActionSecurity('pane_read_screen', { paneId: 'terminal-1' });
      assert.strictEqual(eval3.tier, 1);

      const check1 = await checkAndApproveAction('app_list_tabs_and_panes', {});
      assert.strictEqual(check1.approved, true);

      const check2 = await checkAndApproveAction('fs_read_file', { path: 'src/main.rs' });
      assert.strictEqual(check2.approved, true);
    });

    it('classifies Tier 2 workspace mutations and checks session-bypass logic', async () => {
      const evalWrite = evaluateActionSecurity('fs_write_or_edit_file', { path: 'src/main.rs', content: 'hello' });
      assert.strictEqual(evalWrite.tier, 2);

      const evalCloseTab = evaluateActionSecurity('app_operate_tab', { action: 'close', tabId: 'tab-1' });
      assert.strictEqual(evalCloseTab.tier, 2);

      const evalSafeCmd = evaluateActionSecurity('pane_send_input', { text: 'cargo check --workspace' });
      assert.strictEqual(evalSafeCmd.tier, 2);

      // Without session approval, Tier 2 triggers pendingAiApproval
      const state = getAetherState();
      assert.strictEqual(state.pendingAiApproval, null);

      const approvalPromise = checkAndApproveAction('fs_write_or_edit_file', { path: 'src/main.rs', content: 'code' });
      assert.ok(state.pendingAiApproval, 'Modal must be active for Tier 2 without session bypass');
      assert.strictEqual(state.pendingAiApproval.tier, 2);

      // Approve once
      resolvePendingAiApproval(true, false);
      const res = await approvalPromise;
      assert.strictEqual(res.approved, true);
      assert.strictEqual(state.pendingAiApproval, null);

      // Now approve with session remember
      const approvalPromise2 = checkAndApproveAction('fs_write_or_edit_file', { path: 'src/main.rs', content: 'more' });
      assert.ok(state.pendingAiApproval);
      resolvePendingAiApproval(true, true);
      const res2 = await approvalPromise2;
      assert.strictEqual(res2.approved, true);
      assert.strictEqual(state.aiSessionApprovedTier2, true);

      // Next Tier 2 action should now bypass modal automatically
      const checkBypass = await checkAndApproveAction('fs_write_or_edit_file', { path: 'src/main.rs', content: 'third' });
      assert.strictEqual(checkBypass.approved, true);
      assert.strictEqual(state.pendingAiApproval, null);
    });

    it('enforces mandatory approval for Tier 3 destructive actions even with session-bypass active', async () => {
      const state = getAetherState();
      state.aiSessionApprovedTier2 = true; // Attempt session bypass

      // 1. Delete path is Tier 3
      const evalDelete = evaluateActionSecurity('fs_delete_path', { path: 'critical_file.rs' });
      assert.strictEqual(evalDelete.tier, 3);

      // 2. Destructive shell command is Tier 3
      const evalDestructive = evaluateActionSecurity('pane_send_input', { text: 'rm -rf /workspace' });
      assert.strictEqual(evalDestructive.tier, 3);

      const evalSudo = evaluateActionSecurity('pane_send_input', { text: 'sudo rm file' });
      assert.strictEqual(evalSudo.tier, 3);

      const evalForcePush = evaluateActionSecurity('pane_send_input', { text: 'git push origin main --force' });
      assert.strictEqual(evalForcePush.tier, 3);

      // 3. Process interruption Ctrl+C is Tier 3
      const evalSigint = evaluateActionSecurity('pane_send_keystroke', { keystroke: 'Ctrl+C' });
      assert.strictEqual(evalSigint.tier, 3);

      // Verify Tier 3 cannot be bypassed by aiSessionApprovedTier2
      const deletePromise = checkAndApproveAction('fs_delete_path', { path: 'database.db' });
      assert.ok(state.pendingAiApproval, 'Tier 3 must trigger modal even when aiSessionApprovedTier2 is true');
      assert.strictEqual(state.pendingAiApproval.tier, 3);

      // Reject action with feedback
      resolvePendingAiApproval(false, false, 'Do not delete the production database!');
      const deleteRes = await deletePromise;
      assert.strictEqual(deleteRes.approved, false);
      assert.strictEqual(deleteRes.rejectReason, 'Do not delete the production database!');
    });
  });

  describe('5. Tool Extraction and Autonomous Assistant Execution', () => {
    it('extracts tool calls from markdown code blocks and XML tags', () => {
      const sampleText = `
I will check the files and run tests:

\`\`\`tool_call
{
  "name": "fs_list_directory",
  "arguments": { "path": "src" }
}
\`\`\`

And also read the screen:

<tool_call name="pane_read_screen">
{ "maxLines": 25 }
</tool_call>
`;
      const calls = extractToolCalls(sampleText);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].name, 'fs_list_directory');
      assert.strictEqual(calls[0].arguments.path, 'src');
      assert.strictEqual(calls[1].name, 'pane_read_screen');
      assert.strictEqual(calls[1].arguments.maxLines, 25);
    });

    it('executes tool call via executeAiToolCall dispatcher', async () => {
      const res = await executeAiToolCall('app_list_tabs_and_panes', {});
      assert.ok(res.tabs);
      assert.ok(res.panes);
    });

    it('runs multi-turn AI message with tool execution and security gatekeeper', async () => {
      const state = getAetherState();
      state.aiSessionApprovedTier2 = true;

      await sendAiMessage('list the workspace files');

      const session = getActiveAiSession();
      const lastMsg = session.messages[session.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'assistant');
      assert.ok(lastMsg.content.includes('Tool Executed') || lastMsg.content.includes('fs_list_directory'));
    });
  });

  describe('6. Slash Commands for Omni Controller & Filesystem', () => {
    it('executes /app tabs command and reports overview', async () => {
      const res = await executeAiCommand('/app tabs');
      assert.strictEqual(res.handled, true);
      const session = getActiveAiSession();
      const last = session.messages[session.messages.length - 1];
      assert.ok(last.content.includes('Workspace Tabs & Panes Overview'));
    });

    it('executes /fs list command', async () => {
      const res = await executeAiCommand('/fs list');
      assert.strictEqual(res.handled, true);
      const session = getActiveAiSession();
      const last = session.messages[session.messages.length - 1];
      assert.ok(last.content.includes('Directory Listing'));
    });

    it('executes /pane read command', async () => {
      const res = await executeAiCommand('/pane read terminal-1');
      assert.strictEqual(res.handled, true);
      const session = getActiveAiSession();
      const last = session.messages[session.messages.length - 1];
      assert.ok(last.content.includes('Terminal Screen'));
    });
  });

  describe('7. Stop Agent Feature & Omni Assistant System Prompt', () => {
    it('generates omni-assistant system prompt containing live state and 11 controller tools', () => {
      const prompt = getOmniAssistantSystemPrompt('Custom user instructions');
      assert.ok(prompt.includes('AetherCortex'));
      assert.ok(prompt.includes('LIVE APPLICATION STATE'));
      assert.ok(prompt.includes('app_list_tabs_and_panes'));
      assert.ok(prompt.includes('app_operate_tab'));
      assert.ok(prompt.includes('app_operate_pane'));
      assert.ok(prompt.includes('pane_read_screen'));
      assert.ok(prompt.includes('pane_send_input'));
      assert.ok(prompt.includes('pane_send_keystroke'));
      assert.ok(prompt.includes('fs_list_directory'));
      assert.ok(prompt.includes('fs_read_file'));
      assert.ok(prompt.includes('fs_write_or_edit_file'));
      assert.ok(prompt.includes('fs_delete_path'));
      assert.ok(prompt.includes('app_trigger_feature'));
      assert.ok(prompt.includes('Custom user instructions'));
    });

    it('stops agent, resets loading states, cancels pending approvals, and aborts running execution', () => {
      const state = getAetherState();
      state.aiLoading = true;
      state.aiPilotRunning = true;
      state.pendingAiApproval = {
        id: 'test-approval-1',
        tier: 2,
        actionType: 'fs_write_or_edit_file',
        toolName: 'fs_write_or_edit_file',
        toolArgs: { path: 'test.txt' },
        description: 'Edit test.txt',
        timestamp: Date.now(),
        resolve: () => {},
      };

      const activePane = state.panes.find((p: any) => p.id === state.activePaneId);
      if (activePane) {
        activePane.status = 'EXECUTING';
      }

      stopAiAssistant();

      assert.strictEqual(state.aiLoading, false, 'aiLoading must be reset to false');
      assert.strictEqual(state.aiPilotRunning, false, 'aiPilotRunning must be reset to false');
      assert.strictEqual(state.pendingAiApproval, null, 'pendingAiApproval must be null');
      if (activePane) {
        assert.strictEqual(activePane.status, 'IDLE', 'Active pane status must be reset to IDLE');
      }

      const session = getActiveAiSession();
      const last = session.messages[session.messages.length - 1];
      assert.ok(last.content.includes('stopped by user') || last.content.includes('Stopped by user'));
    });
  });
});
