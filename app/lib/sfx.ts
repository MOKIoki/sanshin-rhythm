import {
  SFX_VOLUME, SFX_PERFECT_FREQ, SFX_GOOD_FREQ,
  SFX_MISS_FREQ, SFX_DURATION,
} from "./constants";

// ─── Shared AudioContext ───────────────────────────────────────────────────────
let ctx: AudioContext | null = null;

export function resumeAudioContext(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return Promise.resolve(); }
  }
  if (ctx.state === "suspended") return ctx.resume();
  return Promise.resolve();
}

function getCtx(): AudioContext | null { return ctx; }

// ─── Judgment SFX ─────────────────────────────────────────────────────────────
function playTone(freq: number, type: OscillatorType = "sine") {
  if (!ctx || ctx.state !== "running") return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(SFX_VOLUME, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + SFX_DURATION);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + SFX_DURATION + 0.02);
  } catch { /* ignore */ }
}

export function sfxPerfect() { playTone(SFX_PERFECT_FREQ, "sine");     }
export function sfxGood()    { playTone(SFX_GOOD_FREQ,    "sine");     }
export function sfxMiss()    { playTone(SFX_MISS_FREQ,    "triangle"); }

// ─── Audio Gate for sample.wav volume control ─────────────────────────────────
//
// Connects an HTMLAudioElement through a GainNode so we can smoothly
// fade the volume up on Perfect/Good and back down to near-zero otherwise.
//
// Usage:
//   const gate = createAudioGate(audioElement);
//   gate.openGate("perfect");   // on Perfect judgment
//   gate.openGate("good");      // on Good judgment
//   gate.setPreview(true/false) // full volume for "お手本を聞く"
//   gate.destroy();             // cleanup

export interface AudioGate {
  openGate(judgment: "perfect" | "good", holdMs?: number): void;
  setPreview(on: boolean): void;
  destroy(): void;
}

// Volume levels
const GATE_BASE    = 0.0;   // background level (inaudible)
const GATE_PERFECT = 1.0;   // Perfect: full volume
const GATE_GOOD    = 0.85;  // Good: clearly audible but not perfect
const GATE_PREVIEW = 1.0;   // お手本: full

// Fade timings (seconds)
const FADE_IN_PERFECT  = 0.04;  // fast attack
const FADE_IN_GOOD     = 0.06;
const HOLD_PERFECT     = 0.18;  // how long to hold at peak before fade-out
const HOLD_GOOD        = 0.16;
const FADE_OUT         = 0.18;  // release

export function createAudioGate(audio: HTMLAudioElement): AudioGate {
  const ac = getCtx();
  if (!ac) {
    // No AudioContext: return no-op gate
    return { openGate: () => {}, setPreview: () => {}, destroy: () => {} };
  }

  // Connect: audio element → source → gain → destination
  const source = ac.createMediaElementSource(audio);
  const gain   = ac.createGain();
  source.connect(gain);
  gain.connect(ac.destination);

  // Start at base (silent)
  gain.gain.setValueAtTime(GATE_BASE, ac.currentTime);

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let previewMode = false;

  function cancelScheduled() {
    gain.gain.cancelScheduledValues(ac!.currentTime);
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  return {
    openGate(judgment: "perfect" | "good", holdMs?: number) {
      if (previewMode) return;
      const ac2 = getCtx();
      if (!ac2) return;

      const peak   = judgment === "perfect" ? GATE_PERFECT : GATE_GOOD;
      const fadeIn = judgment === "perfect" ? FADE_IN_PERFECT : FADE_IN_GOOD;
      // holdMs from caller (adaptive); fall back to built-in defaults
      const hold   = holdMs !== undefined
        ? holdMs / 1000
        : (judgment === "perfect" ? HOLD_PERFECT : HOLD_GOOD);

      cancelScheduled();
      const now = ac2.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(peak, now + fadeIn);

      holdTimer = setTimeout(() => {
        const n = ac2.currentTime;
        gain.gain.setValueAtTime(gain.gain.value, n);
        gain.gain.linearRampToValueAtTime(GATE_BASE, n + FADE_OUT);
      }, (fadeIn + hold) * 1000);
    },

    setPreview(on: boolean) {
      const ac2 = getCtx();
      if (!ac2) return;
      previewMode = on;
      cancelScheduled();
      const now = ac2.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(
        on ? GATE_PREVIEW : GATE_BASE,
        now + 0.08
      );
    },

    destroy() {
      cancelScheduled();
      try { source.disconnect(); gain.disconnect(); } catch { /* ignore */ }
    },
  };
}
