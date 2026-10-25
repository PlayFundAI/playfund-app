import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {BeatId, timeline} from './script';
import {BeatWrap} from './components/BeatWrap';

import {Act1Dues} from './beats/Act1Dues';
import {Act1Expenses} from './beats/Act1Expenses';
import {Act1Split} from './beats/Act1Split';
import {Act2Roster} from './beats/Act2Roster';
import {Act2Payout} from './beats/Act2Payout';
import {Act2Buckets} from './beats/Act2Buckets';
import {Act3Dues} from './beats/Act3Dues';
import {Act3Split} from './beats/Act3Split';
import {Act4Card} from './beats/Act4Card';

const beats: Record<BeatId, React.FC> = {
  'act1-dues': Act1Dues,
  'act1-expenses': Act1Expenses,
  'act1-split': Act1Split,
  'act2-roster': Act2Roster,
  'act2-payout': Act2Payout,
  'act2-buckets': Act2Buckets,
  'act3-dues': Act3Dues,
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
      {timeline.map((beat) => {
        const Beat = beats[beat.id];
        const from = at;
        at += beat.frames;
        return (
          <Sequence
            key={beat.id}
            name={beat.id}
            from={from}
            durationInFrames={beat.frames}
          >
            <BeatWrap durationInFrames={beat.frames}>
              <Beat />
            </BeatWrap>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
