/**
 * Event bus (roadmap §2.2) — the seam later systems plug into: wall destruction,
 * AI stimuli (sounds), squad notifications, FX.
 *
 * Kept intentionally tiny. Events are named strings; payloads are whatever the
 * emitter sends. As real event types appear (Phase 5's 'cell:destroyed', Phase 6's
 * sound stimuli) they get typed payload interfaces at their emit site.
 */

export type EventHandler = (payload?: unknown) => void;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();

  /** Subscribe. Returns an unsubscribe function. */
  on(event: string, handler: EventHandler): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) this.handlers.delete(event);
  }

  /** Fire `event`. Handlers may subscribe/unsubscribe during emit without skipping anyone. */
  emit(event: string, payload?: unknown): void {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of [...list]) handler(payload);
  }
}

/** The game's bus. */
export const events = new EventBus();
