"use client";

import { getBest } from "../lib/storage";
import { TRACKS, TrackDef } from "../lib/track";
import { useEffect, useState } from "react";

interface Props {
  onStart: (track: TrackDef) => void;
}

export default function TopScreen({ onStart }: Props) {
  const [bests, setBests] = useState<Record<string, number | null>>({});

  useEffect(() => {
    const result: Record<string, number | null> = {};
    for (const track of TRACKS) {
      const rec = getBest(track.id);
      result[track.id] = rec ? rec.score : null;
    }
    setBests(result);
  }, []);

  return (
    <div className="top-root">
      <div className="top-card">
        <header className="top-header">
          <div className="dojo-mark">三</div>
          <h1 className="top-title">さんしんリズム稽古</h1>
          <p className="top-tagline">Sanshin Rhythm 30sec Play</p>
          <p className="top-copy">30秒で、三線にふれる</p>
        </header>

        <section className="top-intro">
          <p className="top-intro-text">
            三線には、工工四（くんくんしー）という譜面があります。
            小さな稽古で、基本音とリズムにふれてみましょう。
          </p>
        </section>

        <section className="shelf">
          <p className="shelf-label">稽古コース</p>
          {TRACKS.map((track) => (
            <div key={track.id} className="shelf-card" onClick={() => onStart(track)}>
              <p className="card-track-id">{TRACKS.indexOf(track) + 1}</p>
              <h2 className="card-title">{track.title}</h2>
              <p className="card-desc">{track.description}</p>
              {bests[track.id] != null && (
                <div className="card-best">
                  <span className="best-label">自己ベスト</span>
                  <span className="best-score">{bests[track.id]}点</span>
                </div>
              )}
            </div>
          ))}
        </section>

        <footer className="top-footer">
          <p>工工四の位置を見て、音に合わせて「弾く」を押す練習です</p>
        </footer>
      </div>
    </div>
  );
}
