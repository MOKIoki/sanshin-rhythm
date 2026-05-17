"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  TrackDef, NOTE_MAP, STRING_ROWS, ROW_NOTES, Judgment,
} from "../lib/track";
import {
  BPM,
  MAP_PAD_BOT, MAP_ROW_H,
  NOTE_FALL_DURATION_DEFAULT, NOTE_FALL_DURATION_MIN,
  NOTE_FALL_DURATION_MAX, NOTE_FALL_DURATION_STEP,
  PERFECT_WINDOW, GOOD_WINDOW, MISS_WINDOW,
  FEEDBACK_DURATION, STRIKE_COOLDOWN,
  PERFECT_SCORE, GOOD_SCORE, MISS_SCORE,
  COUNTDOWN_STEPS, COUNTDOWN_INTERVAL,
} from "../lib/constants";
import { saveBest, getBest } from "../lib/storage";
import { sfxPerfect, sfxGood, sfxMiss, resumeAudioContext, createAudioGate, AudioGate } from "../lib/sfx";

// ─── 4-column grid coordinate system ─────────────────────────────────────────
//
// ALL three rows use the same 4-column grid:
//   col 0 (x=12.5%): open notes  — 工 / 四 / 合
//   col 1 (x=37.5%): pressed #1  — 五 / 上 / 乙
//   col 2 (x=62.5%): pressed #2  — 六 / 中 / 老
//   col 3 (x=87.5%): pressed #3  — 七 / 尺 / [invisible placeholder]
//
// X centre of col c = (c + 0.5) / 4 × 100%
// Separator line between col 0 and col 1 = 25% from left
//
// Y calculation (must match CSS .map-layer / .map-row):
//   .map-layer: flex-col + justify-end + padding-bottom: MAP_PAD_BOT%
//   .map-row:   flex: 0 0 MAP_ROW_H%
//   DOM order top→bottom: lower(工), middle(四), upper(合) → flex-end → upper is visual bottom
//   bottom edge = 100 - MAP_PAD_BOT
//   STRING_ROWS indices: lower=0, middle=1, upper=2
//   Y(rowIdx) = (100 - MAP_PAD_BOT) - (N_ROWS - rowIdx - 0.5) × MAP_ROW_H

const N_ROWS   = STRING_ROWS.length; // 3
const N_COLS   = 4;
const MAX_RAW_SCORE = 120; // track.notes.length(12) × PERFECT_SCORE(10)
const SEP_X    = (1 / N_COLS) * 100; // 25% — separator between open col and pressed cols

// col assignment per note
const NOTE_COL: Record<string, number> = {
  // lower row (工弦 → visual top)
  工: 0, 五: 1, 六: 2, 七: 3,
  // middle row (四弦)
  四: 0, 上: 1, 中: 2, 尺: 3,
  // upper row (合弦 → visual bottom)
  合: 0, 乙: 1, 老: 2,
  // col 3 of upper row is invisible placeholder (no note)
};

function buildNotePositions(): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  for (const row of STRING_ROWS) {
    const rowIdx = STRING_ROWS.indexOf(row);
    const y = (100 - MAP_PAD_BOT) - (N_ROWS - rowIdx - 0.5) * MAP_ROW_H;
    ROW_NOTES[row].forEach((noteName) => {
      const col = NOTE_COL[noteName] ?? 0;
      const x   = (col + 0.5) / N_COLS * 100;
      pos[noteName] = { x, y };
    });
  }
  return pos;
}

// Single source of truth — both map chips and falling notes read from here
const NOTE_POSITIONS = buildNotePositions();

function getNotePos(noteName: string): { x: number; y: number } {
  return NOTE_POSITIONS[noteName] ?? { x: 50, y: 75 };
}

// ─── Adaptive gate duration ──────────────────────────────────────────────────
// Hold time is capped at a fraction of the interval to the next note,
// preventing audio from bleeding into the next note's window.
const GATE_BASE_PERFECT  = 340; // ms
const GATE_BASE_GOOD     = 260; // ms
const GATE_RATIO_PERFECT = 0.60;
const GATE_RATIO_GOOD    = 0.50;

function getGateDurationMs(
  judgment: "perfect" | "good",
  noteIndex: number,
  allNotes: { timeSeconds: number }[]
): number {
  const base  = judgment === "perfect" ? GATE_BASE_PERFECT : GATE_BASE_GOOD;
  const ratio = judgment === "perfect" ? GATE_RATIO_PERFECT : GATE_RATIO_GOOD;
  if (noteIndex >= 0 && noteIndex < allNotes.length - 1) {
    const intervalMs = (allNotes[noteIndex + 1].timeSeconds - allNotes[noteIndex].timeSeconds) * 1000;
    return Math.round(Math.min(base, intervalMs * ratio));
  }
  return base; // last note or not found
}

// ─── Types ────────────────────────────────────────────────────────────────────
type NoteState = "incoming" | "hit-perfect" | "hit-good" | "missed";
interface LiveNote {
  id: number; beat: number; note: string; timeSeconds: number;
  row: string; position: number; type: string; rowLabel: string;
  state: NoteState;
}

type JudgmentResult = "perfect" | "good" | "miss" | "too-early" | null;
interface FeedbackState { judgment: JudgmentResult; note: string; diffMs: number; }
interface BurstEffect  { id: number; x: number; y: number; judgment: "perfect" | "good" | "miss"; }
interface StringRing  { id: number; row: string; judgment: "perfect" | "good" | "miss"; }
interface GameResult {
  score: number; displayScore: number; maxCombo: number;
  perfects: number; goods: number; misses: number;
  grade: string;
}
type Phase = "idle" | "countdown" | "playing" | "result";

function judgmentLabel(j: JudgmentResult, diffMs: number): string {
  if (j === "perfect")   return "ぴったり";
  if (j === "good")      return diffMs < 0 ? "少し早い" : "少し遅い";
  if (j === "miss")      return diffMs < 0 ? "早すぎ"  : "遅すぎ";
  if (j === "too-early") return "まだ早い";
  return "";
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function RhythmGame({ track, onBack: onBackOrig }: { track: TrackDef; onBack: () => void }) {
  const onBack = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; }
    // Stop guide audio
    const guide = guideAudioRef.current;
    if (guide) { guide.pause(); guide.currentTime = 0; }
    // Destroy gate on final exit (page unmount equivalent)
    if (audioGateRef.current) { audioGateRef.current.destroy(); audioGateRef.current = null; }
    setPreviewPlaying(false);
    onBackOrig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBackOrig]);
  const [phase, setPhase]       = useState<Phase>("idle");
  const [notes, setNotes]       = useState<LiveNote[]>([]);
  const [score, setScore]       = useState(0);
  const [combo, setCombo]       = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [result, setResult]     = useState<GameResult | null>(null);
  const [elapsed, setElapsed]   = useState(0);
  const [bursts, setBursts]     = useState<BurstEffect[]>([]);
  const [stringRings, setStringRings] = useState<StringRing[]>([]);
  const [cdStep, setCdStep]     = useState(0);

  // Tuning: initialise from track defaults each time a new track is selected
  const [fallMs,     setFallMs]     = useState(() => track.defaultLeadMs);
  const [bpmAdj,     setBpmAdj]     = useState(BPM);
  const [offsetAdj,  setOffsetAdj]  = useState(() => track.defaultAudioOffsetSec);
  const [tuningOpen, setTuningOpen] = useState(false);

  const audioRef           = useRef<HTMLAudioElement | null>(null);
  const rafRef             = useRef<number>(0);
  const t0Ref              = useRef<number>(0);
  const notesRef           = useRef<LiveNote[]>([]);
  const comboRef           = useRef(0);
  const maxComboRef        = useRef(0);
  const scoreRef           = useRef(0);
  const perfsRef           = useRef(0);
  const goodsRef           = useRef(0);
  const missesRef          = useRef(0);
  const phaseRef           = useRef<Phase>("idle");
  const fbTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cdTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioStartDelayRef = useRef<number>(0);
  const lastStrikeRef      = useRef<number>(0);
  const burstIdRef         = useRef<number>(0);
  const stringRingIdRef    = useRef<number>(0);
  const audioGateRef       = useRef<AudioGate | null>(null);
  const guideAudioRef      = useRef<HTMLAudioElement | null>(null); // separate instance for お手本
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const spawnBurst = useCallback((noteName: string, judgment: "perfect" | "good" | "miss") => {
    const pos = getNotePos(noteName);
    const id  = ++burstIdRef.current;
    setBursts((prev) => [...prev, { id, x: pos.x, y: pos.y, judgment }]);
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 500);
  }, []);

  const spawnStringRing = useCallback((noteName: string, judgment: "perfect" | "good" | "miss") => {
    const entry = NOTE_MAP[noteName];
    if (!entry) return;
    const id = ++stringRingIdRef.current;
    setStringRings((prev) => [...prev, { id, row: entry.row, judgment }]);
    setTimeout(() => setStringRings((prev) => prev.filter((r) => r.id !== id)), 550);
  }, []);

  const syncDisplay = useCallback(() => {
    setNotes([...notesRef.current]);
    setScore(Math.min(100, Math.round(scoreRef.current / MAX_RAW_SCORE * 100)));
    setCombo(comboRef.current);
  }, []);

  const endGame = useCallback((_reason?: "complete" | "gameover") => {
    const p: Phase = "result";
    phaseRef.current = p;
    cancelAnimationFrame(rafRef.current);
    const audio = audioRef.current;
    if (audio) { audio.pause(); }
    // Keep audioGateRef alive — reused if player clicks もう一度
    // Just ensure gain is back to 0 (gate state is already at base after fade-out)
    setPreviewPlaying(false);
    const maxRawScore = track.notes.length * PERFECT_SCORE;
    const displayScore = maxRawScore > 0
      ? Math.round(scoreRef.current / maxRawScore * 100) : 0;
    const grade = displayScore === 100 ? '満点'
      : displayScore >= 90 ? '上出来'
      : displayScore >= 70 ? '合格'
      : 'もう一度';
    saveBest(track.id, {
      score: displayScore, combo: maxComboRef.current,
      perfects: perfsRef.current, goods: goodsRef.current, misses: missesRef.current,
    });
    setResult({
      score: scoreRef.current, displayScore, maxCombo: maxComboRef.current,
      perfects: perfsRef.current, goods: goodsRef.current, misses: missesRef.current,
      grade,
    });
    setPhase(p);
  }, []);

  const gameLoop = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const now = (performance.now() - t0Ref.current) / 1000;
    setElapsed(now);

    let changed = false;
    notesRef.current = notesRef.current.map((n) => {
      if (n.state === "incoming" && now > n.timeSeconds + MISS_WINDOW) {
        missesRef.current++;
        comboRef.current = 0;
        sfxMiss();
        spawnBurst(n.note, "miss");
        if (n.type === "open") spawnStringRing(n.note, "miss");
        changed = true;
        return { ...n, state: "missed" as const };
      }
      return n;
    });

    if (changed) {
      syncDisplay();
    } else {
      setElapsed(now);
    }

    const last = notesRef.current[notesRef.current.length - 1];
    const allDone = notesRef.current.every((n) => n.state !== "incoming");
    if (allDone && now > last.timeSeconds + 1.5) { endGame("complete"); return; }
    rafRef.current = requestAnimationFrame(gameLoop);
  }, [endGame, syncDisplay, spawnBurst, spawnStringRing]);

  const startPlaying = useCallback(() => {
    phaseRef.current = "playing";
    t0Ref.current = performance.now();
    const delay = audioStartDelayRef.current;
    const audio = audioRef.current;
    if (audio) {
      // createMediaElementSource must only be called ONCE per element.
      // Re-use the existing gate if already created; only create on first play.
      if (!audioGateRef.current) {
        audioGateRef.current = createAudioGate(audio);
      }
      audio.currentTime = 0;
      const doPlay = () => audio.play().catch((e) => console.warn("play failed:", e));
      if (delay <= 0.01) doPlay(); else setTimeout(doPlay, delay * 1000);
    }
    setPhase("playing");
    rafRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop]);

  const runCountdown = useCallback(() => {
    phaseRef.current = "countdown";
    setCdStep(0); setPhase("countdown");
    let step = 0;
    const tick = () => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setCdStep(step);
        cdTimerRef.current = setTimeout(tick, COUNTDOWN_INTERVAL);
      } else { startPlaying(); }
    };
    cdTimerRef.current = setTimeout(tick, COUNTDOWN_INTERVAL);
  }, [startPlaying]);

  const startGame = useCallback(async () => {
    await resumeAudioContext();
    if (audioRef.current) { audioRef.current.load(); }

    const spb = 60 / bpmAdj;
    const fallSec = fallMs / 1000;
    const audioStartDelay = Math.max(0, fallSec - offsetAdj);

    notesRef.current = track.notes.map((n) => ({
      ...n,
      timeSeconds: audioStartDelay + offsetAdj + n.beat * spb,
      state: "incoming" as const,
    }));
    audioStartDelayRef.current = audioStartDelay;
    comboRef.current = 0; maxComboRef.current = 0; scoreRef.current = 0;
    perfsRef.current = 0; goodsRef.current = 0;    missesRef.current = 0;
    lastStrikeRef.current = 0;

    setNotes(notesRef.current);
    setScore(0); setCombo(0);
    // Stop guide audio if playing when もう一度 is pressed
    if (guideAudioRef.current) {
      guideAudioRef.current.pause();
      guideAudioRef.current.currentTime = 0;
    }
    setFeedback(null); setResult(null); setElapsed(0); setBursts([]); setStringRings([]);
    setPreviewPlaying(false);
    runCountdown();
  }, [bpmAdj, offsetAdj, fallMs, runCountdown]);

  const handleStrike = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const now_ms = performance.now();
    if (now_ms - lastStrikeRef.current < STRIKE_COOLDOWN) return;
    lastStrikeRef.current = now_ms;
    const now = (now_ms - t0Ref.current) / 1000;

    let closest: LiveNote | null = null;
    let minDist = Infinity;
    for (const n of notesRef.current) {
      if (n.state !== "incoming") continue;
      const dist = Math.abs(now - n.timeSeconds);
      if (dist < minDist) { minDist = dist; closest = n; }
    }
    if (!closest) return;

    const diff = now - closest.timeSeconds;
    let judgment: JudgmentResult;
    let newState: NoteState;

    if (diff < -MISS_WINDOW) {
      setFeedback({ judgment: "too-early", note: closest.note, diffMs: Math.round(diff * 1000) });
      if (fbTimerRef.current) clearTimeout(fbTimerRef.current);
      fbTimerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_DURATION);
      return;
    } else if (Math.abs(diff) <= PERFECT_WINDOW) {
      judgment = "perfect"; newState = "hit-perfect";
    } else if (Math.abs(diff) <= GOOD_WINDOW) {
      judgment = "good"; newState = "hit-good";
    } else {
      judgment = "miss"; newState = "missed";
    }

    const diffMs = Math.round(diff * 1000);
    notesRef.current = notesRef.current.map((n) =>
      n.id === closest!.id ? { ...n, state: newState } : n
    );

    if (judgment === "perfect") {
      comboRef.current++;
      if (comboRef.current > maxComboRef.current) maxComboRef.current = comboRef.current;
      scoreRef.current += PERFECT_SCORE;
      perfsRef.current++;
      sfxPerfect();
      audioGateRef.current?.openGate(
        "perfect",
        getGateDurationMs("perfect", notesRef.current.indexOf(closest), notesRef.current)
      );
    } else if (judgment === "good") {
      comboRef.current++;
      if (comboRef.current > maxComboRef.current) maxComboRef.current = comboRef.current;
      scoreRef.current += GOOD_SCORE;
      goodsRef.current++;
      sfxGood();
      audioGateRef.current?.openGate(
        "good",
        getGateDurationMs("good", notesRef.current.indexOf(closest), notesRef.current)
      );
    } else {
      comboRef.current = 0;
      missesRef.current++; sfxMiss();
      // Miss: gate stays closed (audio stays near-silent)
    }
    if (judgment === "perfect" || judgment === "good" || judgment === "miss") {
      spawnBurst(closest.note, judgment);
      if (closest.type === "open") {
        spawnStringRing(closest.note, judgment);
      }
    }

    setFeedback({ judgment, note: closest.note, diffMs });
    syncDisplay();
    if (fbTimerRef.current) clearTimeout(fbTimerRef.current);
    fbTimerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_DURATION);
  }, [syncDisplay, endGame, spawnBurst, spawnStringRing]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); handleStrike(); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [handleStrike]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (fbTimerRef.current) clearTimeout(fbTimerRef.current);
    if (cdTimerRef.current) clearTimeout(cdTimerRef.current);
    if (audioGateRef.current) { audioGateRef.current.destroy(); audioGateRef.current = null; }
    if (guideAudioRef.current) { guideAudioRef.current.pause(); }
  }, []);

  // Reset tuning defaults when a different track is selected
  useEffect(() => {
    setFallMs(track.defaultLeadMs);
    setOffsetAdj(track.defaultAudioOffsetSec);
  }, [track.id, track.defaultLeadMs, track.defaultAudioOffsetSec]);

  // ── Note fall position ─────────────────────────────────────────────────────
  const fallSec = fallMs / 1000;

  const getFallY = (n: LiveNote): number => {
    const tgt = getNotePos(n.note);
    const delta = n.timeSeconds - elapsed;
    const progress = 1 - delta / fallSec;
    return progress * tgt.y;
  };

  const isVisible = (n: LiveNote): boolean => {
    const delta = n.timeSeconds - elapsed;
    const progress = 1 - delta / fallSec;
    return progress > -0.05 && progress < 1.25;
  };

  const activeNote = notes.find((n) => n.state === "incoming") ?? null;

  // ── Lives ──────────────────────────────────────────────────────────────────

  // ── Lane renderer ──────────────────────────────────────────────────────────
  const renderLane = (isCountdown: boolean) => (
    <div className="lane">
      {/* Fixed map — 4-col grid, same coords as NOTE_POSITIONS */}
      <div className="map-layer" aria-hidden>
        {STRING_ROWS.map((row) => {
          const chips = ROW_NOTES[row]; // 4 or 3 notes
          return (
            <div key={row} className={`map-row map-row--${row}`}>
              {(() => {
                const ring = stringRings.find((r) => r.row === row);
                const ringCls = ring ? `str-line--ring-${ring.judgment}` : "";
                return <div className={`str-line str-line--${row} ${ringCls}`} key={ring?.id ?? "static"} />;
              })()}
              {Array.from({ length: N_COLS }, (_, col) => {
                const noteName = chips[col];
                if (!noteName) {
                  return <div key={`ph-${col}`} className="map-chip map-chip--placeholder" aria-hidden />;
                }
                const entry   = NOTE_MAP[noteName];
                const isLand  = !isCountdown && activeNote?.note === noteName;
                // Dim pressed chips when an open note on the same row is active
                const activeIsOpenOnSameRow =
                  !isCountdown &&
                  activeNote?.row === row &&
                  NOTE_MAP[activeNote.note]?.type === "open" &&
                  entry.type !== "open";
                return (
                  <div
                    key={noteName}
                    className={[
                      "map-chip",
                      entry.type === "open" ? "map-chip--open" : "",
                      isLand ? "map-chip--landing" : "",
                      activeIsOpenOnSameRow ? "map-chip--dim" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {noteName}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Falling notes — absolute positioned using NOTE_POSITIONS */}
      {!isCountdown && (
        <div className="note-layer" aria-hidden>
          {notes.map((n) => {
            const tgt = getNotePos(n.note);

            const isOpen = n.type === "open";
            const isHalfBeat = Math.abs(n.beat % 1 - 0.5) < 0.001;

            // All judged notes: hide immediately
            // (burst-effect handles non-open visuals; string-ring handles open note visuals)
            if (n.state === "hit-perfect" || n.state === "hit-good" || n.state === "missed") {
              return null;
            }

            if (!isVisible(n)) return null;
            const y = getFallY(n);
            const isActive = n.id === activeNote?.id;
            if (isOpen) {
              return (
                <div key={n.id}
                  className={[
                    "fall-note fall-note--open-bar open-note",
                    isHalfBeat ? "fall-note--half" : "",
                    isActive ? "fall-note--active" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ left: `${tgt.x}%`, top: `${y}%` }}>
                  <span className="open-note-label">{n.note}</span>
                  <span className="open-note-string" />
                </div>
              );
            }
            return (
              <div key={n.id}
                className={[
                  "fall-note",
                  isHalfBeat ? "fall-note--half" : "",
                  isActive ? "fall-note--active" : "",
                ].filter(Boolean).join(" ")}
                style={{ left: `${tgt.x}%`, top: `${y}%` }}>
                {n.note}
              </div>
            );
          })}
          {/* Burst effects — independent of note shape */}
          {bursts.map((b) => (
            <div key={b.id}
              className={`burst-effect burst-effect--${b.judgment}`}
              style={{ left: `${b.x}%`, top: `${b.y}%` }}
              aria-hidden
            >
              <div className="burst-ring" />
              <div className="burst-particles">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className={`burst-particle burst-particle--${i}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Countdown overlay */}
      {isCountdown && (
        <div className="cd-overlay">
          <span className="cd-num" key={cdStep}>{COUNTDOWN_STEPS[cdStep]}</span>
          <span className="cd-hint">リズムに合わせよう</span>
        </div>
      )}
    </div>
  );

  // ── Preview (お手本を聞く) ─────────────────────────────────────────────────
  const togglePreview = useCallback(() => {
    // Use a separate audio instance to avoid competing with the gated play audio
    if (!guideAudioRef.current) {
      guideAudioRef.current = new Audio(track.audioSrc);
    }
    const guide = guideAudioRef.current;
    if (previewPlaying) {
      guide.pause();
      guide.currentTime = 0;
      setPreviewPlaying(false);
    } else {
      guide.currentTime = 0;
      guide.play().catch(() => {});
      setPreviewPlaying(true);
      const onEnd = () => { setPreviewPlaying(false); guide.removeEventListener('ended', onEnd); };
      guide.addEventListener('ended', onEnd);
    }
  }, [previewPlaying]);

  // ── Feedback ───────────────────────────────────────────────────────────────
  const renderFeedback = () => {
    if (!feedback) return <span className="fb-placeholder">—</span>;
    const { judgment, note, diffMs } = feedback;
    const label = judgmentLabel(judgment, diffMs);
    return (
      <>
        {judgment !== "too-early" && <span className="fb-note">{note}</span>}
        <span className={`fb-judgment fb-judgment--${judgment ?? "none"}`}>
          {judgment === "perfect" ? "Perfect"
            : judgment === "good"  ? "Good"
            : judgment === "miss"  ? "Miss"
            : ""}
        </span>
        <span className={`fb-detail fb-detail--${judgment ?? "none"}`}>{label}</span>
      </>
    );
  };

  // ── Tuning panel ───────────────────────────────────────────────────────────
  const renderTuning = () => (
    <div className="tuning-wrap">
      <button className="tuning-toggle-btn" onClick={() => setTuningOpen(v => !v)}>
        {tuningOpen ? "▲ 調整を閉じる" : "▼ タイミング調整"}
      </button>
      {tuningOpen && (
        <div className="tuning-panel">
          <div className="tuning-row">
            <div className="tuning-text">
              <span className="tuning-name">見やすさ</span>
              <span className="tuning-desc">ノーツが落ちてくる速さ</span>
            </div>
            <div className="tuning-ctrl">
              <button className="tuning-btn"
                disabled={fallMs <= NOTE_FALL_DURATION_MIN}
                onClick={() => setFallMs(v => Math.max(NOTE_FALL_DURATION_MIN, v - NOTE_FALL_DURATION_STEP))}>
                はやく
              </button>
              <span className="tuning-val">{fallMs}ms</span>
              <button className="tuning-btn"
                disabled={fallMs >= NOTE_FALL_DURATION_MAX}
                onClick={() => setFallMs(v => Math.min(NOTE_FALL_DURATION_MAX, v + NOTE_FALL_DURATION_STEP))}>
                ゆっくり
              </button>
            </div>
          </div>
          <div className="tuning-row">
            <div className="tuning-text">
              <span className="tuning-name">音とのズレ</span>
              <span className="tuning-desc">音と工工四のタイミングがズレる時に調整</span>
            </div>
            <div className="tuning-ctrl">
              <button className="tuning-btn"
                onClick={() => setOffsetAdj(v => parseFloat(Math.max(0, v - 0.1).toFixed(1)))}>
                少し早く
              </button>
              <span className="tuning-val">{offsetAdj.toFixed(1)}s</span>
              <button className="tuning-btn"
                onClick={() => setOffsetAdj(v => parseFloat((v + 0.1).toFixed(1)))}>
                少し遅く
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="gr-root">
      <audio ref={audioRef} src={track.audioSrc} preload="auto" />

      {/* Idle */}
      {phase === "idle" && (
        <div className="screen-center">
          <div className="title-block">
            <p className="subtitle">三線リズム稽古</p>
            <h1 className="track-title">{track.title}</h1>
          </div>
          <p className="idle-desc">
            30秒以内の小さな稽古です。<br />最後まで弾いて、合格点を目指します。
          </p>
          <p className="idle-open-note">工・四・合は、弦を押さえずに鳴らす音です。</p>
          <button className="btn-primary" onClick={startGame}>稽古をはじめる</button>
          <button className="btn-ghost" onClick={onBack}>← 戻る</button>
          {renderTuning()}
        </div>
      )}

      {/* Countdown */}
      {phase === "countdown" && (
        <div className="play-card">
          <div className="hud">
            <div className="hud-score">
              <span className="hud-label">スコア</span>
              <span className="hud-value">0</span>
            </div>
            <div className="hud-mid" />
          </div>
          {renderLane(true)}
          <div className="feedback-row"><span className="fb-placeholder">—</span></div>
          <div className="strike-area">
            <button className="strike-btn strike-btn--dim" disabled>
              <span className="strike-kanji">弾く</span>
            </button>
          </div>
        </div>
      )}

      {/* Playing */}
      {phase === "playing" && (
        <div className="play-card">
          <div className="hud">
            <div className="hud-score">
              <span className="hud-label">スコア</span>
              <span className="hud-value">{score.toLocaleString()}</span>
            </div>
            <div className="hud-mid">
              {combo >= 3 && <span className="combo-badge">{combo} COMBO</span>}
            </div>
          </div>
          {renderLane(false)}
          <div className="feedback-row" aria-live="polite">{renderFeedback()}</div>
          <div className="strike-area">
            <button className="strike-btn"
              onPointerDown={(e) => { e.preventDefault(); handleStrike(); }}>
              <span className="strike-kanji">弾く</span>
              <span className="strike-sub">SPACE / TAP</span>
            </button>
          </div>
        </div>
      )}

      {/* Result / Gameover */}
      {phase === "result" && result && (
        <div className="screen-center">
          <div className="result-block">
            <p className="result-grade">{result.grade}</p>
            <div className="result-score">{result.displayScore}点</div>
            <div className="result-stats">
              {[
                { label: "Perfect",  val: result.perfects,  cls: "perfect-color" },
                { label: "Good",     val: result.goods,     cls: "good-color"    },
                { label: "Miss",     val: result.misses,    cls: "miss-color"    },
                { label: "最大コンボ", val: result.maxCombo, cls: ""              },
              ].map(({ label, val, cls }) => (
                <div key={label} className="stat-row">
                  <span className={`stat-label ${cls}`}>{label}</span>
                  <span className="stat-val">{val}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            className={`btn-ghost ${previewPlaying ? 'btn-ghost--active' : ''}`}
            onClick={togglePreview}>
            {previewPlaying ? '■ 停止' : '▶ お手本を聞く'}
          </button>
          <button className="btn-primary" onClick={startGame}>もう一度</button>
          <button className="btn-ghost"   onClick={onBack}>← 戻る</button>
        </div>
      )}
    </div>
  );
}
