import { Button } from "@/components/ui/button";

/** A plain `<a href>` download link, not a fetch+blob client component -- the browser's native
 * download handling (via the export routes' Content-Disposition: attachment header) already does
 * everything needed, so there's no reason to ship JS for it. `nativeButton={false}` is base-ui's
 * Button rendering itself AS the given element rather than wrapping it, matching the pattern
 * already used for "New purchase" in purchases/page.tsx. */
export function ExportCsvLink({ href }: { href: string }) {
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<a href={href}>Export CSV</a>} />
  );
}
