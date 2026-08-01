/**
 * Binary min-heap over cell indices, keyed by an external score array.
 *
 * The searches reuse one heap instance per module rather than allocating a new open
 * list per search — path requests happen often enough that the garbage matters more
 * than the code being a few lines longer.
 */
export class IndexHeap {
  private items: Int32Array;
  private count = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(Math.max(16, capacity));
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(index: number, score: Float32Array): void {
    if (this.count === this.items.length) {
      const grown = new Int32Array(this.items.length * 2);
      grown.set(this.items);
      this.items = grown;
    }
    let i = this.count++;
    this.items[i] = index;
    // sift up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (score[this.items[parent]] <= score[this.items[i]]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(score: Float32Array): number {
    if (this.count === 0) return -1;
    const top = this.items[0];
    this.count--;
    if (this.count > 0) {
      this.items[0] = this.items[this.count];
      // sift down
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.count && score[this.items[left]] < score[this.items[smallest]]) {
          smallest = left;
        }
        if (right < this.count && score[this.items[right]] < score[this.items[smallest]]) {
          smallest = right;
        }
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}
