"use client";

import { useState } from "react";
import TopScreen from "./components/TopScreen";
import RhythmGame from "./components/RhythmGame";
import { TrackDef, TRACKS } from "./lib/track";

type View = "top" | "game";

export default function Page() {
  const [view, setView] = useState<View>("top");
  const [selectedTrack, setSelectedTrack] = useState<TrackDef>(TRACKS[0]);

  const handleStart = (track: TrackDef) => {
    setSelectedTrack(track);
    setView("game");
  };

  return (
    <main>
      {view === "top" && <TopScreen onStart={handleStart} />}
      {view === "game" && (
        <RhythmGame track={selectedTrack} onBack={() => setView("top")} />
      )}
    </main>
  );
}
