import type { DexEvent, DexEventListener, DexEventName, Unsubscribe } from "./types.js";

/**
 * Minimal event emitter for DEX audit events.
 * Listeners receive the request, optional response, and the immutable receipt.
 * The emitter does not store "last result" state, so it is safe for concurrent calls.
 */
export class DexEventEmitter {
  private listeners = new Map<DexEventName, Set<DexEventListener>>();

  on(event: DexEventName, listener: DexEventListener): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(event: DexEventName, payload: DexEvent): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // Listener errors must not break the decision flow.
      }
    }
  }
}
