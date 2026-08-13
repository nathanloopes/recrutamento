import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { logDevice } from "@/utils/detectSafariUI";

const DeviceContext = createContext<null>(null);

let GLOBAL_DETECTED = false;

/**
 * DeviceProvider centralizado.
 * Executa a detecção UMA ÚNICA vez, após mount do React,
 * dentro de useEffect + requestAnimationFrame, garantindo que
 * o layout do Safari/iOS já esteja estabilizado.
 */
export function DeviceProvider({ children }: { children: ReactNode }) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || GLOBAL_DETECTED) return;
    ranRef.current = true;
    GLOBAL_DETECTED = true;

    const raf = requestAnimationFrame(() => {
      logDevice();
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  return <DeviceContext.Provider value={null}>{children}</DeviceContext.Provider>;
}

export function useDevice() {
  return useContext(DeviceContext);
}
