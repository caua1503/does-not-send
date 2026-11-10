type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  openDurationMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(private readonly config: CircuitBreakerConfig) {}

  /**
   * Check if we can attempt an operation.
   * If circuit is open and timeout expired, transitions to half_open.
   * @returns true if operation should be attempted, false if circuit is open.
   */
  canAttempt(): boolean {
    if (this.state === "closed" || this.state === "half_open") {
      return true;
    }

    // State is "open": check if timeout expired
    if (Date.now() >= this.openUntil) {
      this.state = "half_open";
      return true;
    }

    return false;
  }

  /**
   * Record a successful operation. Closes the circuit and resets failure count.
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  /**
   * Record a failed operation. Opens the circuit if threshold is reached.
   * @returns true if circuit just opened, false otherwise.
   */
  recordFailure(): boolean {
    // A failed half-open probe reopens immediately: with the old counter it fell
    // into "already open" and, once exhausted, left the circuit closed forever.
    if (this.state === "half_open") {
      this.state = "open";
      this.openUntil = Date.now() + this.config.openDurationMs;
      return true;
    }
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.config.failureThreshold) {
      if (this.state !== "open") {
        this.state = "open";
        this.openUntil = Date.now() + this.config.openDurationMs;
        return true; // Circuit just opened
      }
    }

    return false;
  }

  /**
   * Reset the circuit breaker to initial state.
   */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  getState(): CircuitState {
    return this.state;
  }
}
