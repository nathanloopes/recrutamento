/**
 * Interview Engine — Deterministic State Machine
 *
 * Controls the entire AI interview lifecycle:
 *  - State transitions (INTRODUCTION → CLOSING)
 *  - Question sequencing with stage objectives
 *  - Candidate context memory (answers, strengths, contradictions)
 *  - Real-time scoring accumulation
 *  - Final decision logic
 *
 * React components MUST NOT control interview logic — only render state.
 */

// ─── Interview States ──────────────────────────────────────────────────────────
export type InterviewStage =
  | "INTRODUCTION"
  | "WARMUP"
  | "TECHNICAL_QUESTIONS"
  | "BEHAVIORAL_QUESTIONS"
  | "SCENARIO_TEST"
  | "FINAL_EVALUATION"
  | "CLOSING";

const STAGE_ORDER: InterviewStage[] = [
  "INTRODUCTION",
  "WARMUP",
  "TECHNICAL_QUESTIONS",
  "BEHAVIORAL_QUESTIONS",
  "SCENARIO_TEST",
  "FINAL_EVALUATION",
  "CLOSING",
];

export type InterviewStatus = "idle" | "speaking" | "listening" | "processing" | "finished";

// ─── Evaluation Dimensions ──────────────────────────────────────────────────────

export interface DimensionScores {
  communication: number;    // 0–100
  confidence: number;       // 0–100
  technical_level: number;  // 0–100
  reasoning: number;        // 0–100
  clarity: number;          // 0–100
  behavioral_signals: number; // 0–100
}

const EMPTY_SCORES: DimensionScores = {
  communication: 0,
  confidence: 0,
  technical_level: 0,
  reasoning: 0,
  clarity: 0,
  behavioral_signals: 0,
};

// ─── Stage Objectives ───────────────────────────────────────────────────────────

export interface StageObjective {
  stage: InterviewStage;
  goal: string;
  questionCount: number;
  focusDimensions: (keyof DimensionScores)[];
}

const DEFAULT_OBJECTIVES: StageObjective[] = [
  {
    stage: "INTRODUCTION",
    goal: "Apresentar-se e deixar o candidato confortável. Perguntar nome e experiência resumida.",
    questionCount: 1,
    focusDimensions: ["communication", "confidence"],
  },
  {
    stage: "WARMUP",
    goal: "Perguntas leves sobre motivação e expectativas para o cargo.",
    questionCount: 2,
    focusDimensions: ["communication", "behavioral_signals"],
  },
  {
    stage: "TECHNICAL_QUESTIONS",
    goal: "Avaliar conhecimento técnico e experiência prática relevante ao cargo.",
    questionCount: 3,
    focusDimensions: ["technical_level", "reasoning", "clarity"],
  },
  {
    stage: "BEHAVIORAL_QUESTIONS",
    goal: "Avaliar comportamento em situações reais de trabalho, liderança e conflitos.",
    questionCount: 2,
    focusDimensions: ["behavioral_signals", "communication", "confidence"],
  },
  {
    stage: "SCENARIO_TEST",
    goal: "Apresentar cenário hipotético do cargo e avaliar raciocínio e tomada de decisão.",
    questionCount: 1,
    focusDimensions: ["reasoning", "technical_level", "clarity"],
  },
  {
    stage: "FINAL_EVALUATION",
    goal: "Última chance para o candidato adicionar algo. Avaliação interna do sistema.",
    questionCount: 1,
    focusDimensions: ["communication", "confidence", "behavioral_signals"],
  },
  {
    stage: "CLOSING",
    goal: "Agradecer e informar próximos passos.",
    questionCount: 0,
    focusDimensions: [],
  },
];

// ─── Turn Record ────────────────────────────────────────────────────────────────

export interface TurnRecord {
  stage: InterviewStage;
  questionIndex: number;
  aiQuestion: string;
  candidateAnswer: string;
  transcription: string;
  scores: DimensionScores;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  timestamp: number;
}

// ─── Context Memory ─────────────────────────────────────────────────────────────

export interface ContextMemory {
  candidateName: string;
  detectedStrengths: string[];
  detectedWeaknesses: string[];
  contradictions: string[];
  keyTopics: string[];
  overallImpression: string;
}

// ─── Final Decision ─────────────────────────────────────────────────────────────

export type FinalDecision = "APPROVED" | "TALENT_POOL" | "REJECTED" | "ESCALATED";

export interface InterviewResult {
  decision: FinalDecision;
  finalScore: number;
  dimensionAverages: DimensionScores;
  turnCount: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  turns: TurnRecord[];
}

// ─── Engine Configuration ───────────────────────────────────────────────────────

export interface InterviewConfig {
  jobTitle: string;
  jobDescription?: string;
  approveThreshold: number;    // e.g. 75
  talentPoolThreshold: number; // e.g. 50
  objectives?: StageObjective[];
  guideBlocks?: GuideBlock[];  // interview_guides roteiro por cargo
  escalationScoreMargin?: number; // pts near thresholds → escalate
  escalationOnInconsistency?: boolean; // dimension spread > 30 → escalate
}

export interface GuideBlock {
  name: string;
  questions: { id: string; text: string; required: boolean }[];
  criteria: { id: string; label: string; scale: string[] }[];
}

// ─── Engine State ───────────────────────────────────────────────────────────────

export interface InterviewState {
  status: InterviewStatus;
  currentStage: InterviewStage;
  currentStageIndex: number;
  questionIndexInStage: number;
  totalQuestionsAsked: number;
  turns: TurnRecord[];
  accumulatedScores: DimensionScores;
  scoreSampleCount: number;
  memory: ContextMemory;
  currentAIMessage: string;
  isComplete: boolean;
  result: InterviewResult | null;
  error: string | null;
}

// ─── Listener ───────────────────────────────────────────────────────────────────

export type StateListener = (state: InterviewState) => void;

// ─── Interview Engine Class ─────────────────────────────────────────────────────

export class InterviewEngine {
  private state: InterviewState;
  private config: InterviewConfig;
  private objectives: StageObjective[];
  private listeners: Set<StateListener> = new Set();
  private aborted = false;

  constructor(config: InterviewConfig) {
    this.config = config;
    this.objectives = config.objectives ?? DEFAULT_OBJECTIVES;

    this.state = {
      status: "idle",
      currentStage: "INTRODUCTION",
      currentStageIndex: 0,
      questionIndexInStage: 0,
      totalQuestionsAsked: 0,
      turns: [],
      accumulatedScores: { ...EMPTY_SCORES },
      scoreSampleCount: 0,
      memory: {
        candidateName: "",
        detectedStrengths: [],
        detectedWeaknesses: [],
        contradictions: [],
        keyTopics: [],
        overallImpression: "",
      },
      currentAIMessage: "",
      isComplete: false,
      result: null,
      error: null,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): Readonly<InterviewState> {
    return this.state;
  }

  getConfig(): Readonly<InterviewConfig> {
    return this.config;
  }

  getCurrentObjective(): StageObjective | null {
    return this.objectives[this.state.currentStageIndex] ?? null;
  }

  /**
   * Build context for the AI prompt: all previous turns + memory.
   * Used by the edge function to generate the next question.
   */
  buildContext(): {
    turns: TurnRecord[];
    memory: ContextMemory;
    currentStage: InterviewStage;
    objective: StageObjective | null;
    jobTitle: string;
    jobDescription?: string;
    questionIndexInStage: number;
    guideBlocks?: GuideBlock[];
  } {
    return {
      turns: this.state.turns,
      memory: this.state.memory,
      currentStage: this.state.currentStage,
      objective: this.getCurrentObjective(),
      jobTitle: this.config.jobTitle,
      jobDescription: this.config.jobDescription,
      questionIndexInStage: this.state.questionIndexInStage,
      guideBlocks: this.config.guideBlocks,
    };
  }

  /**
   * Start the interview — transitions to INTRODUCTION.
   */
  start(): void {
    this.aborted = false;
    this.update({
      status: "speaking",
      currentStage: "INTRODUCTION",
      currentStageIndex: 0,
      questionIndexInStage: 0,
    });
  }

  /**
   * Set the current AI message (what the AI is saying/showing).
   */
  setAIMessage(message: string): void {
    this.update({ currentAIMessage: message });
  }

  /**
   * Transition to listening (waiting for candidate input).
   */
  startListening(): void {
    this.update({ status: "listening" });
  }

  /**
   * Transition to processing (evaluating candidate response).
   */
  startProcessing(): void {
    this.update({ status: "processing" });
  }

  /**
   * Record a completed turn with evaluation scores.
   */
  recordTurn(turn: Omit<TurnRecord, "stage" | "questionIndex" | "timestamp">): void {
    const record: TurnRecord = {
      ...turn,
      stage: this.state.currentStage,
      questionIndex: this.state.questionIndexInStage,
      timestamp: Date.now(),
    };

    // Accumulate scores
    const acc = { ...this.state.accumulatedScores };
    const dims = Object.keys(acc) as (keyof DimensionScores)[];
    for (const dim of dims) {
      acc[dim] += turn.scores[dim];
    }

    // Update memory
    const mem = { ...this.state.memory };
    if (turn.strengths.length > 0) {
      mem.detectedStrengths = [...new Set([...mem.detectedStrengths, ...turn.strengths])];
    }
    if (turn.weaknesses.length > 0) {
      mem.detectedWeaknesses = [...new Set([...mem.detectedWeaknesses, ...turn.weaknesses])];
    }

    this.update({
      turns: [...this.state.turns, record],
      accumulatedScores: acc,
      scoreSampleCount: this.state.scoreSampleCount + 1,
      memory: mem,
      totalQuestionsAsked: this.state.totalQuestionsAsked + 1,
    });
  }

  /**
   * Update context memory (from AI analysis).
   */
  updateMemory(patch: Partial<ContextMemory>): void {
    this.update({
      memory: { ...this.state.memory, ...patch },
    });
  }

  /**
   * Advance to the next question or stage.
   * Returns true if interview continues, false if it's done.
   */
  advance(): boolean {
    if (this.aborted) return false;

    const obj = this.getCurrentObjective();
    if (!obj) {
      this.finish();
      return false;
    }

    const nextQ = this.state.questionIndexInStage + 1;

    if (nextQ < obj.questionCount) {
      // More questions in this stage
      this.update({
        status: "speaking",
        questionIndexInStage: nextQ,
      });
      return true;
    }

    // Move to next stage
    const nextStageIdx = this.state.currentStageIndex + 1;
    if (nextStageIdx >= this.objectives.length) {
      this.finish();
      return false;
    }

    const nextStage = this.objectives[nextStageIdx];

    // Skip CLOSING if it has 0 questions — but still transition through it
    if (nextStage.stage === "CLOSING") {
      this.update({
        status: "speaking",
        currentStage: "CLOSING",
        currentStageIndex: nextStageIdx,
        questionIndexInStage: 0,
      });
      return true;
    }

    // Skip FINAL_EVALUATION if there's only the closing message
    if (nextStage.stage === "FINAL_EVALUATION" && nextStage.questionCount === 0) {
      // Jump to CLOSING
      const closingIdx = this.objectives.findIndex((o) => o.stage === "CLOSING");
      if (closingIdx >= 0) {
        this.update({
          status: "speaking",
          currentStage: "CLOSING",
          currentStageIndex: closingIdx,
          questionIndexInStage: 0,
        });
        return true;
      }
      this.finish();
      return false;
    }

    this.update({
      status: "speaking",
      currentStage: nextStage.stage,
      currentStageIndex: nextStageIdx,
      questionIndexInStage: 0,
    });
    return true;
  }

  /**
   * Force-finish the interview (e.g. candidate disconnects).
   */
  abort(reason?: string): void {
    this.aborted = true;
    const result = this.computeResult();
    this.update({
      status: "finished",
      isComplete: true,
      result,
      error: reason || null,
    });
  }

  /**
   * Mark CLOSING as done — finalize.
   */
  finishClosing(): void {
    this.finish();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private finish(): void {
    const result = this.computeResult();
    this.update({
      status: "finished",
      currentStage: "CLOSING",
      isComplete: true,
      result,
    });
  }

  private computeResult(): InterviewResult {
    const n = this.state.scoreSampleCount || 1;
    const dims = Object.keys(EMPTY_SCORES) as (keyof DimensionScores)[];
    const avgs: DimensionScores = { ...EMPTY_SCORES };
    for (const d of dims) {
      avgs[d] = Math.round(this.state.accumulatedScores[d] / n);
    }

    const finalScore = Math.round(
      dims.reduce((sum, d) => sum + avgs[d], 0) / dims.length
    );

    let decision: FinalDecision;
    if (finalScore >= this.config.approveThreshold) {
      decision = "APPROVED";
    } else if (finalScore >= this.config.talentPoolThreshold) {
      decision = "TALENT_POOL";
    } else {
      decision = "REJECTED";
    }

    // Escalation rules
    const margin = this.config.escalationScoreMargin ?? 0;
    if (margin > 0) {
      const nearApprove = finalScore < this.config.approveThreshold &&
        Math.abs(finalScore - this.config.approveThreshold) <= margin;
      const nearReject = finalScore > this.config.talentPoolThreshold &&
        Math.abs(finalScore - this.config.talentPoolThreshold) <= margin;
      if (nearApprove || nearReject) {
        decision = "ESCALATED";
      }
    }

    if (this.config.escalationOnInconsistency) {
      const dimValues = Object.values(avgs);
      const spread = Math.max(...dimValues) - Math.min(...dimValues);
      if (spread > 30 && decision !== "ESCALATED") {
        decision = "ESCALATED";
      }
    }

    return {
      decision,
      finalScore,
      dimensionAverages: avgs,
      turnCount: this.state.turns.length,
      summary: this.state.memory.overallImpression || "",
      strengths: this.state.memory.detectedStrengths,
      weaknesses: this.state.memory.detectedWeaknesses,
      turns: this.state.turns,
    };
  }

  private update(patch: Partial<InterviewState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {}
    }
  }
}
