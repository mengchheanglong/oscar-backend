import { StageTimer } from '../../src/modules/assistant/context/stage-timings';

describe('private duration-only assistant telemetry', () => {
  it('captures overlapping durations without pretending they sum to total elapsed time', async () => {
    let now = 0;
    const timer = new StageTimer(() => now);
    const finishReference = timer.start('referenceRetrieval');
    now = 5;
    const finishProject = timer.start('projectRetrieval');
    now = 15;
    finishProject();
    now = 20;
    finishReference();
    finishReference();
    expect(timer.snapshot()).toEqual({
      version: 1,
      turnElapsedMs: 20,
      stagesMs: { referenceRetrieval: 20, projectRetrieval: 10 },
    });
    const snapshot = timer.snapshot();
    snapshot.stagesMs.projectRetrieval = 99;
    expect(timer.snapshot().stagesMs.projectRetrieval).toBe(10);
  });

  it('preserves success values and exceptions while measuring both', async () => {
    let now = 0;
    const timer = new StageTimer(() => now);
    expect(
      await timer.measure('generation', async () => {
        now = 7;
        return 'value';
      }),
    ).toBe('value');
    const failure = new Error('Synthetic failure');
    await expect(
      timer.measure('supportReview', async () => {
        now = 12;
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(timer.snapshot()).toEqual({
      version: 1,
      turnElapsedMs: 12,
      stagesMs: { generation: 7, supportReview: 5 },
    });
  });
});
