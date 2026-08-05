"use client";

import {
  Archive,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Save,
  Send,
  Settings,
  Sparkles,
  RotateCcw,
  RefreshCw,
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
};

type Module = {
  id: string;
  name: string;
  description: string;
  status: string;
};

type MailboxIntegration = {
  provider: "gmail" | "imap_smtp";
  status: string;
  accountEmail: string;
  updatedAt: string;
};

type AssignableModuleId =
  | "quote_assistant"
  | "inbox_assistant"
  | "service_assistant";

const closedStatuses = ["sent", "dismissed", "approved", "signed"];

const recordStatusLabels: Record<string, string> = {
  needs_approval: "Goedkeuren",
  draft_ready: "Concept",
  sent: "Verzonden",
  viewed: "Bekeken",
  approved: "Goedgekeurd",
  signed: "Ondertekend",
  dismissed: "Archief",
  routed: "Openstaand",
};

const moduleIcons = {
  quote_assistant: FileText,
  inbox_assistant: Inbox,
  service_assistant: Wrench,
  planning_assistant: CalendarDays,
  crm_assistant: Users,
};

const moduleLabels: Record<string, string> = {
  quote_assistant: "Offerte",
  inbox_assistant: "Inbox",
  service_assistant: "Service",
  planning_assistant: "Planning",
  crm_assistant: "CRM",
};

const assignableModules: { id: AssignableModuleId; name: string }[] = [
  { id: "quote_assistant", name: "Offerte Assistent" },
  { id: "inbox_assistant", name: "Inbox Assistent" },
  { id: "service_assistant", name: "Service Assistent" },
];

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
  // A hot reload can leave the dashboard visible after its WorkOS cookie has
  // expired. Never let that stale UI submit mailbox credentials as though the
  // user were still signed in.
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
}: {
  displayName: string;
  organizationName: string;
  userName: string;
  companyAddress: string;
  companyVatNumber: string;
  companyEmail: string;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceSection, setWorkspaceSection] = useState<"inbox" | "quotes">("inbox");
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(true);
  const [syncingInbox, setSyncingInbox] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [integration, setIntegration] = useState<MailboxIntegration | null>(null);
  const [mailboxPickerOpen, setMailboxPickerOpen] = useState(false);
  const [mailboxMenuOpen, setMailboxMenuOpen] = useState(false);
  const mailboxControlRef = useRef<HTMLDivElement | null>(null);
  const [mailboxSetupOpen, setMailboxSetupOpen] = useState(false);
  const [manualQuoteOpen, setManualQuoteOpen] = useState(false);
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
      setModules(Array.isArray(data.modules) ? data.modules : []);
      setIntegration(data.integration || null);
    } catch {
      setItems([]);
      setModules([]);
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
        // A connected mailbox is not necessarily the business contact address
        // that belongs on a legal quote. Quotes may only use the workspace
        // profile, which is shared by the whole team.
        email: companyEmail,
      };
      const finalQuote = ["sent", "viewed", "signed"].includes(selected.quoteStatus || "");
      const builder = quote.builder
        ? finalQuote
          ? quote.builder
          : applyWorkspaceCompanyDetails(quote.builder, company)
        : createDefaultQuoteBuilder(selected, quote, company);
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
  const emailItems = items.filter(
    (item) => item.moduleId !== "quote_assistant" && !item.quoteStatus,
  );
  const sectionItems = workspaceSection === "quotes" ? quoteItems : emailItems;

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
  const receivedToday = items.filter(
    (item) => belgianDateKey(item.receivedAt) === belgianDateKey(new Date()),
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
    // Keep a trailing decimal separator visible while the user is still
    // typing (for example "4007,"), instead of formatting it away.
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
      };
      if (!response.ok) throw new Error(data.error || "Offerte opslaan mislukt");
      if (!data.builder) throw new Error("De opgeslagen offerte ontbreekt");
      setItems((current) =>
        current.map((item) =>
          item.id === selected.id
            ? {
                ...item,
                draft: emailDraft,
                quoteJson: mergeQuoteBuilder(item.quoteJson, data.builder),
              }
            : item,
        ),
      );
      setQuoteBuilder(data.builder);
      setQuoteSavedSnapshot(JSON.stringify(data.builder));
      setDraftValue(emailDraft);
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

  async function reassignItem(moduleId: AssignableModuleId) {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selected.id, moduleId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Toewijzen mislukt");
      setItems((current) =>
        current.map((item) => (item.id === selected.id ? data.item : item)),
      );
      setDraftValue(data.item.draft);
      const assistant = assignableModules.find((entry) => entry.id === moduleId);
      setToast(
        `Opnieuw geanalyseerd door ${assistant?.name || "de gekozen assistent"}`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "Toewijzen lukte niet. Probeer het opnieuw.",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 4200);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <span>Orelix <strong>Office</strong></span>
        </div>

        <div className="workspace-switcher">
          <span className="workspace-logo">{initials(organizationName)}</span>
          <span>
            <strong>{organizationName}</strong>
            <small>Hoofdworkspace</small>
          </span>
          <ChevronDown size={15} />
        </div>

        <nav className="main-nav" aria-label="Hoofdnavigatie">
          <a className="active" href="#overzicht">
            <LayoutDashboard size={18} />
            Overzicht
          </a>
          <a href="#werk">
            <Zap size={18} />
            Werk voor jou
            {!syncing && openItems.length > 0 && (
              <span className="nav-count">{openItems.length}</span>
            )}
          </a>
          <a href="#dossiers">
            <MessageSquareText size={18} />
            Dossiers
          </a>
          <a href="#contacten">
            <Users size={18} />
            Contacten
          </a>
        </nav>

        <p className="nav-kicker">ASSISTENTEN</p>
        <nav className="assistant-nav" aria-label="Assistenten">
          <a className="assistant-active" href="#offerte">
            <FileText size={17} />
            Offerte
            <span className="status-dot" />
          </a>
          <a className="muted" href="#inbox">
            <Inbox size={17} />
            Inbox
            <small>Bèta</small>
          </a>
          <a className="muted" href="#service">
            <Wrench size={17} />
            Service
            <small>Bèta</small>
          </a>
          <a href="planning">
            <CalendarDays size={17} />
            Planning
          </a>
          <a className="muted" href="#crm">
            <Users size={17} />
            CRM
          </a>
        </nav>

        <div className="sidebar-bottom">
          <a href="settings">
            <Settings size={17} />
            Instellingen
          </a>
          <a href="#help">
            <CircleHelp size={17} />
            Help & feedback
          </a>
          <div className="profile">
            <span className="profile-avatar">{initials(userName)}</span>
            <span>
              <strong>{userName}</strong>
              <small>Administrator</small>
            </span>
            <MoreHorizontal size={17} />
          </div>
          <a className="logout-link" href="/logout">
            <LogOut size={17} />
            Uitloggen
          </a>
        </div>
      </aside>

      <main className="main-content" id="overzicht">
        <header className="topbar">
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Zoeken"
              placeholder="Zoek klant, dossier of e-mail..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </label>
          <button className="icon-button" aria-label="Meldingen">
            <Bell size={19} />
            <span className="notification-dot" />
          </button>
          <button
            type="button"
            className="primary-button quick-quote-button"
            onClick={() => setManualQuoteOpen(true)}
          >
            <Plus size={16} />
            Nieuwe offerte
          </button>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">{currentDateLabel()}</p>
              <h1>Goedemorgen, {displayName}.</h1>
              <p>Je digitale team heeft alvast het voorwerk gedaan.</p>
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

          <section className="metric-grid" aria-label="Dagoverzicht">
            <article>
              <span className="metric-icon coral">
                <Zap size={20} />
              </span>
              <div>
                <strong>{syncing ? "—" : openItems.length}</strong>
                <span>Wachten op jou</span>
              </div>
              <small>{syncing ? "Laden…" : "Actuele werkvoorraad"}</small>
            </article>
            <article>
              <span className="metric-icon blue">
                <Mail size={20} />
              </span>
              <div>
                <strong>{syncing ? "—" : receivedToday}</strong>
                <span>Ontvangen vandaag</span>
              </div>
              <small>{syncing ? "Laden…" : "Via gekoppelde inbox"}</small>
            </article>
            <article>
              <span className="metric-icon green">
                <Clock3 size={20} />
              </span>
              <div>
                <strong>—</strong>
                <span>Tijd bespaard</span>
              </div>
              <small>Nog niet gemeten</small>
            </article>
            <article>
              <span className="metric-icon lilac">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <strong>—</strong>
                <span>Automatisch juist</span>
              </div>
              <small>Nog niet gemeten</small>
            </article>
          </section>

          <div className="dashboard-grid">
            <section className="work-panel" id="werk">
              <div className="workspace-tabs" role="tablist" aria-label="Werkruimtes">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceSection === "inbox"}
                  className={workspaceSection === "inbox" ? "selected" : ""}
                  onClick={() => {
                    setWorkspaceSection("inbox");
                    setFilter("open");
                  }}
                >
                  Inbox <span>{emailItems.filter((item) => !closedStatuses.includes(item.status)).length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceSection === "quotes"}
                  className={workspaceSection === "quotes" ? "selected" : ""}
                  onClick={() => {
                    setWorkspaceSection("quotes");
                    setFilter("open");
                  }}
                >
                  Offertes <span>{quoteItems.filter((item) => !closedStatuses.includes(item.status)).length}</span>
                </button>
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    {filter === "all_records"
                      ? "Alle dossiers"
                      : "Werk voor jou klaar"}
                  </h2>
                  <p>
                    {filter === "all_records"
                      ? "Openstaand, verzonden en gearchiveerd op één plek."
                      : "Alleen beslissingen die jouw aandacht nodig hebben."}
                  </p>
                </div>
                <div className="section-heading-actions">
                  <button
                    className="text-button"
                    onClick={() =>
                      setFilter(filter === "all_records" ? "open" : "all_records")
                    }
                  >
                    {filter === "all_records"
                      ? "Terug naar openstaand"
                      : "Alles bekijken"}{" "}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>

              <div className="filter-row">
                {filter === "all_records" && (
                  <button className="selected" onClick={() => setFilter("open")}>
                    Alle items <span>{sectionItems.length}</span>
                  </button>
                )}
                {(workspaceSection === "quotes"
                  ? [
                      ["open", "Aanvragen", openItems.length],
                      ["approval", "Goedkeuren", approvalItems.length],
                      ["drafts", "Concepten", draftItems.length],
                      ["sent", "Verzonden", sentItems.length],
                      ["viewed", "Bekeken", viewedItems.length],
                      ["signed", "Getekend", signedItems.length],
                      ["archive", "Archief", archivedItems.length],
                    ]
                  : [
                      ["open", "Openstaand", openItems.length],
                      ["archive", "Archief", archivedItems.length],
                    ]
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    className={filter === value ? "selected" : ""}
                    onClick={() => setFilter(String(value))}
                  >
                    {label} <span>{count}</span>
                  </button>
                ))}
                {syncing && <small className="sync-label">Synchroniseren…</small>}
              </div>

              <div className="work-list">
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
                {!syncing && !loadError && visibleItems.map((item) => (
                  <button
                    key={item.id}
                    className="work-item"
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className={`avatar ${item.moduleId}`}>
                      {initials(item.customerName)}
                    </span>
                    <span className="work-copy">
                      <span className="work-meta">
                        <span className={`module-tag ${item.moduleId}`}>
                          {moduleLabels[item.moduleId]}
                        </span>
                        <span>{timeLabel(item.receivedAt)}</span>
                      </span>
                      <strong>{item.customerName}</strong>
                      <b>{item.title}</b>
                      <small>{item.summary}</small>
                    </span>
                    <span className="work-aside">
                      {item.priority === "high" && (
                        <span className="priority">Prioriteit</span>
                      )}
                      <span
                        className={`record-state record-state-${item.status}`}
                      >
                        {recordStatusLabels[item.quoteStatus || item.status] || item.dueLabel}
                      </span>
                      <ChevronRight size={19} />
                    </span>
                  </button>
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
                  <div className="empty-state">
                    {filter === "archive" ? (
                      <Archive size={28} />
                    ) : (
                      <CheckCircle2 size={28} />
                    )}
                    <strong>
                      {filter === "archive"
                        ? "Archief is leeg"
                        : filter === "sent"
                          ? "Nog niets verzonden"
                          : filter === "viewed"
                            ? "Nog geen bekeken offertes"
                            : filter === "signed"
                              ? "Nog geen getekende offertes"
                          : "Alles bijgewerkt"}
                    </strong>
                    <span>Geen dossiers gevonden in deze rubriek.</span>
                  </div>
                )}
              </div>
            </section>

            <aside className="right-column">
              <section className="assistants-card">
                <div className="section-heading compact">
                  <div>
                    <h2>Jouw assistenten</h2>
                    <p>Eén team, elk met een eigen specialisme.</p>
                  </div>
                </div>
                <div className="module-list">
                  {syncing &&
                    Array.from({ length: 5 }).map((_, index) => (
                      <div className="module-row-skeleton" key={index}>
                        <span className="skeleton-block module-skeleton-icon" />
                        <span className="skeleton-copy">
                          <span className="skeleton-block medium" />
                          <span className="skeleton-block long" />
                        </span>
                      </div>
                    ))}
                  {!syncing && modules.map((module) => {
                    const Icon =
                      moduleIcons[module.id as keyof typeof moduleIcons] ?? Sparkles;
                    return (
                      <button className="module-row" key={module.id}>
                        <span className={`module-icon ${module.id}`}>
                          <Icon size={19} />
                        </span>
                        <span>
                          <strong>{module.name}</strong>
                          <small>{module.description}</small>
                        </span>
                        {module.status === "active" ? (
                          <span className="live-state">
                            <i /> Actief
                          </span>
                        ) : module.status === "beta" ? (
                          <span className="beta-state">Bèta</span>
                        ) : (
                          <span className="soon-state">Binnenkort</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button className="manage-button">
                  Assistenten beheren <ArrowRight size={15} />
                </button>
              </section>

              <section className="insight-card">
                <div className="insight-orbit">
                  <Sparkles size={21} />
                </div>
                <div>
                  <p>ORELIX INZICHT</p>
                  <h3>Je workspace is klaar.</h3>
                  <span>
                    Nieuwe Gmail-berichten worden verwerkt zodra ze binnenkomen.
                    Alleen acties die jouw aandacht vragen verschijnen hier.
                  </span>
                  <button>Bekijk je werk <ArrowRight size={14} /></button>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </main>

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

            <label className="assignment-control">
              <span>
                <strong>Toewijzen aan</strong>
                <small>
                  Verwerk de originele e-mail opnieuw met deze assistent
                </small>
              </span>
              <select
                aria-label="Toewijzen aan assistent"
                value={selected.moduleId}
                disabled={busy}
                onChange={(event) =>
                  reassignItem(event.target.value as AssignableModuleId)
                }
              >
                {assignableModules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="assignment-actions">
              <button
                className="secondary-button reanalyze-button"
                disabled={busy}
                onClick={() => reassignItem(selected.moduleId as AssignableModuleId)}
              >
                <Sparkles size={15} />
                Opnieuw analyseren
              </button>
              <small>Gebruik dit wanneer je het antwoord wilt laten herbekijken.</small>
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
                          onChange={(event) =>
                            updateQuoteField("quoteNumber", event.target.value)
                          }
                        />
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
                            Vul eerst je adres, btw-nummer en algemeen e-mailadres in bij Workspacebeheer. Deze gegevens worden niet uit je persoonlijke mailbox overgenomen.
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
                    "De inhoud van deze oudere e-mail is nog niet opgeslagen. Bij nieuwe berichten verschijnt hier altijd de volledige originele tekst."}
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
                  )}
                </div>
              </section>
            </div>

            {selected.status === "dismissed" ? (
              <div className="drawer-actions archive-actions">
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
            ) : ["sent", "approved", "signed"].includes(selected.status) ? (
              <div className="drawer-actions completed-actions">
                <span className="completed-message">
                  <CheckCircle2 size={17} />
                  {selected.status === "signed"
                    ? "De klant heeft deze offerte ondertekend."
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
              Orelix controleert de mailbox eerst. Je wachtwoord wordt versleuteld opgeslagen en verschijnt nooit opnieuw in Orelix.
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
                data-1p-ignore="true"
                data-lpignore="true"
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
              Maak een dossier zonder e-mail. Daarna vul je de offerte, bedragen en begeleidende e-mail in voordat je ze verstuurt.
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
            <p className="mailbox-picker-intro">Kies je provider. Je kan later altijd een andere mailbox koppelen.</p>
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
              <span><strong>Eigen e-mail (IMAP/SMTP)</strong><small>Easyhost, Combell, TransIP en andere providers</small></span>
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
    quoteNumber: `OFF-${issueDate.slice(0, 4)}-${item.id.replace(/\W/g, "").slice(-6).toUpperCase()}`,
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
    "Heeft u nog vragen of wenst u iets aan te passen, dan helpen we u graag verder.\n\n" +
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
