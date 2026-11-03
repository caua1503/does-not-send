export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  constructor(private currentTime: number = 0) {}

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }

  set(time: number): void {
    this.currentTime = time;
  }
}
