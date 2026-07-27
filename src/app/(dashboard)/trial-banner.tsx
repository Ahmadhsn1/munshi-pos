import Link from "next/link";

/**
 * plan.md Phase 7: "Basic subscription/trial gate: trial countdown banner, manual contact-to-
 * subscribe flow (no payment gateway integration yet)." Deliberately non-blocking -- nothing here
 * disables a single feature. The whole reason this phase's scope stops short of a real gate is
 * that there's no payment gateway yet, so a hard lock would have no way for a real customer to pay
 * their way back in; it would just be a wall with no door.
 *
 * Silent for most of the trial on purpose -- a banner nagging from day one trains an owner to
 * ignore banners entirely by the time it actually matters.
 */
export function TrialBanner({ trialEndsAt }: { trialEndsAt: string }) {
  const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  const WARNING_WINDOW_DAYS = 3;
  if (daysRemaining > WARNING_WINDOW_DAYS) return null;

  const expired = daysRemaining <= 0;

  // NEXT_PUBLIC_SUPPORT_WHATSAPP is optional and unset in this deployment -- rather than fabricate
  // a contact number/email that doesn't belong to anyone, the banner degrades to a plain message
  // when it's missing instead of rendering a broken or fake contact link.
  const supportWhatsApp = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
  const contactHref = supportWhatsApp
    ? `https://wa.me/${supportWhatsApp.replace(/\D/g, "")}?text=${encodeURIComponent("Hi, I'd like to subscribe to continue using the app.")}`
    : null;

  return (
    <div
      className={`flex items-center justify-between border-b px-6 py-2 text-sm ${
        expired ? "bg-debt-soft text-debt" : "bg-gold-soft text-gold-foreground"
      }`}
    >
      <span>
        {expired
          ? "Your trial has ended. Your data is safe and the app keeps working, but please subscribe to keep using it."
          : `Your trial ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`}
      </span>
      {contactHref ? (
        <Link href={contactHref} target="_blank" className="font-medium underline underline-offset-2">
          Contact to subscribe
        </Link>
      ) : (
        <span className="text-xs opacity-75">Contact your account manager to subscribe</span>
      )}
    </div>
  );
}
