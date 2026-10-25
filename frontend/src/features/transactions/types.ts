import type { ApiInstance } from '@/lib/api/client';
import type { ApiError, WagerSubmissionResult } from '@/types/api';

export type TransactionOutcome =
  | { type: 'result'; result: WagerSubmissionResult; httpStatus: number; instance: ApiInstance }
  | { type: 'conflict'; apiError: ApiError }
  | { type: 'error'; message: string };

export interface TimelineStep {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly timestamp: Date;
}
