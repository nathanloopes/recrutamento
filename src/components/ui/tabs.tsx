import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement>(null);
  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );

  const touchState = React.useRef({ startX: 0, scrollLeft: 0, isDragging: false });

  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    const el = innerRef.current;
    if (!el) return;
    touchState.current = { startX: e.touches[0].clientX, scrollLeft: el.scrollLeft, isDragging: true };
  }, []);

  const onTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (!touchState.current.isDragging) return;
    const el = innerRef.current;
    if (!el) return;
    const dx = e.touches[0].clientX - touchState.current.startX;
    el.scrollLeft = touchState.current.scrollLeft - dx;
  }, []);

  const onTouchEnd = React.useCallback(() => {
    touchState.current.isDragging = false;
  }, []);

  // Mouse drag support (desktop click-and-drag)
  const mouseState = React.useRef({ startX: 0, scrollLeft: 0, isDragging: false, moved: false });

  const onMouseDown = React.useCallback((e: React.MouseEvent) => {
    const el = innerRef.current;
    if (!el) return;
    mouseState.current = { startX: e.clientX, scrollLeft: el.scrollLeft, isDragging: true, moved: false };
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
  }, []);

  const onMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (!mouseState.current.isDragging) return;
    const el = innerRef.current;
    if (!el) return;
    const dx = e.clientX - mouseState.current.startX;
    if (Math.abs(dx) > 3) mouseState.current.moved = true;
    el.scrollLeft = mouseState.current.scrollLeft - dx;
  }, []);

  const onMouseUp = React.useCallback(() => {
    const el = innerRef.current;
    if (el) {
      el.style.cursor = "grab";
      el.style.userSelect = "";
    }
    mouseState.current.isDragging = false;
  }, []);

  const onMouseLeave = React.useCallback(() => {
    if (mouseState.current.isDragging) {
      const el = innerRef.current;
      if (el) {
        el.style.cursor = "grab";
        el.style.userSelect = "";
      }
      mouseState.current.isDragging = false;
    }
  }, []);

  // Auto-scroll active tab into view
  React.useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>("[data-state='active']");
    if (active) {
      const elRect = el.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      if (activeRect.left < elRect.left || activeRect.right > elRect.right) {
        active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  });

  return (
    <div className="overflow-hidden w-full max-w-full">
      <TabsPrimitive.List
        ref={mergedRef}
        className={cn(
          "items-center bg-muted p-1 text-muted-foreground gap-1 scrollbar-hide",
          "rounded-md",
          "px-1",
          className,
        )}
        style={{
          display: "flex",
          flexWrap: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
          WebkitOverflowScrolling: "touch",
          cursor: "grab",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        {...props}
      />
    </div>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap shrink-0 rounded-sm px-3 py-1.5 text-xs sm:text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    style={{ flex: "0 0 auto" }}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:animate-tab-enter",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
