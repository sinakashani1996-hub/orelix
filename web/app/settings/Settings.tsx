"use client";

import {
    Bell, CalendarDays, CheckCircle2, ChevronDown, CircleHelp, FileText,
    Inbox, LayoutDashboard, MessageSquareText, MoreHorizontal, Search, Settings,
    Users, Wrench, Zap, User, Building2, Link as LinkIcon, ShieldCheck, Mail, Moon, Sun, Palette, Check
} from "lucide-react";
import { useState, useEffect, FormEvent } from "react";

function initials(name: string) {
    if (!name) return "??";
    return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

const THEME_COLORS = [
    { id: "mint", name: "Orelix Groen", hex: "#10b981" },
    { id: "blue", name: "Oceaan Blauw", hex: "#3b82f6" },
    { id: "indigo", name: "Diep Indigo", hex: "#6366f1" },
    { id: "purple", name: "Tech Paars", hex: "#a855f7" },
    { id: "pink", name: "Zacht Roze", hex: "#ec4899" },
    { id: "rose", name: "Robijn Rood", hex: "#e11d48" },
    { id: "orange", name: "Warm Oranje", hex: "#f97316" },
    { id: "amber", name: "Zonnegeel", hex: "#f59e0b" },
];

export function SettingsPage({
                                 displayName: initialDisplayName,
                                 organizationName: initialOrgName,
                                 userName: initialUserName,
                                 companyAddress: initialCompanyAddress,
                                 companyVatNumber: initialCompanyVatNumber,
                                 companyEmail: initialCompanyEmail,
                             }: {
    displayName: string;
    organizationName: string;
    userName: string;
    companyAddress: string;
    companyVatNumber: string;
    companyEmail: string;
}) {
    const [localUserName, setLocalUserName] = useState(initialUserName);
    const [localOrgName, setLocalOrgName] = useState(initialOrgName);
    const [localDisplayName, setLocalDisplayName] = useState(initialDisplayName);
    const [localEmail, setLocalEmail] = useState("info@orelix-office.com");
    const [localCompanyAddress, setLocalCompanyAddress] = useState(initialCompanyAddress);
    const [localCompanyVatNumber, setLocalCompanyVatNumber] = useState(initialCompanyVatNumber);
    const [localCompanyEmail, setLocalCompanyEmail] = useState(initialCompanyEmail);

    const [activeTab, setActiveTab] = useState<"profiel" | "workspace" | "weergave" | "integraties">("weergave");
    const [busy, setBusy] = useState<string | null>(null);
    const [toast, setToast] = useState("");
    const [searchQuery, setSearchQuery] = useState("");

    const [formUserName, setFormUserName] = useState(localUserName);
    const [formEmail, setFormEmail] = useState(localEmail);
    const [formOrgName, setFormOrgName] = useState(localOrgName);
    const [formVat, setFormVat] = useState(initialCompanyVatNumber);
    const [formAddress, setFormAddress] = useState(initialCompanyAddress);
    const [formCompanyEmail, setFormCompanyEmail] = useState(initialCompanyEmail);

    const [isDarkMode, setIsDarkMode] = useState(false);
    const [activeColorId, setActiveColorId] = useState("mint");

    useEffect(() => {
        const savedTheme = localStorage.getItem("orelix_theme");
        const savedColor = localStorage.getItem("orelix_color");
        if (savedTheme === "dark") setIsDarkMode(true);
        if (savedColor) setActiveColorId(savedColor);
    }, []);

    function showToast(message: string) {
        setToast(message);
        window.setTimeout(() => setToast(""), 4000);
    }

    function handleThemeChange(dark: boolean) {
        setIsDarkMode(dark);
        localStorage.setItem("orelix_theme", dark ? "dark" : "light");
        window.dispatchEvent(new Event("theme-change"));
    }

    function handleColorChange(colorId: string) {
        setActiveColorId(colorId);
        localStorage.setItem("orelix_color", colorId);
        window.dispatchEvent(new Event("theme-change"));
    }

    async function saveField(fieldId: string, action: () => void, successMsg: string) {
        setBusy(fieldId);
        await new Promise(resolve => setTimeout(resolve, 500));
        action();
        setBusy(null);
        showToast(successMsg);
    }

    async function saveWorkspace() {
        setBusy('workspace');
        try {
            const response = await fetch('/api/organizations', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    name: formOrgName,
                    companyAddress: formAddress,
                    companyVatNumber: formVat,
                    companyEmail: formCompanyEmail,
                }),
            });
            const data = await response.json() as { error?: string };
            if (!response.ok) throw new Error(data.error || 'Opslaan is niet gelukt');
            setLocalOrgName(formOrgName.trim());
            setLocalCompanyAddress(formAddress.trim());
            setLocalCompanyVatNumber(formVat.trim());
            setLocalCompanyEmail(formCompanyEmail.trim());
            showToast('Workspace en offertegegevens opgeslagen');
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Opslaan is niet gelukt');
        } finally {
            setBusy(null);
        }
    }

    const q = searchQuery.toLowerCase();
    const showWeergave = q === "" ? activeTab === 'weergave' : "weergave thema donker licht accentkleur kleuren interface".includes(q);
    const showProfiel = q === "" ? activeTab === 'profiel' : "profiel weergavenaam e-mailadres naam email persoonlijk".includes(q);
    const showWorkspace = q === "" ? activeTab === 'workspace' : "workspace bedrijf bedrijfsnaam btw-nummer adres hoofdkantoor".includes(q);
    const showIntegraties = q === "" ? activeTab === 'integraties' : "integraties api google workspace gmail agenda exact online yuki koppelen".includes(q);
    const isSearching = q.length > 0;
    const noResults = isSearching && !showWeergave && !showProfiel && !showWorkspace && !showIntegraties;

    return (
        <div className="app-shell">
            <style>{`
        /* BOTERZACHTE, VEER-ACHTIGE INTERACTIES (Spring Animatie) */
        .btn-save, .btn-outline, .theme-card, .settings-tab, .api-card, .color-pill {
          transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.2), 
                      background-color 0.2s ease, 
                      border-color 0.2s ease, 
                      box-shadow 0.2s ease;
        }
        
        .btn-save:active:not(:disabled), .btn-outline:active, .settings-tab:active, .theme-card:active, .color-pill:active {
          transform: scale(0.96) !important;
        }

        .settings-container { display: flex; align-items: flex-start; gap: 60px; margin-top: 24px; }
        .settings-nav { display: flex; flex-direction: column; gap: 6px; width: 220px; flex-shrink: 0; position: sticky; top: 100px; }
        .settings-tab { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; color: var(--muted); font-size: 13px; font-weight: 600; cursor: pointer; border: none; background: transparent; text-align: left; }
        .settings-tab:hover { color: var(--ink); background: var(--paper); }
        .settings-tab.active { color: var(--ink); background: var(--paper); box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid var(--line); }

        .settings-content { flex: 1; max-width: 680px; }
        .settings-content-header { margin-bottom: 32px; border-bottom: 1px solid var(--line); padding-bottom: 24px; }
        .settings-content-header h2 { font-family: var(--font-display); font-size: 22px; color: var(--ink); margin: 0 0 6px; }
        .settings-content-header p { color: var(--muted); font-size: 13px; margin: 0; }

        .setting-block { margin-bottom: 32px; animation: slideUp 0.3s ease-out; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .setting-block > h4 { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0 0 6px; }
        .setting-block > p { font-size: 13px; color: var(--muted); margin: 0 0 16px; line-height: 1.5; }
        .setting-card-inner { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }

        .input-group { margin-bottom: 16px; }
        .input-group label { display: block; font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
        .input-group input, .input-group textarea { width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--canvas); color: var(--ink); font-size: 13px; outline: none; font-family: var(--font-body); transition: border-color 0.2s, box-shadow 0.2s; }
        .input-group input:focus, .input-group textarea:focus { border-color: var(--mint-deep); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1); }

        .save-footer { display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
        .save-footer span { font-size: 12px; color: var(--muted); }

        .btn-save { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; background: var(--ink); color: var(--canvas); font-size: 12px; font-weight: 600; border: none; cursor: pointer; }
        .btn-save:hover:not(:disabled) { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .btn-save:disabled { opacity: 0.5; cursor: wait; }

        .theme-options-wrapper { display: flex; gap: 16px; }
        .theme-card { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 2px solid var(--line); border-radius: 12px; background: var(--canvas); cursor: pointer; }
        .theme-card:hover { border-color: var(--muted); }
        .theme-card.active { border-color: var(--mint-deep); background: var(--paper); }
        .theme-preview { width: 100%; height: 64px; border-radius: 6px; border: 1px solid var(--line); display: flex; overflow: hidden; }
        .theme-card-title { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 700; color: var(--ink); }

        /* DE NIEUWE, PREMIUM COLOR PILLS (Vervangt de grote bollen) */
        .color-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        @media (min-width: 500px) { .color-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (min-width: 640px) { .color-grid { grid-template-columns: repeat(4, 1fr); } }

        .color-pill {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--canvas);
          cursor: pointer;
          width: 100%;
          text-align: left;
        }
        .color-pill:hover { border-color: var(--muted); }
        .color-pill.active {
          border-color: var(--mint-deep);
          background: var(--paper);
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }
        
        .color-dot {
          width: 16px; height: 16px;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1);
        }
        .dark-theme .color-dot { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15); }
        
        .color-name {
          font-size: 12px; font-weight: 600; color: var(--ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        
        .color-check { margin-left: auto; color: var(--mint-deep); flex-shrink: 0; }

        .api-card { display: flex; align-items: center; justify-content: space-between; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); margin-bottom: 12px; }
        .api-info { display: flex; align-items: center; gap: 16px; }
        .api-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; background: var(--canvas); border: 1px solid var(--line); color: var(--ink); }
        .api-status { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; margin-top: 4px; }
        .api-status.connected { color: #10b981; }
        .api-status.disconnected { color: var(--muted); }
        .pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); animation: pulse 2s infinite; }
        @keyframes pulse { 70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }

        .btn-outline { padding: 8px 16px; background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .btn-outline:hover { background: var(--canvas); }

        .mobile-bottom-nav { display: none; }

        @media (max-width: 900px) {
          .settings-container { flex-direction: column; gap: 32px; }
          .settings-nav { width: 100%; flex-direction: row; overflow-x: auto; position: static; padding-bottom: 8px; }
          .settings-content { width: 100%; }
        }

        @media (max-width: 760px) {
          .sidebar { display: none !important; }
          .main-content { margin-left: 0; padding-bottom: 90px !important; }
          .topbar { padding: 0 16px; }
          .content-wrap { padding-top: 20px; width: calc(100% - 32px); }
          .theme-options-wrapper { flex-direction: column; }
          
          .mobile-bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 70px; background: var(--paper); border-top: 1px solid var(--line); justify-content: space-around; align-items: center; z-index: 90; padding-bottom: env(safe-area-inset-bottom); }
          .mobile-nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--muted); text-decoration: none; font-size: 10px; font-weight: 600; flex: 1; }
          .mobile-nav-item.active { color: var(--mint-deep); }
          .mobile-nav-item.active svg { color: var(--mint-deep); fill: var(--mint); }
        }
      `}</style>

            <aside className="sidebar">
                <div className="brand">
                    <span className="brand-mark">O</span>
                    <span>Orelix <strong>Office</strong></span>
                </div>
                <div className="workspace-switcher">
                    <span className="workspace-logo" style={{ background: 'var(--mint-deep)', color: '#ffffff' }}>{initials(localOrgName)}</span>
                    <span><strong>{localOrgName}</strong><small>Hoofdworkspace</small></span>
                    <ChevronDown size={15} />
                </div>
                <nav className="main-nav">
                    <a href="/"><LayoutDashboard size={18} /> Overzicht</a>
                    <a href="/#werk"><Zap size={18} /> Werk voor jou</a>
                    <a href="/#dossiers"><MessageSquareText size={18} /> Dossiers</a>
                    <a href="/#contacten"><Users size={18} /> Contacten</a>
                </nav>
                <p className="nav-kicker">ASSISTENTEN</p>
                <nav className="assistant-nav">
                    <a href="/"><FileText size={17} /> Offerte</a>
                    <a href="/#inbox"><Inbox size={17} /> Inbox <small>Bèta</small></a>
                    <a href="/#service"><Wrench size={17} /> Service <small>Bèta</small></a>
                    <a className="muted" href="/planning"><CalendarDays size={17} /> Planning</a>
                    <a className="muted" href="/#crm"><Users size={17} /> CRM</a>
                </nav>
                <div className="sidebar-bottom">
                    <a href="/settings" className="active">
                        <Settings size={17} /> Instellingen
                    </a>
                    <a href="/#help"><CircleHelp size={17} /> Help & feedback</a>
                    <div className="profile">
                        <span className="profile-avatar" style={{ background: 'var(--mint-deep)' }}>{initials(localUserName)}</span>
                        <span><strong>{localUserName}</strong><small>Administrator</small></span>
                        <MoreHorizontal size={17} />
                    </div>
                </div>
            </aside>

            <main className="main-content">
                <header className="topbar">
                    <label className="search">
                        <Search size={18} />
                        <input
                            aria-label="Zoeken"
                            placeholder="Zoek instellingen (bijv. 'Btw' of 'Kleur')..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <kbd>⌘ K</kbd>
                    </label>
                    <button className="icon-button"><Bell size={19} /></button>
                </header>

                <div className="content-wrap">
                    <div>
                        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', margin: '0 0 8px', letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                            {isSearching ? `Zoekresultaten voor "${searchQuery}"` : "Instellingen"}
                        </h1>
                        <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
                            {isSearching ? "Instellingen die overeenkomen met je zoekopdracht." : "Beheer je account, workspace en applicatievoorkeuren."}
                        </p>
                    </div>

                    <div className="settings-container">
                        {/* Navigatie (Verberg tijdens zoeken) */}
                        {!isSearching && (
                            <div className="settings-nav">
                                <button className={`settings-tab ${activeTab === 'weergave' ? 'active' : ''}`} onClick={() => setActiveTab('weergave')}>
                                    <Palette size={16}/> Weergave & Thema
                                </button>
                                <button className={`settings-tab ${activeTab === 'profiel' ? 'active' : ''}`} onClick={() => setActiveTab('profiel')}>
                                    <User size={16}/> Persoonlijk Profiel
                                </button>
                                <button className={`settings-tab ${activeTab === 'workspace' ? 'active' : ''}`} onClick={() => setActiveTab('workspace')}>
                                    <Building2 size={16}/> Workspace Beheer
                                </button>
                                <button className={`settings-tab ${activeTab === 'integraties' ? 'active' : ''}`} onClick={() => setActiveTab('integraties')}>
                                    <LinkIcon size={16}/> API & Integraties
                                </button>
                            </div>
                        )}

                        {/* RECHTER PANEEL */}
                        <div className="settings-content" style={{ width: isSearching ? '100%' : 'auto' }}>

                            {noResults && (
                                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', background: 'var(--paper)', borderRadius: '12px', border: '1px solid var(--line)' }}>
                                    <Search size={32} style={{ opacity: 0.5, margin: '0 auto 12px' }} />
                                    <p>Geen instellingen gevonden voor "{searchQuery}".</p>
                                </div>
                            )}

                            {/* TAB: WEERGAVE */}
                            {showWeergave && (
                                <div className="stagger-in">
                                    {!isSearching && (
                                        <div className="settings-content-header">
                                            <h2>Weergave & Thema</h2>
                                            <p>Beheer hoe Orelix Office er voor jou uitziet.</p>
                                        </div>
                                    )}

                                    <div className="setting-block">
                                        <h4>Interface Thema</h4>
                                        <p>Kies tussen een lichte of donkere werkomgeving. Slaat automatisch op en past zich direct aan.</p>
                                        <div className="setting-card-inner">
                                            <div className="theme-options-wrapper">
                                                <button className={`theme-card ${!isDarkMode ? 'active' : ''}`} onClick={() => handleThemeChange(false)}>
                                                    <div className="theme-preview" style={{ background: '#f8fafc', borderColor: '#e2e8f0' }}>
                                                        <div style={{ width: '25%', background: '#0f172a' }}></div>
                                                        <div style={{ width: '75%', background: '#ffffff', borderTopLeftRadius: '8px', borderTop: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0' }}></div>
                                                    </div>
                                                    <div className="theme-card-title">
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Sun size={16} color="var(--muted)"/> Licht</span>
                                                        {!isDarkMode && <CheckCircle2 size={18} color="var(--mint-deep)" />}
                                                    </div>
                                                </button>
                                                <button className={`theme-card ${isDarkMode ? 'active' : ''}`} onClick={() => handleThemeChange(true)}>
                                                    <div className="theme-preview" style={{ background: '#020617', borderColor: '#1e293b' }}>
                                                        <div style={{ width: '25%', background: '#020617' }}></div>
                                                        <div style={{ width: '75%', background: '#0f172a', borderTopLeftRadius: '8px', borderTop: '1px solid #1e293b', borderLeft: '1px solid #1e293b' }}></div>
                                                    </div>
                                                    <div className="theme-card-title">
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Moon size={16} color="var(--muted)"/> Donker</span>
                                                        {isDarkMode && <CheckCircle2 size={18} color="var(--mint-deep)" />}
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="setting-block">
                                        <h4>Accentkleur</h4>
                                        <p>Pas de primaire merkkleur van het platform aan naar jouw voorkeur.</p>
                                        <div className="setting-card-inner">

                                            {/* DE VERNIEUWDE, PROFESSIONELE COLOR PILL GRID */}
                                            <div className="color-grid">
                                                {THEME_COLORS.map(color => (
                                                    <button
                                                        key={color.id}
                                                        className={`color-pill ${activeColorId === color.id ? 'active' : ''}`}
                                                        onClick={() => handleColorChange(color.id)}
                                                        type="button"
                                                    >
                                                        <div className="color-dot" style={{ backgroundColor: color.hex }}></div>
                                                        <span className="color-name">{color.name}</span>
                                                        {activeColorId === color.id && <Check size={16} className="color-check" />}
                                                    </button>
                                                ))}
                                            </div>

                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB: PROFIEL */}
                            {showProfiel && (
                                <div className="stagger-in">
                                    {!isSearching && (
                                        <div className="settings-content-header">
                                            <h2>Persoonlijk Profiel</h2>
                                            <p>Beheer je persoonlijke instellingen en contactgegevens.</p>
                                        </div>
                                    )}
                                    <div className="setting-block">
                                        <form className="setting-card-inner" onSubmit={(e) => { e.preventDefault(); saveField('profile', () => { setLocalUserName(formUserName); setLocalDisplayName(formUserName.split(" ")[0]); setLocalEmail(formEmail); }, "Profiel succesvol bijgewerkt"); }}>
                                            <div className="input-group">
                                                <label>Weergavenaam</label>
                                                <input value={formUserName} onChange={(e) => setFormUserName(e.target.value)} required />
                                            </div>
                                            <div className="input-group" style={{ marginBottom: 0 }}>
                                                <label>E-mailadres</label>
                                                <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} required />
                                            </div>
                                            <div className="save-footer">
                                                <span>Beide velden zijn vereist voor login.</span>
                                                <button
                                                    type="submit"
                                                    className="btn-save"
                                                    disabled={busy === 'profile' || (formUserName === localUserName && formEmail === localEmail)}
                                                >
                                                    {busy === 'profile' ? "Opslaan..." : "Wijzigingen opslaan"}
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            )}

                            {/* TAB: WORKSPACE */}
                            {showWorkspace && (
                                <div className="stagger-in">
                                    {!isSearching && (
                                        <div className="settings-content-header">
                                            <h2>Workspace Beheer</h2>
                                            <p>Configureer de bedrijfsgegevens van deze Orelix-omgeving. Zichtbaar voor alle teamleden.</p>
                                        </div>
                                    )}
                                    <div className="setting-block">
                                        <form className="setting-card-inner" onSubmit={(e) => { e.preventDefault(); void saveWorkspace(); }}>
                                            <div className="input-group">
                                                <label>Bedrijfsnaam (Workspace)</label>
                                                <input value={formOrgName} onChange={(e) => setFormOrgName(e.target.value)} required />
                                            </div>
                                            <div className="input-group">
                                                <label>Btw-nummer</label>
                                                <input value={formVat} onChange={(e) => setFormVat(e.target.value)} />
                                            </div>
                                            <div className="input-group">
                                                <label>Algemeen e-mailadres</label>
                                                <input type="email" value={formCompanyEmail} onChange={(e) => setFormCompanyEmail(e.target.value)} placeholder="info@jouwbedrijf.be" />
                                            </div>
                                            <div className="input-group" style={{ marginBottom: 0 }}>
                                                <label>Hoofdkantoor Adres</label>
                                                <textarea rows={3} value={formAddress} onChange={(e) => setFormAddress(e.target.value)} />
                                            </div>
                                            <div className="save-footer">
                                                <span>Wordt gebruikt voor documentgeneratie en facturatie.</span>
                                                <button
                                                    type="submit"
                                                    className="btn-save"
                                                    disabled={busy === 'workspace' || (formOrgName === localOrgName && formVat === localCompanyVatNumber && formAddress === localCompanyAddress && formCompanyEmail === localCompanyEmail)}
                                                >
                                                    {busy === 'workspace' ? "Opslaan..." : "Wijzigingen opslaan"}
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            )}

                            {/* TAB: INTEGRATIES */}
                            {showIntegraties && (
                                <div className="stagger-in">
                                    {!isSearching && (
                                        <div className="settings-content-header">
                                            <h2>API & Integraties</h2>
                                            <p>Verbind Orelix veilig met je bestaande software via OAuth2 protocollen.</p>
                                        </div>
                                    )}
                                    <div className="api-card">
                                        <div className="api-info">
                                            <div className="api-icon"><Mail size={22} /></div>
                                            <div>
                                                <strong style={{ fontSize: '14px', color: 'var(--ink)', display: 'block' }}>Google Workspace (Gmail)</strong>
                                                <div className="api-status connected"><span className="pulse-dot"></span> Beveiligd verbonden</div>
                                            </div>
                                        </div>
                                        <button className="btn-outline">Beheren</button>
                                    </div>
                                    <div className="api-card">
                                        <div className="api-info">
                                            <div className="api-icon"><CalendarDays size={22} /></div>
                                            <div>
                                                <strong style={{ fontSize: '14px', color: 'var(--ink)', display: 'block' }}>Google Agenda API</strong>
                                                <div className="api-status connected"><span className="pulse-dot"></span> Real-time sync actief</div>
                                            </div>
                                        </div>
                                        <button className="btn-outline">Ontkoppelen</button>
                                    </div>
                                    <div className="api-card">
                                        <div className="api-info">
                                            <div className="api-icon"><ShieldCheck size={22} /></div>
                                            <div>
                                                <strong style={{ fontSize: '14px', color: 'var(--ink)', display: 'block' }}>Exact Online / Yuki</strong>
                                                <div className="api-status disconnected">Niet geconfigureerd</div>
                                            </div>
                                        </div>
                                        <button className="btn-save" style={{ margin: 0 }}>Koppeling Maken</button>
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            </main>

            {toast && (
                <div className="toast" role="status">
                    <CheckCircle2 size={18} /> {toast}
                </div>
            )}

            <nav className="mobile-bottom-nav">
                <a href="/" className="mobile-nav-item"><LayoutDashboard size={22} /><span>Dashboard</span></a>
                <a href="#inbox" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setToast("Inbox opent binnenkort"); }}><Inbox size={22} /><span>Inbox</span></a>
                <a href="/planning" className="mobile-nav-item"><CalendarDays size={22} /><span>Planning</span></a>
                <a href="#crm" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setToast("CRM opent binnenkort"); }}><Users size={22} /><span>Klanten</span></a>
                <a href="/settings" className="mobile-nav-item active"><Settings size={22} /><span>Menu</span></a>
            </nav>

        </div>
    );
}
