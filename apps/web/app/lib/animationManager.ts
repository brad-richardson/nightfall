/**
 * Centralized animation manager for handling multiple requestAnimationFrame loops.
 * Prevents memory leaks and provides frame rate control.
 */
export class AnimationManager {
  private animations = new Map<string, number>();
  private lastFrameTimes = new Map<string, number>();
  private fpsTarget: number;
  private frameDuration: number;

  constructor(fpsTarget = 60) {
    this.fpsTarget = fpsTarget;
    this.frameDuration = 1000 / fpsTarget;
  }

  /**
   * Start a new animation loop with optional frame rate limiting.
   * @param id Unique identifier for this animation
   * @param callback Function to call on each frame
   * @param limitFps Whether to limit to target FPS (default: false)
   */
  start(id: string, callback: (timestamp: number) => void, limitFps = false) {
    // Stop existing animation with same ID
    this.stop(id);

    const animate = (timestamp: number) => {
      if (limitFps) {
        const lastTime = this.lastFrameTimes.get(id) ?? 0;
        if (timestamp - lastTime < this.frameDuration) {
          this.animations.set(id, requestAnimationFrame(animate));
          return;
        }
        this.lastFrameTimes.set(id, timestamp);
      }

      callback(timestamp);
      this.animations.set(id, requestAnimationFrame(animate));
    };

    this.animations.set(id, requestAnimationFrame(animate));
  }

  /**
   * Stop a specific animation by ID
   */
  stop(id: string) {
    const frameId = this.animations.get(id);
    if (frameId !== undefined) {
      cancelAnimationFrame(frameId);
      this.animations.delete(id);
      this.lastFrameTimes.delete(id);
    }
  }

  /**
   * Stop all running animations
   */
  stopAll() {
    this.animations.forEach((frameId) => cancelAnimationFrame(frameId));
    this.animations.clear();
    this.lastFrameTimes.clear();
  }

  /**
   * Check if a specific animation is running
   */
  isRunning(id: string): boolean {
    return this.animations.has(id);
  }

  /**
   * Get count of active animations
   */
  getActiveCount(): number {
    return this.animations.size;
  }
}
