"use client";

import {
    ArrowRight,
    Bell,
    Calendar,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    FileText,
    Inbox,
    LayoutDashboard,
    LogOut,
    MapPin,
    MessageSquareText,
    MoreHorizontal,
    Phone,
    Mail,
    Plus,
    Search,
    Settings,
    Users,
    Wrench,
    Zap,
    X,
    Save,
    AlignLeft,
    Sparkles,
    Route,
    Clock,
    CarFront,
    Check
} from "lucide-react";
import { useState, useRef, FormEvent, useMemo, useEffect } from "react";

const SUGGESTED_CITIES = [
    "Aalst, België", "Antwerpen, België", "Bonheiden, België", "Brugge, België", "Brussel, België",
    "Genk, België", "Gent, België", "Hasselt, België", "Kortrijk, België", "Leuven, België",
    "Mechelen, België", "Oostende, België", "Roeselare, België", "Sint-Niklaas, België"
];

type EventStatus = "scheduled" | "unscheduled";

type Event = {
    id: string;
    status: EventStatus;
    title: string;
    customerName: string;
    date: string;
    rawDate: string;
    startTime: string;
    endTime: string;
    location: string;
    assignee: string;
    type: "installation" | "maintenance" | "survey";
    week: "this_week" | "next_week" | "later";
    phone?: string;
    email?: string;
    notes?: string;
    // Extra velden voor de ongeplande taken (Laag 1)
    originalRequest?: string;
    preferredDays?: string;
};

type GoogleCalendarApiEvent = {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
};

const initialMockEvents: Event[] = [
    // --- ONGEPLANDE TAKEN (Inkomend uit Inbox/CRM) ---
    {
        id: "evt_unsched_1",
        status: "unscheduled",
        title: "Dringend Onderhoud Warmtepomp",
        customerName: "Karel Vervoort",
        date: "",
        rawDate: "",
        startTime: "",
        endTime: "",
        location: "Duffel, België", // Dichtbij Mechelen
        assignee: "",
        type: "maintenance",
        week: "this_week",
        phone: "+32 471 11 22 33",
        email: "karel.vervoort@gmail.com",
        originalRequest: "Beste,\n\nOnze warmtepomp maakt sinds gisteren een vreemd tikkend geluid en de druk is weggevallen. Kunnen jullie zo snel mogelijk iemand sturen?\n\nAlvast bedankt,\nKarel",
        preferredDays: "Zo snel mogelijk"
    },
    {
        id: "evt_unsched_2",
        status: "unscheduled",
        title: "Plaatsbezoek Zonnepanelen (Nieuwbouw)",
        customerName: "Familie Dubois",
        date: "",
        rawDate: "",
        startTime: "",
        endTime: "",
        location: "Brasschaat, België",
        assignee: "",
        type: "survey",
        week: "this_week",
        phone: "+32 499 88 77 66",
        email: "fam.dubois@telenet.be",
        originalRequest: "Goedemiddag. Via jullie website had ik graag een offerte aangevraagd voor 14 panelen op onze nieuwbouw. Wanneer kan er iemand langskomen om het dak te bekijken? Wij zijn meestal thuis op vrijdagochtend.",
        preferredDays: "Vrijdagochtend"
    },

    // --- GEPLANDE TAKEN (Agenda) ---
    {
        id: "evt_1",
        status: "scheduled",
        title: "Installatie Zonnepanelen (12st)",
        customerName: "Janssens BV",
        date: "Vandaag",
        rawDate: new Date().toISOString().split('T')[0],
        startTime: "08:30",
        endTime: "16:00",
        location: "Kerkstraat 44, Antwerpen, België",
        assignee: "Team A",
        type: "installation",
        week: "this_week",
        phone: "+32 470 12 34 56",
        email: "info@janssensbv.be",
        notes: "Klant wil de omvormer graag in de garage naast de meterkast gemonteerd hebben."
    },
    {
        id: "evt_2",
        status: "scheduled",
        title: "Vervanging Omvormer",
        customerName: "De Smet",
        date: "Vandaag",
        rawDate: new Date().toISOString().split('T')[0],
        startTime: "13:00",
        endTime: "15:00",
        location: "Gent, België",
        assignee: "Team B",
        type: "maintenance",
        week: "this_week",
        phone: "+32 486 98 76 54",
        email: "desmet.j@telenet.be",
        notes: "Omvormer geeft foutcode E-34. Nieuw toestel ligt klaar in de bestelwagen."
    },
    {
        id: "evt_3",
        status: "scheduled",
        title: "Plaatsbezoek Offerte",
        customerName: "Familie Peeters",
        date: "Morgen",
        rawDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        startTime: "10:00",
        endTime: "11:30",
        location: "Brusselsesteenweg 12, Mechelen, België",
        assignee: "Jan Verkoper",
        type: "survey",
        week: "this_week",
        phone: "+32 495 11 22 33",
        email: "fam.peeters@gmail.com",
        notes: "Schuin dak, zuidgericht. Controleer of de huidige meterkast een 3-fase aansluiting heeft."
    }
];

function initials(name: string) {
    return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function calendarEventToPlanningEvent(event: GoogleCalendarApiEvent): Event | null {
    const startValue = event.start?.dateTime || event.start?.date;
    if (!startValue) return null;
    const start = new Date(startValue);
    if (Number.isNaN(start.getTime())) return null;
    const endValue = event.end?.dateTime || event.end?.date;
    const end = endValue ? new Date(endValue) : null;
    return {
        id: `google_${event.id}`,
        status: "scheduled",
        title: event.summary || "Afspraak uit Google Agenda",
        customerName: "Google Agenda",
        date: start.toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long" }),
        rawDate: start.toISOString().slice(0, 10),
        startTime: event.start?.dateTime ? start.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) : "Hele dag",
        endTime: event.end?.dateTime && end && !Number.isNaN(end.getTime()) ? end.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) : "",
        location: event.location || "Geen locatie opgegeven",
        assignee: "Google Agenda",
        type: "survey",
        week: "this_week",
        notes: event.description || "",
    };
}

export function Planning({
                             displayName,
                             organizationName,
                             userName,
                         }: {
    displayName: string;
    organizationName: string;
    userName: string;
}) {
    const [query, setQuery] = useState("");
    const [filterWeek, setFilterWeek] = useState<"this_week" | "next_week" | "all">("this_week");

    const [calendarConnected, setCalendarConnected] = useState(false);
    const [calendarEmail, setCalendarEmail] = useState("");
    const [busy, setBusy] = useState(false);
    const [events, setEvents] = useState<Event[]>(initialMockEvents);
    const [toast, setToast] = useState("");

    // UI States
    const [isFabOpen, setIsFabOpen] = useState(false);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

    // AI Planning States
    const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);

    // FAB Drag State
    const [fabPos, setFabPos] = useState({ x: 0, y: 0 });
    const dragRef = useRef({ active: false, isDragging: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });

    // Formulier state (Voor handmatige bewerkingen)
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [newTitle, setNewTitle] = useState("");
    const [newCustomer, setNewCustomer] = useState("");
    const [newDate, setNewDate] = useState("");
    const [newTime, setNewTime] = useState("");
    const [newLocation, setNewLocation] = useState("");
    const [newNotes, setNewNotes] = useState("");

    const [filteredCities, setFilteredCities] = useState<string[]>([]);
    const [showCitySuggestions, setShowCitySuggestions] = useState(false);

    const selectedEvent = events.find((evt) => evt.id === selectedEventId) ?? null;

    useEffect(() => {
        let cancelled = false;
        async function loadCalendar() {
            try {
                const response = await fetch("/api/integrations/google-calendar?events=upcoming");
                if (response.status === 401) {
                    window.location.assign("/?auth=session-expired");
                    return;
                }
                const data = await response.json() as {
                    connected?: boolean;
                    accountEmail?: string;
                    events?: GoogleCalendarApiEvent[];
                };
                if (cancelled) return;
                setCalendarConnected(Boolean(data.connected));
                setCalendarEmail(data.accountEmail || "");
                if (data.connected && data.events?.length) {
                    const calendarEvents = data.events
                        .map(calendarEventToPlanningEvent)
                        .filter((event): event is Event => Boolean(event));
                    setEvents((current) => [
                        ...current.filter((event) => !event.id.startsWith("google_")),
                        ...calendarEvents,
                    ]);
                }
            } catch {
                // The planner remains usable with its existing Orelix tasks
                // when Google Agenda is temporarily unavailable.
            }
        }
        void loadCalendar();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const status = new URLSearchParams(window.location.search).get("calendar");
        if (!status) return;
        const messages: Record<string, string> = {
            connected: "Google Agenda is gekoppeld. Je komende afspraken zijn geladen.",
            "workspace-required": "Maak eerst een workspace voordat je Google Agenda koppelt.",
            "setup-required": "Google Agenda is nog niet geconfigureerd door je beheerder.",
            "account-in-use": "Deze Google Agenda is al gekoppeld aan een andere workspace.",
            "token-exchange": "Google kon de koppeling niet afronden. Probeer opnieuw.",
            "no-refresh-token": "Google gaf geen blijvende toegang. Koppel de agenda opnieuw.",
            failed: "De koppeling met Google Agenda is niet gelukt.",
        };
        window.history.replaceState({}, "", window.location.pathname);
        showToast(messages[status] || "De koppeling met Google Agenda is niet afgerond.");
    }, []);

    // Wanneer een ongeplande taak wordt geopend, start de "AI Analyse" animatie
    useEffect(() => {
        if (selectedEvent?.status === 'unscheduled') {
            setIsAiAnalyzing(true);
            const timer = setTimeout(() => {
                setIsAiAnalyzing(false);
            }, 1800); // 1.8 seconden 'nadenken' voor het premium gevoel
            return () => clearTimeout(timer);
        }
    }, [selectedEvent]);

    // --- HARDWARE ACCELERATED POINTER EVENTS VOOR DE FAB ---
    const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { active: true, isDragging: false, startX: e.clientX, startY: e.clientY, initialX: fabPos.x, initialY: fabPos.y };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!dragRef.current.active) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        if (!dragRef.current.isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) { dragRef.current.isDragging = true; }
        if (dragRef.current.isDragging) { setFabPos({ x: dragRef.current.initialX + dx, y: dragRef.current.initialY + dy }); }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!dragRef.current.active) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragRef.current.active = false;
        if (!dragRef.current.isDragging) { setIsFabOpen(true); }
        dragRef.current.isDragging = false;
    };

    function showToast(message: string) {
        setToast(message);
        window.setTimeout(() => setToast(""), 4000);
    }

    function handleCloseDrawer() {
        setSelectedEventId(null);
        setIsAiAnalyzing(false);
    }

    function handleCloseForm() {
        setIsFabOpen(false);
        setEditingEventId(null);
        setNewTitle(""); setNewCustomer(""); setNewDate(""); setNewTime(""); setNewLocation(""); setNewNotes("");
        setShowCitySuggestions(false);
    }

    function handleEditClick() {
        if (!selectedEvent) return;
        setEditingEventId(selectedEvent.id);
        setNewTitle(selectedEvent.title);
        setNewCustomer(selectedEvent.customerName);
        setNewDate(selectedEvent.rawDate || new Date().toISOString().split('T')[0]);
        setNewTime(selectedEvent.startTime);
        setNewLocation(selectedEvent.location !== "Kantoor / Op locatie" ? selectedEvent.location : "");
        setNewNotes(selectedEvent.notes || "");
        setSelectedEventId(null);
        setIsFabOpen(true);
    }

    function handleLocationChange(e: React.ChangeEvent<HTMLInputElement>) {
        const val = e.target.value;
        setNewLocation(val);
        const parts = val.split(",");
        const currentQuery = parts[parts.length - 1].trim().toLowerCase();
        if (currentQuery.length > 0) {
            const matches = SUGGESTED_CITIES.filter(city => city.toLowerCase().includes(currentQuery));
            setFilteredCities(matches);
            setShowCitySuggestions(matches.length > 0);
        } else { setShowCitySuggestions(false); }
    }

    function handleSelectCity(cityAndCountry: string) {
        const parts = newLocation.split(",");
        if (parts.length > 1) {
            parts[parts.length - 1] = " " + cityAndCountry;
            setNewLocation(parts.join(",").trim());
        } else { setNewLocation(cityAndCountry); }
        setShowCitySuggestions(false);
    }

    async function toggleCalendarConnection() {
        if (!calendarConnected) {
            window.location.assign("/api/integrations/google-calendar/start");
            return;
        }
        if (!window.confirm("Google Agenda ontkoppelen? Nieuwe afspraken worden dan niet meer gesynchroniseerd.")) {
            return;
        }
        setBusy(true);
        try {
            const response = await fetch("/api/integrations/google-calendar", { method: "DELETE" });
            if (!response.ok) throw new Error("Ontkoppelen is niet gelukt");
            setCalendarConnected(false);
            setCalendarEmail("");
            setEvents((current) => current.filter((event) => !event.id.startsWith("google_")));
            showToast("Google Agenda ontkoppeld");
        } catch {
            showToast("Google Agenda kon niet worden ontkoppeld. Probeer opnieuw.");
        } finally {
            setBusy(false);
        }
    }

    // Accepteer het AI Voorstel
    async function handleAcceptAiProposal() {
        if (!selectedEvent) return;
        setBusy(true);
        await new Promise((resolve) => setTimeout(resolve, 600)); // Simulatie opslaan

        setEvents(events.map(evt => evt.id === selectedEvent.id ? {
            ...evt,
            status: "scheduled",
            date: "Morgen",
            rawDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            startTime: "13:00",
            endTime: "14:30",
            assignee: "Team A",
            notes: evt.originalRequest // Verplaats originele request naar notities voor het team
        } : evt));

        showToast("Slim voorstel geaccepteerd en ingepland!");
        handleCloseDrawer();
        setBusy(false);
    }

    async function handleSaveEvent(e: FormEvent) {
        e.preventDefault();
        if (!newTitle || !newCustomer) { showToast("Vul minstens een titel en klant in."); return; }
        setBusy(true);
        await new Promise((resolve) => setTimeout(resolve, 600));

        const displayDate = newDate ? new Date(newDate).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' }) : "Vandaag";
        const finalLocation = newLocation.trim() !== "" ? newLocation : "Kantoor / Op locatie";
        const rawDateVal = newDate || new Date().toISOString().split('T')[0];

        if (calendarConnected) {
            const startTime = newTime || "09:00";
            const start = new Date(`${rawDateVal}T${startTime}:00`);
            const end = new Date(start.getTime() + 90 * 60 * 1000);
            try {
                const response = await fetch("/api/integrations/google-calendar", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        title: newTitle,
                        description: newNotes,
                        location: finalLocation,
                        startDateTime: start.toISOString(),
                        endDateTime: end.toISOString(),
                    }),
                });
                if (!response.ok) throw new Error("Afspraak kon niet naar Google Agenda");
            } catch {
                showToast("De afspraak is niet opgeslagen in Google Agenda. Controleer je koppeling.");
                setBusy(false);
                return;
            }
        }

        if (editingEventId) {
            setEvents(events.map(evt => evt.id === editingEventId ? {
                ...evt, status: "scheduled", title: newTitle, customerName: newCustomer, date: newDate ? displayDate : evt.date, rawDate: rawDateVal, startTime: newTime || evt.startTime, location: finalLocation, notes: newNotes
            } : evt));
            showToast("Afspraak succesvol bijgewerkt");
        } else {
            const newEvent: Event = {
                id: `evt_${Date.now()}`, status: "scheduled", title: newTitle, customerName: newCustomer, date: displayDate, rawDate: rawDateVal, startTime: newTime || "09:00", endTime: "12:00", location: finalLocation, assignee: "Nieuwe Toewijzing", type: "maintenance", week: filterWeek === "all" ? "this_week" : filterWeek, phone: "+32 400 00 00 00", email: "klant@domein.be", notes: newNotes
            };
            setEvents([...events, newEvent]);
            showToast("Nieuwe afspraak succesvol ingepland");
        }
        handleCloseForm();
        setBusy(false);
    }

    const unscheduledEvents = useMemo(() => events.filter(e => e.status === "unscheduled"), [events]);

    const groupedScheduledEvents = useMemo(() => {
        let filtered = events.filter(evt => evt.status === "scheduled" && (evt.title.toLowerCase().includes(query.toLowerCase()) || evt.customerName.toLowerCase().includes(query.toLowerCase())));
        if (filterWeek !== "all") filtered = filtered.filter(evt => evt.week === filterWeek);
        const groups: Record<string, Event[]> = {};
        filtered.forEach(evt => {
            if (!groups[evt.date]) groups[evt.date] = [];
            groups[evt.date].push(evt);
        });
        Object.keys(groups).forEach(date => groups[date].sort((a, b) => a.startTime.localeCompare(b.startTime)));
        return groups;
    }, [events, query, filterWeek]);

    return (
        <div className="app-shell">
            <style>{`
        /* VLOEIENDE INTERACTIES */
        button:not(.draggable-fab) { transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease; }
        button:active:not(:disabled):not(.draggable-fab) { transform: scale(0.96) !important; }

        .planning-hero { display: grid; grid-template-columns: 1fr auto; gap: 20px; background: var(--paper); padding: 30px; border-radius: 16px; border: 1px solid var(--line); margin-bottom: 32px; }
        .planning-hero h1 { color: var(--ink); }
        .planning-hero p.eyebrow { color: var(--mint-deep); }
        .planning-hero p:not(.eyebrow) { color: var(--muted); }

        /* LIJSTEN & HEADERS */
        .section-heading-row { display: flex; justify-content: space-between; align-items: flex-end; padding: 0 0 16px; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
        .section-heading-row h2 { font-family: var(--font-display); font-size: 18px; color: var(--ink); margin:0; }
        
        .unscheduled-lane { margin-bottom: 40px; }
        .unscheduled-card { 
          background: rgba(16, 185, 129, 0.05); 
          border: 1px solid rgba(16, 185, 129, 0.2); 
          border-radius: 12px; padding: 16px 20px; 
          display: flex; align-items: center; justify-content: space-between; 
          cursor: pointer; transition: all 0.2s ease;
          margin-bottom: 8px;
        }
        .dark-theme .unscheduled-card { background: rgba(16, 185, 129, 0.1); }
        .unscheduled-card:hover { transform: translateX(4px); border-color: var(--mint-deep); background: rgba(16, 185, 129, 0.1); }
        .uc-left { display: flex; align-items: center; gap: 16px; }
        .uc-icon { width: 40px; height: 40px; border-radius: 10px; background: var(--mint-deep); color: white; display: grid; place-items: center; }
        .uc-text h4 { margin: 0 0 4px; font-size: 14px; color: var(--ink); }
        .uc-text p { margin: 0; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }

        .day-group { margin-bottom: 30px; }
        .day-header { font-size: 14px; font-weight: 800; color: var(--ink); padding-bottom: 10px; margin-bottom: 12px; border-bottom: 2px solid var(--line); display: flex; align-items: center; gap: 8px; }
        .day-header .event-count { background: var(--line); color: var(--muted); padding: 2px 8px; border-radius: 12px; font-size: 11px; }

        .structured-list { display: flex; flex-direction: column; gap: 8px; }
        .structured-event { display: grid; grid-template-columns: 100px minmax(220px, 1.5fr) 160px 130px 110px 24px; align-items: center; gap: 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 12px 20px; cursor: pointer; transition: background 0.2s, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .structured-event:hover { background: var(--canvas); border-color: var(--muted); }

        .se-time { font-weight: 700; color: var(--ink); font-size: 13px; display: flex; align-items: center; gap: 6px; }
        .se-time small { color: var(--muted); font-weight: 500; font-size: 11px; }
        .se-details { display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
        .se-title { font-weight: 700; font-size: 13px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .se-customer, .se-location { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .se-location { display: flex; align-items: center; gap: 6px; }
        .se-mobile-meta { display: none; }
        
        .empty-state { background: var(--paper) !important; border-color: var(--line) !important; }
        .empty-state strong { color: var(--ink); }
        .empty-state span { color: var(--muted); }

        /* DRAGGABLE FAB */
        .interactive-fab-container { position: absolute; z-index: 101; }
        .draggable-fab {
          position: fixed; bottom: 40px; right: 40px; width: 56px; height: 56px; border-radius: 50%;
          background: var(--mint-deep); color: white; border: none; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3); cursor: grab; z-index: 110; will-change: transform;
          transition: box-shadow 0.25s ease, opacity 0.25s ease !important; touch-action: none; 
        }
        .draggable-fab:active { cursor: grabbing; box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
        .draggable-fab.hidden { opacity: 0; pointer-events: none; }

        /* BACKDROP */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px); z-index: 100; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
        .modal-overlay.is-active { opacity: 1; pointer-events: auto; }
        
        /* FORMULIER PANEL */
        .fab-form-panel {
          position: fixed; top: 80px; right: 34px; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 110px);
          overflow-y: auto; background: var(--paper); border: 1px solid var(--line); border-radius: 16px;
          box-shadow: 0 30px 60px rgba(0,0,0,0.4); transform-origin: top right; opacity: 0; transform: scale(0.96) translateY(-10px);
          pointer-events: none; z-index: 105; transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fab-form-panel::-webkit-scrollbar { display: none; }
        .fab-form-panel { -ms-overflow-style: none; scrollbar-width: none; }
        .fab-form-panel.is-open { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }
        
        .fab-form-panel h3, .fab-form-panel span, .fab-form-panel input, .fab-form-panel textarea { color: var(--ink) !important; }
        .fab-form-panel input, .fab-form-panel textarea { background: var(--canvas) !important; border-color: var(--line) !important; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
        .fab-form-panel input:focus, .fab-form-panel textarea:focus { border-color: var(--mint-deep) !important; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1) !important;}
        .fab-form-panel .icon-button { background: var(--canvas) !important; border-color: var(--line) !important; color: var(--ink) !important; }
        
        /* =========================================================
           DE NIEUWE "3-LAYERS" AI DRAWER (GEÏNSPIREERD OP DASHBOARD)
           ========================================================= */
       
        .detail-drawer { 
          background: var(--paper) !important; border-left: 1px solid var(--line); 
          width: min(800px, 100vw) !important; 
          z-index: 105 !important; /* FIX: Zorgt dat de lade BOVEN de blur ligt */
        }
        .drawer-header h2 { color: var(--ink) !important; }
        .customer-strip { background: var(--canvas) !important; border-color: var(--line) !important; }
        .customer-strip strong { color: var(--ink) !important; }
        .customer-strip small { color: var(--muted) !important; }
        .contact-btn { background: var(--paper) !important; border-color: var(--line) !important; color: var(--ink) !important; }

        .message-comparison {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: var(--line);
          border: 1px solid var(--line);
          border-radius: 12px;
          margin: 0 24px 24px;
          overflow: hidden;
        }

        .message-pane { background: var(--canvas); padding: 24px; display: flex; flex-direction: column; }
        .message-pane-heading { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        .message-pane-heading h3 { font-size: 16px; color: var(--ink); margin: 6px 0 0; }
        .drawer-label { font-size: 10px; font-weight: 700; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; margin:0; }

        /* Linker Paneel (Origineel) */
        .original-pane { background: var(--sidebar); }
        .original-message { font-family: var(--font-body); font-size: 13px; line-height: 1.6; color: var(--muted); white-space: pre-wrap; margin: 0; }
        
        /* Rechter Paneel (AI Planner) */
        .ai-planner-pane { position: relative; }
        
        /* AI Loading State */
        .ai-loading-overlay {
          position: absolute; inset: 0; background: var(--canvas);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 16px; z-index: 10;
        }
        .glowing-brain {
          width: 60px; height: 60px; border-radius: 50%;
          background: rgba(16, 185, 129, 0.1);
          display: grid; place-items: center;
          color: var(--mint-deep);
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
          animation: brainPulse 1.5s infinite cubic-bezier(0.66, 0, 0, 1);
        }
        @keyframes brainPulse { to { box-shadow: 0 0 0 30px rgba(16, 185, 129, 0); } }
        .ai-loading-overlay p { color: var(--mint-deep); font-weight: 600; font-size: 13px; margin:0; animation: pulseText 1.5s infinite; }
        @keyframes pulseText { 50% { opacity: 0.5; } }

        /* AI Resultaat (Het Voorstel) */
        .ai-proposal-card {
          background: var(--paper); border: 1px solid var(--mint-deep); border-radius: 12px;
          padding: 20px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.1);
          animation: slideUpFade 0.4s ease-out forwards;
        }
        @keyframes slideUpFade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        .ai-insight-row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
        .ai-insight-icon { color: var(--mint-deep); flex-shrink: 0; margin-top: 2px; }
        .ai-insight-text { font-size: 13px; color: var(--ink); line-height: 1.5; margin: 0; }
        
        .ai-slot-box {
          background: rgba(16, 185, 129, 0.08); border-radius: 8px; padding: 16px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .ai-slot-detail { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); font-weight: 600; }
        .ai-slot-detail svg { color: var(--muted); }

        .drawer-actions { background: var(--paper) !important; border-top-color: var(--line) !important; padding: 24px; display: flex; gap: 12px; }
        .secondary-button { flex: 1; padding: 12px; border-radius: 10px; font-weight: 600; font-size: 13px; background: var(--canvas); color: var(--ink); border: 1px solid var(--line); text-align: center; cursor: pointer; }
        .approve-button { flex: 2; padding: 12px; border-radius: 10px; font-weight: 600; font-size: 13px; background: var(--mint-deep); color: white; border: none; text-align: center; cursor: pointer; display: flex; justify-content: center; gap: 8px; }

        .mobile-bottom-nav { display: none; }
        .header-add-btn, .header-quote-btn { white-space: nowrap; }
        .header-quote-btn { display: flex; height: 39px; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); background: var(--paper); font-size: 12px; font-weight: 700; text-decoration: none; }
        .header-quote-btn:hover { border-color: var(--mint-deep); color: var(--mint-deep); }

        @media (max-width: 1024px) {
          .structured-event { grid-template-columns: 90px 1fr 130px 110px 24px; }
          .se-location { display: none; }
        }

        @media (max-width: 760px) {
          .sidebar { display: none !important; }
          .main-content { margin-left: 0; padding-bottom: 90px !important; }
          .topbar { padding: 0 16px; }
          .content-wrap { padding-top: 20px; width: calc(100% - 32px); }
          .header-add-btn, .header-quote-btn { display: none !important; }

          .mobile-bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 70px; background: var(--paper); border-top: 1px solid var(--line); justify-content: space-around; align-items: center; z-index: 90; padding-bottom: env(safe-area-inset-bottom); }
          .mobile-nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--muted); text-decoration: none; font-size: 10px; font-weight: 600; flex: 1; }
          .mobile-nav-item.active { color: var(--mint-deep); }
          .mobile-nav-item.active svg { color: var(--mint-deep); fill: var(--mint); }
          
          .fab-form-panel { top: 70px; right: 16px; width: calc(100vw - 32px); }

          /* Stack 3-layers pane on mobile */
          .message-comparison { grid-template-columns: 1fr; margin: 0 16px 16px; }
          .detail-drawer { width: 100vw !important; }
          .drawer-actions { padding: 16px; }

          .planning-hero { grid-template-columns: 1fr; padding: 20px; text-align: center; }
          .planning-hero p.eyebrow { margin-top: 0; }
          .planning-hero p { margin-inline: auto; }
          .mail-status-wrap { width: 100%; justify-content: center; margin-top: 10px;}
          .mail-status { width: 100%; justify-content: flex-start; }
          .structured-event { grid-template-columns: 60px 1fr 20px; padding: 14px 16px; gap: 12px; align-items: flex-start; }
          .se-time { flex-direction: column; align-items: flex-start; gap: 2px; margin-top: 2px; }
          .desktop-only { display: none; }
          .se-mobile-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
          .filter-row { padding-bottom: 8px; overflow-x: auto; white-space: nowrap; }
        }
      `}</style>

            {/* GEDEELDE ACHTERGROND BLUR VOOR ZOWEL FORMULIER ALS DETAILS POP-UP */}
            <div className={`modal-overlay ${(isFabOpen || selectedEvent) ? 'is-active' : ''}`} onClick={() => { handleCloseForm(); handleCloseDrawer(); }} />

            <aside className="sidebar">
                <div className="brand">
                    <span className="brand-mark">O</span>
                    <span>Orelix <strong>Office</strong></span>
                </div>
                <div className="workspace-switcher">
                    <span className="workspace-logo">{initials(organizationName)}</span>
                    <span><strong>{organizationName}</strong><small>Hoofdworkspace</small></span>
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
                    <a className="muted" href="/#inbox"><Inbox size={17} /> Inbox <small>Bèta</small></a>
                    <a className="muted" href="/#service"><Wrench size={17} /> Service <small>Bèta</small></a>
                    <a className="assistant-active" href="/planning"><CalendarDays size={17} /> Planning <span className="status-dot" /></a>
                    <a className="muted" href="/#crm"><Users size={17} /> CRM</a>
                </nav>
                <div className="sidebar-bottom">
                    <a href="/settings"><Settings size={17} /> Instellingen</a>
                    <a href="/#help"><CircleHelp size={17} /> Help & feedback</a>
                    <div className="profile">
                        <span className="profile-avatar">{initials(userName)}</span>
                        <span><strong>{userName}</strong><small>Administrator</small></span>
                        <MoreHorizontal size={17} />
                    </div>
                    <a className="logout-link" href="/logout"><LogOut size={17} /> Uitloggen</a>
                </div>
            </aside>

            <main className="main-content" id="planning">
                <header className="topbar">
                    <label className="search">
                        <Search size={18} />
                        <input aria-label="Zoeken" placeholder="Zoek afspraak of klant..." value={query} onChange={(e) => setQuery(e.target.value)} />
                        <kbd>⌘ K</kbd>
                    </label>
                    <button className="icon-button"><Bell size={19} /></button>
                    <a className="header-quote-btn" href="/?newQuote=true">
                        <FileText size={17} /> Nieuwe offerte
                    </a>
                    <button className="primary-button header-add-btn" onClick={() => setIsFabOpen(true)}>
                        <Plus size={17} /> Nieuwe afspraak
                    </button>
                </header>

                <div className="content-wrap">
                    <section className="planning-hero" style={{ animationDelay: '0.1s' }}>
                        <div>
                            <p className="eyebrow">TEAM CAPACITEIT & PLANNING</p>
                            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', margin: '8px 0 8px', letterSpacing: '-0.02em' }}>De Slimme Agenda.</h1>
                            <p style={{ fontSize: '13px', maxWidth: '500px', lineHeight: '1.5' }}>Een strak overzicht van alle taken. Koppel de agenda om dubbele boekingen te voorkomen en het team efficiënt aan te sturen.</p>
                        </div>
                        <div className="mail-status-wrap" style={{ alignSelf: 'center' }}>
                            <button className={`mail-status ${calendarConnected ? "connected" : "disconnected"}`} onClick={toggleCalendarConnection} disabled={busy === true} style={{ cursor: busy ? "wait" : "pointer", textAlign: "left", padding: '12px 16px', borderRadius: '12px', minWidth: '220px' }}>
                                <span className="gmail-mark" style={{ width: '32px', height: '32px' }}><Calendar size={16} /></span>
                                <span>
                  <strong style={{ fontSize: '12px' }}>{busy ? "Verwerken..." : calendarConnected ? "Agenda verbonden" : "Agenda koppelen"}</strong>
                  <small style={{ fontSize: '10px', marginTop: '2px' }}>{calendarConnected ? (calendarEmail || "Synchronisatie is actief") : "Klik om te koppelen"}</small>
                </span>
                                {calendarConnected ? <CheckCircle2 size={18} color="var(--mint-deep)" /> : <ArrowRight size={18} color="var(--muted)" />}
                            </button>
                        </div>
                    </section>

                    {/* LAAG 1 IN DE HOOFDVIEW: ONGEPLANDE TAKEN */}
                    {unscheduledEvents.length > 0 && query === "" && (
                        <div className="unscheduled-lane">
                            <div className="section-heading-row">
                                <h2>Nog in te plannen</h2>
                                <span className="module-tag planning_assistant">{unscheduledEvents.length} aanvragen wachten op een tijdslot</span>
                            </div>
                            <div className="unscheduled-list">
                                {unscheduledEvents.map(evt => (
                                    <div key={evt.id} className="unscheduled-card" onClick={() => setSelectedEventId(evt.id)}>
                                        <div className="uc-left">
                                            <div className="uc-icon"><Sparkles size={20}/></div>
                                            <div className="uc-text">
                                                <h4>{evt.title}</h4>
                                                <p><MapPin size={12}/> {evt.location} &nbsp;•&nbsp; <Clock size={12}/> {evt.preferredDays}</p>
                                            </div>
                                        </div>
                                        <ChevronRight size={20} color="var(--mint-deep)"/>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="section-heading-row" style={{ marginTop: '24px' }}>
                        <h2>Aankomende afspraken</h2>
                        <div className="filter-row" style={{ padding: 0, borderBottom: "none", marginBottom: "-8px" }}>
                            <button className={filterWeek === "this_week" ? "selected" : ""} onClick={() => setFilterWeek("this_week")}>Deze week</button>
                            <button className={filterWeek === "next_week" ? "selected" : ""} onClick={() => setFilterWeek("next_week")}>Volgende week</button>
                            <button className={filterWeek === "all" ? "selected" : ""} onClick={() => setFilterWeek("all")}>Alles bekijken</button>
                        </div>
                    </div>

                    <div>
                        {Object.keys(groupedScheduledEvents).length === 0 ? (
                            <div className="empty-state" style={{ borderRadius: '12px', border: '1px solid var(--line)', padding: '40px' }}>
                                <CalendarDays size={28} />
                                <strong>Geen afspraken gevonden</strong>
                                <span>{filterWeek === "next_week" ? "Geen taken gepland voor volgende week." : "Probeer een andere weergave."}</span>
                            </div>
                        ) : (
                            Object.entries(groupedScheduledEvents).map(([date, dayEvents]) => (
                                <div key={date} className="day-group">
                                    <div className="day-header">{date} <span className="event-count">{dayEvents.length}</span></div>
                                    <div className="structured-list">
                                        {dayEvents.map((evt) => (
                                            <div key={evt.id} className="structured-event" onClick={() => setSelectedEventId(evt.id)}>
                                                <div className="se-time">{evt.startTime} <small>{evt.endTime}</small></div>
                                                <div className="se-details">
                                                    <span className="se-title">{evt.title}</span>
                                                    <span className="se-customer">{evt.customerName}</span>
                                                    <div className="se-mobile-meta">
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--muted)' }}><MapPin size={10} /> {evt.location}</span>
                                                        <span className={`module-tag ${evt.type === 'installation' ? 'service_assistant' : 'quote_assistant'}`} style={{ padding: '2px 6px', fontSize: '9px' }}>
                              {evt.type === 'installation' ? 'Installatie' : evt.type === 'maintenance' ? 'Onderhoud' : 'Plaatsbezoek'}
                            </span>
                                                    </div>
                                                </div>
                                                <div className="se-location"><MapPin size={13} /> {evt.location}</div>
                                                <div className="desktop-only"><span className={`module-tag ${evt.type === 'installation' ? 'service_assistant' : 'quote_assistant'}`} style={{ padding: '4px 8px', fontSize: '10px' }}>{evt.type === 'installation' ? 'Installatie' : evt.type === 'maintenance' ? 'Onderhoud' : 'Plaatsbezoek'}</span></div>
                                                <div className="desktop-only"><span className="record-state record-state-sent" style={{ padding: '4px 8px', fontSize: '10px', background: 'var(--canvas)', color: 'var(--muted)' }}>{evt.assignee}</span></div>
                                                <div style={{ justifySelf: 'end' }}><ChevronRight size={18} color="var(--muted)" /></div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </main>

            {/* DE 3-LAYERS DRAWER (Voor zowel Ongeplande als Geplande items) */}
            {selectedEvent && (
                <>
                    <button className="drawer-backdrop" aria-label="Sluiten" onClick={handleCloseDrawer} />
                    <aside className="detail-drawer" aria-label="Afspraak details">

                        <div className="drawer-header">
                            <div>
                <span className={`module-tag ${selectedEvent.type === 'installation' ? 'service_assistant' : 'quote_assistant'}`}>
                  {selectedEvent.status === 'unscheduled' ? 'Nieuwe Aanvraag (Nog in te plannen)' : (selectedEvent.type === 'installation' ? 'Installatie' : selectedEvent.type === 'maintenance' ? 'Onderhoud' : 'Plaatsbezoek')}
                </span>
                                <h2>{selectedEvent.title}</h2>
                            </div>
                            <button className="icon-button" onClick={handleCloseDrawer} aria-label="Sluiten"><X size={20} /></button>
                        </div>

                        <div className="customer-strip" style={{ margin: '0 24px 24px' }}>
                            <span className={`avatar ${selectedEvent.type === 'installation' ? 'service_assistant' : 'quote_assistant'}`}>{initials(selectedEvent.customerName)}</span>
                            <span style={{ minWidth: 0 }}>
                <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedEvent.customerName}</strong>
                <small style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedEvent.phone ?? "Geen nummer"} • {selectedEvent.email ?? "Geen e-mail"}</small>
              </span>
                            <div className="contact-actions" style={{ display: 'flex', gap: '8px' }}>
                                <button className="contact-btn" onClick={() => showToast(`Bellen naar ${selectedEvent?.phone ?? 'klant'}...`)}><Phone size={15}/></button>
                                <button className="contact-btn" onClick={() => showToast(`Nieuwe mail naar ${selectedEvent?.email ?? 'klant'}...`)}><Mail size={15}/></button>
                            </div>
                        </div>

                        {/* --- DE 3 LAGEN LOGICA (AI PLANNER VIEW VS NORMALE VIEW) --- */}
                        {selectedEvent.status === 'unscheduled' ? (

                            // LAAG 2 & 3: AI PLANNER SPLIT VIEW
                            <div className="message-comparison">
                                {/* Links: Originele Context (Klantverzoek) */}
                                <section className="message-pane original-pane">
                                    <div className="message-pane-heading">
                                        <div>
                                            <p className="drawer-label">HET VERZOEK</p>
                                            <h3>Ingekomen via E-mail</h3>
                                        </div>
                                        <Mail size={18} color="var(--muted)" />
                                    </div>
                                    <pre className="original-message">{selectedEvent.originalRequest}</pre>

                                    <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                        <p className="drawer-label">GEWENSTE MOMENTEN</p>
                                        <p style={{ fontSize: '13px', color: 'var(--ink)', margin: '4px 0 0', fontWeight: 600 }}>{selectedEvent.preferredDays}</p>
                                    </div>
                                </section>

                                {/* Rechts: AI Planner & Voorstel */}
                                <section className="message-pane ai-planner-pane">
                                    <div className="message-pane-heading">
                                        <div>
                                            <p className="drawer-label">SLIMME PLANNING</p>
                                            <h3>AI Voorstel</h3>
                                        </div>
                                        <Sparkles size={18} color="var(--mint-deep)" />
                                    </div>

                                    {isAiAnalyzing ? (
                                        <div className="ai-loading-overlay">
                                            <div className="glowing-brain"><Sparkles size={28} /></div>
                                            <p>Agenda en locaties analyseren...</p>
                                        </div>
                                    ) : (
                                        <div className="ai-proposal-card">
                                            <div className="ai-insight-row">
                                                <Route size={18} className="ai-insight-icon" />
                                                <p className="ai-insight-text">
                                                    <strong>Perfecte route:</strong> Team A is morgenochtend al in de buurt van {selectedEvent.location.split(',')[0]} (12 min reistijd).
                                                </p>
                                            </div>

                                            <div className="ai-slot-box">
                                                <div className="ai-slot-detail"><CalendarDays size={16}/> Morgen (Vrijdag)</div>
                                                <div className="ai-slot-detail"><Clock size={16}/> 13:00 - 14:30 (1,5 uur gereserveerd)</div>
                                                <div className="ai-slot-detail"><CarFront size={16}/> Toegewezen aan <strong>Team A</strong></div>
                                            </div>
                                        </div>
                                    )}
                                </section>
                            </div>

                        ) : (

                            // NORMALE VIEW VOOR GEPLANDE TAKEN
                            <>
                                <div className="drawer-section" style={{ padding: '0 24px 24px' }}>
                                    <p className="drawer-label">PLANNING & LOCATIE</p>
                                    <div className="drawer-section-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
                                        <div>
                                            <strong style={{ display: 'block', fontSize: '10px', marginBottom: '4px' }}>Datum & Tijd</strong>
                                            <span style={{ fontSize: '12px', fontWeight: 600 }}>{selectedEvent.date}</span><br/>
                                            <span style={{ fontSize: '11px' }}>{selectedEvent.startTime} - {selectedEvent.endTime}</span>
                                        </div>
                                        <div>
                                            <strong style={{ display: 'block', fontSize: '10px', marginBottom: '4px' }}>Adres</strong>
                                            <span style={{ fontSize: '12px', fontWeight: 600 }}>{selectedEvent.location}</span><br/>
                                            <span style={{ fontSize: '11px', color: 'var(--mint-deep)', cursor: 'pointer' }}>Open in Maps ↗</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="drawer-section grow" style={{ padding: '0 24px 24px' }}>
                                    <p className="drawer-label">OPMERKINGEN VOOR TEAM</p>
                                    <div style={{ padding: '16px', border: '1px solid var(--line)', borderRadius: '12px', minHeight: '120px' }}>
                                        <p style={{ fontSize: '12px', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap' }}>{selectedEvent.notes || "Geen extra opmerkingen toegevoegd voor deze afspraak."}</p>
                                    </div>
                                </div>
                            </>

                        )}

                        {/* ACTIE KNOPPEN ONDERAAN */}
                        <div className="drawer-actions">
                            <button className="secondary-button" onClick={handleCloseDrawer}>Sluiten</button>

                            {selectedEvent.status === 'unscheduled' ? (
                                <button className="approve-button" disabled={isAiAnalyzing || busy} onClick={handleAcceptAiProposal}>
                                    {busy ? "Inplannen..." : (isAiAnalyzing ? "Analyseren..." : <><Check size={16} /> Voorstel Accepteren</>)}
                                </button>
                            ) : (
                                <button className="approve-button" onClick={handleEditClick}><Wrench size={16} /> Afspraak wijzigen</button>
                            )}
                        </div>

                    </aside>
                </>
            )}

            {/* DRAGGABLE FAB KNOP MET REACT POINTER EVENTS */}
            <button
                className={`draggable-fab ${isFabOpen ? 'hidden' : ''}`}
                title="Nieuwe afspraak inplannen"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ transform: `translate3d(${fabPos.x}px, ${fabPos.y}px, 0)` }}
            >
                <Plus size={24} />
            </button>

            {/* VASTE FORMULIER PANEL */}
            <div className={`fab-form-panel ${isFabOpen ? 'is-open' : ''}`} style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>{editingEventId ? "Afspraak bewerken" : "Nieuwe afspraak"}</h3>
                        <span style={{ display: "block", marginTop: "4px", fontSize: "12px" }}>{editingEventId ? "Pas de gegevens hieronder aan." : "Plan direct een nieuwe taak in."}</span>
                    </div>
                    <button className="icon-button" style={{ border: 'none', width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0 }} onClick={handleCloseForm}><X size={16} /></button>
                </div>

                <form style={{ display: "flex", flexDirection: "column", gap: '16px' }} onSubmit={handleSaveEvent}>
                    <label style={{ display: 'block', margin: 0 }}>
                        <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', letterSpacing: 'normal' }}>Titel afspraak</span>
                        <input style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', outline: 'none' }} placeholder="Bijv. Onderhoud zonnepanelen" value={newTitle} onChange={e => setNewTitle(e.target.value)} required />
                    </label>

                    <label style={{ display: 'block', margin: 0 }}>
                        <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', letterSpacing: 'normal' }}>Klant of Referentie</span>
                        <input style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', outline: 'none' }} placeholder="Bedrijfsnaam of klantnaam" value={newCustomer} onChange={e => setNewCustomer(e.target.value)} required />
                    </label>

                    <label style={{ display: 'block', margin: 0, position: 'relative' }}>
                        <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', letterSpacing: 'normal' }}>Locatie (Optioneel: Straat, Stad, Land)</span>
                        <input style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', outline: 'none' }} placeholder="Bijv. Kerkstraat 12, Mechelen" value={newLocation} onChange={handleLocationChange} onFocus={() => { if (newLocation.length > 0 && filteredCities.length > 0) setShowCitySuggestions(true); }} onBlur={() => setTimeout(() => setShowCitySuggestions(false), 200)} />
                        {showCitySuggestions && (
                            <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '8px', marginTop: '4px', zIndex: 10, maxHeight: '150px', overflowY: 'auto', padding: 0, listStyle: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)' }}>
                                {filteredCities.map(city => (
                                    <li key={city} style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--ink)', cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onMouseDown={(e) => { e.preventDefault(); handleSelectCity(city); }}>{city}</li>
                                ))}
                            </ul>
                        )}
                    </label>

                    <div style={{ display: "flex", gap: "16px" }}>
                        <label style={{ display: 'block', margin: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', letterSpacing: 'normal' }}>Datum</span>
                            <input style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', outline: 'none' }} type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
                        </label>
                        <label style={{ display: 'block', margin: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', letterSpacing: 'normal' }}>Starttijd</span>
                            <input style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', outline: 'none' }} type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
                        </label>
                    </div>

                    <label style={{ display: 'block', margin: 0 }}>
                        <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', marginBottom: '6px', letterSpacing: 'normal' }}>Opmerkingen voor team</span>
                        <textarea rows={3} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', outline: 'none', resize: 'vertical' }} placeholder="Extra details of instructies..." value={newNotes} onChange={e => setNewNotes(e.target.value)} />
                    </label>

                    <button type="submit" disabled={busy === true} style={{ width: "100%", marginTop: "12px", height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'var(--mint-deep)', color: 'white', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                        {busy ? "Bezig..." : <>{editingEventId ? <Save size={16} style={{ marginRight: '8px' }} /> : <Plus size={16} style={{ marginRight: '8px' }} />} {editingEventId ? "Opslaan" : "Inplannen"}</>}
                    </button>
                </form>
            </div>

            {toast && (
                <div className="toast" role="status"><CheckCircle2 size={18} /> {toast}</div>
            )}

            <nav className="mobile-bottom-nav">
                <a href="/" className="mobile-nav-item"><LayoutDashboard size={22} /><span>Dashboard</span></a>
                <a href="#inbox" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setToast("Inbox opent binnenkort"); }}><Inbox size={22} /><span>Inbox</span></a>
                <a href="/planning" className="mobile-nav-item active"><CalendarDays size={22} /><span>Planning</span></a>
                <a href="#crm" className="mobile-nav-item" onClick={(e) => { e.preventDefault(); setToast("CRM opent binnenkort"); }}><Users size={22} /><span>Klanten</span></a>
                <a href="/settings" className="mobile-nav-item"><Settings size={22} /><span>Menu</span></a>
            </nav>
        </div>
    );
}
