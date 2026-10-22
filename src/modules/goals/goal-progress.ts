import type { Goal, GoalMetric } from './entities';
import type { Task } from '../tasks/entities/task.entity';

export function measureGoalProgress(goal: Goal, metrics: GoalMetric[] = [], tasks: Task[] = []) {
  // 1. Metric progress
  let metricsProgress = 0;
  if (metrics.length > 0) {
    const sum = metrics.reduce((acc, m) => {
      const span = m.targetValue - m.baselineValue;
      if (span === 0) {
        return acc + (m.currentValue >= m.targetValue ? 100 : 0);
      }
      const pct = ((m.currentValue - m.baselineValue) / span) * 100;
      return acc + Math.max(0, Math.min(100, pct));
    }, 0);
    metricsProgress = Math.round(sum / metrics.length);
  }

  // 2. Milestone progress
  let milestonesProgress = 0;
  if (goal.milestones && goal.milestones.length > 0) {
    const completed = goal.milestones.filter((m) => m.completed).length;
    milestonesProgress = Math.round((completed / goal.milestones.length) * 100);
  }

  // 3. Task progress
  let tasksProgress = 0;
  if (tasks.length > 0) {
    const done = tasks.filter((t) => t.status === 'DONE').length;
    tasksProgress = Math.round((done / tasks.length) * 100);
  }

  // Completed work is activity, not proof that an outcome metric improved.
  // Fall back to milestones only when the goal has no outcome metrics.
  const measuredProgress =
    metrics.length > 0
      ? metricsProgress
      : goal.milestones?.length
        ? milestonesProgress
        : goal.progress;

  return {
    measuredProgress: Math.max(0, Math.min(100, measuredProgress)),
    metricsProgress,
    milestonesProgress,
    tasksProgress,
  };
}
