"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// next-themes was already an installed dependency but never wired up -- src/components/ui/sonner.tsx
// has called useTheme() since it was scaffolded, silently falling back to its "system" default with
// no provider above it. attribute="class" matches globals.css's existing
// `@custom-variant dark (&:is(.dark *))` selector, which has been there since Phase 1 waiting for
// something to actually toggle the class.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem {...props}>
      {children}
    </NextThemesProvider>
  );
}
