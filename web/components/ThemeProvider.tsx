"use client";
import { useEffect, useState } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);

        const applyTheme = () => {
            const isDark = localStorage.getItem("orelix_theme") === "dark";
            const colorId = localStorage.getItem("orelix_color") || "mint";
            const root = document.documentElement;

            // HET VOLLEDIGE, UITGEBREIDE KLEURENPALET
            const colors: Record<string, { deep: string, bg: string }> = {
                mint: { deep: "#10b981", bg: "rgba(16, 185, 129, 0.15)" },
                blue: { deep: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
                indigo: { deep: "#6366f1", bg: "rgba(99, 102, 241, 0.15)" },
                purple: { deep: "#a855f7", bg: "rgba(168, 85, 247, 0.15)" },
                pink: { deep: "#ec4899", bg: "rgba(236, 72, 153, 0.15)" },
                rose: { deep: "#e11d48", bg: "rgba(225, 29, 72, 0.15)" },
                orange: { deep: "#f97316", bg: "rgba(249, 115, 22, 0.15)" },
                amber: { deep: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" }
            };

            const c = colors[colorId] || colors.mint;

            if (isDark) {
                root.style.setProperty('--canvas', '#090e11');
                root.style.setProperty('--sidebar', '#121816');
                root.style.setProperty('--paper', '#16201d');
                root.style.setProperty('--ink', '#ffffff');
                root.style.setProperty('--line', '#1c2824');
                root.style.setProperty('--muted', '#a1b0ab');
                root.style.setProperty('--sidebar-muted', '#788c88');
                root.classList.add('dark-theme');
            } else {
                root.style.removeProperty('--canvas');
                root.style.removeProperty('--sidebar');
                root.style.removeProperty('--paper');
                root.style.removeProperty('--ink');
                root.style.removeProperty('--line');
                root.style.removeProperty('--muted');
                root.style.removeProperty('--sidebar-muted');
                root.classList.remove('dark-theme');
            }

            if (colorId !== "mint") {
                root.style.setProperty('--mint-deep', c.deep);
            } else {
                root.style.removeProperty('--mint-deep');
            }

            root.style.setProperty('--sidebar-active-bg', c.bg);
        };

        window.addEventListener('theme-change', applyTheme);
        return () => window.removeEventListener('theme-change', applyTheme);
    }, []);

    const themeScript = `
    (function() {
      try {
        var isDark = localStorage.getItem("orelix_theme") === "dark";
        var colorId = localStorage.getItem("orelix_color") || "mint";
        var root = document.documentElement;
        
        var colors = {
          mint: { deep: "#10b981", bg: "rgba(16, 185, 129, 0.15)" },
          blue: { deep: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
          indigo: { deep: "#6366f1", bg: "rgba(99, 102, 241, 0.15)" },
          purple: { deep: "#a855f7", bg: "rgba(168, 85, 247, 0.15)" },
          pink: { deep: "#ec4899", bg: "rgba(236, 72, 153, 0.15)" },
          rose: { deep: "#e11d48", bg: "rgba(225, 29, 72, 0.15)" },
          orange: { deep: "#f97316", bg: "rgba(249, 115, 22, 0.15)" },
          amber: { deep: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" }
        };
        var c = colors[colorId] || colors.mint;

        if (isDark) {
          root.style.setProperty('--canvas', '#090e11');
          root.style.setProperty('--sidebar', '#121816');
          root.style.setProperty('--paper', '#16201d');
          root.style.setProperty('--ink', '#ffffff');
          root.style.setProperty('--line', '#1c2824');
          root.style.setProperty('--muted', '#a1b0ab');
          root.style.setProperty('--sidebar-muted', '#788c88');
          root.classList.add('dark-theme');
        }
        
        if (colorId !== "mint") {
          root.style.setProperty('--mint-deep', c.deep);
        }
        root.style.setProperty('--sidebar-active-bg', c.bg);
      } catch (e) {}
    })();
  `;

    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: themeScript }} />
            <style>{`
        /* GLOBALE ACCENT KLEUREN */
        .brand-mark, .workspace-logo, .profile-avatar, .quote-ready-icon { background: var(--mint-deep) !important; color: #ffffff !important; }
        .primary-button, .approve-button, .btn-save, .save-btn, .fab-trigger { background: var(--mint-deep) !important; color: #ffffff !important; border: none !important; }
        .notification-dot, .status-dot { background: var(--mint-deep) !important; border: none !important; box-shadow: none !important; }
        .text-button:hover, .manage-button:hover, .insight-card button { color: var(--mint-deep) !important; }

        /* ZIJBALK FIX */
        .main-nav a.active, .sidebar-bottom > a.active { background: var(--sidebar-active-bg) !important; color: #ffffff !important; border: none !important; border-radius: 8px !important; font-weight: inherit !important; }
        .main-nav a.active svg, .sidebar-bottom > a.active svg { color: var(--mint-deep) !important; }

        /* MAILBOX KOPPELING FIX */
        .mail-status.disconnected { border-color: var(--line) !important; background: var(--paper) !important; }
        .mail-status.disconnected strong { color: var(--ink) !important; }
        .mail-status.disconnected svg { color: var(--muted) !important; }
        .gmail-mark { background: var(--mint-deep) !important; color: #ffffff !important; }
        .mail-status.disconnected .gmail-mark { background: var(--paper) !important; color: var(--mint-deep) !important; border: 1px solid var(--line); }

        /* LIJNEN OVERSCHRIJVEN IN DARK MODE */
        .dark-theme .module-row, 
        .dark-theme .status-tabs,
        .dark-theme .work-list-header,
        .dark-theme .work-item, 
        .dark-theme .work-item-skeleton, 
        .dark-theme .module-row-skeleton,
        .dark-theme .quote-lines,
        .dark-theme .quote-line,
        .dark-theme .quote-totals .quote-grand-total,
        .dark-theme .mail-metadata,
        .dark-theme .quote-builder-footer { 
          border-color: var(--line) !important; 
        }

        /* DONKERE MODUS STRUCTUUR */
        .dark-theme .topbar { background: rgba(18, 24, 22, 0.85) !important; border-bottom-color: var(--line) !important; }
        .dark-theme .search, .dark-theme .icon-button { background: var(--canvas) !important; border-color: var(--line) !important; color: var(--ink) !important; }
        .dark-theme .search input { color: var(--ink) !important; }
        .dark-theme .search input::placeholder { color: var(--muted) !important; }
        .dark-theme .search kbd { background: var(--paper) !important; border-color: var(--line) !important; color: var(--muted) !important; }
        
        .dark-theme .work-panel, .dark-theme .assistants-card, .dark-theme .insight-card, .dark-theme .planning-hero { background: var(--paper) !important; border-color: var(--line) !important; }
        .dark-theme .metric-grid article, .dark-theme .structured-event, .dark-theme .empty-state { background: var(--paper) !important; border-color: var(--line) !important; box-shadow: none !important; }
        .dark-theme .structured-event:hover { background: var(--canvas) !important; }
        .dark-theme .mail-status { background: var(--canvas) !important; border-color: var(--line) !important; color: var(--ink) !important; }
        .dark-theme .mail-status:hover { border-color: var(--mint-deep) !important; }
        
        /* TYPOGRAFIE & TEKST CONTRAST */
        .dark-theme h1, .dark-theme h2, .dark-theme h3, .dark-theme strong, .dark-theme b, .dark-theme .se-title { color: #ffffff !important; }
        .dark-theme p:not(.eyebrow), 
        .dark-theme span:not(.module-tag):not(.nav-count):not(.record-state):not(.beta-state):not(.soon-state):not(.live-state):not(.switch-count):not(.chip-count) { 
          color: #a1b0ab !important; 
        }
        .dark-theme .work-copy strong, .dark-theme .work-copy b { color: #ffffff !important; }
        .dark-theme .day-header { color: #ffffff !important; border-bottom-color: var(--line) !important; }
        
        /* HELDER CONTRAST VOOR ASSISTENTEN & BADGES IN DARK MODE */
        .dark-theme .beta-state, .dark-theme .soon-state { background: #1e2d29 !important; color: #f8fafc !important; border: 1px solid #2a3a35 !important; }
        .dark-theme .live-state { background: rgba(16, 185, 129, 0.15) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.2) !important; }
        .dark-theme .live-state i { background: #10b981 !important; }

        .dark-theme .module-icon.quote_assistant { background: rgba(44, 119, 90, 0.25) !important; color: #4ade80 !important; }
        .dark-theme .module-icon.inbox_assistant { background: rgba(55, 107, 161, 0.25) !important; color: #60a5fa !important; }
        .dark-theme .module-icon.service_assistant { background: rgba(120, 91, 155, 0.25) !important; color: #c084fc !important; }
        .dark-theme .module-icon.planning_assistant { background: rgba(163, 107, 54, 0.25) !important; color: #fbbf24 !important; }
        .dark-theme .module-icon.crm_assistant { background: rgba(138, 102, 98, 0.25) !important; color: #f87171 !important; }

        /* Lades en Formulieren */
        .dark-theme .detail-drawer, .dark-theme .fab-form-panel { background: var(--paper) !important; border-color: var(--line) !important; box-shadow: -10px 0 50px rgba(0,0,0,0.6) !important; }
        .dark-theme .drawer-header { border-bottom-color: var(--line) !important; }
        .dark-theme .customer-strip, .dark-theme .assignment-control, .dark-theme .quote-builder { background: var(--canvas) !important; border-color: var(--line) !important; }
        .dark-theme .drawer-section-grid { background: var(--canvas) !important; border-color: var(--line) !important; }
        .dark-theme .message-pane { background: var(--canvas) !important; border-color: var(--line) !important; }
        .dark-theme .original-pane { background: var(--sidebar) !important; }
        .dark-theme .drawer-actions { background: var(--paper) !important; border-top-color: var(--line) !important; }
        .dark-theme pre, .dark-theme textarea, .dark-theme input, .dark-theme select { background: var(--canvas) !important; border-color: var(--line) !important; color: var(--ink) !important; }
        .dark-theme .secondary-button, .dark-theme .contact-btn { background: var(--canvas) !important; border-color: var(--line) !important; color: var(--ink) !important; }
        .dark-theme .quote-action-button { background: var(--canvas) !important; border-color: var(--line) !important; color: var(--ink) !important; }
        .dark-theme .quote-action-button.success { color: #7fd4ae !important; }
        .dark-theme .quote-action-button.danger { color: #f0a495 !important; }
        .dark-theme .quote-actions { border-bottom-color: var(--line) !important; }
        .dark-theme .work-label { color: #e8cf8e !important; background: #453b1e !important; }
        .dark-theme .row-menu { background: var(--paper) !important; border-color: var(--line) !important; }
        .dark-theme .row-menu button { color: var(--ink) !important; }
        .dark-theme .row-menu button:hover, .dark-theme .row-menu-button:hover { background: var(--canvas) !important; }
        .dark-theme .row-menu button.danger, .dark-theme .secondary-button.danger { color: #f0a495 !important; }
        .dark-theme .work-list-header { background: var(--canvas) !important; }
        .dark-theme .workspace-switch { background: var(--canvas) !important; }
        .dark-theme .workspace-switch button { color: var(--muted) !important; }
        .dark-theme .workspace-switch button.active { color: var(--canvas) !important; background: var(--ink) !important; box-shadow: none !important; }
        .dark-theme .switch-count { background: var(--paper) !important; color: var(--muted) !important; }
        .dark-theme .workspace-switch button.active .switch-count { background: var(--canvas) !important; color: var(--ink) !important; }
        .dark-theme .panel-search { border-color: var(--line) !important; background: var(--canvas) !important; color: var(--muted) !important; }
        .dark-theme .panel-search input { color: var(--ink) !important; }
        .dark-theme .status-tabs button { color: var(--muted) !important; }
        .dark-theme .status-tabs button:hover { color: var(--ink) !important; }
        .dark-theme .status-tabs button.active { border-bottom-color: var(--mint-deep) !important; color: var(--ink) !important; }
        .dark-theme .status-tabs button.active span { color: var(--muted) !important; }

        .dark-theme .metric-icon.coral { background: rgba(239, 68, 68, 0.15) !important; color: #ef4444 !important; }
        .dark-theme .metric-icon.blue { background: rgba(59, 130, 246, 0.15) !important; color: #3b82f6 !important; }
        .dark-theme .metric-icon.lilac { background: rgba(168, 85, 247, 0.15) !important; color: #a855f7 !important; }
      `}</style>
            {mounted && children}
        </>
    );
}