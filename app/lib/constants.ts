// ─── Timing & Tempo ───────────────────────────────────────────────────────────
export const BPM = 90;
export const START_OFFSET = 1.1;

// ─── Note fall ────────────────────────────────────────────────────────────────
export const NOTE_FALL_DURATION_DEFAULT = 3000;
export const NOTE_FALL_DURATION_MIN     = 1400;
export const NOTE_FALL_DURATION_MAX     = 4000;
export const NOTE_FALL_DURATION_STEP    = 400;

// ─── Judgment Windows (seconds) ───────────────────────────────────────────────
export const PERFECT_WINDOW  = 0.12;
export const GOOD_WINDOW     = 0.25;
export const MISS_WINDOW     = 0.45;

// ─── Feedback Duration ────────────────────────────────────────────────────────
export const FEEDBACK_DURATION = 750;
export const STRIKE_COOLDOWN   = 180;

// ─── Score (raw per note, converted to 100-point scale at result) ─────────────
export const PERFECT_SCORE = 10;
export const GOOD_SCORE    = 6;
export const MISS_SCORE    = 0;

// ─── Feedback SFX ─────────────────────────────────────────────────────────────
export const SFX_VOLUME       = 0.18;
export const SFX_PERFECT_FREQ = 880;
export const SFX_GOOD_FREQ    = 660;
export const SFX_MISS_FREQ    = 180;
export const SFX_DURATION     = 0.07;

// ─── Countdown ────────────────────────────────────────────────────────────────
export const COUNTDOWN_STEPS    = ["3", "2", "1", "はじめ"] as const;
export const COUNTDOWN_INTERVAL = 900;

// ─── Map geometry (synced with CSS) ──────────────────────────────────────────
export const MAP_PAD_BOT = 4;
export const MAP_ROW_H   = 14;
