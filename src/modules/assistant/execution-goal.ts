import { BadRequestException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { Goal } from '../goals/entities/goal.entity';

export async function assertExecutionGoal(
  manager: EntityManager,
  projectId: string,
  goalId?: string,
) {
  if (
    goalId &&
    !(await manager.getRepository(Goal).findOneBy({ id: goalId, projectId, deletedAt: IsNull() }))
  ) {
    throw new BadRequestException('Choose an available goal in this project.');
  }
}
