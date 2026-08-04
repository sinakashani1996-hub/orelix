const MAX_NOTIFICATION_BYTES = 1024 * 1024;
const MAX_AI_REQUEST_BYTES = 128 * 1024;
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const analysisSchema = {
  type: "object",
  properties: {
    moduleId: {
      type: "string",
      enum: ["quote_assistant", "service_assistant", "inbox_assistant"],
    },
    kind: {
      type: "string",
      enum: [
        "quote_request",
        "missing_information",
        "service_request",
        "manual",
      ],
    },
    title: { type: "string" },
    summary: { type: "string" },
    status: {
      type: "string",
      enum: ["needs_approval", "draft_ready", "routed"],
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    customerName: { type: "string" },
    draft: { type: "string" },
    extracted: {
      type: "object",
      properties: {
        address: { type: "string" },
        buildingOlderThan10Years: { type: "string" },
        propertyType: { type: "string" },
        annualUsageKwh: { type: "string" },
        panelCount: { type: "string" },
        roofType: { type: "string" },
        batteryPreference: { type: "string" },
        desiredTiming: { type: "string" },
      },
      required: [
        "address",
        "buildingOlderThan10Years",
        "propertyType",
        "annualUsageKwh",
        "panelCount",
        "roofType",
        "batteryPreference",
        "desiredTiming",
      ],
    },
    missingFields: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "address",
          "buildingAge",
          "propertyType",
          "annualUsageKwhOrPanelCount",
          "roofType",
          "batteryPreference",
          "desiredTiming",
        ],
      },
    },
    quoteReady: { type: "boolean" },
    quote: {
      type: "object",
      properties: {
        title: { type: "string" },
        introduction: { type: "string" },
        scope: { type: "array", items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } },
        validityDays: { type: "integer", minimum: 1, maximum: 90 },
      },
      required: ["title", "introduction", "scope", "assumptions", "validityDays"],
    },
  },
  required: [
    "moduleId",
    "kind",
    "title",
    "summary",
    "status",
    "confidence",
    "customerName",
    "draft",
    "extracted",
    "missingFields",
    "quoteReady",
    "quote",
  ],
};

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "orelix-gmail-relay",
        ai: true,
      });
    }

    if (url.pathname === "/api/ai/analyze") {
      return analyzeConversation(request, env);
    }

    if (url.pathname !== "/api/webhooks/gmail") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return Response.json({ error: "Missing Pub/Sub identity" }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_NOTIFICATION_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }

    if (!env.OAI_SITES_BYPASS_TOKEN || !env.TARGET_URL) {
      console.error(
        JSON.stringify({
          event: "relay_configuration_missing",
          hasBypassToken: Boolean(env.OAI_SITES_BYPASS_TOKEN),
          hasTargetUrl: Boolean(env.TARGET_URL),
        }),
      );
      return Response.json({ error: "Relay unavailable" }, { status: 503 });
    }

    const headers = new Headers({
      authorization,
      "content-type":
        request.headers.get("content-type") || "application/json",
      "oai-sites-authorization": `Bearer ${env.OAI_SITES_BYPASS_TOKEN}`,
    });
    const response = await fetch(env.TARGET_URL, {
      method: "POST",
      headers,
      body: request.body,
      redirect: "manual",
    });

    console.log(
      JSON.stringify({
        event: "gmail_notification_forwarded",
        upstreamStatus: response.status,
      }),
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") || "application/json",
      },
    });
  },
};

async function analyzeConversation(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_AI_REQUEST_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  if (
    !env.AI_SHARED_SECRET ||
    !(await secretsMatch(
      request.headers.get("authorization") || "",
      `Bearer ${env.AI_SHARED_SECRET}`,
    ))
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(input?.conversation) || input.conversation.length === 0) {
    return Response.json(
      { error: "Conversation is required" },
      { status: 400 },
    );
  }

  const systemPrompt = [
    "Je bent de Offerte Assistent van First Client BV in Orelix Office.",
    "Analyseer de VOLLEDIGE conversatie, niet alleen het laatste bericht.",
    "Herken vervolgberichten als onderdeel van hetzelfde klantdossier en behoud eerder bevestigde gegevens.",
    "Vraag nooit opnieuw naar informatie die al in de conversatie of knownData staat.",
    "Negeer geciteerde e-mailheaders en gebruik de echte ondertekening van de klant voor customerName.",
    "Schrijf natuurlijk, professioneel Belgisch-Nederlands en kort. Geen robottaal of interne instructies in een klantantwoord.",
    "Verzin nooit prijzen, technische prestaties, premies, garanties of uitvoeringsdata.",
    "Voor een eerste zonnepanelenofferte zijn nodig: het volledige installatieadres, of de woning ouder is dan 10 jaar, het daktype, het gewenste aantal panelen OF het jaarlijkse elektriciteitsverbruik in kWh, en of de klant een thuisbatterij wenst. Type pand en gewenste timing blokkeren de eerste offerte niet.",
    "Als informatie ontbreekt: moduleId quote_assistant, kind missing_information, status draft_ready, en vraag in hetzelfde antwoord naar alle ontbrekende informatie.",
    "Als alle informatie aanwezig is: moduleId quote_assistant, kind quote_request, status needs_approval, quoteReady true en maak een professioneel offerteconcept zonder bedragen. De mens vult bedragen in en controleert voor verzending.",
    "Bij een storing of technisch probleem: service_assistant. Bij andere of onduidelijke e-mail: inbox_assistant.",
    "Als preferredModule is ingevuld, respecteer die handmatige keuze en verwerk de conversatie voor die assistent.",
    "Een conceptantwoord begint met Beste <voornaam>, en eindigt met Met vriendelijke groeten, First Client BV.",
    "Geef uitsluitend één geldig JSON-object terug dat exact aan outputSchema voldoet. Gebruik lege strings en lege arrays voor nog niet beschikbare waarden.",
  ].join("\n");

  try {
    const result = await env.AI.run(AI_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            preferredModule: input.preferredModule || null,
            knownData: input.knownData || {},
            conversation: input.conversation.slice(-12),
            outputSchema: analysisSchema,
          }),
        },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0.2,
      max_tokens: 1800,
    });
    const response = result?.response;
    const analysis =
      typeof response === "string" ? JSON.parse(response) : response;
    if (!analysis || typeof analysis !== "object") {
      throw new Error("AI returned no structured response");
    }
    const guardedAnalysis = applyQuoteGuardrails(analysis, input);
    console.log(
      JSON.stringify({
        event: "ai_conversation_analyzed",
        model: AI_MODEL,
        quoteReady: Boolean(guardedAnalysis.quoteReady),
      }),
    );
    return Response.json({ analysis: guardedAnalysis, model: AI_MODEL });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ai_conversation_failed",
        model: AI_MODEL,
        error: error instanceof Error ? error.message : "Unknown AI error",
      }),
    );
    return Response.json({ error: "AI analysis failed" }, { status: 503 });
  }
}

// The model is useful for intent and summarisation, but intake completeness must
// remain deterministic. Otherwise it can ask again for facts that a customer
// has already supplied in a reply.
function applyQuoteGuardrails(analysis, input) {
  if (analysis.moduleId !== "quote_assistant") return analysis;

  const customerText = (input.conversation || [])
    .filter((message) => message?.role === "customer")
    .map((message) => stripQuotedEmail(String(message.body || "")))
    .join("\n");
  const known = input.knownData || {};
  // The model may summarise well, but it is never a source of customer facts.
  // Otherwise a weak model response such as "adres" gets mistaken for a real
  // installation address and leaks into an outgoing customer draft.
  const fields = extractQuoteFacts(customerText, known);
  const missing = requiredQuoteFields(fields);
  const customerName = inferReplyName(customerText, analysis.customerName);
  const quote = analysis.quote || {
    title: "Offerte zonnepanelen",
    introduction: "Voorstel voor een zonnepaneleninstallatie.",
    scope: [],
    assumptions: [],
    validityDays: 30,
  };

  if (missing.length) {
    return {
      ...analysis,
      moduleId: "quote_assistant",
      kind: "missing_information",
      title: "Nog enkele gegevens nodig",
      summary: missing.map((field) => missingLabel(field, fields)).join(" · "),
      status: "draft_ready",
      confidence: Math.max(80, Number(analysis.confidence) || 0),
      customerName,
      extracted: fields,
      missingFields: missing,
      quoteReady: false,
      quote,
      draft: buildMissingDataDraft(customerName, fields, missing),
    };
  }

  return {
    ...analysis,
    moduleId: "quote_assistant",
    kind: "quote_request",
    title: "Aanvraag compleet — offerte voorbereiden",
    summary: quoteSummary(fields),
    status: "needs_approval",
    customerName,
    extracted: fields,
    missingFields: [],
    quoteReady: true,
    quote,
  };
}

function stripQuotedEmail(value) {
  const lines = value.replace(/\r/g, "").split("\n");
  const kept = [];
  for (const line of lines) {
    if (
      /^\s*>/.test(line) ||
      /^\s*(?:Op .+ schreef .+:|On .+ wrote:)$/i.test(line)
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function extractQuoteFacts(text, known) {
  const current = text.toLowerCase();
  const knownAddress = valueOf(known.address);
  const address = extractAddress(text) || (isCompleteAddress(knownAddress) ? knownAddress : "");
  const propertyType =
    matchWord(current, ["woning", "huis", "appartement", "bedrijfspand", "kantoor", "magazijn"]) ||
    normalisePropertyType(known.propertyType);
  const buildingOlderThan10Years =
    extractBuildingAge(text) || normaliseYesNo(known.buildingOlderThan10Years);
  const annualUsageKwh =
    text.match(/\b([\d.\s]{3,12})\s*kwh\b/i)?.[1]?.replace(/\s/g, "") ||
    normaliseUsage(known.annualUsageKwh);
  const panelCount =
    text.match(/\b(\d{1,3})\s*(?:zonnepanelen|panelen)\b/i)?.[1] ||
    normalisePanelCount(known.panelCount);
  const roofType =
    matchWord(current, ["plat dak", "pannendak", "leien dak", "leiden dak", "leien", "golfplaten", "hellend dak"]) ||
    normaliseRoofType(known.roofType);
  const desiredTiming =
    current.match(/\b(zo snel mogelijk|deze maand|volgende maand|binnen\s+(?:\d+|een|twee|drie|vier|vijf|zes)\s+(?:weken|maanden))\b/i)?.[1] ||
    normaliseTiming(known.desiredTiming);
  const batteryPreference =
    /\b(?:geen|zonder)\s+(?:thuis)?batterij\b/i.test(text)
      ? "zonder thuisbatterij"
      : /\b(?:thuis)?batterij\b/i.test(text)
        ? "met thuisbatterij"
        : valueOf(known.batteryPreference);
  return {
    address,
    buildingOlderThan10Years,
    propertyType,
    annualUsageKwh,
    panelCount,
    roofType,
    batteryPreference,
    desiredTiming,
  };
}

function extractAddress(text) {
  // Customers often provide a complete address in a sentence rather than on
  // its own line ("... op mijn woning in Kerkstraat 12, 2000 Antwerpen").
  const inline = text.match(
    /\b(?:in|aan|op)\s+([\p{L}][\p{L} .'-]{1,60}\s+\d{1,5}[a-z]?\s*,?\s*\d{4}\s+[\p{L}][\p{L}' -]{1,60})/iu,
  )?.[1]?.trim();
  if (inline && isCompleteAddress(inline)) return inline;

  const lines = text.replace(/\r/g, "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const candidate = line
      .replace(/^\s*(?:adres(?:\s+is)?|installatieadres)\s*[:=-]?\s*/i, "")
      .trim();
    const addressMatch = candidate.match(
      /^([\p{L}][\p{L} .'-]{1,60}\s+\d{1,5}[a-z]?)(?:\s*,?\s*(\d{4}\s+[\p{L}][\p{L}' -]{1,60}))?\s*[.!?]?$/u,
    );
    if (addressMatch) {
      const streetAddress = [addressMatch[1], addressMatch[2]]
        .filter(Boolean)
        .join(", ");
      if (isCompleteAddress(streetAddress)) return streetAddress;
      const next = (lines[index + 1] || "").trim();
      return next && isLikelyLocationLine(next)
        ? `${streetAddress}, ${next}`
        : streetAddress;
    }
  }
  return "";
}

function requiredQuoteFields(fields) {
  const missing = [];
  if (!fields.address || !/\b\d{4}\s+\p{L}/u.test(fields.address)) missing.push("address");
  if (!fields.buildingOlderThan10Years) missing.push("buildingAge");
  if (!fields.annualUsageKwh && !fields.panelCount) missing.push("annualUsageKwhOrPanelCount");
  if (!fields.roofType) missing.push("roofType");
  if (!fields.batteryPreference) missing.push("batteryPreference");
  return missing;
}

function buildMissingDataDraft(customerName, fields, missing) {
  const questions = missing.map((field) => missingQuestion(field, fields));
  const greeting = customerName ? `Beste ${firstName(customerName)},` : "Beste,";
  const request = fields.panelCount
    ? `voor ${fields.panelCount} zonnepanelen`
    : "voor zonnepanelen";
  return `${greeting}\n\nHartelijk dank voor uw interesse in First Client BV.\n\nWe hebben uw aanvraag voor een offerte ${request} goed ontvangen. Om een correcte en gepersonaliseerde offerte op te stellen, vragen we u om ons nog volgende gegevens te bezorgen:\n\n${questions.map((question) => `• ${question}`).join("\n")}\n\nMet deze informatie kunnen wij uw offerte zo nauwkeurig mogelijk opmaken. Indien we bijkomende vragen hebben om uw dossier volledig te maken, nemen wij persoonlijk contact met u op.\n\nZodra de offerte naar wens is, plannen we graag een huisbezoek in om de situatie ter plaatse te bekijken en de installatie verder te bespreken.\n\nMet vriendelijke groeten,\nFirst Client BV`;
}

function isCompleteAddress(value) {
  return /\b\d{4}\s+[\p{L}][\p{L}' -]{1,60}\b/u.test(String(value || ""));
}

function isLikelyLocationLine(value) {
  return /^[\p{L}][\p{L}' -]{1,60}$/u.test(value) &&
    !/^(?:mvg|groeten|met vriendelijke groeten|vriendelijke groeten)$/i.test(value);
}

function normalisePropertyType(value) {
  return matchWord(String(value || "").toLowerCase(), ["woning", "huis", "appartement", "bedrijfspand", "kantoor", "magazijn"]);
}

function extractBuildingAge(value) {
  const text = String(value || "").toLowerCase();
  const explicit = text.match(/ouder\s+dan\s+10\s+jaar\s*[:=-]?\s*(ja|nee)\b/i)?.[1];
  if (explicit) return explicit.toLowerCase();
  if (/\b(?:niet ouder dan 10 jaar|jonger dan 10 jaar|10 jaar of jonger)\b/i.test(text)) return "nee";
  if (/\b(?:woning|huis|gebouw)\b.{0,30}\bouder dan 10 jaar\b/i.test(text)) return "ja";
  return "";
}

function normaliseYesNo(value) {
  const match = String(value || "").trim().toLowerCase().match(/^(ja|nee)$/);
  return match?.[1] || "";
}

function normaliseUsage(value) {
  const match = String(value || "").match(/\b([\d.\s]{3,12})\b/);
  return match ? match[1].replace(/\s/g, "") : "";
}

function normalisePanelCount(value) {
  const match = String(value || "").match(/^\s*(\d{1,3})\s*$/);
  return match ? match[1] : "";
}

function normaliseRoofType(value) {
  return matchWord(String(value || "").toLowerCase(), ["plat dak", "pannendak", "leien dak", "leiden dak", "leien", "golfplaten", "hellend dak"]);
}

function normaliseTiming(value) {
  const match = String(value || "").match(/\b(zo snel mogelijk|deze maand|volgende maand|binnen\s+(?:\d+|een|twee|drie|vier|vijf|zes)\s+(?:weken|maanden))\b/i);
  return match?.[1]?.toLowerCase() || "";
}

function missingQuestion(field, fields) {
  if (field === "address") {
    return "Het volledige adres van de woning waar de installatie moet gebeuren (straat, huisnummer, postcode en gemeente).";
  }
  if (field === "buildingAge") return "Is de woning ouder dan 10 jaar? (Ja/nee)";
  if (field === "propertyType") return "Gaat het om een woning, appartement of bedrijfspand?";
  if (field === "annualUsageKwhOrPanelCount") return "Het gewenste aantal zonnepanelen of uw jaarlijkse elektriciteitsverbruik in kWh.";
  if (field === "roofType") return "Het type dak (bijvoorbeeld pannendak, plat dak, leien of golfplaten).";
  if (field === "batteryPreference") return "Wenst u een thuisbatterij in combinatie met de zonnepanelen? (Ja/nee)";
  if (field === "desiredTiming") return "Wanneer wilt u de installatie ongeveer laten uitvoeren?";
  return field;
}

function missingLabel(field, fields) {
  if (field === "address") return fields.address ? "Postcode en gemeente ontbreken" : "Installatieadres ontbreekt";
  if (field === "buildingAge") return "Leeftijd van de woning ontbreekt";
  if (field === "propertyType") return "Type pand ontbreekt";
  if (field === "annualUsageKwhOrPanelCount") return "Verbruik of gewenst aantal panelen ontbreekt";
  if (field === "roofType") return "Daktype ontbreekt";
  if (field === "desiredTiming") return "Gewenste timing ontbreekt";
  if (field === "batteryPreference") return "Voorkeur voor thuisbatterij ontbreekt";
  return field;
}

function quoteSummary(fields) {
  return [fields.address, fields.roofType, fields.annualUsageKwh || fields.panelCount, fields.desiredTiming]
    .filter(Boolean)
    .join(" · ");
}

function inferReplyName(text, fallback) {
  const match = text.match(/(?:met vriendelijke groeten|vriendelijke groeten|mvg\.?|groeten)[,\s]*\n+\s*([^\n<]{2,60})/i);
  const candidate = match?.[1]?.trim() || "";
  return isLikelyPersonName(candidate) ? candidate : "";
}

function firstName(value) {
  return String(value || "Klant").trim().split(/\s+/)[0] || "Klant";
}

function isLikelyPersonName(value) {
  return /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3}$/u.test(value);
}

function matchWord(value, choices) {
  return choices.find((choice) => value.includes(choice)) || "";
}

function valueOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function joinNatural(values) {
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} en ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} en ${values.at(-1)}`;
}

async function secretsMatch(left, right) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", leftBytes),
    crypto.subtle.digest("SHA-256", rightBytes),
  ]);
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

export default worker;
