import { getAppContext } from "../lib/context";
import { Dashboard } from "./Dashboard";
import { Onboarding } from "./Onboarding";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{ auth?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const context = await getAppContext();
  if (!context) {
    const { auth } = await searchParams;
    const authNotice = authenticationNotice(auth);
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
          {authNotice && <p className="form-error">{authNotice}</p>}
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

function authenticationNotice(status?: string) {
  if (status === "invalid-state") {
    return "Je aanmeldsessie is verlopen. Start de aanmelding opnieuw.";
  }
  if (status === "failed") {
    return "Aanmelden kon niet worden afgerond. Probeer opnieuw; blijft dit gebeuren, controleer dan de WorkOS-instellingen.";
  }
  if (status === "setup-required") {
    return "Aanmelden is nog niet volledig geconfigureerd op deze omgeving. Controleer de WorkOS-variabelen en callback-URL.";
  }
  if (status === "session-expired") {
    return "Je sessie is verlopen. Meld je opnieuw aan om verder te werken.";
  }
  return null;
}
