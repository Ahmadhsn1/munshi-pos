"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SidebarNav } from "./sidebar-nav";

/**
 * The real sidebar is `hidden md:flex` -- on a phone-width viewport there is otherwise NO
 * navigation at all beyond the header's tenant-name link, which is a real regression this redesign
 * would have shipped with (plan.md Phase 7 explicitly calls for Android phone browser testing,
 * meaning mobile use is expected, not an edge case). No Sheet/Drawer primitive exists in this
 * project's component set yet, so this reuses the existing Dialog rather than adding a new
 * dependency for one screen -- a centered modal is less polished than a slide-in drawer, but it is
 * correct and consistent with every other overlay already in the app.
 */
export function MobileNav({ permissions }: { permissions: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        className="md:hidden"
        onClick={() => setOpen(true)}
      >
        <MenuIcon />
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Menu</DialogTitle>
        </DialogHeader>
        <SidebarNav permissions={permissions} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
