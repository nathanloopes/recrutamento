import { HelpCircle, Lightbulb } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { helpTips } from "@/lib/helpTips";
import { useState } from "react";

export function PageHelp() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Match route: try exact, then strip trailing segments for nested routes like /documentos/:id
  const data =
    helpTips[pathname] ||
    helpTips[pathname.replace(/\/[^/]+$/, "")] ||
    helpTips["/" + pathname.split("/").filter(Boolean)[0]];

  if (!data) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10"
        onClick={() => setOpen(true)}
        aria-label="Ajuda desta página"
      >
        <HelpCircle className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[320px] sm:w-[380px]">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <Lightbulb className="h-5 w-5 text-primary" />
              Dicas — {data.pageTitle}
            </SheetTitle>
            <SheetDescription>
              Dicas rápidas para te ajudar nesta tela
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 mt-2">
            {data.tips.map((tip, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {i + 1}
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {tip.title}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {tip.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
