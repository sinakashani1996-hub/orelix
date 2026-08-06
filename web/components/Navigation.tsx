"use client";

import {
    CalendarDays,
    ChevronDown,
    CircleHelp,
    FileText,
    Inbox,
    LayoutDashboard,
    LogOut,
    MessageSquareText,
    MoreHorizontal,
    Receipt,
    Settings,
    Users,
    Zap
} from "lucide-react";

function initials(name: string) {
    if (!name) return "??";
    return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

interface NavigationProps {
    activePath: "dashboard" | "inbox" | "quotes" | "planning" | "settings";
    organizationName: string;
    userName: string;
    openItemsCount?: number;
    onSectionChange?: (section: "inbox" | "quotes") => void;
}

export function Navigation({
                               activePath,
                               organizationName,
                               userName,
                               openItemsCount = 0,
                               onSectionChange
                           }: NavigationProps) {

    // Triggert een globale pop-up op de actieve pagina voor 'binnenkort' links
    const handleFakeNav = (e: React.MouseEvent, msg: string) => {
        e.preventDefault();
        const event = new CustomEvent("show-toast", { detail: msg });
        window.dispatchEvent(event);
    };

    const handleSectionClick = (e: React.MouseEvent, section: "inbox" | "quotes") => {
        if (onSectionChange) {
            e.preventDefault();
            onSectionChange(section);
        }
    };

    return (
        <>
            <style>{`
        .mobile-bottom-nav { display: none; }
        @media (max-width: 760px) {
          .sidebar { display: none !important; }
          .mobile-bottom-nav {
            display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 70px;
            background: var(--paper, rgba(255,255,255,0.95));
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            border-top: 1px solid var(--line, #e2e8f0);
            justify-content: space-around; align-items: center; z-index: 90;
            padding-bottom: env(safe-area-inset-bottom);
            box-shadow: 0 -4px 12px rgba(0,0,0,0.03);
          }
          .dark-theme .mobile-bottom-nav { background: rgba(18, 24, 22, 0.85); }
          .mobile-nav-item {
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            color: var(--muted, #94a3b8); text-decoration: none; font-size: 10px;
            font-weight: 600; flex: 1; transition: color 0.2s;
          }
          .mobile-nav-item.active { color: var(--mint-deep, #207253); }
          .mobile-nav-item.active svg { color: var(--mint-deep, #207253); fill: var(--sidebar-active-bg, rgba(32, 114, 83, 0.15)); }
        }
      `}</style>

            {/* --- DESKTOP SIDEBAR --- */}
            <aside className="sidebar">
                <div className="brand">
                    <span className="brand-mark">O</span>
                    <span>Orelix <strong>Office</strong></span>
                </div>

                <div className="workspace-switcher">
                    <span className="workspace-logo" style={{ background: 'var(--mint-deep)', color: '#ffffff' }}>{initials(organizationName)}</span>
                    <span><strong>{organizationName}</strong><small>Hoofdworkspace</small></span>
                    <ChevronDown size={15} />
                </div>

                <nav className="main-nav" aria-label="Hoofdnavigatie">
                    {/* OVERZICHT is nu 100% onafhankelijk. Het triggert de Inbox niet meer. */}
                    <a className={activePath === "dashboard" ? "active" : ""} href="/#overzicht">
                        <LayoutDashboard size={18} /> Overzicht
                    </a>
                    <a href="/#werk">
                        <Zap size={18} /> Werk voor jou
                        {openItemsCount > 0 && <span className="nav-count">{openItemsCount}</span>}
                    </a>
                    <a href="/#dossiers"><MessageSquareText size={18} /> Dossiers</a>
                    <a href="/#contacten"><Users size={18} /> Contacten</a>
                </nav>

                <p className="nav-kicker">ASSISTENTEN</p>
                <nav className="assistant-nav" aria-label="Assistenten">

                    {/* EXACTE VOLGORDE VAN SCREENSHOT */}

                    {/* 1. INBOX */}
                    <a href="/?section=inbox" className={activePath === "inbox" ? "assistant-active" : ""} onClick={(e) => handleSectionClick(e, "inbox")}>
                        <Inbox size={17} /> Inbox
                    </a>

                    {/* 2. OFFERTE */}
                    <a href="/?section=quotes" className={activePath === "quotes" ? "assistant-active" : ""} onClick={(e) => handleSectionClick(e, "quotes")}>
                        <FileText size={17} /> Offerte
                    </a>

                    {/* 3. PLANNING */}
                    <a href="/planning" className={activePath === "planning" ? "assistant-active" : ""}>
                        <CalendarDays size={17} /> Planning
                    </a>

                    {/* 4. FACTUUR (Met hoofdletters voor de juiste pill-styling) */}
                    <a className="muted" href="#factuur" onClick={(e) => handleFakeNav(e, "Facturatie opent binnenkort")}>
                        <Receipt size={17} /> Factuur <small>BINNENKORT</small>
                    </a>

                    {/* 5. CRM (Met hoofdletters voor de juiste pill-styling) */}
                    <a className="muted" href="#crm" onClick={(e) => handleFakeNav(e, "CRM opent binnenkort")}>
                        <Users size={17} /> CRM <small>BINNENKORT</small>
                    </a>
                </nav>

                <div className="sidebar-bottom">
                    <a href="/settings" className={activePath === "settings" ? "active" : ""}>
                        <Settings size={17} /> Instellingen
                    </a>
                    <a href="/#help"><CircleHelp size={17} /> Help & feedback</a>
                    <div className="profile">
                        <span className="profile-avatar" style={{ background: 'var(--mint-deep)' }}>{initials(userName)}</span>
                        <span><strong>{userName}</strong><small>Administrator</small></span>
                        <MoreHorizontal size={17} />
                    </div>
                    <a className="logout-link" href="/logout"><LogOut size={17} /> Uitloggen</a>
                </div>
            </aside>

            {/* --- MOBILE BOTTOM NAV --- */}
            <nav className="mobile-bottom-nav">
                <a href="/#overzicht" className={`mobile-nav-item ${activePath === "dashboard" ? "active" : ""}`}>
                    <LayoutDashboard size={22} /><span>Dashboard</span>
                </a>
                <a href="/?section=inbox" className={`mobile-nav-item ${activePath === "inbox" ? "active" : ""}`} onClick={(e) => handleSectionClick(e, "inbox")}>
                    <Inbox size={22} /><span>Inbox</span>
                </a>
                <a href="/planning" className={`mobile-nav-item ${activePath === "planning" ? "active" : ""}`}>
                    <CalendarDays size={22} /><span>Planning</span>
                </a>
                <a href="#crm" className="mobile-nav-item" onClick={(e) => handleFakeNav(e, "CRM opent binnenkort")}>
                    <Users size={22} /><span>Klanten</span>
                </a>
                <a href="/settings" className={`mobile-nav-item ${activePath === "settings" ? "active" : ""}`}>
                    <Settings size={22} /><span>Menu</span>
                </a>
            </nav>
        </>
    );
}