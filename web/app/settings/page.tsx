import { redirect } from "next/navigation";
import { getAppContext } from "../../lib/context";
import { SettingsPage } from "./Settings";

export const dynamic = "force-dynamic";

export default async function InstellingenRoute() {
    const context = await getAppContext();

    if (!context) {
        redirect("/");
    }

    if (!context.organization) {
        redirect("/");
    }

    const displayName = context.user.name.split(" ")[0] || "daar";

    return (
        <SettingsPage
            displayName={displayName}
            organizationName={context.organization.name}
            userName={context.user.name}
        />
    );
}