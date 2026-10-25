import React from 'react';
import {Composition} from 'remotion';
import {FPS, sec, totalFrames} from './script';
import {Main} from './Main';
import {Act2Payout} from './beats/Act2Payout';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* The pilot explainer. */}
      <Composition
        id="Main"
        component={Main}
        durationInFrames={totalFrames}
        fps={FPS}
        width={1920}
        height={1080}
      />

      {/* The homepage loop: the payout beat on its own, silent, no narration.
          Renders to a short file that autoplays muted behind the hero. */}
      <Composition
        id="HeroLoop"
        component={Act2Payout}
        durationInFrames={sec(8)}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
