export interface SessionTimingConfig {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  computerGraceMs: number;
  phoneGraceMs: number;
  wsAuthTimeoutMs: number;
}

export const DEFAULT_TIMING_CONFIG: SessionTimingConfig = {
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 25_000,
  computerGraceMs: 30_000,
  phoneGraceMs: 30_000,
  wsAuthTimeoutMs: 5_000,
};
