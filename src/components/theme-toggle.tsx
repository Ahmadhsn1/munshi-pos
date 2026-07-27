"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A real, working light/dark toggle -- not just an OS-preference fallback. Requires the
 * mounted-check dance because next-themes can't know the resolved theme during server render
 * (it depends on localStorage/matchMedia, neither available on the server); rendering the real
 * icon before mount would either mismatch the client's actual theme or throw a hydration warning.
 * A blank-but-correctly-sized button in that gap avoids both a hydration mismatch and a layout
 * shift once the real icon appears a frame later.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="ghost" size="icon" aria-hidden className="opacity-0" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
