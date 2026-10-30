import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {BeatId, LEAD, SPEED, TRANSITION, sec, timeline} from './script';
import {BeatWrap} from './components/BeatWrap';
import {LogoLayer} from './components/LogoLayer';

import {Act1Dues} from './beats/Act1Dues';
import {Act1Expenses} from './beats/Act1Expenses';
import {Act1Split} from './beats/Act1Split';
import {Act2Roster} from './beats/Act2Roster';
import {Act2Payout} from './beats/Act2Payout';
import {Act2Alongside} from './beats/Act2Alongside';
import {Act3Split} from './beats/Act3Split';
import {Act4Card} from './beats/Act4Card';

const beats: Record<BeatId, React.FC> = {
  'act1-dues': Act1Dues,
  'act1-expenses': Act1Expenses,
  'act1-split': Act1Split,
  'act2-roster': Act2Roster,
  'act2-payout': Act2Payout,
  'act2-alongside': Act2Alongside,
  'act3-split': Act3Split,
  'act4-card': Act4Card,
};

/**
 * The whole video is this loop over `timeline` in script.ts. Nothing about
 * order or duration lives here, so cutting or reordering a beat never means
 * touching this file.
 */
export const Main: React.FC = () => {
  let at = 0;

  return (
    <AbsoluteFill style={{background: '#F4F7F6'}}>
      {timeline.map((beat, i) => {
        const Beat = beats[beat.id];
        // Start early enough that this beat's fade-in overlaps the previous
        // beat's fade-out. The first beat has nothing to dissolve from.
        const overlap = i === 0 ? 0 : TRANSITION;
        const from = at - overlap;
        const duration = beat.frames + overlap;
        at += beat.frames;
        return (
          <Sequence
            key={beat.id}
            name={beat.id}
            from={from}
            durationInFrames={duration}
          >
            <BeatWrap durationInFrames={duration}>
              <Beat />
            </BeatWrap>
            {beat.voice ? (
              <Sequence from={overlap + sec(LEAD)} name={`vo:${beat.id}`}>
                <Audio src={staticFile(`vo/${beat.id}.wav`)} playbackRate={SPEED} />
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}

      {/* Above every beat: one mark that travels, never a cut. */}
      <LogoLayer />
    </AbsoluteFill>
  );
};
