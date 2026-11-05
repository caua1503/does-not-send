/**
 * Fixed-size FIFO queue. When full, discards oldest items.
 */
export class Queue<T> {
  private items: T[] = [];

  constructor(private readonly maxSize: number) {
    if (maxSize < 1) throw new Error("Queue maxSize must be >= 1");
  }

  /**
   * Add item to queue. If full, discards oldest item.
   * @returns true if an item was discarded to make room, false otherwise.
   */
  push(item: T): boolean {
    let discarded = false;
    if (this.items.length >= this.maxSize) {
      this.items.shift();
      discarded = true;
    }
    this.items.push(item);
    return discarded;
  }

  /**
   * Remove and return the oldest item, or undefined if empty.
   */
  shift(): T | undefined {
    return this.items.shift();
  }

  /**
   * Return the oldest item without removing it, or undefined if empty.
   */
  peek(): T | undefined {
    return this.items[0];
  }

  /**
   * Current number of items in queue.
   */
  get size(): number {
    return this.items.length;
  }

  /**
   * Remove and return up to `count` items from the front of the queue.
   */
  drain(count: number): T[] {
    return this.items.splice(0, count);
  }

  /**
   * Remove all items from the queue.
   */
  clear(): void {
    this.items.length = 0;
  }

  /**
   * Return items that don't fit under the size limit, removing them from the queue.
   * Used when returning failed batch to the front would exceed maxSize.
   */
  trimToSize(): T[] {
    if (this.items.length <= this.maxSize) return [];
    const excess = this.items.splice(0, this.items.length - this.maxSize);
    return excess;
  }

  /**
   * Add multiple items to the front of the queue.
   * If this would exceed maxSize, discards oldest items and returns them.
   */
  unshift(items: T[]): T[] {
    this.items.unshift(...items);
    return this.trimToSize();
  }
}
