// main.js
const { Plugin, MarkdownView } = require('obsidian');

// Debounce function (remains the same)
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

// Define the NEW, REVERSED CSS rules
const REVERSED_FIX_CSS = `
/* Injected by Bracket Link Fix Plugin (Reversed Logic) */

/* Default state for ALL cm-link: make them look like normal text */
.cm-s-obsidian span.cm-link {
    color: var(--text-normal) !important;
    text-decoration: none !important;
    cursor: text !important;
}
.cm-s-obsidian span.cm-link:hover {
    color: var(--text-normal) !important;
    text-decoration: none !important;
}

/* Style ONLY for VERIFIED links (when .cm-link-verified is added) */
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

class BracketLinkFixPlugin extends Plugin {
    styleEl = null; // To hold reference to our added style element
    observer = null;
    debouncedApplyFix = null;

    async onload() {
        console.log('Loading Bracket Link Fix Plugin (v4 - Reversed Logic)');

        // --- Inject CSS ---
        this.styleEl = document.createElement('style');
        this.styleEl.setAttribute('type', 'text/css');
        this.styleEl.textContent = REVERSED_FIX_CSS; // Use the reversed CSS
        document.head.appendChild(this.styleEl);
        this.register(() => {
            if (this.styleEl) {
                this.styleEl.remove();
                this.styleEl = null;
            }
            // Also, ensure any lingering .cm-link-verified classes are removed from DOM?
            // Might not be necessary if CSS handles the visual state correctly
            // and Obsidian rebuilds the relevant DOM sections on reload.
        });
        // --- End Inject CSS ---

        // Initialize debounced function
        this.debouncedApplyFix = debounce(this.applyFix.bind(this), 100);

        // Setup observer and apply fix on layout ready and leaf changes
        this.app.workspace.onLayoutReady(() => {
            this.setupObserverAndApplyInitialFix();
        });

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    this.setupObserverAndApplyInitialFix();
                } else {
                    this.disconnectObserver();
                }
            })
        );
    }

    onunload() {
        console.log('Unloading Bracket Link Fix Plugin');
        this.disconnectObserver();
        // Cleanup function registered in onload handles style removal
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
        if (!activeView?.editor?.cm?.contentDOM) { return; }
        const targetNode = activeView.editor.cm.contentDOM;

        if (targetNode) {
            const config = { childList: true, subtree: true };
             // Use a simplified observer callback
            const callback = () => {
                // Run the debounced fix on any relevant mutation
                this.debouncedApplyFix(targetNode);
            };
            this.observer = new MutationObserver(callback);
            this.observer.observe(targetNode, config);
            this.applyFix(targetNode); // Initial fix
        }
    }

    /**
     * Finds span.cm-link elements. Adds .cm-link-verified class if they ARE
     * immediately followed by '(', and removes .cm-link-verified if they are NOT.
     * @param {Element} targetElement The container element (usually cm.contentDOM) to search within.
     */
    applyFix(targetElement) {
        if (!targetElement) return;
        // console.log('Bracket Link Fix (Reversed): Running applyFix...');

        // Find all elements initially styled as links by Obsidian's editor
        const potentialLinks = targetElement.querySelectorAll('span.cm-link');
        let verifiedCount = 0;
        let revertedCount = 0;

        potentialLinks.forEach(span => {
            let nextNode = span.nextSibling;
            let isActualLinkSyntax = false;

            // Traverse past whitespace-only text nodes
            while (nextNode && nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent.trim() === '') {
                nextNode = nextNode.nextSibling;
            }

            // Check if the first meaningful node starts with '('
            if (nextNode && nextNode.nodeType === Node.TEXT_NODE && nextNode.textContent.startsWith('(')) {
                isActualLinkSyntax = true;
            }

            // ---- REVERSED LOGIC ----
            if (isActualLinkSyntax) {
                // It IS a valid link pattern -> ADD .cm-link-verified
                if (!span.classList.contains('cm-link-verified')) {
                    span.classList.add('cm-link-verified');
                    verifiedCount++;
                }
            } else {
                // It's NOT a valid link pattern -> REMOVE .cm-link-verified (if present)
                // This ensures elements default to the base .cm-link style (now normal text)
                if (span.classList.contains('cm-link-verified')) {
                    span.classList.remove('cm-link-verified');
                    revertedCount++;
                }
            }
            // ---- END REVERSED LOGIC ----
        });

        // if (verifiedCount > 0 || revertedCount > 0) {
        //     console.log(`Bracket Link Fix (Reversed): Verified ${verifiedCount}, Reverted ${revertedCount} spans.`);
        // }
    }
}

module.exports = BracketLinkFixPlugin;