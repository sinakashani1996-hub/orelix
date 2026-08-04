"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";

type Props = {
  token: string;
  customerName: string;
  accepted: boolean;
  signerName: string;
  acceptedAt: string;
};

export function QuoteAcceptanceForm(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [name, setName] = useState(props.signerName || props.customerName);
  const [consent, setConsent] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(props.accepted);
  const [acceptedAt, setAcceptedAt] = useState(props.acceptedAt);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || accepted) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#133a30";
  }, [accepted]);

  function position(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = position(event);
    drawing.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = position(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  }

  function stopDrawing() {
    drawing.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canvasRef.current || !hasSignature || !consent) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/quotes/${encodeURIComponent(props.token)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signerName: name,
          consent,
          signatureDataUrl: canvasRef.current.toDataURL("image/png"),
        }),
      });
      const data = (await response.json()) as { error?: string; acceptedAt?: string };
      if (!response.ok) throw new Error(data.error || "Ondertekenen is niet gelukt");
      setAccepted(true);
      setAcceptedAt(data.acceptedAt || new Date().toISOString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ondertekenen is niet gelukt");
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <aside className="quote-acceptance-panel accepted">
        <span className="quote-acceptance-check">✓</span>
        <p className="eyebrow">ONDERTEKEND</p>
        <h2>Bedankt, de offerte is aanvaard.</h2>
        <p>
          Ondertekend door <strong>{name}</strong>
          {acceptedAt ? ` op ${new Intl.DateTimeFormat("nl-BE", { dateStyle: "long", timeStyle: "short" }).format(new Date(acceptedAt))}` : ""}.
        </p>
        <a href={`/api/quotes/${encodeURIComponent(props.token)}/pdf`} target="_blank" rel="noreferrer">
          Ondertekende PDF downloaden
        </a>
      </aside>
    );
  }

  return (
    <form className="quote-acceptance-panel" onSubmit={submit}>
      <p className="eyebrow">GOEDKEUREN EN ONDERTEKENEN</p>
      <h2>Akkoord met deze offerte?</h2>
      <label>
        Volledige naam
        <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
      </label>
      <div className="signature-heading">
        <span>Handtekening</span>
        <button type="button" onClick={clearSignature}>Wissen</button>
      </div>
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        aria-label="Teken uw handtekening"
      />
      <label className="quote-consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>Ik heb de offerte gelezen en ga akkoord met de inhoud, prijs en voorwaarden.</span>
      </label>
      {error && <p className="quote-acceptance-error">{error}</p>}
      <button className="quote-accept-button" disabled={busy || !consent || !hasSignature || name.trim().length < 2}>
        {busy ? "Ondertekening opslaan…" : "Offerte aanvaarden en ondertekenen"}
      </button>
      <small>Na ondertekening wordt de offerte vergrendeld en ontvangt de afzender uw akkoord.</small>
    </form>
  );
}
