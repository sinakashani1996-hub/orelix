import { redirect } from "next/navigation";
import { getAppContext } from "../../lib/context";
import { Planning } from "./Planning";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
    const context = await getAppContext();

    if (!context) {
        // Stuur terug naar login als de gebruiker niet is ingelogd
        redirect("/");
    }

    if (!context.organization) {
        // Stuur terug naar onboarding als er geen workspace is
        redirect("/");
    }

    const displayName = context.user.name.split(" ")[0] || "daar";

    return (
        <Planning
            displayName={displayName}
            organizationName={context.organization.name}
            userName={context.user.name}
        />
    );
}