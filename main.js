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
    debouncedResequenceFootnotes = null;

    async onload() {
        console.log('Loading Bracket Link Fix Plugin (v5 - with Footnote Resequencing)');

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
        });
        // --- End Inject CSS ---

        // Initialize debounced functions
        this.debouncedApplyFix = debounce(this.applyFix.bind(this), 100);
        this.debouncedResequenceFootnotes = debounce(this.resequenceFootnotes.bind(this), 300);

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
                // Run both debounced functions on any relevant mutation
                this.debouncedApplyFix(targetNode);
                this.debouncedResequenceFootnotes();
            };
            this.observer = new MutationObserver(callback);
            this.observer.observe(targetNode, config);
            this.applyFix(targetNode); // Initial fix
            this.resequenceFootnotes(); // Initial footnote check
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

    /**
     * Resequences footnotes in the current document to ensure they are numbered
     * sequentially starting from 1. Updates both inline references [^n] and
     * footnote definitions [^n]: to maintain proper linking.
     */
    resequenceFootnotes() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView?.editor) return;

        const editor = activeView.editor;
        const content = editor.getValue();
        
        // Regex patterns for footnotes
        const footnoteRefPattern = /\[\^([^\]]+)\]/g;
        const footnoteDefPattern = /^\[\^([^\]]+)\]:\s*/gm;
        
        // Find all footnote references in order of appearance
        const footnoteRefs = [];
        const footnoteRefsMap = new Map(); // Maps original ID to new sequential number
        let match;
        
        // Collect all footnote references in document order
        footnoteRefPattern.lastIndex = 0;
        while ((match = footnoteRefPattern.exec(content)) !== null) {
            const originalId = match[1];
            if (!footnoteRefsMap.has(originalId)) {
                const newNumber = footnoteRefsMap.size + 1;
                footnoteRefsMap.set(originalId, newNumber);
                footnoteRefs.push({ originalId, newNumber, index: match.index });
            }
        }
        
        // Find all footnote definitions
        const footnoteDefs = [];
        footnoteDefPattern.lastIndex = 0;
        while ((match = footnoteDefPattern.exec(content)) !== null) {
            const originalId = match[1];
            if (footnoteRefsMap.has(originalId)) {
                footnoteDefs.push({ 
                    originalId, 
                    newNumber: footnoteRefsMap.get(originalId),
                    index: match.index,
                    fullMatch: match[0]
                });
            }
        }
        
        // Check if resequencing is needed
        let needsResequencing = false;
        let expectedNumber = 1;
        
        for (const ref of footnoteRefs) {
            if (ref.newNumber !== expectedNumber || isNaN(parseInt(ref.originalId))) {
                needsResequencing = true;
                break;
            }
            expectedNumber++;
        }
        
        // Also check if any footnote definitions are out of order or missing
        if (!needsResequencing) {
            const defNumbers = footnoteDefs.map(def => parseInt(def.originalId)).filter(n => !isNaN(n));
            const expectedDefs = Array.from({length: footnoteRefs.length}, (_, i) => i + 1);
            if (defNumbers.length !== expectedDefs.length || 
                !defNumbers.every((num, index) => num === expectedDefs[index])) {
                needsResequencing = true;
            }
        }
        
        if (!needsResequencing || footnoteRefs.length === 0) {
            return; // No resequencing needed
        }
        
        console.log(`Footnote Resequencing: Processing ${footnoteRefs.length} footnotes`);
        
        // Create the updated content
        let updatedContent = content;
        
        // Sort replacements by index in reverse order to avoid offset issues
        const allReplacements = [];
        
        // Add footnote reference replacements
        footnoteRefPattern.lastIndex = 0;
        while ((match = footnoteRefPattern.exec(content)) !== null) {
            const originalId = match[1];
            if (footnoteRefsMap.has(originalId)) {
                const newNumber = footnoteRefsMap.get(originalId);
                allReplacements.push({
                    index: match.index,
                    length: match[0].length,
                    replacement: `[^${newNumber}]`
                });
            }
        }
        
        // Add footnote definition replacements
        footnoteDefPattern.lastIndex = 0;
        while ((match = footnoteDefPattern.exec(content)) !== null) {
            const originalId = match[1];
            if (footnoteRefsMap.has(originalId)) {
                const newNumber = footnoteRefsMap.get(originalId);
                allReplacements.push({
                    index: match.index,
                    length: match[0].length,
                    replacement: `[^${newNumber}]: `
                });
            }
        }
        
        // Sort by index in descending order and apply replacements
        allReplacements.sort((a, b) => b.index - a.index);
        
        for (const replacement of allReplacements) {
            updatedContent = 
                updatedContent.slice(0, replacement.index) + 
                replacement.replacement + 
                updatedContent.slice(replacement.index + replacement.length);
        }
        
        // Only update if content actually changed
        if (updatedContent !== content) {
            const cursor = editor.getCursor();
            editor.setValue(updatedContent);
            editor.setCursor(cursor); // Restore cursor position
            console.log(`Footnote Resequencing: Updated ${allReplacements.length} footnote references and definitions`);
        }
    }
}

module.exports = BracketLinkFixPlugin;