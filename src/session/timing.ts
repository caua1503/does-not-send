export interface SessionTimingConfig {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  wsAuthTimeoutMs: number;
}

export const DEFAULT_TIMING_CONFIG: SessionTimingConfig = {
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 25_000,
  wsAuthTimeoutMs: 5_000,
};
