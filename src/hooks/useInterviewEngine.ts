/**
 * useInterviewEngine — React hook for the Interview Engine.
 * Bridges the InterviewOrchestrator to React component lifecycle.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { InterviewOrchestrator } from "@/core/interviewOrchestrator";
import type { InterviewConfig, InterviewState, InterviewResult } from "@/core/interviewEngine";

export function useInterviewEngine(config: InterviewConfig) {
  const [state, setState] = useState<InterviewState | null>(null);
  const orchestratorRef = useRef<InterviewOrchestrator | null>(null);

  // Create orchestrator once
  useEffect(() => {
    const orch = new InterviewOrchestrator(config);
    orchestratorRef.current = orch;

    const unsub = orch.subscribe((s) => setState({ ...s }));

    return () => {
      unsub();
      orch.dispose();
      orchestratorRef.current = null;
    };
  }, [config.jobTitle]); // Only recreate if job changes

  const initialize = useCallback(async () => {
    return orchestratorRef.current?.initialize() ?? { audio: false, mic: false };
  }, []);

  const start = useCallback(async () => {
    await orchestratorRef.current?.start();
  }, []);

  const submitAnswer = useCallback(async () => {
    await orchestratorRef.current?.submitAnswer();
  }, []);

  const submitTextAnswer = useCallback(async (text: string) => {
    await orchestratorRef.current?.submitTextAnswer(text);
  }, []);

  const abort = useCallback((reason?: string) => {
    orchestratorRef.current?.abort(reason);
  }, []);

  return {
    state,
    initialize,
    start,
    submitAnswer,
    submitTextAnswer,
    abort,
    isComplete: state?.isComplete ?? false,
    result: state?.result ?? null,
  };
}
