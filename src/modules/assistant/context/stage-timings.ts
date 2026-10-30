import { performance } from 'node:perf_hooks';

export type AssistantStage =
  | 'referenceRetrieval'
  | 'projectRetrieval'
  | 'contextPreparation'
  | 'evidenceAssembly'
  | 'conversationContext'
  | 'generation'
  | 'supportReview';

export interface AssistantStageTimings {
  version: 1;
  turnElapsedMs: number;
  stagesMs: Partial<Record<AssistantStage, number>>;
}

// Durations only: never accepts a prompt, source body, credential or model response.
// Concurrent stages overlap. turnElapsedMs ends before the final message commit.
export class StageTimer {
  private readonly started: number;
  private readonly stages: Partial<Record<AssistantStage, number>> = {};

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.started = clock();
  }

  start(stage: AssistantStage): () => void {
    const started = this.clock();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.stages[stage] = (this.stages[stage] ?? 0) + Math.max(0, this.clock() - started);
    };
  }

  async measure<T>(stage: AssistantStage, action: () => Promise<T>): Promise<T> {
    const finish = this.start(stage);
    try {
      return await action();
    } finally {
      finish();
    }
  }

  snapshot(): AssistantStageTimings {
    return {
      version: 1,
      turnElapsedMs: Math.round(Math.max(0, this.clock() - this.started)),
      stagesMs: Object.fromEntries(
        Object.entries(this.stages).map(([stage, duration]) => [stage, Math.round(duration)]),
      ),
    };
  }
}
