import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Sonner Toaster — hardening iOS:
 * - position="top-center": evita conflito com bottom navs em mobile.
 * - offset usa max(env(safe-area-inset-top), 16px) + 8px extra para
 *   garantir folga abaixo da Dynamic Island do iPhone 14 Pro / 15.
 * - whitespace-normal + break-words: nunca corta texto longo.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      offset="calc(max(env(safe-area-inset-top), 16px) + 8px)"
      mobileOffset="calc(max(env(safe-area-inset-top), 16px) + 8px)"
      style={
        {
          ["--safe-area-top" as any]: "env(safe-area-inset-top)",
          ["--safe-area-left" as any]: "env(safe-area-inset-left)",
          ["--safe-area-right" as any]: "env(safe-area-inset-right)",
          // largura máxima responsiva para evitar overflow em telas estreitas
          ["--width" as any]: "min(420px, calc(100vw - 32px))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg whitespace-normal break-words",
          title: "whitespace-normal break-words",
          description:
            "group-[.toast]:text-muted-foreground whitespace-normal break-words",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
