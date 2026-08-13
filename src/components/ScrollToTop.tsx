import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

const SCROLL_SELECTORS = "main, [data-scroll-root='true']";

export function ScrollToTop() {
  const location = useLocation();

  useLayoutEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.body.scrollTo({ top: 0, left: 0, behavior: "auto" });

      document.querySelectorAll<HTMLElement>(SCROLL_SELECTORS).forEach((element) => {
        element.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    };

    resetScroll();
    const frame = requestAnimationFrame(resetScroll);

    return () => cancelAnimationFrame(frame);
  }, [location.key]);

  return null;
}
