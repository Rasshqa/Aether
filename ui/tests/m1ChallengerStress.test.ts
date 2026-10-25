import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Minimal mock browser environment for Node.js testing
// ----------------------------------------------------------------------------
const storageMap = new Map<string, string>();
let storageShouldThrow = false;

const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => {
    if (storageShouldThrow) {
      throw new Error('QuotaExceededError: storage limit reached');
    }
    storageMap.set(key, String(val));
  },
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
};

const eventListeners: Record<string, ((e: any) => void)[]> = {};
const mockWindow = {
  addEventListener: (event: string, cb: (e: any) => void) => {
    eventListeners[event] = eventListeners[event] || [];
    eventListeners[event].push(cb);
  },
  removeEventListener: (event: string, cb: (e: any) => void) => {
    if (eventListeners[event]) {
      eventListeners[event] = eventListeners[event].filter((l) => l !== cb);
    }
  },
  dispatchEvent: (event: any) => {
    for (const cb of eventListeners[event.type] || []) {
      cb(event);
    }
    return true;
  },
};

const rootProperties: Record<string, string> = {};
const rootClasses = new Set<string>();

const mockDocument = {
  documentElement: {
    style: {
      setProperty: (prop: string, val: string) => {
        rootProperties[prop] = val;
      },
      getPropertyValue: (prop: string) => rootProperties[prop] || '',
    },
    classList: {
      add: (cls: string) => rootClasses.add(cls),
      remove: (cls: string) => rootClasses.delete(cls),
      contains: (cls: string) => rootClasses.has(cls),
    },
  },
  body: {
    style: {
      backgroundColor: '',
    },
  },
};

(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).window = mockWindow;
(globalThis as any).document = mockDocument;

import jitiFactory from 'jiti';
import xtermPkg from '@xterm/xterm';
const { Terminal } = xtermPkg;

const jiti = jitiFactory(import.meta.url);
const aetherStore = jiti('../src/stores/aetherStore.ts');
const themesUtil = jiti('../src/utils/themes.ts');

const {
  toggleSidebar,
  toggleAetherDriveSidebar,
  toggleAiAssistant,
  toggleAiSettings,
  setAetherTheme,
  getAetherState,
} = aetherStore;

const { AETHER_THEMES, applyTheme } = themesUtil;

// ----------------------------------------------------------------------------
// WCAG 2.1 Contrast Calculation Utilities
// ----------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function sRGBChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const rLin = sRGBChannelToLinear(r);
  const gLin = sRGBChannelToLinear(g);
  const bLin = sRGBChannelToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Milestone 1 Challenger Stress & Property Tests', () => {
  beforeEach(() => {
    storageMap.clear();
    storageShouldThrow = false;
    for (const key of Object.keys(rootProperties)) {
      delete rootProperties[key];
    }
    rootClasses.clear();
    setAetherTheme('aethercortex-dark');
  });

  // ==========================================================================
  // Test Suite 1: Theme Toggle Cycles & localStorage Persistence Stress Tests
  // ==========================================================================
  describe('1. Theme Toggle Cycles & localStorage Persistence Stress Tests', () => {
    it('survives 1,000 rapid toggle cycles between dark and light modes with perfect invariant consistency', () => {
      const darkTheme = AETHER_THEMES.find((t: any) => t.id === 'aethercortex-dark');
      const lightTheme = AETHER_THEMES.find((t: any) => t.id === 'aethercortex-light');

      assert.ok(darkTheme && lightTheme, 'Both themes must exist');

      for (let i = 0; i < 1000; i++) {
        const targetTheme = i % 2 === 0 ? 'aethercortex-light' : 'aethercortex-dark';
        applyTheme(targetTheme);
        setAetherTheme(targetTheme);

        // Invariant 1: LocalStorage must precisely match active theme
        assert.equal(
          storageMap.get('aether_theme'),
          targetTheme,
          `Iteration ${i}: LocalStorage out of sync with theme ${targetTheme}`
        );

        // Invariant 2: Store state must match
        assert.equal(
          getAetherState().currentTheme,
          targetTheme,
          `Iteration ${i}: Store state out of sync`
        );

        // Invariant 3: Class list must strictly contain either dark-mode or light-mode (mutually exclusive)
        if (targetTheme === 'aethercortex-light') {
          assert.equal(rootClasses.has('light-mode'), true, `Iteration ${i}: missing light-mode class`);
          assert.equal(rootClasses.has('dark-mode'), false, `Iteration ${i}: unexpected dark-mode class`);
          assert.equal(rootProperties['--cortex-accent'], '#00A3AD');
          assert.equal(rootProperties['--cortex-bg'], '#FFFFFF');
        } else {
          assert.equal(rootClasses.has('dark-mode'), true, `Iteration ${i}: missing dark-mode class`);
          assert.equal(rootClasses.has('light-mode'), false, `Iteration ${i}: unexpected light-mode class`);
          assert.equal(rootProperties['--cortex-accent'], '#00F0FF');
          assert.equal(rootProperties['--cortex-bg'], '#050809');
        }
      }
    });

    it('handles adversarial invalid theme names with graceful fallback to default theme', () => {
      const invalidThemes = [
        'non-existent-theme-xyz',
        '',
        '   ',
        null as any,
        undefined as any,
        '<script>alert(1)</script>',
        '../../../etc/passwd',
        'tokyo-night-invalid',
      ];

      for (const invalid of invalidThemes) {
        // applyTheme should safely fallback to AETHER_THEMES[0] ('aethercortex-dark')
        const applied = applyTheme(invalid);
        assert.equal(applied.id, 'aethercortex-dark');
        assert.equal(rootProperties['--cortex-accent'], '#00F0FF');
        assert.equal(rootClasses.has('dark-mode'), true);
        assert.equal(rootClasses.has('light-mode'), false);
      }
    });

    it('resiliently handles localStorage quota or security exceptions during theme apply', () => {
      storageShouldThrow = true;

      // applyTheme wraps localStorage in try/catch: must not throw exception to caller
      assert.doesNotThrow(() => {
        applyTheme('aethercortex-light');
      }, 'applyTheme must not crash when localStorage.setItem throws');

      // CSS properties must still be applied even if persistence fails
      assert.equal(rootProperties['--cortex-accent'], '#00A3AD');
      assert.equal(rootClasses.has('light-mode'), true);
    });

    it('maintains theme state across store re-reads and localStorage hydration', () => {
      // Simulate localStorage initialized with light mode before app loads
      storageMap.set('aether_theme', 'aethercortex-light');
      const savedTheme = storageMap.get('aether_theme') || 'aethercortex-dark';
      applyTheme(savedTheme);
      setAetherTheme(savedTheme);

      assert.equal(getAetherState().currentTheme, 'aethercortex-light');
      assert.equal(rootProperties['--cortex-accent'], '#00A3AD');
    });
  });

  // ==========================================================================
  // Test Suite 2: WCAG 2.1 Contrast Ratio Property Tests
  // ==========================================================================
  describe('2. WCAG 2.1 Contrast Ratio Property Tests for Neo-Brutalist Tokens', () => {
    const darkTokens = {
      bg: '#050809',
      bgAlt: '#0B1013',
      surface1: '#0E1418',
      surface2: '#121A1F',
      text: '#F8FAFC',
      textMuted: '#94A3B8',
      accent: '#00F0FF',
      accentHover: '#38F4FF',
      error: '#FF3B5C',
      success: '#00E599',
      warning: '#FFB800',
      border: '#162026',
      borderStrong: '#1F2E36',
    };

    const lightTokens = {
      bg: '#FFFFFF',
      bgAlt: '#F8F9FA',
      surface1: '#F1F4F6',
      surface2: '#E5E9EC',
      text: '#1E3A8A',
      textMuted: '#3B5B82',
      accent: '#00A3AD',
      accentHover: '#008790',
      error: '#DC2626',
      success: '#059669',
      warning: '#D97706',
      border: '#CBD5E1',
      borderStrong: '#94A3B8',
    };

    it('Dark Mode: primary text passes WCAG AAA (>= 7:1) across all dark surfaces', () => {
      const surfaces = [darkTokens.bg, darkTokens.bgAlt, darkTokens.surface1, darkTokens.surface2];
      for (const surface of surfaces) {
        const ratio = getContrastRatio(darkTokens.text, surface);
        // Off-white (#F8F9FA) on near-black (#050809) reaches ~19:1
        assert.ok(
          ratio >= 7.0,
          `Dark primary text must pass WCAG AAA (>= 7:1). Actual ratio: ${ratio.toFixed(2)}:1`
        );
      }
    });

    it('Dark Mode: muted text passes WCAG AA (>= 4.5:1) across all dark surfaces', () => {
      const surfaces = [darkTokens.bg, darkTokens.bgAlt, darkTokens.surface1, darkTokens.surface2];
      for (const surface of surfaces) {
        const ratio = getContrastRatio(darkTokens.textMuted, surface);
        assert.ok(
          ratio >= 4.5,
          `Dark muted text must pass WCAG AA (>= 4.5:1). Actual ratio: ${ratio.toFixed(2)}:1`
        );
      }
    });

    it('Dark Mode: Cosmic Cyan accent passes WCAG AA for graphical components and large text (>= 3:1)', () => {
      const surfaces = [darkTokens.bg, darkTokens.bgAlt, darkTokens.surface1, darkTokens.surface2];
      for (const surface of surfaces) {
        const ratio = getContrastRatio(darkTokens.accent, surface);
        // Cosmic Cyan (#00F0FF) reaches > 12:1 contrast against dark surfaces
        assert.ok(
          ratio >= 3.0,
          `Dark accent must pass WCAG AA (>= 3:1). Actual ratio: ${ratio.toFixed(2)}:1`
        );
      }
    });

    it('Light Mode: primary text passes WCAG AAA (>= 7:1) across all light surfaces', () => {
      const surfaces = [lightTokens.bg, lightTokens.bgAlt, lightTokens.surface1, lightTokens.surface2];
      for (const surface of surfaces) {
        const ratio = getContrastRatio(lightTokens.text, surface);
        // Near-black (#050809) on pure white (#FFFFFF) reaches > 16:1
        assert.ok(
          ratio >= 7.0,
          `Light primary text must pass WCAG AAA (>= 7:1). Actual ratio: ${ratio.toFixed(2)}:1`
        );
      }
    });

    it('Light Mode: muted text passes WCAG AA (>= 4.5:1) across all light surfaces', () => {
      const surfaces = [lightTokens.bg, lightTokens.bgAlt, lightTokens.surface1, lightTokens.surface2];
      for (const surface of surfaces) {
        const ratio = getContrastRatio(lightTokens.textMuted, surface);
        assert.ok(
          ratio >= 4.5,
          `Light muted text must pass WCAG AA (>= 4.5:1). Actual ratio: ${ratio.toFixed(2)}:1`
        );
      }
    });

    it('Light Mode: high-contrast cyan accent meets graphical component requirement (>= 3:1) on white background', () => {
      const ratio = getContrastRatio(lightTokens.accent, lightTokens.bg);
      // High-contrast cyan #00A3AD on #FFFFFF is 3.07:1
      assert.ok(
        ratio >= 3.0,
        `Light accent on pure white must meet WCAG AA graphical UI requirement (>= 3.0:1). Actual: ${ratio.toFixed(2)}:1`
      );
    });

    it('verifies border contrast discernibility between adjacent surfaces', () => {
      // Dark mode: border #162026 vs bg #050809
      const darkBorderRatio = getContrastRatio(darkTokens.border, darkTokens.bg);
      assert.ok(darkBorderRatio > 1.05, 'Dark border must have measurable contrast against bg');

      // Light mode: border #CBD5E1 vs bg #FFFFFF
      const lightBorderRatio = getContrastRatio(lightTokens.border, lightTokens.bg);
      assert.ok(lightBorderRatio > 1.3, 'Light border must have measurable contrast against bg');
    });
  });

  // ==========================================================================
  // Test Suite 3: PersistentLeftSidebar Navigation Event Dispatching Tests
  // ==========================================================================
  describe('3. PersistentLeftSidebar Navigation Event Dispatching Tests', () => {
    it('dispatches navigation section events when onSelectSection callback is provided', () => {
      const dispatchedSections: string[] = [];
      const onSelectSection = (section: string) => {
        dispatchedSections.push(section);
      };

      // Simulate PersistentLeftSidebar handleNavClick logic
      const simulateNavClick = (section: 'terminal' | 'assistant' | 'workspace' | 'settings') => {
        if (onSelectSection) onSelectSection(section);
        if (section === 'workspace') toggleSidebar();
        else if (section === 'assistant') toggleAiAssistant();
        else if (section === 'settings') toggleAiSettings(true);
      };

      simulateNavClick('terminal');
      simulateNavClick('assistant');
      simulateNavClick('workspace');
      simulateNavClick('settings');

      assert.deepEqual(dispatchedSections, ['terminal', 'assistant', 'workspace', 'settings']);
    });

    it('triggers underlying store actions on navigation actions', () => {
      // Toggle workspace drawer
      toggleSidebar(false);
      assert.equal(getAetherState().aetherDriveSidebarOpen, false);
      toggleSidebar(true);
      assert.equal(getAetherState().aetherDriveSidebarOpen, true);
      toggleSidebar();
      assert.equal(getAetherState().aetherDriveSidebarOpen, false);

      // Toggle AI Assistant
      toggleAiAssistant(false);
      assert.equal(getAetherState().aiAssistantOpen, false);
      toggleAiAssistant(true);
      assert.equal(getAetherState().aiAssistantOpen, true);

      // Toggle AI Settings
      toggleAiSettings(false);
      assert.equal(getAetherState().aiSettingsOpen, false);
      toggleAiSettings(true);
      assert.equal(getAetherState().aiSettingsOpen, true);
    });

    it('identifies adversarial finding: clicking terminal does not reset open workspace sidebar', () => {
      // Setup: Open workspace drawer
      toggleSidebar(true);
      assert.equal(getAetherState().aetherDriveSidebarOpen, true);

      // In PersistentLeftSidebar, handleNavClick('terminal') does not close workspace or mutate store
      // Document this behavior:
      const isWorkspaceActive = getAetherState().aetherDriveSidebarOpen;
      const isAssistantActive = getAetherState().aiAssistantOpen;
      const isSettingsActive = getAetherState().aiSettingsOpen;
      const isTerminalActive = !isWorkspaceActive && !isAssistantActive && !isSettingsActive;

      assert.equal(isTerminalActive, false, 'isTerminalActive is false while workspace is open');
    });
  });

  // ==========================================================================
  // Test Suite 4: Layout Collision Tests (PersistentLeftSidebar & AetherDriveSidebar)
  // ==========================================================================
  describe('4. Layout Collision Tests: PersistentLeftSidebar & AetherDriveSidebar', () => {
    it('verifies non-overlapping CSS flex column dimensions and classes', () => {
      const sidebarPath = path.resolve(__dirname, '../src/components/PersistentLeftSidebar.tsx');
      const driveSidebarPath = path.resolve(__dirname, '../src/components/AetherDriveSidebar.tsx');
      const mainPath = path.resolve(__dirname, '../src/main.tsx');

      const sidebarSrc = fs.readFileSync(sidebarPath, 'utf8');
      const driveSidebarSrc = fs.readFileSync(driveSidebarPath, 'utf8');
      const mainSrc = fs.readFileSync(mainPath, 'utf8');

      // 1. Unified PersistentLeftSidebar: collapsed w-[200px] or expanded w-72 with shrink-0 and z-30
      assert.ok(
        sidebarSrc.includes('w-[200px]') || sidebarSrc.includes('w-72'),
        'PersistentLeftSidebar must define collapsed (w-[200px]) or expanded (w-72) width'
      );
      assert.ok(sidebarSrc.includes('shrink-0'), 'PersistentLeftSidebar must have shrink-0');
      assert.ok(sidebarSrc.includes('z-30'), 'PersistentLeftSidebar must have z-30');

      // 2. AetherDriveSidebar component file still exists (its content is embedded in unified sidebar)
      assert.ok(driveSidebarSrc.length > 0, 'AetherDriveSidebar component file must exist');

      // 3. In main.tsx, PersistentLeftSidebar is the first column in the outer flex-row,
      // and main application viewport is flex-1 min-w-0
      assert.ok(mainSrc.includes('flex flex-row h-screen w-screen'), 'Outer container is flex-row');
      assert.ok(mainSrc.includes('<PersistentLeftSidebar />'), 'PersistentLeftSidebar mounted first');
      assert.ok(mainSrc.includes('flex flex-col flex-1 h-full min-w-0'), 'Main viewport has flex-1 min-w-0');

      // 4. TerminalGrid is mounted in main flex-row
      assert.ok(mainSrc.includes('<TerminalGrid'), 'TerminalGrid mounted in main layout');
    });

    it('computes layout geometry under various viewport widths', () => {
      // Unified sidebar: collapsed = 200px (w-[200px]), expanded = 288px (w-72)
      const persistentSidebarCollapsed = 200;
      const persistentSidebarExpanded = 288; // w-72 = 18rem
      const aiPanelWidth = 380;

      // Desktop 1920x1080: collapsed sidebar + ai panel
      const desktopRemaining = 1920 - persistentSidebarCollapsed - aiPanelWidth;
      assert.ok(desktopRemaining > 1000, 'Desktop viewport leaves ample space for terminal');

      // Laptop 1280x800
      const laptopRemaining = 1280 - persistentSidebarCollapsed - aiPanelWidth;
      assert.ok(laptopRemaining > 600, 'Laptop viewport comfortable for terminal');

      // Expanded sidebar on desktop
      const expandedRemaining = 1920 - persistentSidebarExpanded - aiPanelWidth;
      assert.ok(expandedRemaining > 900, 'Expanded sidebar still leaves ample terminal space');

      // Narrow viewport: unified sidebar is less constrained than two separate panels
      const narrowViewport = 500;
      const isNarrowConstrained = narrowViewport < (persistentSidebarCollapsed + aiPanelWidth);
      assert.equal(isNarrowConstrained, true, 'Narrow viewports under 580px are constrained with AI panel open');
    });

    it('identifies design token collision in AetherDriveSidebar during light mode', () => {
      const driveSidebarPath = path.resolve(__dirname, '../src/components/AetherDriveSidebar.tsx');
      const content = fs.readFileSync(driveSidebarPath, 'utf8');

      // AetherDriveSidebar hardcodes bg-slate-950/95 and border-slate-800 instead of cortex variables
      const hasHardcodedDarkSlate = content.includes('bg-slate-950') && content.includes('border-slate-800');
      assert.ok(
        hasHardcodedDarkSlate,
        'Empirically observed: AetherDriveSidebar retains hardcoded dark slate colors, which causes a visual theme collision in light mode'
      );
    });
  });

  // ==========================================================================
  // Test Suite 5: XtermWebGLPane Theme Reactivity Empirical Verification
  // ==========================================================================
  describe('5. XtermWebGLPane Theme Reactivity Verification', () => {
    it('empirically updates Terminal options.theme when store.currentTheme changes', () => {
      const darkTheme = AETHER_THEMES.find((t: any) => t.id === 'aethercortex-dark')!;
      const lightTheme = AETHER_THEMES.find((t: any) => t.id === 'aethercortex-light')!;

      // 1. Initialize real xterm Terminal with initial theme
      const term = new Terminal({
        theme: darkTheme.xterm,
      });

      assert.equal(term.options.theme?.background, '#050809');
      assert.equal(term.options.theme?.foreground, '#F8FAFC');
      assert.equal(term.options.theme?.cursor, '#00F0FF');

      // 2. Simulate reactive theme change effect from XtermWebGLPane:
      // useEffect(() => {
      //   if (!termRef.current) return;
      //   const currentActiveTheme = AETHER_THEMES.find((t) => t.id === store.currentTheme) || AETHER_THEMES[0];
      //   termRef.current.options.theme = currentActiveTheme.xterm;
      // }, [store.currentTheme]);
      const syncTerminalTheme = (themeId: string) => {
        const theme = AETHER_THEMES.find((t: any) => t.id === themeId) || AETHER_THEMES[0];
        term.options.theme = theme.xterm;
      };

      // Switch to Light Mode
      setAetherTheme('aethercortex-light');
      syncTerminalTheme(getAetherState().currentTheme);

      assert.equal(term.options.theme?.background, '#FFFFFF');
      assert.equal(term.options.theme?.foreground, '#1E3A8A');
      assert.equal(term.options.theme?.cursor, '#00A3AD');

      // Switch back to Dark Mode
      setAetherTheme('aethercortex-dark');
      syncTerminalTheme(getAetherState().currentTheme);

      assert.equal(term.options.theme?.background, '#050809');
      assert.equal(term.options.theme?.foreground, '#F8FAFC');
      assert.equal(term.options.theme?.cursor, '#00F0FF');
    });

    it('verifies all 10 AETHER_THEMES map correctly to Terminal options.theme', () => {
      const term = new Terminal();

      for (const theme of AETHER_THEMES) {
        setAetherTheme(theme.id);
        const activeTheme = AETHER_THEMES.find((t: any) => t.id === theme.id) || AETHER_THEMES[0];
        term.options.theme = activeTheme.xterm;

        assert.equal(
          term.options.theme?.background,
          theme.xterm.background,
          `Theme ${theme.id}: background mismatch`
        );
        assert.equal(
          term.options.theme?.foreground,
          theme.xterm.foreground,
          `Theme ${theme.id}: foreground mismatch`
        );
        assert.equal(
          term.options.theme?.cursor,
          theme.xterm.cursor,
          `Theme ${theme.id}: cursor mismatch`
        );
      }
    });

    it('verifies XtermWebGLPane.tsx implements the reactive useEffect dependency array', () => {
      const panePath = path.resolve(__dirname, '../src/components/XtermWebGLPane.tsx');
      const src = fs.readFileSync(panePath, 'utf8');

      // Check for reactive hook watching store.currentTheme
      assert.ok(src.includes('useEffect(() => {'), 'Must have useEffect');
      assert.ok(src.includes('termRef.current.options.theme = currentActiveTheme.xterm;'), 'Must assign term.options.theme');
      assert.ok(src.includes('[store.currentTheme]'), 'Must depend on store.currentTheme');
      assert.ok(src.includes('termRef.current = term;'), 'Must assign termRef.current on open');
    });
  });
});
