"use client";

import { ArrowRight, Building2, Check, Sparkles } from "lucide-react";
import { useState } from "react";

export function Onboarding({ name }: { name: string }) {
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: companyName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Workspace maken mislukt");
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Probeer het opnieuw");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="onboarding-page">
      <div className="auth-brand">
        <span className="brand-mark">O</span>
        <span>Orelix <strong>Office</strong></span>
      </div>
      <section className="onboarding-card">
        <div className="onboarding-progress">
          <span className="done"><Check size={14} /></span>
          <i />
          <span>2</span>
          <i />
          <span>3</span>
        </div>
        <p className="eyebrow">STAP 1 VAN 3</p>
        <h1>Welkom, {name.split(" ")[0]}.</h1>
        <p>
          Maak je bedrijfsworkspace. Hier komen straks je team, mailboxen,
          assistenten en klantdossiers samen.
        </p>
        <form onSubmit={createWorkspace}>
          <label>
            Bedrijfsnaam
            <span className="onboarding-input">
              <Building2 size={18} />
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Bijvoorbeeld First Client BV"
                minLength={2}
                maxLength={80}
                required
                autoFocus
              />
            </span>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button disabled={saving}>
            {saving ? "Workspace wordt gemaakt…" : "Workspace maken"}
            {!saving && <ArrowRight size={17} />}
          </button>
        </form>
        <div className="onboarding-note">
          <Sparkles size={16} />
          <span>
            Daarna koppel je Gmail en activeer je de Offerte Assistent.
          </span>
        </div>
      </section>
    </main>
  );
}
