import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ChecklistStep {
  label: string;
  href: string;
  done: boolean;
}

/**
 * plan.md Phase 7: "Onboarding flow: guided first-time setup wizard (add shop -> add products ->
 * add first sale)." "Add shop" is already done by the time this renders -- signup itself creates
 * the tenant via bootstrap_tenant, and this is a page inside that tenant's dashboard -- so the
 * remaining guidance is exactly the next two steps.
 *
 * Deliberately a checklist card, not a blocking multi-step modal: a hard-gated wizard risks
 * getting in the way of an owner who wants to explore the app their own way, and a skippable
 * checklist gives the same guidance without that risk. It disappears entirely once a sale has been
 * made -- a shop past its first sale has no more use for onboarding hints.
 */
export function OnboardingChecklist({
  hasProducts,
  hasCompletedSale,
}: {
  hasProducts: boolean;
  hasCompletedSale: boolean;
}) {
  if (hasCompletedSale) return null;

  const steps: ChecklistStep[] = [
    { label: "Add your first product", href: "/products", done: hasProducts },
    { label: "Take your first sale", href: "/pos", done: hasCompletedSale },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
        <CardDescription>A couple of steps to get your shop up and running.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {steps.map((step) => (
          <Link
            key={step.href}
            href={step.href}
            className="hover:bg-muted flex items-center justify-between rounded-md border p-3 text-sm"
          >
            <span className={step.done ? "text-muted-foreground line-through" : ""}>{step.label}</span>
            <Badge variant={step.done ? "secondary" : "outline"}>{step.done ? "Done" : "Go"}</Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
