"use client";

import { PanelLeft, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar, SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";

export function SiteHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="bg-background/95 sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4" />
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            className="w-full pl-8 h-9 bg-muted/50"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Future: Add notifications, theme switch, etc. */}
        </div>
      </div>
    </header>
  );
}
