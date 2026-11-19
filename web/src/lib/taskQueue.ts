/**
 * FIFO queue that hands an occupied slot directly to the next task.
 */
export class TaskQueue {
  private readonly concurrency: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    } else {
      this.running++;
    }

    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running--;
    }
  }
}
