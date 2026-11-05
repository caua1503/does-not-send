import { describe, it, expect } from "vitest";
import { Queue } from "../src/recording/queue.js";

describe("Queue", () => {
  it("push and shift preserve FIFO order", () => {
    const q = new Queue<number>(10);
    q.push(1);
    q.push(2);
    q.push(3);

    expect(q.shift()).toBe(1);
    expect(q.shift()).toBe(2);
    expect(q.shift()).toBe(3);
    expect(q.shift()).toBeUndefined();
  });

  it("push returns true when discarding oldest item at capacity", () => {
    const q = new Queue<number>(3);
    expect(q.push(1)).toBe(false);
    expect(q.push(2)).toBe(false);
    expect(q.push(3)).toBe(false);
    expect(q.push(4)).toBe(true); // Discards 1

    expect(q.shift()).toBe(2);
    expect(q.size).toBe(2);
  });

  it("peek returns oldest without removing", () => {
    const q = new Queue<string>(5);
    q.push("a");
    q.push("b");

    expect(q.peek()).toBe("a");
    expect(q.size).toBe(2);
    expect(q.peek()).toBe("a");
  });

  it("drain removes up to count items", () => {
    const q = new Queue<number>(10);
    for (let i = 0; i < 5; i++) q.push(i);

    const drained = q.drain(3);
    expect(drained).toEqual([0, 1, 2]);
    expect(q.size).toBe(2);
  });

  it("clear removes all items", () => {
    const q = new Queue<number>(10);
    q.push(1);
    q.push(2);
    q.clear();

    expect(q.size).toBe(0);
    expect(q.shift()).toBeUndefined();
  });

  it("unshift adds items to front and returns discarded if over capacity", () => {
    const q = new Queue<number>(5);
    q.push(1);
    q.push(2);

    const discarded = q.unshift([10, 11, 12, 13]);
    // Queue now: [10, 11, 12, 13, 1, 2] → exceeds 5, discards [10]
    expect(discarded.length).toBeGreaterThan(0);
    expect(q.size).toBe(5);
  });

  it("throws if maxSize < 1", () => {
    expect(() => new Queue(0)).toThrow("maxSize must be >= 1");
  });
});
