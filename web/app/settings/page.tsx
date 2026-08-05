import { redirect } from "next/navigation";
import { getAppContext } from "../../lib/context";
import { SettingsPage } from "./Settings";

export const dynamic = "force-dynamic";

export default async function InstellingenRoute({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const { tab } = await searchParams;
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
            companyAddress={context.organization.companyAddress}
            companyVatNumber={context.organization.companyVatNumber}
            companyEmail={context.organization.companyEmail}
            quoteNumberMode={context.organization.quoteNumberMode}
            quoteNumberPrefix={context.organization.quoteNumberPrefix}
            quoteNumberNext={context.organization.quoteNumberNext}
            quoteNumberStart={context.organization.quoteNumberStart}
            quoteNumberResetYearly={context.organization.quoteNumberResetYearly}
            initialTab={tab === "workspace" ? "workspace" : undefined}
        />
    );
}
