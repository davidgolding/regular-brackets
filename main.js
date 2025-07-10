// main.js
const { Plugin, MarkdownView, WorkspaceLeaf, Setting, PluginSettingTab } = require('obsidian');

// Default settings
const DEFAULT_SETTINGS = {
    bracketLinkFix: true,
    whiteCanvasMode: true
};

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// CSS for bracket link fix
const BRACKET_LINK_CSS = `
/* Bracket Link Fix - Injected by Personal Plugins */
.cm-s-obsidian span.cm-link {
    color: var(--text-normal) !important;
    text-decoration: none !important;
    cursor: text !important;
}
.cm-s-obsidian span.cm-link:hover {
    color: var(--text-normal) !important;
    text-decoration: none !important;
}
.cm-s-obsidian span.cm-link.cm-link-verified {
    color: var(--text-accent) !important;
    text-decoration: none !important;
    cursor: pointer !important;
}
.cm-s-obsidian span.cm-link.cm-link-verified:hover {
    color: var(--text-accent-hover) !important;
    text-decoration: underline !important;
}
`;

// CSS for white canvas mode
const WHITE_CANVAS_CSS = `
/* White Canvas Mode - Injected by Personal Plugins */
body:not(.is-mobile).theme-dark .workspace-tabs:not(.mod-stacked) .view-content.light-mode-active:not(.vignette-radial, .vignette-linear, .animate, .ptm-fullscreen-writing-focus-element) {
    background-color: #fff !important;
    border-top-left-radius: var(--card-border-radius-dark, 8px) !important;
    border-top-right-radius: var(--card-border-radius-dark, 8px) !important;
}
body:not(.is-mobile).theme-dark .workspace-tabs:not(.mod-stacked) .view-content.light-mode-active:not(.vignette-radial, .vignette-linear, .animate, .ptm-fullscreen-writing-focus-element) .cm-content {
    color: rgb(76, 76, 76);
}
body.theme-dark .view-content.light-mode-active .inline-title {
    color: rgb(76, 76, 76);
}
body .view-content.light-mode-active .markdown-source-view.mod-cm6 .cm-content {
    caret-color: var(--color-base-25);
}
.light-mode-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
    margin-left: 4px;
    opacity: 0.7;
    transition: opacity 0.2s ease;
}
.light-mode-toggle:hover {
    opacity: 1;
    background: var(--background-modifier-hover);
}
.light-mode-toggle.active {
    opacity: 1;
    background: var(--background-modifier-active);
}
.light-mode-toggle svg {
    width: 16px;
    height: 16px;
}
`;

// Base class for plugin modules
class PluginModule {
    constructor(plugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.enabled = false;
    }

    async enable() {
        if (this.enabled) return;
        this.enabled = true;
        await this.onEnable();
    }

    async disable() {
        if (!this.enabled) return;
        this.enabled = false;
        await this.onDisable();
    }

    async onEnable() {
        // Override in subclasses
    }

    async onDisable() {
        // Override in subclasses
    }
}

// Bracket Link Fix Module
class BracketLinkFixModule extends PluginModule {
    constructor(plugin) {
        super(plugin);
        this.styleEl = null;
        this.observer = null;
        this.debouncedApplyFix = null;
        this.debouncedResequenceFootnotes = null;
    }

    async onEnable() {
        console.log('Enabling Bracket Link Fix');
        
        // Inject CSS
        this.styleEl = document.createElement('style');
        this.styleEl.setAttribute('type', 'text/css');
        this.styleEl.textContent = BRACKET_LINK_CSS;
        document.head.appendChild(this.styleEl);

        // Initialize debounced functions
        this.debouncedApplyFix = debounce(this.applyFix.bind(this), 100);
        this.debouncedResequenceFootnotes = debounce(this.resequenceFootnotes.bind(this), 300);

        // Setup observer
        this.setupObserverAndApplyInitialFix();
        
        // Register events
        this.plugin.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    this.setupObserverAndApplyInitialFix();
                } else {
                    this.disconnectObserver();
                }
            })
        );
    }

    async onDisable() {
        console.log('Disabling Bracket Link Fix');
        
        this.disconnectObserver();
        
        if (this.styleEl) {
            this.styleEl.remove();
            this.styleEl = null;
        }
    }

    disconnectObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    setupObserverAndApplyInitialFix() {
        this.disconnectObserver();
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView?.editor?.cm?.contentDOM) return;
        
        const targetNode = activeView.editor.cm.contentDOM;
        if (targetNode) {
            const config = { childList: true, subtree: true };
            const callback = () => {
                this.debouncedApplyFix(targetNode);
                this.debouncedResequenceFootnotes();
            };
            this.observer = new MutationObserver(callback);
            this.observer.observe(targetNode, config);
            this.applyFix(targetNode);
            this.resequenceFootnotes();
        }
    }

    applyFix(targetElement) {
        if (!targetElement) return;
        
        const potentialLinks = targetElement.querySelectorAll('span.cm-link');
        let verifiedCount = 0;
        let revertedCount = 0;

        potentialLinks.forEach(span => {
            let nextNode = span.nextSibling;
            let isActualLinkSyntax = false;

            while (nextNode && nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent.trim() === '') {
                nextNode = nextNode.nextSibling;
            }

            if (nextNode && nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent.startsWith('(')) {
                isActualLinkSyntax = true;
            }

            if (isActualLinkSyntax) {
                if (!span.classList.contains('cm-link-verified')) {
                    span.classList.add('cm-link-verified');
                    verifiedCount++;
                }
            } else {
                if (span.classList.contains('cm-link-verified')) {
                    span.classList.remove('cm-link-verified');
                    revertedCount++;
                }
            }
        });
    }

    resequenceFootnotes() {
        // Placeholder for footnote resequencing logic
        // Add your existing resequenceFootnotes implementation here
    }
}

// White Canvas Mode Module
class WhiteCanvasModeModule extends PluginModule {
    constructor(plugin) {
        super(plugin);
        this.styleEl = null;
        this.activeLeaves = new Set();
    }

    async onEnable() {
        console.log('Enabling White Canvas Mode');
        
        // Inject CSS
        this.styleEl = document.createElement('style');
        this.styleEl.setAttribute('type', 'text/css');
        this.styleEl.id = 'white-canvas-mode-styles';
        this.styleEl.textContent = WHITE_CANVAS_CSS;
        document.head.appendChild(this.styleEl);

        // Add buttons to existing tabs
        this.addButtonToExistingTabs();

        // Register events
        this.plugin.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.addButtonToExistingTabs();
            })
        );
    }

    async onDisable() {
        console.log('Disabling White Canvas Mode');
        
        this.removeAllButtons();
        
        if (this.styleEl) {
            this.styleEl.remove();
            this.styleEl = null;
        }
    }

    addButtonToExistingTabs() {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        
        leaves.forEach(leaf => {
            if (!this.activeLeaves.has(leaf)) {
                this.addButtonToTab(leaf);
                this.activeLeaves.add(leaf);
            }
        });
    }

    addButtonToTab(leaf) {
        const view = leaf.view;
        if (!view || !view.containerEl) return;

        const tabHeader = leaf.tabHeaderEl;
        if (!tabHeader) return;

        if (tabHeader.querySelector('.light-mode-toggle')) return;

        const button = document.createElement('button');
        button.className = 'light-mode-toggle';
        button.setAttribute('aria-label', 'Toggle white canvas mode for this note');
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-sun-moon">
                <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"></path>
                <path d="M12 2v2"></path>
                <path d="M12 20v2"></path>
                <path d="m4.9 4.9 1.4 1.4"></path>
                <path d="m17.7 17.7 1.4 1.4"></path>
                <path d="M2 12h2"></path>
                <path d="M20 12h2"></path>
                <path d="m6.3 17.7-1.4 1.4"></path>
                <path d="m19.1 4.9-1.4 1.4"></path>
            </svg>
        `;

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleWhiteCanvas(leaf, button);
        });

        tabHeader.appendChild(button);
    }

    toggleWhiteCanvas(leaf, button) {
        const view = leaf.view;
        if (!view || !view.containerEl) return;

        const viewContent = view.containerEl.querySelector('.view-content');
        if (!viewContent) return;

        const isActive = viewContent.classList.contains('light-mode-active');
        
        if (isActive) {
            viewContent.classList.remove('light-mode-active');
            button.classList.remove('active');
            button.setAttribute('aria-label', 'Enable white canvas mode for this note');
        } else {
            viewContent.classList.add('light-mode-active');
            button.classList.add('active');
            button.setAttribute('aria-label', 'Disable white canvas mode for this note');
        }
    }

    removeAllButtons() {
        const buttons = document.querySelectorAll('.light-mode-toggle');
        buttons.forEach(button => button.remove());
        
        const viewContents = document.querySelectorAll('.view-content.light-mode-active');
        viewContents.forEach(content => content.classList.remove('light-mode-active'));
        
        this.activeLeaves.clear();
    }
}

// Settings Tab
class PersonalPluginsSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Personal Plugins Settings' });

        // Bracket Link Fix Setting
        new Setting(containerEl)
            .setName('Bracket Link Fix')
            .setDesc('Fix bracket links to only show as links when followed by parentheses')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.bracketLinkFix)
                .onChange(async (value) => {
                    this.plugin.settings.bracketLinkFix = value;
                    await this.plugin.saveSettings();
                    await this.plugin.toggleModule('bracketLinkFix', value);
                })
            );

        // White Canvas Mode Setting
        new Setting(containerEl)
            .setName('White Canvas Mode')
            .setDesc('Add toggle buttons to tabs for white background in dark mode')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.whiteCanvasMode)
                .onChange(async (value) => {
                    this.plugin.settings.whiteCanvasMode = value;
                    await this.plugin.saveSettings();
                    await this.plugin.toggleModule('whiteCanvasMode', value);
                })
            );
    }
}

// Main Plugin Class
class PersonalPluginsPlugin extends Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.modules = {};
    }

    async onload() {
        console.log('Loading Personal Plugins');

        // Load settings
        await this.loadSettings();

        // Initialize modules
        this.modules.bracketLinkFix = new BracketLinkFixModule(this);
        this.modules.whiteCanvasMode = new WhiteCanvasModeModule(this);

        // Add settings tab
        this.addSettingTab(new PersonalPluginsSettingTab(this.app, this));

        // Enable modules based on settings
        this.app.workspace.onLayoutReady(async () => {
            await this.initializeModules();
        });
    }

    async onunload() {
        console.log('Unloading Personal Plugins');
        
        // Disable all modules
        for (const module of Object.values(this.modules)) {
            await module.disable();
        }
    }

    async initializeModules() {
        for (const [key, module] of Object.entries(this.modules)) {
            if (this.settings[key]) {
                await module.enable();
            }
        }
    }

    async toggleModule(moduleKey, enabled) {
        const module = this.modules[moduleKey];
        if (!module) return;

        if (enabled) {
            await module.enable();
        } else {
            await module.disable();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

module.exports = PersonalPluginsPlugin;