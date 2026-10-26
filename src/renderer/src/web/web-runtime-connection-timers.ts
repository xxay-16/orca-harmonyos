import { withReconnectJitter } from '../../../shared/reconnect-jitter'

type TimerName = 'connect' | 'handshake' | 'reconnect'
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15_000]

/** The web transport's one-shot timers; arming a timer replaces any pending one of that name. */
export class WebRuntimeConnectionTimers {
  private readonly timers = new Map<TimerName, number>()
  private reconnectAttempt = 0

  armReconnect(fire: () => void): void {
    if (this.has('reconnect')) {
      return
    }
    const delay = withReconnectJitter(
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    )
    this.reconnectAttempt++
    this.arm('reconnect', delay, fire)
  }

  resetReconnect(): void {
    this.reconnectAttempt = 0
  }

  arm(name: TimerName, delayMs: number, fire: () => void): void {
    this.clear(name)
    this.timers.set(
      name,
      window.setTimeout(() => {
        this.timers.delete(name)
        fire()
      }, delayMs)
    )
  }

  has(name: TimerName): boolean {
    return this.timers.has(name)
  }

  clear(name: TimerName): void {
    const timer = this.timers.get(name)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      this.timers.delete(name)
    }
  }

  clearAll(): void {
    for (const name of Array.from(this.timers.keys())) {
      this.clear(name)
    }
  }
}
