import { getAppContext } from "../lib/context";
import { Dashboard } from "./Dashboard";
import { Onboarding } from "./Onboarding";

export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await getAppContext();
  if (!context) {
    return (
      <main className="auth-page">
        <div className="auth-brand">
          <span className="brand-mark">O</span>
          <span>Orelix <strong>Office</strong></span>
        </div>
        <section className="auth-card">
          <span className="auth-orbit">O</span>
          <p className="eyebrow">JE DIGITALE TEAM</p>
          <h1>Welkom bij Orelix Office.</h1>
          <p>
            Beheer offertes, inbox, service, planning en CRM vanuit één rustige
            werkplek.
          </p>
          <a className="auth-button" href="/login">
            Inloggen of account maken
          </a>
          <small>Veilig inloggen via e-mail, Google of Microsoft.</small>
        </section>
      </main>
    );
  }

  if (!context.organization) {
    return <Onboarding name={context.user.name} />;
  }

  const displayName = context.user.name.split(" ")[0] || "daar";
  return (
    <Dashboard
      displayName={displayName}
      organizationName={context.organization.name}
      userName={context.user.name}
    />
  );
}
