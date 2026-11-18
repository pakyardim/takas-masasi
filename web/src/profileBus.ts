// Opens the player / team popup from anywhere (name links render far from the popup).
export interface ProfileTarget { kind: "player" | "team"; key: string }

let listener: ((t: ProfileTarget) => void) | null = null;
export const openProfile = (t: ProfileTarget) => listener?.(t);
export function onProfile(fn: (t: ProfileTarget) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}
