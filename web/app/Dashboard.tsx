"use client";

import { Navigation } from "@/components/Navigation";
import {
  Archive,
  ArrowRight,
  Ban,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  Clock3,
  Download,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  MailPlus,
  MessageSquareText,
  MoreHorizontal,
  PenLine,
  Plus,
  Receipt,
  Search,
  Save,
  Send,
  Settings,
  Sparkles,
  RotateCcw,
  RefreshCw,
  Tag,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  formatEuro,
  normalizeQuoteBuilder,
  quoteTotals,
  quoteValidationIssues,
  type QuoteBuilder,
  type QuoteLine,
} from "../lib/quote-builder";
import { formatQuoteNumber, type QuoteNumberingSettings } from "../lib/quote-numbering";

type WorkItem = {
  id: string;
  moduleId: string;
  customerName: string;
  customerEmail: string;
  title: string;
  summary: string;
  status: string;
  priority: string;
  confidence: number;
  receivedAt: string;
  dueLabel: string;
  draft: string;
  sourceSubject?: string | null;
  sourceBody?: string;
  extractedJson?: string;
  quoteJson?: string;
  aiProvider?: string;
  quoteStatus?: "sent" | "viewed" | "signed";
  quoteSentAt?: string | null;
  quoteViewedAt?: string | null;
  quoteSignedAt?: string | null;
  label?: string | null;
};

type MailboxIntegration = {
  provider: "gmail" | "imap_smtp";
  status: string;
  accountEmail: string;
  updatedAt: string;
};

const closedStatuses = ["sent", "dismissed", "approved", "signed", "cancelled"];

const recordStatusLabels: Record<string, string> = {
  needs_approval: "Goedkeuren",
  draft_ready: "Concept",
  sent: "Verzonden",
  viewed: "Bekeken",
  approved: "Goedgekeurd",
  signed: "Ondertekend",
  cancelled: "Geannuleerd",
  dismissed: "Archief",
  routed: "Openstaand",
};

const quoteLabelOptions = [
  "Prioriteit",
  "Nabellen",
  "Wacht op klant",
  "Facturatie",
];

const moduleLabels: Record<string, string> = {
  quote_assistant: "Offerte",
  inbox_assistant: "Algemeen",
  service_assistant: "Klacht",
  planning_assistant: "Planning",
  crm_assistant: "CRM",
};

function initials(name: string) {
  return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function receivedDateLabel(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function currentDateLabel() {
  return new Intl.DateTimeFormat("nl-BE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Brussels",
  })
      .format(new Date())
      .toUpperCase();
}

function belgianDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(new Date(value));
}

function requireActiveSession(response: Response) {
  if (response.status !== 401) return;
  window.location.assign("/?auth=session-expired");
  throw new Error("Je sessie is verlopen. Meld je opnieuw aan.");
}

export function Dashboard({
                            displayName,
                            organizationName,
                            userName,
                            companyAddress,
                            companyVatNumber,
                            companyEmail,
                            quoteNumbering,
                          }: {
  displayName: string;
  organizationName: string;
  userName: string;
  companyAddress: string;
  companyVatNumber: string;
  companyEmail: string;
  quoteNumbering: QuoteNumberingSettings;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [workspaceSection, setWorkspaceSection] = useState<
    "overview" | "inbox" | "quotes"
  >("overview");
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(true);
  const [upcomingEvents, setUpcomingEvents] = useState<number | null>(null);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "quotes") {
      setWorkspaceSection("quotes");
      setFilter("all_records");
    } else if (section === "inbox") {
      setWorkspaceSection("inbox");
      setFilter("open");
    }
  }, []);

  // De planningkaart toont het aantal komende afspraken. Zonder gekoppelde
  // agenda blijft de teller leeg in plaats van een fout te tonen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          "/api/integrations/google-calendar?events=upcoming",
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          connected?: boolean;
          events?: unknown[];
        };
        if (!cancelled && data.connected) {
          setUpcomingEvents(data.events?.length ?? 0);
        }
      } catch {
        // Agenda is optioneel; het overzicht werkt ook zonder.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [syncingInbox, setSyncingInbox] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [integration, setIntegration] = useState<MailboxIntegration | null>(null);
  const [mailboxPickerOpen, setMailboxPickerOpen] = useState(false);
  const [mailboxMenuOpen, setMailboxMenuOpen] = useState(false);
  const mailboxControlRef = useRef<HTMLDivElement | null>(null);
  const [mailboxSetupOpen, setMailboxSetupOpen] = useState(false);
  const [manualQuoteOpen, setManualQuoteOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeForm, setComposeForm] = useState({ to: "", subject: "", body: "" });
  const [openQuoteBuilderForId, setOpenQuoteBuilderForId] = useState<string | null>(null);
  const [manualQuoteForm, setManualQuoteForm] = useState({
    customerName: "",
    customerEmail: "",
    street: "",
    houseNumber: "",
    box: "",
    postalCode: "",
    city: "",
    title: "Offerte zonnepanelen",
  });
  const [mailboxForm, setMailboxForm] = useState({
    email: "",
    password: "",
    imapHost: "",
    imapPort: "993",
    smtpHost: "",
    smtpPort: "465",
  });
  const [draftValue, setDraftValue] = useState("");
  const [quoteBuilder, setQuoteBuilder] = useState<QuoteBuilder | null>(null);
  const [quoteInputValues, setQuoteInputValues] = useState<Record<string, string>>({});
  const [quoteSavedSnapshot, setQuoteSavedSnapshot] = useState("");
  const [quoteBuilderOpen, setQuoteBuilderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const gmailNeedsReconnect =
      integration?.provider === "gmail" && integration.status === "needs_reconnect";
  const imapConfigured = integration?.provider === "imap_smtp";

  const loadWorkspace = useCallback(async () => {
    setSyncing(true);
    setLoadError("");
    try {
      const response = await fetch("/api/work-items");
      requireActiveSession(response);
      if (!response.ok) throw new Error("Workspace laden mislukt");
      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setIntegration(data.integration || null);
    } catch {
      setItems([]);
      setIntegration(null);
      setLoadError(
          "De actuele workspacegegevens konden niet worden geladen. Probeer het opnieuw.",
      );
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!mailboxMenuOpen) return;

    const closeWhenOutside = (event: MouseEvent | TouchEvent) => {
      if (!mailboxControlRef.current?.contains(event.target as Node)) {
        setMailboxMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMailboxMenuOpen(false);
    };

    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("touchstart", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("touchstart", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mailboxMenuOpen]);

  useEffect(() => {
    const handleCustomToast = (e: any) => {
      setToast(e.detail);
      setTimeout(() => setToast(""), 4000);
    };
    window.addEventListener("show-toast", handleCustomToast);
    return () => window.removeEventListener("show-toast", handleCustomToast);
  }, []);

  async function syncInbox() {
    setBusy(true);
    setSyncingInbox(true);
    try {
      const response = await fetch("/api/work-items/sync?force=true", {
        method: "POST",
      });
      requireActiveSession(response);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Synchroniseren mislukt");
      await loadWorkspace();
      setToast(
          data.processed > 0
              ? `${data.processed} nieuw bericht verwerkt`
              : "Postvak is up-to-date",
      );
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Synchroniseren lukte niet. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
      setSyncingInbox(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  async function sendCompose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/mail/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(composeForm),
      });
      requireActiveSession(response);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verzenden mislukt");
      setComposeOpen(false);
      setComposeForm({ to: "", subject: "", body: "" });
      setToast(`E-mail verzonden naar ${composeForm.to}`);
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Verzenden lukte niet. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  async function disconnectMailbox() {
    if (!window.confirm("Deze mailbox ontkoppelen? Orelix verwijdert de versleutelde mailboxgegevens. Je dossiers blijven bewaard.")) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/disconnect", {
        method: "POST",
      });
      requireActiveSession(response);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Mailbox ontkoppelen is niet gelukt");
      setIntegration(null);
      setMailboxMenuOpen(false);
      await loadWorkspace();
      setToast("Mailbox ontkoppeld. Je dossiers blijven bewaard.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Mailbox ontkoppelen is niet gelukt.");
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  async function connectOwnMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/imap/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...mailboxForm,
          imapPort: Number(mailboxForm.imapPort),
          smtpPort: Number(mailboxForm.smtpPort),
        }),
      });
      requireActiveSession(response);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Mailbox koppelen is niet gelukt");
      }
      setMailboxForm((current) => ({ ...current, password: "" }));
      setMailboxSetupOpen(false);
      await loadWorkspace();
      setToast(
          data.syncWarning
              ? data.syncWarning
              : data.processed > 0
                  ? `Mailbox gekoppeld: ${data.processed} recente berichten verwerkt.`
                  : "Mailbox veilig geverifieerd en gekoppeld aan deze workspace.",
      );
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Mailbox koppelen is niet gelukt.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 5200);
    }
  }

  useEffect(() => {
    const gmailStatus = new URLSearchParams(window.location.search).get("gmail");
    if (!gmailStatus) return;
    const messages: Record<string, string> = {
      connected: "Gmail is veilig verbonden met deze workspace.",
      "account-in-use":
          "Deze Gmail-mailbox is nog met een andere workspace verbonden.",
      "token-exchange":
          "Google kon de aanmelding niet afronden. Probeer Gmail opnieuw te koppelen.",
      "no-refresh-token":
          "Google gaf geen blijvende toegang. Trek de oude toestemming in en probeer opnieuw.",
      "setup-required":
          "Deze omgeving mist de Google-instellingen (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET en GMAIL_TOKEN_ENCRYPTION_KEY).",
      "workspace-required":
          "Er is nog geen workspace voor dit account. Rond eerst de onboarding af.",
      "invalid-callback":
          "Google keerde onvolledig terug. Start het koppelen opnieuw vanaf deze pagina.",
      "expired-state":
          "Het koppelen duurde te lang of startte in een ander venster. Probeer het opnieuw.",
      failed:
          "De Gmail-koppeling kon niet worden afgerond. De fout is geregistreerd.",
    };
    const message =
        messages[gmailStatus] || "De Gmail-koppeling is niet afgerond.";
    window.history.replaceState({}, "", window.location.pathname);
    const showTimer = window.setTimeout(() => setToast(message), 0);
    const hideTimer = window.setTimeout(() => setToast(""), 7000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("newQuote") !== "true") return;

    setManualQuoteOpen(true);
    params.delete("newQuote");
    const search = params.toString();
    window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedQuote = selected ? parseQuoteConcept(selected.quoteJson) : null;
  useEffect(() => {
    const timer = window.setTimeout(
        () => setDraftValue(selected?.draft || ""),
        0,
    );
    return () => window.clearTimeout(timer);
  }, [selectedId, selected?.draft]);

  useEffect(() => {
    setQuoteInputValues({});
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const quote = selected ? parseQuoteConcept(selected.quoteJson) : null;
      if (!selected || !quote?.ready) {
        setQuoteBuilder(null);
        setQuoteSavedSnapshot("");
        setQuoteBuilderOpen(false);
        return;
      }
      const company = {
        name: organizationName,
        address: companyAddress,
        vatNumber: companyVatNumber,
        email: companyEmail,
      };
      const finalQuote = ["sent", "viewed", "signed"].includes(selected.quoteStatus || "");
      const builder = quote.builder
          ? finalQuote
              ? quote.builder
              : applyWorkspaceCompanyDetails(quote.builder, company)
          : createDefaultQuoteBuilder(selected, quote, company, quoteNumbering);
      setQuoteBuilder(builder);
      setQuoteSavedSnapshot(
          quote.builder ? JSON.stringify(quote.builder) : "",
      );
      setQuoteBuilderOpen(
          Boolean(quote.builder) || openQuoteBuilderForId === selected.id,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    organizationName,
    companyAddress,
    companyVatNumber,
    companyEmail,
    quoteNumbering,
    selected,
    selected?.quoteJson,
    selectedId,
  ]);

  useEffect(() => {
    if (openQuoteBuilderForId && selectedId === openQuoteBuilderForId && quoteBuilder) {
      setOpenQuoteBuilderForId(null);
    }
  }, [openQuoteBuilderForId, quoteBuilder, selectedId]);

  const quoteDirty =
      quoteBuilder !== null &&
      JSON.stringify(quoteBuilder) !== quoteSavedSnapshot;
  const quoteIssues = quoteBuilder
      ? quoteValidationIssues(quoteBuilder)
      : ["Maak eerst een offerte aan"];
  const storedQuoteIssues = selectedQuote?.builder
      ? quoteValidationIssues(selectedQuote.builder)
      : ["Sla de offerte eerst op"];
  const storedQuoteSendable =
      Boolean(selectedQuote?.builder) && storedQuoteIssues.length === 0;
  const quoteBlocksSend =
      selectedQuote?.ready === true && (!storedQuoteSendable || quoteDirty);
  const currentQuoteTotals = quoteBuilder ? quoteTotals(quoteBuilder) : null;

  const quoteItems = items.filter(
      (item) => item.moduleId === "quote_assistant" || Boolean(item.quoteStatus),
  );
  const inboxItems = items.filter((item) => item.aiProvider !== "manual");
  const sectionItems = workspaceSection === "quotes" ? quoteItems : inboxItems;

  const visibleItems = useMemo(() => {
    return sectionItems.filter((item) => {
      const isOpen = !closedStatuses.includes(item.status);
      const matchesFilter =
          filter === "all_records" ||
          (filter === "open" && isOpen) ||
          (filter === "approval" && item.status === "needs_approval") ||
          (filter === "drafts" && item.status === "draft_ready") ||
          (filter === "sent" && item.quoteStatus === "sent") ||
          (filter === "viewed" && item.quoteStatus === "viewed") ||
          (filter === "signed" && item.quoteStatus === "signed") ||
          (filter === "archive" && item.status === "dismissed");
      const haystack =
          `${item.customerName} ${item.customerEmail} ${item.title} ${item.summary} ${item.sourceSubject || ""}`.toLowerCase();
      return matchesFilter && haystack.includes(query.toLowerCase());
    });
  }, [filter, query, sectionItems]);

  const openItems = sectionItems.filter(
      (item) => !closedStatuses.includes(item.status),
  );
  const approvalItems = sectionItems.filter(
      (item) => item.status === "needs_approval",
  );
  const draftItems = sectionItems.filter((item) => item.status === "draft_ready");
  const sentItems = sectionItems.filter((item) => item.quoteStatus === "sent");
  const viewedItems = sectionItems.filter((item) => item.quoteStatus === "viewed");
  const signedItems = sectionItems.filter((item) => item.quoteStatus === "signed");
  const archivedItems = sectionItems.filter((item) => item.status === "dismissed");
  const receivedToday = inboxItems.filter(
      (item) => belgianDateKey(item.receivedAt) === belgianDateKey(new Date()),
  ).length;

  // Tellers voor het overzicht blijven aan hun eigen assistent gekoppeld en
  // veranderen dus niet mee met de rubriek die je op dat moment bekijkt.
  const inboxOpenCount = inboxItems.filter(
      (item) => !closedStatuses.includes(item.status),
  ).length;
  const quotesOpenCount = quoteItems.filter(
      (item) => !closedStatuses.includes(item.status),
  ).length;
  const quotesApprovalCount = quoteItems.filter(
      (item) => item.status === "needs_approval",
  ).length;

  async function updateStatus(id: string, status: "approved" | "dismissed") {
    const previous = items;
    setBusy(true);
    try {
      const response =
          status === "approved"
              ? await fetch(`/api/work-items/${id}/send`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ draft: draftValue }),
              })
              : await fetch("/api/work-items", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id, status }),
              });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Update mislukt");
      setItems((current) =>
          current.map((item) =>
              item.id === id
                  ? { ...item, status: status === "approved" ? "sent" : status }
                  : item,
          ),
      );
      setSelectedId(null);
      setToast(
          status === "approved"
              ? data.signatureRequested
                  ? "Offerte verzonden voor ondertekening"
                  : "Goedgekeurd en veilig verzonden"
              : "Dossier naar het archief verplaatst",
      );
    } catch (caught) {
      setItems(previous);
      setToast(
          caught instanceof Error
              ? caught.message
              : "Opslaan lukte niet. Probeer het opnieuw.",
      );
    }
    setBusy(false);
    window.setTimeout(() => setToast(""), 4200);
  }

  async function quoteAction(
      id: string,
      action: "reminder" | "label" | "mark_signed" | "cancel",
      label?: string,
  ) {
    setBusy(true);
    try {
      const response = await fetch(`/api/work-items/${id}/quote-actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, label }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Actie mislukt");
      setItems((current) =>
          current.map((item) => {
            if (item.id !== id) return item;
            if (action === "label") {
              return { ...item, label: data.item?.label ?? label ?? "" };
            }
            if (action === "mark_signed") {
              return {
                ...item,
                status: "signed",
                quoteStatus: "signed",
                quoteSignedAt: new Date().toISOString(),
              };
            }
            if (action === "cancel") {
              return { ...item, status: "cancelled", quoteStatus: undefined };
            }
            return {
              ...item,
              quoteStatus: "sent",
              quoteSentAt: data.quoteSentAt || item.quoteSentAt,
            };
          }),
      );
      setToast(
          action === "reminder"
              ? "Herinnering verzonden naar de klant"
              : action === "label"
                  ? label
                      ? `Label "${label}" ingesteld`
                      : "Label verwijderd"
                  : action === "mark_signed"
                      ? "Offerte gemarkeerd als ondertekend"
                      : "Offerte geannuleerd",
      );
      if (action === "mark_signed" || action === "cancel") {
        setSelectedId(null);
      }
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Actie lukte niet. Probeer het opnieuw.",
      );
    }
    setBusy(false);
    window.setTimeout(() => setToast(""), 4200);
  }

  async function createManualQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const customerAddress = [
        `${manualQuoteForm.street.trim()} ${manualQuoteForm.houseNumber.trim()}`.trim(),
        manualQuoteForm.box.trim() ? `bus ${manualQuoteForm.box.trim()}` : "",
        `${manualQuoteForm.postalCode.trim()} ${manualQuoteForm.city.trim()}`.trim(),
      ]
          .filter(Boolean)
          .join(", ");
      const response = await fetch("/api/work-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...manualQuoteForm, customerAddress }),
      });
      requireActiveSession(response);
      const data = (await response.json()) as { error?: string; item?: WorkItem };
      if (!response.ok || !data.item) {
        throw new Error(data.error || "Offerte aanmaken mislukt");
      }
      setItems((current) => [data.item!, ...current]);
      setWorkspaceSection("quotes");
      setFilter("approval");
      setSelectedId(data.item.id);
      setOpenQuoteBuilderForId(data.item.id);
      setManualQuoteOpen(false);
      setManualQuoteForm({
        customerName: "",
        customerEmail: "",
        street: "",
        houseNumber: "",
        box: "",
        postalCode: "",
        city: "",
        title: "Offerte zonnepanelen",
      });
      setToast("Offerte aangemaakt. Vul nu de regels en bedragen aan.");
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Offerte aanmaken lukte niet. Probeer opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  function runRowAction(
      id: string,
      action: "reminder" | "mark_signed" | "cancel" | "archive" | "restore",
  ) {
    setRowMenuId(null);
    if (action === "archive") {
      void updateStatus(id, "dismissed");
      return;
    }
    if (action === "restore") {
      void restoreArchivedItem(id);
      return;
    }
    void quoteAction(id, action);
  }

  async function restoreArchivedItem(id: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: "needs_approval" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Terugzetten mislukt");
      setItems((current) =>
          current.map((item) =>
              item.id === id ? { ...item, status: "needs_approval" } : item,
          ),
      );
      setSelectedId(null);
      setToast("Dossier teruggezet naar Goedkeuren");
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Terugzetten lukte niet. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  async function deleteArchivedItem(id: string) {
    if (
        !window.confirm(
            "Dit dossier en de bijbehorende geschiedenis definitief verwijderen?",
        )
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((current) => current.filter((item) => item.id !== id));
      setSelectedId(null);
      setToast("Dossier definitief verwijderd");
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Verwijderen lukte niet. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  async function saveDraft() {
    if (!selected || !draftValue.trim() || draftValue === selected.draft) return;
    setBusy(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selected.id, draft: draftValue }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Opslaan mislukt");
      setItems((current) =>
          current.map((item) =>
              item.id === selected.id ? { ...item, draft: draftValue } : item,
          ),
      );
      setToast("Conceptantwoord opgeslagen");
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Opslaan lukte niet. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  async function reanalyzeItem() {
    if (!selected || !selected.sourceBody?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selected.id, moduleId: selected.moduleId }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Opnieuw analyseren mislukt");
      setItems((current) =>
          current.map((item) =>
              item.id === selected.id
                  ? { ...item, ...data.item, quoteStatus: item.quoteStatus }
                  : item,
          ),
      );
      setDraftValue(data.item.draft || "");
      setToast("Voorgesteld antwoord opnieuw gegenereerd");
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Opnieuw analyseren lukte niet. Probeer het nog eens.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  function updateQuoteField<K extends keyof QuoteBuilder>(
      field: K,
      value: QuoteBuilder[K],
  ) {
    setQuoteBuilder((current) =>
        current ? { ...current, [field]: value } : current,
    );
  }

  function updateQuoteLine(
      id: string,
      field: keyof QuoteLine,
      value: string | number,
  ) {
    setQuoteBuilder((current) =>
        current
            ? {
              ...current,
              lines: current.lines.map((line) =>
                  line.id === id ? { ...line, [field]: value } : line,
              ),
            }
            : current,
    );
  }

  function updateQuoteLineTotal(id: string, value: string) {
    const totalCents = euroInputToCents(value);
    setQuoteBuilder((current) =>
        current
            ? {
              ...current,
              lines: current.lines.map((line) =>
                  line.id === id
                      ? {
                        ...line,
                        unitPriceCents: Math.round(
                            totalCents / Math.max(line.quantity, 0.001),
                        ),
                      }
                      : line,
              ),
            }
            : current,
    );
  }

  function updateQuoteMoneyInput(
      id: string,
      field: "unitPrice" | "lineTotal",
      value: string,
  ) {
    const key = `${id}:${field}`;
    setQuoteInputValues((current) => ({ ...current, [key]: value }));
    if (/[,.]$/.test(value.trim())) return;
    if (field === "unitPrice") {
      updateQuoteLine(id, "unitPriceCents", euroInputToCents(value));
    } else {
      updateQuoteLineTotal(id, value);
    }
  }

  function commitQuoteMoneyInput(
      id: string,
      field: "unitPrice" | "lineTotal",
  ) {
    const key = `${id}:${field}`;
    const value = quoteInputValues[key];
    if (value === undefined) return;
    if (field === "unitPrice") {
      updateQuoteLine(id, "unitPriceCents", euroInputToCents(value));
    } else {
      updateQuoteLineTotal(id, value);
    }
    setQuoteInputValues((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function addQuoteLine() {
    setQuoteBuilder((current) =>
        current
            ? {
              ...current,
              lines: [
                ...current.lines,
                {
                  id: `line_${crypto.randomUUID()}`,
                  description: "",
                  quantity: 1,
                  unit: "stuk",
                  unitPriceCents: 0,
                  vatRate: 21,
                },
              ],
            }
            : current,
    );
  }

  function removeQuoteLine(id: string) {
    setQuoteBuilder((current) =>
        current && current.lines.length > 1
            ? {
              ...current,
              lines: current.lines.filter((line) => line.id !== id),
            }
            : current,
    );
  }

  async function saveQuoteBuilder() {
    if (!selected || !quoteBuilder || !quoteDirty) return;
    setBusy(true);
    try {
      const normalized = normalizeQuoteBuilder(quoteBuilder);
      const emailDraft = selectedQuote?.builder
          ? draftValue
          : quoteEmailDraft(normalized);
      const response = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          quoteBuilder: normalized,
          draft: emailDraft,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        builder?: QuoteBuilder;
        item?: WorkItem;
      };
      if (!response.ok) throw new Error(data.error || "Offerte opslaan mislukt");
      if (!data.builder) throw new Error("De opgeslagen offerte ontbreekt");
      setItems((current) =>
          current.map((item) =>
              item.id === selected.id
                  ? {
                    ...item,
                    draft: data.item?.draft ?? emailDraft,
                    quoteJson: mergeQuoteBuilder(item.quoteJson, data.builder),
                  }
                  : item,
          ),
      );
      setQuoteBuilder(data.builder);
      setQuoteSavedSnapshot(JSON.stringify(data.builder));
      setDraftValue(data.item?.draft ?? emailDraft);
      setToast("Offerte en begeleidende e-mail opgeslagen");
    } catch (caught) {
      setToast(
          caught instanceof Error
              ? caught.message
              : "Offerte opslaan lukte niet. Probeer opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  return (
      <div className="app-shell" style={{ background: '#f8faf9', minHeight: '100vh' }}>
        <style>{`
        /* =========================================
           PRO KMO DASHBOARD STYLING
           ========================================= */
        .pro-header {
            position: sticky; top: 0; z-index: 20; display: flex; height: 80px;
            align-items: center; justify-content: flex-end; gap: 16px; padding: 0 40px;
            background: rgba(248, 250, 249, 0.85); backdrop-filter: blur(20px);
            border-bottom: 1px solid rgba(0,0,0,0.04);
        }
        
        .pro-content { width: min(1320px, calc(100% - 80px)); margin: 0 auto; padding: 40px 0 80px; }
        
        /* HERO SECTIE */
        .pro-hero { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 40px; }
        .pro-date { font-size: 11px; font-weight: 800; color: var(--mint-deep); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 8px; display: block; }
        .pro-greeting { font-family: var(--font-display); font-size: 38px; font-weight: 700; color: #111827; letter-spacing: -0.03em; margin: 0; }
        .pro-subtitle { font-size: 15px; color: #64748b; margin: 8px 0 0; font-weight: 500; }
        
        /* METRIC CARDS (PERFECTE SYMMETRIE) */
        .pro-metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 48px; }
        .pro-metric-card {
            background: #ffffff; border: 1px solid rgba(0,0,0,0.04); border-radius: 20px;
            padding: 24px; box-shadow: 0 10px 30px -10px rgba(0,0,0,0.03);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease;
            position: relative; overflow: hidden;
        }
        .pro-metric-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px -12px rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.2); }
        
        .metric-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        .metric-icon-box { 
            width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; 
        }
        .metric-icon-box.coral { background: #fff1f0; color: #e15b45; }
        .metric-icon-box.blue { background: #eff6ff; color: #3b82f6; }
        .metric-icon-box.mint { background: #ecfdf5; color: #10b981; }
        .metric-icon-box.purple { background: #f3e8ff; color: #8b5cf6; }
        
        .metric-value { font-family: var(--font-display); font-size: 32px; font-weight: 700; color: #111827; line-height: 1; margin: 0; }
        .metric-label { font-size: 13px; color: #64748b; font-weight: 600; margin-top: 6px; }
        .metric-badge { font-size: 10px; font-weight: 700; color: #94a3b8; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; }

        /* OVERZICHT: DE DRIE ASSISTENTEN */
        .assistant-overview-heading { margin-bottom: 20px; }
        .assistant-overview-heading h2 { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: #111827; margin: 0; letter-spacing: -0.02em; }
        .assistant-overview-heading p { font-size: 14px; color: #64748b; margin: 6px 0 0; font-weight: 500; }
        .assistant-card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .assistant-card {
            display: grid; grid-template-columns: 52px 1fr auto auto; align-items: center;
            gap: 18px; width: 100%; text-align: left; text-decoration: none;
            background: #ffffff; border: 1px solid rgba(0,0,0,0.04); border-radius: 20px;
            padding: 24px; cursor: pointer; font: inherit; color: inherit;
            box-shadow: 0 10px 30px -10px rgba(0,0,0,0.03);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease, border-color 0.3s ease;
        }
        .assistant-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px -12px rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.2); }
        .assistant-card-icon { width: 52px; height: 52px; border-radius: 15px; display: grid; place-items: center; }
        .assistant-card-icon.inbox { background: #eff6ff; color: #3b82f6; }
        .assistant-card-icon.quotes { background: #ecfdf5; color: #10b981; }
        .assistant-card-icon.planning { background: #f3e8ff; color: #8b5cf6; }
        .assistant-card-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .assistant-card-body strong { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: #111827; letter-spacing: -0.01em; }
        .assistant-card-body small { font-size: 12px; color: #64748b; font-weight: 500; line-height: 1.5; }
        .assistant-card-meta { display: flex; flex-direction: column; align-items: flex-end; }
        .assistant-card-value { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: #111827; line-height: 1; }
        .assistant-card-unit { font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 4px; white-space: nowrap; }
        .assistant-card-arrow { color: #cbd5e1; transition: color 0.2s ease, transform 0.2s ease; }
        .assistant-card:hover .assistant-card-arrow { color: var(--mint-deep); transform: translateX(3px); }

        /* INBOX & TABS CONTAINER */
        .pro-inbox-container {
            background: #ffffff; border: 1px solid rgba(0,0,0,0.05); border-radius: 24px;
            box-shadow: 0 10px 40px -10px rgba(0,0,0,0.03); overflow: hidden;
        }
        .pro-inbox-header { padding: 32px 32px 0; }
        .pro-inbox-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .pro-inbox-title-left { display: flex; align-items: center; gap: 12px; }
        .pro-inbox-title h2 { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: #111827; margin: 0; }
        .pro-inbox-count { font-size: 12px; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 4px 10px; border-radius: 99px; }

        .pro-tabs { display: flex; gap: 32px; border-bottom: 1px solid #e2e8f0; padding: 0 32px; overflow-x: auto; }
        .pro-tab {
            padding: 0 0 16px; background: transparent; border: none; font-size: 14px; font-weight: 600;
            color: #64748b; cursor: pointer; position: relative; transition: color 0.2s; white-space: nowrap;
        }
        .pro-tab:hover { color: #111827; }
        .pro-tab.active { color: var(--mint-deep); }
        .pro-tab.active::after {
            content: ''; position: absolute; bottom: -1px; left: 0; right: 0;
            height: 2px; background: var(--mint-deep); border-radius: 2px 2px 0 0;
        }
        .pro-tab span { font-size: 11px; color: #94a3b8; margin-left: 6px; background: #f1f5f9; padding: 2px 6px; border-radius: 10px; }

        /* HET "WOW" EMPTY STATE */
        .pro-empty-state {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            padding: 100px 20px; text-align: center;
            background: radial-gradient(circle at center, rgba(16, 185, 129, 0.03) 0%, transparent 60%);
        }
        .empty-icon-ring {
            width: 96px; height: 96px; border-radius: 50%;
            background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
            display: grid; place-items: center; margin-bottom: 24px;
            box-shadow: 0 0 0 12px rgba(16, 185, 129, 0.04), 0 0 0 24px rgba(16, 185, 129, 0.02);
            color: #059669;
        }
        .pro-empty-state h3 { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px; }
        .pro-empty-state p { font-size: 14px; color: #64748b; max-width: 340px; line-height: 1.6; margin: 0; }

        @media (max-width: 760px) {
          .pro-header { padding: 0 16px; height: 70px; }
          .pro-content { width: calc(100% - 32px); padding: 20px 0 80px; }
          .pro-hero { flex-direction: column; align-items: flex-start; gap: 20px; }
          .pro-greeting { font-size: 28px; }
          .pro-metric-grid { grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 32px; }
          .pro-inbox-header { padding: 20px 20px 0; }
          .pro-tabs { padding: 0 20px; gap: 20px; }
          .assistant-card-grid { grid-template-columns: 1fr; gap: 14px; }
          .assistant-card { padding: 18px; gap: 14px; }
        }
      `}</style>

        {/* --- GLOBALE NAVIGATIE INJECTEREN --- */}
        <Navigation
            activePath={workspaceSection === "overview" ? "dashboard" : workspaceSection}
            organizationName={organizationName}
            userName={userName}
            openItemsCount={inboxOpenCount}
            onSectionChange={(section) => {
              setWorkspaceSection(section);
              setFilter(section === "quotes" ? "all_records" : "open");
              setSelectedId(null);
            }}
        />

        <main className="main-content" id="overzicht">
          <header className="pro-header">
            <label className="search" style={{ background: '#f1f5f9', border: 'none', height: '44px', borderRadius: '12px' }}>
              <Search size={18} color="#64748b" />
              <input
                  aria-label="Zoeken"
                  placeholder="Zoek klant, dossier of e-mail..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  style={{ fontSize: '14px' }}
              />
              <kbd style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#94a3b8' }}>⌘ K</kbd>
            </label>
            <button className="icon-button" aria-label="Meldingen" style={{ border: 'none', background: '#ffffff', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
              <Bell size={19} color="#475569" />
              <span className="notification-dot" />
            </button>
            {workspaceSection === "quotes" ? (
                <button
                    type="button"
                    className="primary-button quick-quote-button"
                    onClick={() => setManualQuoteOpen(true)}
                >
                  <Plus size={16} />
                  Nieuwe offerte
                </button>
            ) : integration && !gmailNeedsReconnect ? (
                <button
                    type="button"
                    className="primary-button quick-quote-button"
                    onClick={() => setComposeOpen(true)}
                >
                  <MailPlus size={16} />
                  Nieuwe mail
                </button>
            ) : null}
          </header>

          <div className="pro-content">
            <section className="pro-hero">
              <div>
                <span className="pro-date">{currentDateLabel()}</span>
                {/*<h1 className="pro-greeting">Goedemorgen, {displayName}.</h1>*/}
                {/*<p className="pro-subtitle">Je digitale team heeft de administratie voorbereid.</p>*/}
              </div>
              <div className="mail-status-wrap">
                {integration && !gmailNeedsReconnect && (
                    <button
                        type="button"
                        className="mailbox-sync-icon"
                        disabled={busy || syncingInbox}
                        onClick={() => void syncInbox()}
                        title="Postvak synchroniseren"
                        aria-label="Postvak synchroniseren"
                    >
                      <RefreshCw size={18} className={syncingInbox ? "spinning" : ""} />
                    </button>
                )}
                <div className="mailbox-control" ref={mailboxControlRef}>
                  <button
                      type="button"
                      className={`mail-status ${integration && !gmailNeedsReconnect ? "connected" : "disconnected"}`}
                      onClick={() => {
                        if (integration && !gmailNeedsReconnect) setMailboxMenuOpen((open) => !open);
                        else if (!gmailNeedsReconnect) setMailboxPickerOpen(true);
                      }}
                  >
                    <span className="gmail-mark">M</span>
                    <span>
                  <strong>
                    {imapConfigured
                        ? "Eigen mailbox gekoppeld"
                        : gmailNeedsReconnect
                            ? "Mail opnieuw verbinden"
                            : integration
                                ? "Mail verbonden"
                                : "Mail koppelen"}
                  </strong>
                  <small>
                    {imapConfigured
                        ? integration.accountEmail
                        : gmailNeedsReconnect
                            ? "Toegang verlopen — klik om te herstellen"
                            : integration
                                ? integration.accountEmail
                                : "Ontvang echte aanvragen in Orelix"}
                  </small>
                </span>
                    {integration && !gmailNeedsReconnect ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                  </button>
                  <div className={`mailbox-actions ${mailboxMenuOpen ? "open" : ""}`} role="menu" aria-label="Mailboxacties">
                    {integration && !gmailNeedsReconnect && (
                        <button
                            type="button"
                            className="secondary-button sync-inbox-button"
                            disabled={busy || syncingInbox}
                            onClick={() => void syncInbox()}
                            title="Nieuwe berichten handmatig ophalen"
                        >
                          <RefreshCw size={16} className={syncingInbox ? "spinning" : ""} />
                          {syncingInbox ? "Synchroniseren…" : "Postvak synchroniseren"}
                        </button>
                    )}
                    {integration && !gmailNeedsReconnect && (
                        <button
                            type="button"
                            className="secondary-button disconnect-mailbox-button"
                            disabled={busy}
                            onClick={() => void disconnectMailbox()}
                        >
                          Mailbox ontkoppelen
                        </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* PREMIUM METRIC CARDS */}
            <div className="pro-metric-grid">
              <article className="pro-metric-card">
                <div className="metric-top">
                  <div className="metric-icon-box coral"><Zap size={22} strokeWidth={2.5} /></div>
                  <span className="metric-badge">Actueel</span>
                </div>
                <div>
                  <h3 className="metric-value">{syncing ? "—" : openItems.length}</h3>
                  <div className="metric-label">Wachten op jou</div>
                </div>
              </article>

              <article className="pro-metric-card">
                <div className="metric-top">
                  <div className="metric-icon-box blue"><Mail size={22} strokeWidth={2.5} /></div>
                  <span className="metric-badge">Vandaag</span>
                </div>
                <div>
                  <h3 className="metric-value">{syncing ? "—" : receivedToday}</h3>
                  <div className="metric-label">Nieuw ontvangen</div>
                </div>
              </article>

              <article className="pro-metric-card">
                <div className="metric-top">
                  <div className="metric-icon-box mint"><Clock3 size={22} strokeWidth={2.5} /></div>
                  <span className="metric-badge">Geschat</span>
                </div>
                <div>
                  <h3 className="metric-value">—</h3>
                  <div className="metric-label">Tijd bespaard</div>
                </div>
              </article>

              <article className="pro-metric-card">
                <div className="metric-top">
                  <div className="metric-icon-box purple"><CheckCircle2 size={22} strokeWidth={2.5} /></div>
                  <span className="metric-badge">AI Score</span>
                </div>
                <div>
                  <h3 className="metric-value">—</h3>
                  <div className="metric-label">Automatisch juist</div>
                </div>
              </article>
            </div>

            {workspaceSection === "overview" && (
                <section className="assistant-overview" aria-label="Jouw assistenten">
                  <div className="assistant-overview-heading">
                    <h2>Jouw assistenten</h2>
                    <p>Kies waar je verder wil werken.</p>
                  </div>

                  <div className="assistant-card-grid">
                    <button
                        type="button"
                        className="assistant-card"
                        onClick={() => {
                          setWorkspaceSection("inbox");
                          setFilter("open");
                        }}
                    >
                      <span className="assistant-card-icon inbox">
                        <Inbox size={22} strokeWidth={2.4} />
                      </span>
                      <span className="assistant-card-body">
                        <strong>Inbox</strong>
                        <small>
                          Alles wat binnenkomt, automatisch herkend en gelabeld.
                        </small>
                      </span>
                      <span className="assistant-card-meta">
                        <span className="assistant-card-value">
                          {syncing ? "—" : inboxOpenCount}
                        </span>
                        <span className="assistant-card-unit">openstaand</span>
                      </span>
                      <ArrowRight size={17} className="assistant-card-arrow" />
                    </button>

                    <button
                        type="button"
                        className="assistant-card"
                        onClick={() => {
                          setWorkspaceSection("quotes");
                          setFilter("all_records");
                        }}
                    >
                      <span className="assistant-card-icon quotes">
                        <FileText size={22} strokeWidth={2.4} />
                      </span>
                      <span className="assistant-card-body">
                        <strong>Offertes</strong>
                        <small>
                          Van aanvraag tot ondertekening, in één dossier.
                        </small>
                      </span>
                      <span className="assistant-card-meta">
                        <span className="assistant-card-value">
                          {syncing ? "—" : quotesOpenCount}
                        </span>
                        <span className="assistant-card-unit">
                          {quotesApprovalCount > 0
                              ? `${quotesApprovalCount} te keuren`
                              : "openstaand"}
                        </span>
                      </span>
                      <ArrowRight size={17} className="assistant-card-arrow" />
                    </button>

                    <a className="assistant-card" href="/planning">
                      <span className="assistant-card-icon planning">
                        <CalendarDays size={22} strokeWidth={2.4} />
                      </span>
                      <span className="assistant-card-body">
                        <strong>Planning</strong>
                        <small>
                          Afspraken en plaatsingen, gekoppeld aan je agenda.
                        </small>
                      </span>
                      <span className="assistant-card-meta">
                        <span className="assistant-card-value">
                          {upcomingEvents === null ? "—" : upcomingEvents}
                        </span>
                        <span className="assistant-card-unit">
                          {upcomingEvents === null ? "geen agenda" : "gepland"}
                        </span>
                      </span>
                      <ArrowRight size={17} className="assistant-card-arrow" />
                    </a>
                  </div>
                </section>
            )}

            {workspaceSection !== "overview" && (
            <div className="dashboard-grid">
              <section className="work-panel" id="werk">
                <div className="pro-inbox-container">
                  <div className="pro-inbox-header">
                    <div className="pro-inbox-title">
                      <div className="pro-inbox-title-left">
                        <h2>{workspaceSection === "quotes" ? "Offertes" : "Inbox"}</h2>
                        <span className="pro-inbox-count">
                          {syncing ? "Laden…" : `${sectionItems.length} dossier${sectionItems.length === 1 ? "" : "s"}`}
                        </span>
                      </div>
                      <div className="panel-actions">
                        <label className="panel-search" style={{ background: '#f8faf9', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                          <Search size={15} color="#64748b" />
                          <input
                              aria-label="Zoek in dossiers"
                              placeholder="Zoeken…"
                              value={query}
                              onChange={(event) => setQuery(event.target.value)}
                          />
                        </label>
                        {workspaceSection === "quotes" && (
                            <button
                                type="button"
                                className="primary-button panel-new-quote"
                                onClick={() => setManualQuoteOpen(true)}
                            >
                              <Plus size={16} />
                              Nieuwe offerte
                            </button>
                        )}
                      </div>
                    </div>

                    <div className="pro-tabs" role="tablist" aria-label="Statusfilter">
                      {(workspaceSection === "quotes"
                              ? [
                                ["all_records", "Alle", sectionItems.length],
                                ["approval", "Goedkeuren", approvalItems.length],
                                ["drafts", "Concepten", draftItems.length],
                                ["sent", "Verzonden", sentItems.length],
                                ["viewed", "Bekeken", viewedItems.length],
                                ["signed", "Getekend", signedItems.length],
                                ["archive", "Archief", archivedItems.length],
                              ]
                              : [
                                ["all_records", "Alle", sectionItems.length],
                                ["open", "Openstaand", openItems.length],
                                ["archive", "Archief", archivedItems.length],
                              ]
                      ).map(([value, label, count]) => (
                          <button
                              key={String(value)}
                              type="button"
                              role="tab"
                              aria-selected={filter === value}
                              className={`pro-tab ${filter === value ? "active" : ""}`}
                              onClick={() => setFilter(String(value))}
                          >
                            {label}
                            <span>{count}</span>
                          </button>
                      ))}
                    </div>
                  </div>

                  <div className="work-list" style={{ padding: '20px 32px 32px' }}>
                    {syncing &&
                        Array.from({ length: 3 }).map((_, index) => (
                            <div className="work-item-skeleton" key={index}>
                              <span className="skeleton-block skeleton-avatar" />
                              <span className="skeleton-copy">
                        <span className="skeleton-block short" />
                        <span className="skeleton-block medium" />
                        <span className="skeleton-block long" />
                      </span>
                            </div>
                        ))}
                    {!syncing && !loadError && visibleItems.length > 0 && (
                        <div className="work-list-header" aria-hidden="true" style={{ padding: '0 20px 12px' }}>
                          <span>Klant</span>
                          <span>Dossier</span>
                          <span>Ontvangen</span>
                          <span>Status</span>
                          <span />
                        </div>
                    )}
                    {!syncing && !loadError && visibleItems.map((item) => (
                        <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            className="work-item"
                            onClick={() => setSelectedId(item.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedId(item.id);
                              }
                            }}
                        >
                    <span className="work-customer">
                      <span className={`avatar ${item.moduleId}`}>
                        {initials(item.customerName)}
                      </span>
                      <span className="work-customer-copy">
                        <strong>{item.customerName}</strong>
                        <small>{item.customerEmail}</small>
                      </span>
                    </span>
                          <span className="work-subject">
                      <span className="work-subject-meta">
                        <span className={`module-tag ${item.moduleId}`}>
                          {moduleLabels[item.moduleId]}
                        </span>
                        {item.priority === "high" && (
                            <span className="priority">Prioriteit</span>
                        )}
                        {item.label ? (
                            <span className="work-label">{item.label}</span>
                        ) : null}
                      </span>
                      <b>{item.title}</b>
                      <small>{item.summary}</small>
                    </span>
                          <span className="work-date">
                      <strong>{receivedDateLabel(item.receivedAt)}</strong>
                      <small>{timeLabel(item.receivedAt)}</small>
                    </span>
                          <span
                              className={`record-state record-state-${item.status}`}
                          >
                      {recordStatusLabels[
                          item.status === "dismissed"
                              ? "dismissed"
                              : item.quoteStatus || item.status
                          ] || item.dueLabel}
                    </span>
                          <span
                              className="row-menu-wrap"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                          >
                      <button
                          type="button"
                          className="row-menu-button"
                          aria-label="Dossieracties"
                          aria-expanded={rowMenuId === item.id}
                          onClick={() =>
                              setRowMenuId(rowMenuId === item.id ? null : item.id)
                          }
                      >
                        <ChevronRight
                            size={18}
                            className={`work-chevron${rowMenuId === item.id ? " open" : ""}`}
                        />
                      </button>
                            {rowMenuId === item.id && (
                                <div className="row-menu" role="menu">
                                  {item.status === "dismissed" ? (
                                      <>
                                        {(item.quoteStatus === "sent" ||
                                            item.quoteStatus === "viewed") && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                className="danger"
                                                onClick={() => runRowAction(item.id, "cancel")}
                                            >
                                              <Ban size={14} />
                                              Offerte annuleren
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => runRowAction(item.id, "restore")}
                                        >
                                          <RotateCcw size={14} />
                                          Terugzetten
                                        </button>
                                      </>
                                  ) : (
                                      <>
                                        {(item.quoteStatus === "sent" ||
                                            item.quoteStatus === "viewed") && (
                                            <>
                                              <button
                                                  type="button"
                                                  role="menuitem"
                                                  onClick={() => runRowAction(item.id, "reminder")}
                                              >
                                                <BellRing size={14} />
                                                Herinnering sturen
                                              </button>
                                              <button
                                                  type="button"
                                                  role="menuitem"
                                                  onClick={() => runRowAction(item.id, "mark_signed")}
                                              >
                                                <PenLine size={14} />
                                                Markeer getekend
                                              </button>
                                            </>
                                        )}
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => runRowAction(item.id, "archive")}
                                        >
                                          <Archive size={14} />
                                          Archiveren
                                        </button>
                                      </>
                                  )}
                                </div>
                            )}
                    </span>
                        </div>
                    ))}
                    {!syncing && loadError && (
                        <div className="empty-state error-state">
                          <CircleHelp size={28} />
                          <strong>Workspace niet geladen</strong>
                          <span>{loadError}</span>
                          <button type="button" onClick={() => void loadWorkspace()}>
                            Opnieuw proberen
                          </button>
                        </div>
                    )}
                    {!syncing && !loadError && visibleItems.length === 0 && (
                        <div className="pro-empty-state">
                          <div className="empty-icon-ring">
                            <Check size={40} strokeWidth={2.5} />
                          </div>
                          <h3>Alles is bijgewerkt</h3>
                          <p>Je inbox is helemaal leeg. Geen dossiers gevonden in deze rubriek.</p>
                        </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
            )}
          </div>
        </main>

        {rowMenuId && (
            <button
                className="row-menu-backdrop"
                aria-label="Menu sluiten"
                onClick={() => setRowMenuId(null)}
            />
        )}

        {selected && (
            <>
              <button
                  className="drawer-backdrop"
                  aria-label="Dossier sluiten"
                  onClick={() => setSelectedId(null)}
              />
              <aside className="detail-drawer" aria-label="Dossierdetails">
                <div className="drawer-header">
                  <div>
                <span className={`module-tag ${selected.moduleId}`}>
                  {moduleLabels[selected.moduleId]}
                </span>
                    <h2>{selected.title}</h2>
                  </div>
                  <button
                      className="icon-button"
                      onClick={() => setSelectedId(null)}
                      aria-label="Sluiten"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="customer-strip">
              <span className={`avatar ${selected.moduleId}`}>
                {initials(selected.customerName)}
              </span>
                  <span>
                <strong>{selected.customerName}</strong>
                <small>{selected.customerEmail}</small>
              </span>
                  <button><MoreHorizontal size={18} /></button>
                </div>

                <div className="confidence">
              <span>
                <Sparkles size={16} />
                {selected.aiProvider && selected.aiProvider !== "rules"
                    ? "Slimme AI-analyse"
                    : "AI-controle"}
              </span>
                  <strong>{selected.confidence}% vertrouwen</strong>
                </div>

                <div className="drawer-section">
                  <p className="drawer-label">SAMENVATTING</p>
                  <p>{selected.summary}</p>
                </div>

                {selectedQuote?.ready && (
                    <>
                      <section className="quote-ready-card">
                        <div>
                    <span className="quote-ready-icon">
                      <FileText size={18} />
                    </span>
                          <span>
                      <strong>
                        {selectedQuote.builder
                            ? "Offerte opgeslagen"
                            : "Klantgegevens compleet"}
                      </strong>
                      <small>
                        {selectedQuote.builder
                            ? `${selectedQuote.builder.quoteNumber} staat klaar voor controle.`
                            : "Open de offertebouwer, vul de commerciële gegevens aan en controleer de PDF."}
                      </small>
                    </span>
                        </div>
                        <button
                            className="quote-builder-toggle"
                            onClick={() => setQuoteBuilderOpen((current) => !current)}
                        >
                          {quoteBuilderOpen ? "Bouwer sluiten" : "Offerte opmaken"}
                          <ArrowRight size={15} />
                        </button>
                      </section>

                      {quoteBuilderOpen && quoteBuilder && currentQuoteTotals && (
                          <section className="quote-builder">
                            <div className="quote-builder-heading">
                              <div>
                                <p className="drawer-label">OFFERTEBOUWER</p>
                                <h3>{quoteBuilder.quoteNumber}</h3>
                                <span>
                          Bedragen worden in euro berekend. Controleer het
                          gekozen btw-tarief per regel.
                        </span>
                              </div>
                              <span
                                  className={`quote-readiness ${quoteIssues.length ? "incomplete" : "ready"}`}
                              >
                        {quoteIssues.length
                            ? `${quoteIssues.length} punt${quoteIssues.length === 1 ? "" : "en"} te vervolledigen`
                            : "Klaar voor verzending"}
                      </span>
                            </div>

                            <div className="quote-form-grid">
                              <label>
                                <span>Offertenummer</span>
                                <input
                                    value={quoteBuilder.quoteNumber}
                                    readOnly={quoteNumbering.mode === "automatic"}
                                    onChange={(event) =>
                                        updateQuoteField("quoteNumber", event.target.value)
                                    }
                                />
                                {quoteNumbering.mode === "automatic" && (
                                    <small>Wordt automatisch toegekend wanneer je de offerte opslaat.</small>
                                )}
                              </label>
                              <label>
                                <span>Offertedatum</span>
                                <input
                                    type="date"
                                    value={quoteBuilder.issueDate}
                                    onChange={(event) =>
                                        updateQuoteField("issueDate", event.target.value)
                                    }
                                />
                              </label>
                              <label>
                                <span>Geldig tot</span>
                                <input
                                    type="date"
                                    value={quoteBuilder.validUntil}
                                    onChange={(event) =>
                                        updateQuoteField("validUntil", event.target.value)
                                    }
                                />
                              </label>
                            </div>

                            <div className="quote-parties-grid">
                              <fieldset>
                                <legend>Bedrijfsgegevens</legend>
                                <p className="quote-company-source">
                                  Beheerd in <a href="/settings?tab=workspace">Instellingen › Workspacebeheer</a>
                                </p>
                                {(!quoteBuilder.companyAddress.trim() ||
                                    !quoteBuilder.companyVatNumber.trim() ||
                                    !quoteBuilder.companyEmail.trim()) && (
                                    <p className="quote-company-warning" role="status">
                                      Vul eerst je adres, btw-nummer en algemeen e-mailadres in bij Workspacebeheer.
                                    </p>
                                )}
                                <label>
                                  <span>Bedrijfsnaam</span>
                                  <input
                                      value={quoteBuilder.companyName}
                                      readOnly
                                      aria-label="Bedrijfsnaam uit Workspacebeheer"
                                  />
                                </label>
                                <label>
                                  <span>Adres</span>
                                  <textarea
                                      rows={2}
                                      value={quoteBuilder.companyAddress}
                                      readOnly
                                      aria-label="Bedrijfsadres uit Workspacebeheer"
                                  />
                                </label>
                                <div className="quote-inline-fields">
                                  <label>
                                    <span>Btw-nummer</span>
                                    <input
                                        placeholder="BE 0123.456.789"
                                        value={quoteBuilder.companyVatNumber}
                                        readOnly
                                        aria-label="Btw-nummer uit Workspacebeheer"
                                    />
                                  </label>
                                  <label>
                                    <span>E-mail</span>
                                    <input
                                        type="email"
                                        value={quoteBuilder.companyEmail}
                                        readOnly
                                        aria-label="Bedrijfs-e-mail uit Workspacebeheer"
                                    />
                                  </label>
                                </div>
                              </fieldset>

                              <fieldset>
                                <legend>Klantgegevens</legend>
                                <label>
                                  <span>Naam</span>
                                  <input
                                      value={quoteBuilder.customerName}
                                      onChange={(event) =>
                                          updateQuoteField(
                                              "customerName",
                                              event.target.value,
                                          )
                                      }
                                  />
                                </label>
                                <label>
                                  <span>Installatieadres</span>
                                  <textarea
                                      rows={2}
                                      value={quoteBuilder.customerAddress}
                                      onChange={(event) =>
                                          updateQuoteField(
                                              "customerAddress",
                                              event.target.value,
                                          )
                                      }
                                  />
                                </label>
                                <label>
                                  <span>E-mail</span>
                                  <input
                                      type="email"
                                      value={quoteBuilder.customerEmail}
                                      onChange={(event) =>
                                          updateQuoteField(
                                              "customerEmail",
                                              event.target.value,
                                          )
                                      }
                                  />
                                </label>
                              </fieldset>
                            </div>

                            <div className="quote-copy-fields">
                              <label>
                                <span>Titel</span>
                                <input
                                    value={quoteBuilder.title}
                                    onChange={(event) =>
                                        updateQuoteField("title", event.target.value)
                                    }
                                />
                              </label>
                              <label>
                                <span>Inleiding</span>
                                <textarea
                                    rows={3}
                                    value={quoteBuilder.introduction}
                                    onChange={(event) =>
                                        updateQuoteField("introduction", event.target.value)
                                    }
                                />
                              </label>
                            </div>

                            <div className="quote-lines-heading">
                              <div>
                                <strong>Offerteregels</strong>
                                <span>Vul bij Bedrag excl. gewoon de totaalprijs per onderdeel in. Btw en eindtotaal berekenen automatisch mee.</span>
                              </div>
                              <button onClick={addQuoteLine}>
                                <Plus size={15} />
                                Regel toevoegen
                              </button>
                            </div>

                            <div className="quote-lines">
                              <div className="quote-line quote-line-labels">
                                <span>Omschrijving</span>
                                <span>Aantal</span>
                                <span>Eenheid</span>
                                <span>Prijs/stuk excl.</span>
                                <span>Bedrag excl.</span>
                                <span>Btw</span>
                                <span>Totaal</span>
                                <span />
                              </div>
                              {quoteBuilder.lines.map((line) => (
                                  <div className="quote-line" key={line.id}>
                                    <input
                                        aria-label="Omschrijving"
                                        value={line.description}
                                        onChange={(event) =>
                                            updateQuoteLine(
                                                line.id,
                                                "description",
                                                event.target.value,
                                            )
                                        }
                                    />
                                    <input
                                        aria-label="Aantal"
                                        type="number"
                                        min="0.001"
                                        step="0.001"
                                        value={line.quantity}
                                        onChange={(event) =>
                                            updateQuoteLine(
                                                line.id,
                                                "quantity",
                                                Number(event.target.value) || 0,
                                            )
                                        }
                                    />
                                    <input
                                        aria-label="Eenheid"
                                        value={line.unit}
                                        onChange={(event) =>
                                            updateQuoteLine(
                                                line.id,
                                                "unit",
                                                event.target.value,
                                            )
                                        }
                                    />
                                    <input
                                        aria-label="Prijs exclusief btw"
                                        className="quote-money-input"
                                        inputMode="decimal"
                                        placeholder="0"
                                        value={
                                            quoteInputValues[`${line.id}:unitPrice`] ??
                                            (line.unitPriceCents
                                                ? String(line.unitPriceCents / 100)
                                                : "")
                                        }
                                        onChange={(event) =>
                                            updateQuoteMoneyInput(
                                                line.id,
                                                "unitPrice",
                                                event.target.value,
                                            )
                                        }
                                        onBlur={() => commitQuoteMoneyInput(line.id, "unitPrice")}
                                    />
                                    <input
                                        aria-label="Bedrag exclusief btw voor deze regel"
                                        className="quote-money-input quote-line-total-input"
                                        inputMode="decimal"
                                        placeholder="0"
                                        value={
                                            quoteInputValues[`${line.id}:lineTotal`] ??
                                            (line.quantity * line.unitPriceCents
                                                ? String(
                                                    (line.quantity * line.unitPriceCents) / 100,
                                                )
                                                : "")
                                        }
                                        onChange={(event) =>
                                            updateQuoteMoneyInput(
                                                line.id,
                                                "lineTotal",
                                                event.target.value,
                                            )
                                        }
                                        onBlur={() => commitQuoteMoneyInput(line.id, "lineTotal")}
                                    />
                                    <select
                                        aria-label="Btw-tarief"
                                        value={line.vatRate}
                                        onChange={(event) =>
                                            updateQuoteLine(
                                                line.id,
                                                "vatRate",
                                                Number(event.target.value),
                                            )
                                        }
                                    >
                                      {[0, 6, 12, 21].map((rate) => (
                                          <option key={rate} value={rate}>
                                            {rate}%
                                          </option>
                                      ))}
                                    </select>
                                    <strong>
                                      {formatEuro(
                                          Math.round(
                                              line.quantity *
                                              line.unitPriceCents *
                                              (1 + line.vatRate / 100),
                                          ),
                                      )}
                                    </strong>
                                    <button
                                        className="remove-quote-line"
                                        aria-label="Offerteregel verwijderen"
                                        disabled={quoteBuilder.lines.length === 1}
                                        onClick={() => removeQuoteLine(line.id)}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                              ))}
                            </div>

                            <div className="quote-lower-grid">
                              <div className="quote-notes">
                                <label>
                                  <span>Opmerkingen</span>
                                  <textarea
                                      rows={4}
                                      value={quoteBuilder.notes}
                                      onChange={(event) =>
                                          updateQuoteField("notes", event.target.value)
                                      }
                                  />
                                </label>
                                <label>
                                  <span>Betalingsvoorwaarden</span>
                                  <textarea
                                      rows={3}
                                      value={quoteBuilder.paymentTerms}
                                      onChange={(event) =>
                                          updateQuoteField(
                                              "paymentTerms",
                                              event.target.value,
                                          )
                                      }
                                  />
                                </label>
                              </div>
                              <div className="quote-totals">
                                <div>
                                  <span>Subtotaal</span>
                                  <strong>
                                    {formatEuro(currentQuoteTotals.subtotalCents)}
                                  </strong>
                                </div>
                                {currentQuoteTotals.vatGroups.map((group) => (
                                    <div key={group.rate}>
                                      <span>Btw {group.rate}%</span>
                                      <strong>{formatEuro(group.vatCents)}</strong>
                                    </div>
                                ))}
                                <div className="quote-grand-total">
                                  <span>Totaal incl. btw</span>
                                  <strong>
                                    {formatEuro(currentQuoteTotals.totalCents)}
                                  </strong>
                                </div>
                              </div>
                            </div>

                            <div className="quote-builder-footer">
                              <div className="quote-issues">
                                {quoteIssues.length ? (
                                    quoteIssues.map((issue) => (
                                        <span key={issue}>{issue}</span>
                                    ))
                                ) : (
                                    <span className="quote-complete">
                            Alle verplichte offertegegevens zijn ingevuld.
                          </span>
                                )}
                              </div>
                              <div className="quote-builder-actions">
                                {selectedQuote.builder && !quoteDirty ? (
                                    <a
                                        href={`/api/work-items/${selected.id}/quote`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                      <Download size={15} />
                                      PDF bekijken
                                    </a>
                                ) : (
                                    <button className="preview-disabled" disabled>
                                      <Download size={15} />
                                      Sla op voor PDF
                                    </button>
                                )}
                                <button
                                    className="save-quote-button"
                                    disabled={busy || !quoteDirty}
                                    onClick={saveQuoteBuilder}
                                >
                                  <Save size={15} />
                                  {busy ? "Opslaan…" : "Offerte opslaan"}
                                </button>
                              </div>
                            </div>
                          </section>
                      )}
                    </>
                )}

                <div className="message-comparison">
                  <section className="message-pane original-pane">
                    <div className="message-pane-heading">
                      <div>
                        <p className="drawer-label">ORIGINELE E-MAIL</p>
                        <h3>{selected.sourceSubject || "(Geen onderwerp)"}</h3>
                      </div>
                      <Mail size={18} />
                    </div>
                    <div className="mail-metadata">
                  <span>
                    Van <strong>{selected.customerEmail}</strong>
                  </span>
                      <span>{timeLabel(selected.receivedAt)}</span>
                    </div>
                    <pre className="original-message">
                  {selected.sourceBody ||
                      "De inhoud van deze oudere e-mail is nog niet opgeslagen."}
                </pre>
                  </section>

                  <section className="message-pane reply-pane">
                    <div className="message-pane-heading">
                      <div>
                        <p className="drawer-label">VOORGESTELD ANTWOORD</p>
                        <h3>Bewerk vóór verzending</h3>
                      </div>
                      <Sparkles size={18} />
                    </div>
                    <textarea
                        aria-label="Voorgesteld antwoord bewerken"
                        value={draftValue}
                        readOnly={closedStatuses.includes(selected.status)}
                        onChange={(event) => setDraftValue(event.target.value)}
                        spellCheck
                    />
                    <div className="editor-footer">
                  <span>
                    {closedStatuses.includes(selected.status)
                        ? "Dit antwoord is alleen-lezen in deze rubriek"
                        : draftValue === selected.draft
                            ? "Geen niet-opgeslagen wijzigingen"
                            : "Je hebt niet-opgeslagen wijzigingen"}
                  </span>
                      {!closedStatuses.includes(selected.status) && (
                          <div className="editor-footer-actions">
                            {selected.sourceBody?.trim() && (
                                <button
                                    className="save-draft-button"
                                    disabled={busy}
                                    onClick={reanalyzeItem}
                                    title="Analyseer de originele e-mail opnieuw"
                                >
                                  <Sparkles size={15} />
                                  Opnieuw genereren
                                </button>
                            )}
                            <button
                                className="save-draft-button"
                                disabled={
                                    busy ||
                                    !draftValue.trim() ||
                                    draftValue === selected.draft
                                }
                                onClick={saveDraft}
                            >
                              <Save size={15} />
                              Wijzigingen opslaan
                            </button>
                          </div>
                      )}
                    </div>
                  </section>
                </div>

                {selected.status === "dismissed" ? (
                    <div className="drawer-actions archive-actions">
                      {(selected.quoteStatus === "sent" ||
                          selected.quoteStatus === "viewed") && (
                          <button
                              className="secondary-button danger"
                              disabled={busy}
                              onClick={() => quoteAction(selected.id, "cancel")}
                          >
                            <Ban size={16} />
                            Offerte annuleren
                          </button>
                      )}
                      <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => restoreArchivedItem(selected.id)}
                      >
                        <RotateCcw size={16} />
                        Terugzetten
                      </button>
                      <button
                          className="delete-button"
                          disabled={busy}
                          onClick={() => deleteArchivedItem(selected.id)}
                      >
                        <Trash2 size={16} />
                        Definitief verwijderen
                      </button>
                    </div>
                ) : ["sent", "approved", "signed", "cancelled"].includes(selected.status) ? (
                    <div className="drawer-actions completed-actions">
                      {(selected.quoteStatus === "sent" ||
                          selected.quoteStatus === "viewed") && (
                          <div className="quote-actions">
                            <div className="quote-actions-row">
                              <button
                                  className="quote-action-button"
                                  disabled={busy}
                                  onClick={() => quoteAction(selected.id, "reminder")}
                              >
                                <BellRing size={15} />
                                Herinnering
                              </button>
                              <button
                                  className="quote-action-button success"
                                  disabled={busy}
                                  onClick={() => quoteAction(selected.id, "mark_signed")}
                              >
                                <PenLine size={15} />
                                Getekend
                              </button>
                            </div>
                            <label className="quote-label-select">
                              <Tag size={14} />
                              <select
                                  value={selected.label || ""}
                                  disabled={busy}
                                  onChange={(event) =>
                                      quoteAction(selected.id, "label", event.target.value)
                                  }
                              >
                                <option value="">Geen label</option>
                                {quoteLabelOptions.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                ))}
                              </select>
                            </label>
                          </div>
                      )}
                      <span className="completed-message">
                  <CheckCircle2 size={17} />
                        {selected.status === "signed"
                            ? "De klant heeft deze offerte ondertekend."
                            : selected.status === "cancelled"
                                ? "Deze offerte werd geannuleerd."
                                : "Dit dossier is verzonden en blijft bewaard in Verzonden."}
                </span>
                      {selected.status === "signed" && (
                          <a
                              className="secondary-button"
                              href={`/api/work-items/${selected.id}/signed-quote`}
                              target="_blank"
                              rel="noreferrer"
                          >
                            <Download size={16} />
                            Ondertekende PDF
                          </a>
                      )}
                      <button
                          className="secondary-button"
                          onClick={() => setSelectedId(null)}
                      >
                        Sluiten
                      </button>
                    </div>
                ) : (
                    <div className="drawer-actions">
                      <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => updateStatus(selected.id, "dismissed")}
                      >
                        <Archive size={16} />
                        Naar archief
                      </button>
                      <button
                          className="approve-button"
                          disabled={
                              busy ||
                              !integration ||
                              !draftValue.trim() ||
                              quoteBlocksSend
                          }
                          onClick={() => updateStatus(selected.id, "approved")}
                      >
                        <Check size={17} />
                        {busy
                            ? "Bezig…"
                            : quoteBlocksSend
                                ? "Maak de offerte eerst compleet"
                                : integration
                                    ? "Goedkeuren & verzenden"
                                    : "Koppel een mailbox om te verzenden"}
                        <Send size={16} />
                      </button>
                    </div>
                )}
              </aside>
            </>
        )}

        {composeOpen && (
            <div
                className="mailbox-modal-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setComposeOpen(false);
                }}
            >
              <form className="mailbox-modal" onSubmit={sendCompose}>
                <div className="mailbox-modal-heading">
                  <div>
                    <p className="drawer-label">NIEUWE MAIL</p>
                    <h2>Bericht opstellen</h2>
                  </div>
                  <button
                      type="button"
                      className="icon-button"
                      aria-label="Sluiten"
                      onClick={() => setComposeOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <label>
                  Aan
                  <input
                      type="email"
                      required
                      autoComplete="off"
                      placeholder="klant@voorbeeld.be"
                      value={composeForm.to}
                      onChange={(event) =>
                          setComposeForm({ ...composeForm, to: event.target.value })
                      }
                  />
                </label>
                <label>
                  Onderwerp
                  <input
                      required
                      autoComplete="off"
                      placeholder="Onderwerp van je bericht"
                      value={composeForm.subject}
                      onChange={(event) =>
                          setComposeForm({ ...composeForm, subject: event.target.value })
                      }
                  />
                </label>
                <label>
                  Bericht
                  <textarea
                      required
                      rows={8}
                      placeholder="Beste ..."
                      value={composeForm.body}
                      onChange={(event) =>
                          setComposeForm({ ...composeForm, body: event.target.value })
                      }
                  />
                </label>
                <button type="submit" className="approve-button" disabled={busy}>
                  <Send size={16} />
                  {busy ? "Verzenden…" : "Verzenden"}
                </button>
              </form>
            </div>
        )}

        {mailboxSetupOpen && (
            <div
                className="mailbox-modal-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setMailboxSetupOpen(false);
                }}
            >
              <form className="mailbox-modal" onSubmit={connectOwnMailbox}>
                <div className="mailbox-modal-heading">
                  <div>
                    <p className="drawer-label">EIGEN MAILBOX</p>
                    <h2>Eigen e-mail koppelen (IMAP/SMTP)</h2>
                  </div>
                  <button
                      type="button"
                      className="icon-button"
                      aria-label="Sluiten"
                      onClick={() => setMailboxSetupOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="mailbox-help">
                  Orelix controleert de mailbox eerst. Je wachtwoord wordt versleuteld opgeslagen.
                </p>
                <label>
                  E-mailadres
                  <input
                      type="email"
                      required
                      name="mailbox-account-email"
                      autoComplete="off"
                      placeholder="naam@jouwbedrijf.be"
                      value={mailboxForm.email}
                      onChange={(event) => setMailboxForm({ ...mailboxForm, email: event.target.value })}
                  />
                </label>
                <label>
                  Mailboxwachtwoord
                  <input
                      type="password"
                      required
                      name="mailbox-account-password"
                      autoComplete="new-password"
                      value={mailboxForm.password}
                      onChange={(event) => setMailboxForm({ ...mailboxForm, password: event.target.value })}
                  />
                </label>
                <div className="mail-server-grid">
                  <label>
                    IMAP-server
                    <input placeholder="imap.jouwprovider.be" autoComplete="off" value={mailboxForm.imapHost} onChange={(event) => setMailboxForm({ ...mailboxForm, imapHost: event.target.value })} required />
                  </label>
                  <label>
                    IMAP-poort
                    <input inputMode="numeric" value={mailboxForm.imapPort} onChange={(event) => setMailboxForm({ ...mailboxForm, imapPort: event.target.value })} required />
                  </label>
                  <label>
                    SMTP-server
                    <input placeholder="smtp.jouwprovider.be" autoComplete="off" value={mailboxForm.smtpHost} onChange={(event) => setMailboxForm({ ...mailboxForm, smtpHost: event.target.value })} required />
                  </label>
                  <label>
                    SMTP-poort
                    <input inputMode="numeric" value={mailboxForm.smtpPort} onChange={(event) => setMailboxForm({ ...mailboxForm, smtpPort: event.target.value })} required />
                  </label>
                </div>
                <div className="mailbox-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setMailboxSetupOpen(false)}>Annuleren</button>
                  <button type="submit" className="approve-button" disabled={busy}>
                    <Check size={16} />
                    {busy ? "Controleren…" : "Mailbox controleren"}
                  </button>
                </div>
              </form>
            </div>
        )}

        {manualQuoteOpen && (
            <div
                className="mailbox-modal-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setManualQuoteOpen(false);
                }}
            >
              <form className="mailbox-modal manual-quote-modal" onSubmit={createManualQuote}>
                <div className="mailbox-modal-heading">
                  <div>
                    <p className="drawer-label">HANDMATIGE OFFERTE</p>
                    <h2>Maak zelf een offerte</h2>
                  </div>
                  <button
                      type="button"
                      className="icon-button"
                      aria-label="Sluiten"
                      onClick={() => setManualQuoteOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="mailbox-help">
                  Maak een dossier zonder e-mail.
                </p>
                <label>
                  Naam van de klant
                  <input
                      required
                      autoFocus
                      value={manualQuoteForm.customerName}
                      onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, customerName: event.target.value })}
                      placeholder="Bijvoorbeeld klantnaam"
                  />
                </label>
                <label>
                  E-mailadres van de klant
                  <input
                      required
                      type="email"
                      value={manualQuoteForm.customerEmail}
                      onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, customerEmail: event.target.value })}
                      placeholder="jan@voorbeeld.be"
                  />
                </label>
                <div className="manual-address-fields">
                  <span>Installatieadres</span>
                  <label>
                    Straat
                    <input
                        required
                        value={manualQuoteForm.street}
                        onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, street: event.target.value })}
                        placeholder="Kerkstraat"
                    />
                  </label>
                  <div className="manual-address-row">
                    <label>
                      Nummer
                      <input
                          required
                          value={manualQuoteForm.houseNumber}
                          onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, houseNumber: event.target.value })}
                          placeholder="10"
                      />
                    </label>
                    <label>
                      Bus <span className="field-optional">(optioneel)</span>
                      <input
                          value={manualQuoteForm.box}
                          onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, box: event.target.value })}
                          placeholder="2"
                      />
                    </label>
                  </div>
                  <div className="manual-address-row manual-address-locality">
                    <label>
                      Postcode
                      <input
                          required
                          inputMode="numeric"
                          value={manualQuoteForm.postalCode}
                          onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, postalCode: event.target.value })}
                          placeholder="3200"
                      />
                    </label>
                    <label>
                      Gemeente
                      <input
                          required
                          value={manualQuoteForm.city}
                          onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, city: event.target.value })}
                          placeholder="Aarschot"
                      />
                    </label>
                  </div>
                </div>
                <label>
                  Titel van de offerte
                  <input
                      required
                      value={manualQuoteForm.title}
                      onChange={(event) => setManualQuoteForm({ ...manualQuoteForm, title: event.target.value })}
                  />
                </label>
                <div className="mailbox-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setManualQuoteOpen(false)}>Annuleren</button>
                  <button type="submit" className="approve-button" disabled={busy}>
                    <FileText size={16} />
                    {busy ? "Aanmaken…" : "Offerte opmaken"}
                  </button>
                </div>
              </form>
            </div>
        )}

        {mailboxPickerOpen && (
            <div
                className="mailbox-picker-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setMailboxPickerOpen(false);
                }}
            >
              <section className="mailbox-picker" role="dialog" aria-modal="true" aria-labelledby="mailbox-picker-title">
                <button type="button" className="icon-button mailbox-picker-close" aria-label="Sluiten" onClick={() => setMailboxPickerOpen(false)}>
                  <X size={19} />
                </button>
                <p className="eyebrow">MAILBOX KOPPELEN</p>
                <h2 id="mailbox-picker-title">Welke e-mail gebruikt je bedrijf?</h2>
                <p className="mailbox-picker-intro">Kies je provider.</p>
                <a className="mailbox-option active" href="/api/integrations/gmail/start">
                  <span className="mailbox-provider-mark gmail">G</span>
                  <span><strong>Gmail</strong><small>Google Workspace of Gmail</small></span>
                  <ArrowRight size={18} />
                </a>
                <div className="mailbox-option disabled" aria-disabled="true">
                  <span className="mailbox-provider-mark microsoft">M</span>
                  <span><strong>Outlook & Microsoft 365</strong><small>Binnenkort beschikbaar</small></span>
                  <span className="coming-soon">Binnenkort</span>
                </div>
                <button
                    type="button"
                    className="mailbox-option active"
                    onClick={() => { setMailboxPickerOpen(false); setMailboxSetupOpen(true); }}
                >
                  <span className="mailbox-provider-mark imap"><Mail size={17} /></span>
                  <span><strong>Eigen e-mail (IMAP/SMTP)</strong><small>Easyhost, Combell, TransIP en andere</small></span>
                  <ArrowRight size={18} />
                </button>
              </section>
            </div>
        )}

        {toast && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {toast}
            </div>
        )}
      </div>
  );
}

type ParsedQuoteConcept = {
  ready: boolean;
  title: string;
  introduction: string;
  scope: string[];
  assumptions: string[];
  validityDays: number;
  builder: QuoteBuilder | null;
};

function parseQuoteConcept(value?: string): ParsedQuoteConcept | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      ready?: boolean;
      title?: string;
      introduction?: string;
      scope?: unknown;
      assumptions?: unknown;
      validityDays?: unknown;
      builder?: unknown;
    };
    let builder: QuoteBuilder | null = null;
    if (parsed.builder) {
      try {
        builder = normalizeQuoteBuilder(parsed.builder);
      } catch {
        builder = null;
      }
    }
    return {
      ready: parsed.ready === true,
      title: parsed.title || "",
      introduction: parsed.introduction || "",
      scope: Array.isArray(parsed.scope)
          ? parsed.scope.filter((entry): entry is string => typeof entry === "string")
          : [],
      assumptions: Array.isArray(parsed.assumptions)
          ? parsed.assumptions.filter(
              (entry): entry is string => typeof entry === "string",
          )
          : [],
      validityDays:
          typeof parsed.validityDays === "number" ? parsed.validityDays : 30,
      builder,
    };
  } catch {
    return null;
  }
}

function createDefaultQuoteBuilder(
    item: WorkItem,
    concept: ParsedQuoteConcept,
    company: { name: string; address: string; vatNumber: string; email: string },
    quoteNumbering: QuoteNumberingSettings,
): QuoteBuilder {
  const issueDate = dateInputValue(new Date());
  const validUntilDate = new Date();
  validUntilDate.setDate(
      validUntilDate.getDate() + Math.max(1, concept.validityDays),
  );
  const extracted = parseObject(item.extractedJson);
  const scope = concept.scope.length
      ? concept.scope
      : ["Levering en installatie van zonnepanelen"];
  return {
    version: 1,
    quoteNumber: formatQuoteNumber(quoteNumbering, Number(issueDate.slice(0, 4))),
    issueDate,
    validUntil: dateInputValue(validUntilDate),
    companyName: company.name,
    companyAddress: company.address,
    companyVatNumber: company.vatNumber,
    companyEmail: company.email,
    customerName: item.customerName,
    customerEmail: item.customerEmail,
    customerAddress:
        typeof extracted.address === "string" ? extracted.address : "",
    title: concept.title || "Offerte zonnepanelen",
    introduction:
        concept.introduction ||
        `Beste ${item.customerName}, hierbij bezorgen wij u ons voorstel voor uw zonnepaneleninstallatie.`,
    lines: scope.map((description, index) => ({
      id: `line_${index + 1}`,
      description,
      quantity: 1,
      unit: "project",
      unitPriceCents: 0,
      vatRate: 21,
    })),
    notes: concept.assumptions.join("\n"),
    paymentTerms:
        "Betaling volgens de overeengekomen voorwaarden. De planning wordt na aanvaarding in overleg vastgelegd.",
  };
}

function applyWorkspaceCompanyDetails(
    builder: QuoteBuilder,
    company: { name: string; address: string; vatNumber: string; email: string },
): QuoteBuilder {
  return {
    ...builder,
    companyName: company.name,
    companyAddress: company.address,
    companyVatNumber: company.vatNumber,
    companyEmail: company.email,
  };
}

function mergeQuoteBuilder(value: string | undefined, builder: QuoteBuilder) {
  const stored = parseObject(value);
  return JSON.stringify({ ...stored, builder });
}

function euroInputToCents(value: string) {
  const compact = value.replace(/[^\d,.-]/g, "").replace(/-/g, "");
  if (!compact) return 0;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const hasBothSeparators = lastComma !== -1 && lastDot !== -1;
  const lastSeparator = Math.max(lastComma, lastDot);
  if (!hasBothSeparators && lastSeparator !== -1 && compact.length - lastSeparator - 1 === 3) {
    return Math.max(0, Math.round((Number(compact.replace(/[.,]/g, "")) || 0) * 100));
  }
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  const normalized = compact
      .replace(decimalSeparator === "," ? /\./g : /,/g, "")
      .replace(decimalSeparator, ".");
  return Math.max(0, Math.round((Number(normalized) || 0) * 100));
}

function quoteEmailDraft(builder: QuoteBuilder) {
  const firstName = builder.customerName.trim().split(/\s+/)[0] || "klant";
  return (
      `Beste ${firstName},\n\n` +
      `In bijlage vindt u onze offerte ${builder.quoteNumber} voor ${builder.title.toLowerCase()}.\n\n` +
      `Het totaalbedrag bedraagt ${formatEuro(quoteTotals(builder).totalCents)} inclusief btw. ` +
      `De offerte is geldig tot en met ${new Intl.DateTimeFormat("nl-BE").format(new Date(`${builder.validUntil}T00:00:00`))}.\n\n` +
      "Heeft u nog vragen of wenst u iets aan te passen, dan helpen wij u graag verder.\n\n" +
      `Met vriendelijke groeten,\n${builder.companyName}`
  );
}

function parseObject(value?: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    return {};
  }
}

function dateInputValue(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Brussels",
  }).format(value);
}