import { BPM, START_OFFSET } from "./constants";

export type Judgment = "perfect" | "good" | "miss" | null;

// ─── String rows (弾き手・見下ろし視点) ──────────────────────────────────────
export type StringRow = "upper" | "middle" | "lower";

export interface NoteMapEntry {
  row: StringRow;
  rowLabel: string;
  position: number;
  type: "open" | "pressed";
}

export const NOTE_MAP: Record<string, NoteMapEntry> = {
  合: { row: "upper",  rowLabel: "上の弦", position: 0, type: "open"    },
  乙: { row: "upper",  rowLabel: "上の弦", position: 1, type: "pressed" },
  老: { row: "upper",  rowLabel: "上の弦", position: 2, type: "pressed" },
  四: { row: "middle", rowLabel: "中の弦", position: 0, type: "open"    },
  上: { row: "middle", rowLabel: "中の弦", position: 1, type: "pressed" },
  中: { row: "middle", rowLabel: "中の弦", position: 2, type: "pressed" },
  尺: { row: "middle", rowLabel: "中の弦", position: 3, type: "pressed" },
  工: { row: "lower",  rowLabel: "下の弦", position: 0, type: "open"    },
  五: { row: "lower",  rowLabel: "下の弦", position: 1, type: "pressed" },
  六: { row: "lower",  rowLabel: "下の弦", position: 2, type: "pressed" },
  七: { row: "lower",  rowLabel: "下の弦", position: 3, type: "pressed" },
};

export const STRING_ROWS: StringRow[] = ["lower", "middle", "upper"];

export const ROW_NOTES: Record<StringRow, string[]> = {
  lower:  ["工", "五", "六", "七"],
  middle: ["四", "上", "中", "尺"],
  upper:  ["合", "乙", "老"],
};

// ─── NoteData ─────────────────────────────────────────────────────────────────
export interface NoteData {
  id: number;
  beat: number;
  note: string;
  timeSeconds: number;
  row: StringRow;
  position: number;
  type: "open" | "pressed";
  rowLabel: string;
}

// ─── Track definition ─────────────────────────────────────────────────────────
export interface TrackDef {
  id: string;
  title: string;
  description: string;
  audioSrc: string;
  /** Default note fall duration (ms) — can be overridden by tuning UI */
  defaultLeadMs: number;
  /** Default audio offset (seconds) — can be overridden by tuning UI */
  defaultAudioOffsetSec: number;
  notes: NoteData[];
}

// ─── Helper: build NoteData array from raw beats ──────────────────────────────
function buildNotes(
  rawNotes: { beat: number; note: string }[],
  bpm: number,
  startOffset: number
): NoteData[] {
  const spb = 60 / bpm;
  return rawNotes.map((n, i) => {
    const m = NOTE_MAP[n.note] ?? {
      row: "middle" as StringRow, rowLabel: "中の弦", position: 0, type: "open" as const,
    };
    return {
      id: i,
      beat: n.beat,
      note: n.note,
      timeSeconds: startOffset + n.beat * spb,
      row: m.row,
      position: m.position,
      type: m.type,
      rowLabel: m.rowLabel,
    };
  });
}

function buildTimedNotes(
  notes: { timeSeconds: number; note: string }[]
): NoteData[] {
  return notes.map((n, i) => ({
    id: `timed-${i}`,
    beat: n.timeSeconds,
    timeSeconds: n.timeSeconds,
    note: n.note,
    type: OPEN_NOTES.includes(n.note) ? "open" : "normal",
  }));
}

// ─── TRACKS ───────────────────────────────────────────────────────────────────
// To add a new course:
//   1. Add audio file to public/audio/
//   2. Add a new entry to this array
//   3. The top screen card appears automatically

export const TRACKS: TrackDef[] = [
  {
    id: "basic-notes",
    title: "三線の基本音フレーズ",
    description: "普通の曲で使う三線の基本音を、一音一拍でたどって「弾く」練習です。",
    audioSrc: "/audio/sample.wav",
    defaultLeadMs: 3000,
    defaultAudioOffsetSec: 0.8,
    notes: buildNotes(
      [
        { beat: 0,  note: "合" },
        { beat: 1,  note: "乙" },
        { beat: 2,  note: "四" },
        { beat: 3,  note: "工" },
        { beat: 4,  note: "六" },
        { beat: 5,  note: "七" },
        { beat: 6,  note: "五" },
        { beat: 7,  note: "中" },
        { beat: 8,  note: "尺" },
        { beat: 9,  note: "工" },
        { beat: 10, note: "上" },
        { beat: 11, note: "老" },
      ],
      BPM,
      START_OFFSET
    ),
  },
  {
    id: "tinsagu-nu-hana",
    title: "てぃんさぐぬ花",
    description: "沖縄で親しまれてきた教訓歌。半拍の「たたん」が入る、少し難しい稽古です。",
    audioSrc: "/audio/tinsagu-nu-hana.m4a",
    defaultLeadMs: 3600,
    defaultAudioOffsetSec: 0.7,
    notes: buildTimedNotes(
      [
        { timeSeconds: 0.850, note: "中" },
        { timeSeconds: 1.667, note: "工" },
        { timeSeconds: 2.449, note: "尺" },
        { timeSeconds: 3.299, note: "中" },
        { timeSeconds: 4.150, note: "上" },

        { timeSeconds: 4.966, note: "四" },
        { timeSeconds: 5.340, note: "合" },
        { timeSeconds: 5.748, note: "老" },
        { timeSeconds: 6.667, note: "四" },
        { timeSeconds: 7.564, note: "工" },

        { timeSeconds: 8.387, note: "中" },
        { timeSeconds: 9.183, note: "工" },
        { timeSeconds: 10.112, note: "六" },
        { timeSeconds: 10.962, note: "合" },

        { timeSeconds: 11.784, note: "上" },
        { timeSeconds: 12.607, note: "合" },
        { timeSeconds: 13.509, note: "六" },
        { timeSeconds: 14.412, note: "七" },

        { timeSeconds: 15.235, note: "中" },
        { timeSeconds: 16.111, note: "合" },
        { timeSeconds: 16.509, note: "尺" },
        { timeSeconds: 16.933, note: "中" },
        { timeSeconds: 17.809, note: "上" },

        { timeSeconds: 18.605, note: "四" },
        { timeSeconds: 19.481, note: "合" },
        { timeSeconds: 20.384, note: "老" },
        { timeSeconds: 20.750, note: "四" },
        { timeSeconds: 20.995, note: "工" },

        { timeSeconds: 21.260, note: "中" },
        { timeSeconds: 22.162, note: "工" },
        { timeSeconds: 23.038, note: "尺" },
        { timeSeconds: 23.462, note: "中" },
        { timeSeconds: 23.967, note: "上" },

        { timeSeconds: 25.108, note: "四" },
      ]
    ),
  },
];

/** Convenience: first track (kept for any legacy reference during migration) */
export const TRACK = TRACKS[0];
