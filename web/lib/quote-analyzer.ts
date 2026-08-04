export type QuoteAnalysis = {
  moduleId: "quote_assistant" | "service_assistant" | "inbox_assistant";
  kind: "quote_request" | "missing_information" | "service_request" | "manual";
  title: string;
  summary: string;
  status: "needs_approval" | "draft_ready" | "routed";
  confidence: number;
  draft: string;
};

export type AssignableModuleId = QuoteAnalysis["moduleId"];

const solarTerms = [
  "zonnepaneel",
  "zonnepanelen",
  "solar",
  "pv",
  "thuisbatterij",
  "batterij",
  "omvormer",
];
const quoteTerms = [
  "offerte",
  "prijs",
  "kosten",
  "raming",
  "ik wil",
  "ik wens",
  "ik zou graag",
  "interesse",
  "bestellen",
  "aanvragen",
  "kunnen jullie",
  "quote",
  "estimate",
  "would like",
];
const serviceTerms = [
  "storing",
  "defect",
  "werkt niet",
  "foutcode",
  "reparatie",
  "onderhoud",
  "repair",
  "broken",
  "fault",
  "maintenance",
];

const missingFieldCopy: Record<
  string,
  { summary: string; question: string }
> = {
  address: {
    summary: "Volledig installatieadres ontbreekt",
    question:
      "Wat is het volledige installatieadres? Graag straat, huisnummer, postcode en gemeente.",
  },
  buildingAge: {
    summary: "Leeftijd van de woning ontbreekt",
    question: "Is de woning ouder dan 10 jaar? (Ja/nee)",
  },
  property: {
    summary: "Type pand ontbreekt",
    question: "Gaat het om een woning, appartement of bedrijfspand?",
  },
  usage: {
    summary: "Jaarlijks elektriciteitsverbruik ontbreekt",
    question:
      "Wat is uw jaarlijkse elektriciteitsverbruik in kWh? U vindt dit meestal op uw laatste jaarafrekening.",
  },
  roof: {
    summary: "Type dak ontbreekt",
    question:
      "Welk type dak heeft het gebouw, bijvoorbeeld een pannendak, leien dak of plat dak?",
  },
  battery: {
    summary: "Voorkeur voor thuisbatterij ontbreekt",
    question:
      "Wenst u een thuisbatterij in combinatie met de zonnepanelen? (Ja/nee)",
  },
  timeline: {
    summary: "Gewenste timing ontbreekt",
    question: "Wanneer zou u de installatie idealiter willen laten uitvoeren?",
  },
};

export function analyzeInboundEmail(
  subject: string,
  body: string,
  senderName: string,
): QuoteAnalysis {
  return analyzeEmail(subject, body, senderName);
}

export function analyzeEmailForModule(
  moduleId: AssignableModuleId,
  subject: string,
  body: string,
  senderName: string,
): QuoteAnalysis {
  return analyzeEmail(subject, body, senderName, moduleId);
}

function analyzeEmail(
  subject: string,
  body: string,
  senderName: string,
  forcedModuleId?: AssignableModuleId,
): QuoteAnalysis {
  const text = `${subject}\n${stripQuotedHistory(body)}`.toLowerCase();
  const customerName = inferCustomerName(body, senderName);
  const hasSolar = solarTerms.some((term) => text.includes(term));
  const hasService = serviceTerms.some((term) => text.includes(term));
  const hasQuote = quoteTerms.some((term) => text.includes(term));

  if (
    forcedModuleId === "service_assistant" ||
    (!forcedModuleId && hasSolar && hasService && !hasQuote)
  ) {
    return {
      moduleId: "service_assistant",
      kind: "service_request",
      title:
        forcedModuleId === "service_assistant"
          ? "Toegewezen aan Service Assistent"
          : "Servicevraag herkend",
      summary: conciseSummary(subject, body),
      status: "routed",
      confidence: forcedModuleId ? 100 : 92,
      draft:
        "Deze e-mail is als servicevraag herkend en staat klaar voor behandeling door de Service Assistent.",
    };
  }

  if (
    forcedModuleId === "inbox_assistant" ||
    (!forcedModuleId && (!hasSolar || !hasQuote))
  ) {
    return {
      moduleId: "inbox_assistant",
      kind: "manual",
      title:
        forcedModuleId === "inbox_assistant"
          ? "Toegewezen aan Inbox Assistent"
          : "Handmatige controle nodig",
      summary: conciseSummary(subject, body),
      status: "routed",
      confidence: forcedModuleId ? 100 : 70,
      draft: "Controleer deze e-mail en wijs hem toe aan de juiste assistent.",
    };
  }

  const fields = extractFields(text);
  // Keep the first intake short and useful. Property type, battery preference
  // and desired timing can be refined later and should not block a proposal.
  const missing = (["address", "buildingAge", "usage", "roof", "battery"] as const)
    .filter((key) => !fields[key]);
  if (missing.length) {
    return {
      moduleId: "quote_assistant",
      kind: "missing_information",
      title: "Ontbrekende gegevens",
      summary: missing.map((key) => missingFieldCopy[key].summary).join(" · "),
      status: "draft_ready",
      confidence: 94,
      draft:
        `Beste ${firstName(customerName)},\n\n` +
        "Hartelijk dank voor uw interesse in First Client BV.\n\n" +
        "We hebben uw aanvraag voor een offerte voor zonnepanelen goed ontvangen. Om een correcte en gepersonaliseerde offerte op te stellen, vragen we u om ons nog volgende gegevens te bezorgen:\n\n" +
        missing
          .map((key) => `• ${missingFieldCopy[key].question}`)
          .join("\n") +
        "\n\nMet deze informatie kunnen wij uw offerte zo nauwkeurig mogelijk opmaken. Indien we bijkomende vragen hebben om uw dossier volledig te maken, nemen wij persoonlijk contact met u op.\n\nZodra de offerte naar wens is, plannen we graag een huisbezoek in om de situatie ter plaatse te bekijken en de installatie verder te bespreken.\n\nMet vriendelijke groeten,\nFirst Client BV",
    };
  }

  const details = [
    fields.usage,
    fields.roof,
    fields.battery,
  ].filter(Boolean);
  const recordedDetails = [
    `Installatieadres: ${fields.address}`,
    fields.property && `Type pand: ${fields.property}`,
    fields.buildingAge && `Woning ouder dan 10 jaar: ${fields.buildingAge}`,
    `Verbruik of gewenst aantal panelen: ${fields.usage}`,
    `Type dak: ${fields.roof}`,
    fields.battery && `Thuisbatterij: ${fields.battery}`,
    fields.timeline && `Gewenste timing: ${fields.timeline}`,
  ]
    .filter(Boolean)
    .map((detail) => `• ${detail}`)
    .join("\n");
  return {
    moduleId: "quote_assistant",
    kind: "quote_request",
    title: "Aanvraag compleet — offerte voorbereiden",
    summary: details.join(" · "),
    status: "needs_approval",
    confidence: 96,
    draft:
      `Beste ${firstName(customerName)},\n\n` +
      "Bedankt voor uw aanvraag voor zonnepanelen. We hebben de volgende gegevens genoteerd:\n\n" +
      `${recordedDetails}\n\n` +
      "Ons team controleert nu de technische gegevens en bereidt op basis daarvan een passend offertevoorstel voor. Als we nog iets moeten verduidelijken, nemen we eerst contact met u op.\n\nMet vriendelijke groeten,\nFirst Client BV",
  };
}

function extractFields(text: string) {
  const address =
    text.match(
      /([a-zà-ÿ][a-zà-ÿ .'-]{1,50}\s+\d{1,5}[a-z]?\s*,?\s*\d{4}\s+[a-zà-ÿ][a-zà-ÿ '-]+)/i,
    )?.[1]?.trim() || "";
  const property =
    text.match(/\b(woning|huis|appartement|bedrijfspand|kantoor|magazijn)\b/)?.[1] ||
    "";
  const buildingAge = extractBuildingAge(text);
  const panelCount = text.match(/\b(\d{1,3})\s*(?:zonnepanelen|panelen)\b/)?.[1];
  const usage = text.match(/([\d.,]+)\s*kwh/)?.[1];
  const usageLabel = [
    panelCount && `${panelCount} zonnepanelen`,
    usage && `${usage} kWh`,
  ].filter(Boolean).join(" · ");
  const roof =
    text.match(/\b(pannendak|plat dak|leien dak|leiden dak|leien|golfplaten|hellend dak)\b/)?.[1] || "";
  const battery = /met.{0,30}(?:thuis)?batterij.{0,30}zonder|zonder.{0,30}met.{0,30}(?:thuis)?batterij/.test(
    text,
  )
    ? "met en zonder thuisbatterij"
    : /\b(geen|zonder)\s+(?:thuis)?batterij\b/.test(text)
      ? "zonder thuisbatterij"
      : /thuisbatterij|batterij/.test(text)
        ? "met thuisbatterij"
        : "";
  const timeline =
    text.match(
      /\b(zo snel mogelijk|deze maand|volgende maand|binnen\s+\d+\s+(?:weken|maanden))\b/,
    )?.[1] || "";
  return {
    address,
    buildingAge,
    property,
    usage: usageLabel,
    annualUsage: usage || "",
    panelCount: panelCount || "",
    roof,
    battery,
    timeline,
  };
}

function extractBuildingAge(value: string) {
  const explicit = value.match(/ouder\s+dan\s+10\s+jaar\s*[:=-]?\s*(ja|nee)\b/i)?.[1];
  if (explicit) return explicit.toLowerCase();
  if (/\b(?:niet ouder dan 10 jaar|jonger dan 10 jaar|10 jaar of jonger)\b/i.test(value)) return "nee";
  if (/\b(?:woning|huis|gebouw)\b.{0,30}\bouder dan 10 jaar\b/i.test(value)) return "ja";
  return "";
}

function stripQuotedHistory(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .split(/\n(?:On .+ wrote:|Op .+ schreef:)/i)[0]
    .trim();
}

function conciseSummary(subject: string, body: string) {
  const cleaned = stripQuotedHistory(body).replace(/\s+/g, " ").trim();
  return (cleaned || subject).slice(0, 140);
}

export function inferCustomerName(body: string, fallbackName: string) {
  const lines = stripQuotedHistory(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const closing =
    /^(?:mvg|met vriendelijke groet(?:en)?|vriendelijke groet(?:en)?|groet(?:en)?|hoogachtend|kind regards|regards)[,!.:\s]*$/i;

  for (let index = Math.max(0, lines.length - 8); index < lines.length; index += 1) {
    if (!closing.test(lines[index])) continue;
    const candidate = lines[index + 1];
    if (candidate && isProbablePersonName(candidate)) return candidate;
  }
  return fallbackName.trim() || "Klant";
}

export function normalizeStoredDraft(
  draft: string,
  previousCustomerName: string,
  customerName: string,
) {
  const obsoleteBatteryGuidance =
    " Kies gerust voor een voorstel met thuisbatterij, zonder thuisbatterij, of twee prijsvoorstellen zodat u beide opties kunt vergelijken.";
  let normalized = draft.replace(obsoleteBatteryGuidance, "");
  const previousFirstName = firstName(previousCustomerName);
  const nextFirstName = firstName(customerName);
  if (previousFirstName !== nextFirstName) {
    const escaped = previousFirstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(
      new RegExp(`^Beste ${escaped},`, "i"),
      `Beste ${nextFirstName},`,
    );
  }
  return normalized;
}

function isProbablePersonName(value: string) {
  if (
    value.length > 60 ||
    /@|https?:|www\.|\d/.test(value) ||
    /\b(?:bv|nv|vzw|gmbh|ltd|inc)\b/i.test(value)
  ) {
    return false;
  }
  return /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3}$/u.test(value);
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "klant";
}
