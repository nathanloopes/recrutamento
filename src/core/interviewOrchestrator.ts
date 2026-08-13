/**
 * Interview Orchestrator — Connects InterviewEngine + AudioEngine + Edge Function.
 *
 * This is the single coordination layer that:
 *  1. Asks the AI for the next question (via edge function)
 *  2. Speaks it via TTS
 *  3. Listens to the candidate
 *  4. Sends audio for transcription + evaluation
 *  5. Updates the engine state
 *  6. Repeats until done
 *
 * React components only subscribe to engine state changes.
 */

import {
  InterviewEngine,
  InterviewConfig,
  InterviewState,
  DimensionScores,
  ContextMemory,
  InterviewResult,
  type InterviewStage,
  type StateListener,
} from "./interviewEngine";
import { interviewAudioEngine } from "./interviewAudioEngine";
import { supabase } from "@/integrations/supabase/client";

// ─── Edge Function Response ─────────────────────────────────────────────────────

interface AITurnResponse {
  question: string;
  transcription?: string;
  scores?: DimensionScores;
  overallScore?: number;
  strengths?: string[];
  weaknesses?: string[];
  memoryUpdate?: Partial<ContextMemory>;
  closingMessage?: string;
  anticipatedNext?: string; // Pre-generated next question for prefetch
}

// ─── Orchestrator ───────────────────────────────────────────────────────────────

export class InterviewOrchestrator {
  private engine: InterviewEngine;
  private disposed = false;
  private currentTurnAbort: AbortController | null = null;
  private voiceInterviewId: string | null = null;

  constructor(private config: InterviewConfig) {
    this.engine = new InterviewEngine(config);
  }

  // ── Public ──────────────────────────────────────────────────────────────

  subscribe(listener: StateListener): () => void {
    return this.engine.subscribe(listener);
  }

  getState(): Readonly<InterviewState> {
    return this.engine.getState();
  }

  getResult(): InterviewResult | null {
    return this.engine.getState().result;
  }

  /**
   * Initialize: unlock audio + request mic. Must be called from user gesture.
   */
  async initialize(): Promise<{ audio: boolean; mic: boolean }> {
    await interviewAudioEngine.unlock();
    const mic = await interviewAudioEngine.requestMic();
    return { audio: true, mic };
  }

  /**
   * Start the interview loop. Runs autonomously.
   */
  async start(): Promise<void> {
    // Check max_voice_retries enforcement before starting
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id;

      if (userId) {
        // Check retry limit from CrossConfig
        const { data: retriesSetting } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "voice")
          .eq("key", "max_voice_retries")
          .maybeSingle();

        const maxRetries = typeof retriesSetting?.value === "number" ? retriesSetting.value : 2;

        // Count previous interviews for this candidate + job
        const { count } = await supabase
          .from("voice_interviews" as any)
          .select("id", { count: "exact", head: true })
          .eq("candidate_id", userId)
          .eq("job_title", this.config.jobTitle || "")
          .in("status", ["completed", "failed"] as any);

        if (count !== null && count >= maxRetries) {
          this.engine.abort("Limite de tentativas de entrevista atingido.");
          throw new Error("RETRY_LIMIT_EXCEEDED");
        }

        // Create voice_interview record with LGPD consent
        const { data: vi } = await supabase.from("voice_interviews" as any).insert({
          candidate_id: userId,
          job_title: this.config.jobTitle || null,
          consent_given_at: new Date().toISOString(),
          status: "in_progress",
          config_snapshot: {
            jobTitle: this.config.jobTitle,
            jobDescription: this.config.jobDescription,
            guideBlocks: this.config.guideBlocks || null,
          },
        } as any).select("id").single();
        if (vi) this.voiceInterviewId = (vi as any).id;

        // Notification: interview started
        await supabase.from("notifications").insert({
          event_type: "voice_interview_started",
          recipient_id: userId,
          channel: "push",
          title: "Entrevista com IA iniciada",
          body: `Sua entrevista para ${this.config.jobTitle || "a vaga"} começou. Boa sorte!`,
          status: "pending",
          payload: { voice_interview_id: this.voiceInterviewId },
          action_url: "/candidato/minhas-candidaturas",
          action_type: "info",
        } as any).then(() => {});
      }
    } catch (e: any) {
      if (e?.message === "RETRY_LIMIT_EXCEEDED") throw e;
      console.error("Failed to create voice_interview record:", e);
    }

    this.engine.start();
    await this.runTurn("generate_question");
  }

  /**
   * Abort the interview.
   */
  abort(reason?: string): void {
    this.disposed = true;
    this.currentTurnAbort?.abort();
    interviewAudioEngine.stopSpeaking();
    this.engine.abort(reason || "Interview aborted");

    // Notification: interview failed/aborted
    if (this.voiceInterviewId) {
      supabase.auth.getSession().then(({ data: session }) => {
        const userId = session?.session?.user?.id;
        if (userId) {
          supabase.from("notifications").insert({
            event_type: "voice_interview_failed",
            recipient_id: userId,
            channel: "push",
            title: "Entrevista encerrada",
            body: reason || "A entrevista foi encerrada antes da conclusão.",
            status: "pending",
            payload: { voice_interview_id: this.voiceInterviewId, reason },
            action_url: "/candidato/minhas-candidaturas",
            action_type: "info",
          } as any).then(() => {});
        }
      }).catch(() => {});
    }
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.disposed = true;
    this.currentTurnAbort?.abort();
    interviewAudioEngine.dispose();
  }

  // ── Turn Loop ───────────────────────────────────────────────────────────

  private async runTurn(
    mode: "generate_question" | "evaluate_answer",
    audioBlob?: Blob
  ): Promise<void> {
    if (this.disposed) return;

    const state = this.engine.getState();
    if (state.isComplete) return;

    // Handle CLOSING state
    if (state.currentStage === "CLOSING") {
      await this.handleClosing();
      return;
    }

    if (mode === "generate_question") {
      await this.handleGenerateQuestion();
    } else if (mode === "evaluate_answer" && audioBlob) {
      await this.handleEvaluateAnswer(audioBlob);
    }
  }

  private async handleGenerateQuestion(): Promise<void> {
    if (this.disposed) return;

    this.engine.setAIMessage("");
    const context = this.engine.buildContext();

    try {
      this.currentTurnAbort = new AbortController();

      // Call edge function to generate next question
      const response = await this.callEdgeFunction("interview-engine-turn", {
        action: "generate_question",
        context: { ...context, voiceInterviewId: this.voiceInterviewId },
      });

      if (this.disposed) return;

      const aiMessage = response.question;
      this.engine.setAIMessage(aiMessage);

      // Prefetch anticipated next question's TTS while this one plays
      if (response.anticipatedNext) {
        interviewAudioEngine.prefetch(response.anticipatedNext);
      }

      // Speak the question
      await interviewAudioEngine.speak(aiMessage);

      if (this.disposed) return;

      // Transition to listening
      this.engine.startListening();
      this.startListeningForAnswer();

    } catch (err: any) {
      if (this.disposed) return;
      // Fallback: use a generic question
      const fallbackQ = this.getFallbackQuestion();
      this.engine.setAIMessage(fallbackQ);
      await interviewAudioEngine.speak(fallbackQ);
      if (!this.disposed) {
        this.engine.startListening();
        this.startListeningForAnswer();
      }
    }
  }

  private startListeningForAnswer(): void {
    // Start recording — the UI will call submitAnswer() when done
    interviewAudioEngine.startRecording();
  }

  /**
   * Called by the UI when the candidate finishes speaking.
   */
  async submitAnswer(): Promise<void> {
    if (this.disposed) return;

    const blob = await interviewAudioEngine.stopRecording();
    if (!blob || blob.size === 0) {
      // No audio captured — ask again
      this.engine.setAIMessage("Desculpe, não consegui ouvir. Pode repetir sua resposta?");
      await interviewAudioEngine.speak("Desculpe, não consegui ouvir. Pode repetir sua resposta?");
      if (!this.disposed) {
        this.engine.startListening();
        this.startListeningForAnswer();
      }
      return;
    }

    this.engine.startProcessing();
    await this.runTurn("evaluate_answer", blob);
  }

  /**
   * Called by the UI for text-based fallback answers.
   */
  async submitTextAnswer(text: string): Promise<void> {
    if (this.disposed) return;
    if (!text.trim()) return;

    // Stop recording if active
    await interviewAudioEngine.stopRecording();

    this.engine.startProcessing();

    try {
      this.currentTurnAbort = new AbortController();
      const context = this.engine.buildContext();

      const response = await this.callEdgeFunction("interview-engine-turn", {
        action: "evaluate_text",
        context: { ...context, voiceInterviewId: this.voiceInterviewId },
        answer_text: text,
      });

      if (this.disposed) return;

      this.applyEvaluation(response, text);

    } catch {
      if (this.disposed) return;
      this.applyFallbackEvaluation(text);
    }
  }

  private async handleEvaluateAnswer(audioBlob: Blob): Promise<void> {
    if (this.disposed) return;

    try {
      this.currentTurnAbort = new AbortController();

      // Upload audio to storage
      const audioUrl = await this.uploadAudio(audioBlob);
      if (!audioUrl) throw new Error("Upload failed");

      const context = this.engine.buildContext();

      // Call edge function for transcription + evaluation
      const response = await this.callEdgeFunction("interview-engine-turn", {
        action: "evaluate_answer",
        context: { ...context, voiceInterviewId: this.voiceInterviewId },
        audio_url: audioUrl,
      });

      if (this.disposed) return;

      this.applyEvaluation(response, response.transcription || "");

    } catch {
      if (this.disposed) return;
      this.applyFallbackEvaluation("[Audio não processado]");
    }
  }

  private applyEvaluation(response: AITurnResponse, candidateAnswer: string): void {
    const scores: DimensionScores = response.scores || {
      communication: 50,
      confidence: 50,
      technical_level: 50,
      reasoning: 50,
      clarity: 50,
      behavioral_signals: 50,
    };

    // Record the turn
    this.engine.recordTurn({
      aiQuestion: this.engine.getState().currentAIMessage,
      candidateAnswer,
      transcription: response.transcription || candidateAnswer,
      scores,
      overallScore: response.overallScore ?? Math.round(
        Object.values(scores).reduce((a, b) => a + b, 0) / 6
      ),
      strengths: response.strengths || [],
      weaknesses: response.weaknesses || [],
    });

    // Update memory if provided
    if (response.memoryUpdate) {
      this.engine.updateMemory(response.memoryUpdate);
    }

    // Advance to next question/stage
    const continues = this.engine.advance();
    if (continues) {
      this.runTurn("generate_question");
    }
  }

  private applyFallbackEvaluation(answer: string): void {
    this.engine.recordTurn({
      aiQuestion: this.engine.getState().currentAIMessage,
      candidateAnswer: answer,
      transcription: answer,
      scores: {
        communication: 50,
        confidence: 50,
        technical_level: 50,
        reasoning: 50,
        clarity: 50,
        behavioral_signals: 50,
      },
      overallScore: 50,
      strengths: [],
      weaknesses: [],
    });

    const continues = this.engine.advance();
    if (continues) {
      this.runTurn("generate_question");
    }
  }

  private async handleClosing(): Promise<void> {
    if (this.disposed) return;

    const result = this.engine.getState().result;
    const context = this.engine.buildContext();

    try {
      const response = await this.callEdgeFunction("interview-engine-turn", {
        action: "closing",
        context: { ...context, voiceInterviewId: this.voiceInterviewId },
        result,
      });

      const closingMsg = response.closingMessage || response.question || this.getDefaultClosing();
      this.engine.setAIMessage(closingMsg);
      await interviewAudioEngine.speak(closingMsg);

    } catch {
      const msg = this.getDefaultClosing();
      this.engine.setAIMessage(msg);
      await interviewAudioEngine.speak(msg);
    }

    // Finalize voice_interview record
    if (this.voiceInterviewId) {
      try {
        const finalResult = this.engine.getState().result;
        await supabase.from("voice_interviews" as any).update({
          ended_at: new Date().toISOString(),
          status: "completed",
          final_score: finalResult?.finalScore ?? null,
          final_decision: finalResult?.decision ?? null,
        } as any).eq("id", this.voiceInterviewId);

        // Push notification: interview completed
        const { data: session } = await supabase.auth.getSession();
        const completedUserId = session?.session?.user?.id;
        if (completedUserId && finalResult) {
          await supabase.from("notifications").insert({
            event_type: "voice_interview_completed",
            recipient_id: completedUserId,
            channel: "push",
            title: "Entrevista concluída!",
            body: `Sua entrevista para ${this.config.jobTitle || "a vaga"} foi concluída. Score: ${finalResult.finalScore}/100.`,
            status: "pending",
            payload: { voice_interview_id: this.voiceInterviewId, score: finalResult.finalScore, decision: finalResult.decision },
            action_url: "/candidato/minhas-candidaturas",
            action_type: "info",
          } as any).then(() => {});

          // onRepeatAllowed: notify candidate if retries are still available
          if (finalResult.decision !== "APPROVED") {
            try {
              const { data: retriesSetting } = await supabase
                .from("global_settings")
                .select("value")
                .eq("category", "voice")
                .eq("key", "max_voice_retries")
                .maybeSingle();
              const maxRetries = typeof retriesSetting?.value === "number" ? retriesSetting.value : 2;

              const { count } = await supabase
                .from("voice_interviews" as any)
                .select("id", { count: "exact", head: true })
                .eq("candidate_id", completedUserId)
                .eq("job_title", this.config.jobTitle || "")
                .in("status", ["completed", "failed"] as any);

              const retriesUsed = count ?? 1;
              if (retriesUsed < maxRetries) {
                await supabase.from("notifications").insert({
                  event_type: "voice_interview_repeat_allowed",
                  recipient_id: completedUserId,
                  channel: "push",
                  title: "Você pode tentar novamente!",
                  body: `Você ainda tem ${maxRetries - retriesUsed} tentativa(s) disponível(is) para a entrevista de ${this.config.jobTitle || "a vaga"}.`,
                  status: "pending",
                  payload: { voice_interview_id: this.voiceInterviewId, retries_remaining: maxRetries - retriesUsed },
                  action_url: "/candidato/minhas-candidaturas",
                  action_type: "action_required",
                } as any).then(() => {});
              }
            } catch (retryNotifErr) {
              console.error("onRepeatAllowed notification error (non-fatal):", retryNotifErr);
            }
          }
        }
      } catch (e) {
        console.error("Failed to finalize voice_interview:", e);
      }
    }

    if (!this.disposed) {
      this.engine.finishClosing();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async callEdgeFunction(name: string, body: any): Promise<AITurnResponse> {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) throw error;
    return data as AITurnResponse;
  }

  private async uploadAudio(blob: Blob): Promise<string | null> {
    const filename = `interview/${Date.now()}_${Math.random().toString(36).slice(2)}.webm`;

    // Retry upload up to 3 times
    let uploadError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.storage
        .from("voice-recordings")
        .upload(filename, blob, { contentType: "audio/webm", upsert: true });
      if (!error) { uploadError = null; break; }
      uploadError = error;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }

    if (uploadError) {
      console.error("Upload failed after 3 attempts:", uploadError);
      return null;
    }

    // Use signed URL — bucket is PRIVATE
    const { data: signedData, error: signedError } = await supabase.storage
      .from("voice-recordings")
      .createSignedUrl(filename, 600); // 10 min expiry

    if (signedError || !signedData?.signedUrl) {
      console.error("Signed URL error:", signedError);
      return null;
    }

    return signedData.signedUrl;
  }

  private getFallbackQuestion(): string {
    const stage = this.engine.getState().currentStage;
    const fallbacks: Record<string, string> = {
      INTRODUCTION: "Olá! Bem-vindo à entrevista. Pode se apresentar brevemente?",
      WARMUP: "O que te motivou a se candidatar para esta vaga?",
      TECHNICAL_QUESTIONS: "Conte-me sobre sua experiência profissional mais relevante.",
      BEHAVIORAL_QUESTIONS: "Me dê um exemplo de uma situação desafiadora no trabalho e como você lidou com ela.",
      SCENARIO_TEST: "Imagine que você está no primeiro dia nesta posição. O que faria primeiro?",
      FINAL_EVALUATION: "Há algo mais que gostaria de compartilhar sobre você?",
      CLOSING: "Obrigado pela entrevista!",
    };
    return fallbacks[stage] || "Pode me contar mais sobre você?";
  }

  private getDefaultClosing(): string {
    const result = this.engine.getState().result;
    if (!result) return "Obrigado pela sua participação. Entraremos em contato em breve.";

    if (result.decision === "APPROVED") {
      return `Muito obrigado pela entrevista! Seu desempenho foi excelente. Você atingiu a pontuação necessária e será encaminhado para a próxima etapa. Parabéns!`;
    }
    if (result.decision === "TALENT_POOL") {
      return `Obrigado pela entrevista! Seu perfil foi registrado em nosso banco de talentos. Entraremos em contato quando surgirem oportunidades alinhadas.`;
    }
    return `Obrigado pela sua participação na entrevista. Seu perfil foi registrado no nosso banco de talentos e você será notificado quando surgirem oportunidades compatíveis. Desejamos sucesso na sua jornada!`;
  }
}
