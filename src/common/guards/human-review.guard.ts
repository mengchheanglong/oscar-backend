import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Durable memory promotion requires the signed-in UI review flow, not an agent API key. */
@Injectable()
export class HumanReviewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.session || request.headers.authorization || request.headers['x-api-key']) {
      throw new ForbiddenException({
        code: 'HUMAN_REVIEW_REQUIRED',
        message: 'Review this memory in OSCAR while signed in.',
      });
    }
    return true;
  }
}
