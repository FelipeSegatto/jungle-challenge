import { apiRequest, type ApiInstance } from '@/lib/api/client';
import type { HealthLive, HealthReady } from '@/types/api';

export function getLive(instance: ApiInstance, signal?: AbortSignal): Promise<HealthLive> {
  return apiRequest<HealthLive>(instance, '/health/live', { signal });
}

export function getReady(instance: ApiInstance, signal?: AbortSignal): Promise<HealthReady> {
  return apiRequest<HealthReady>(instance, '/health/ready', { signal });
}
