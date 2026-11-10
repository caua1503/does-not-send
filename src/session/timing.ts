export interface SessionTimingConfig {
  heartbeatTimeoutMs: number;
  wsAuthTimeoutMs: number;
}

export const DEFAULT_TIMING_CONFIG: SessionTimingConfig = {
  heartbeatTimeoutMs: 25_000,
  wsAuthTimeoutMs: 5_000,
};
