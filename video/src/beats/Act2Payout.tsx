import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Stage} from '../components/Stage';
import {appCss} from '../app-css';
import {Counter, Money, money} from '../components/Money';
import {data} from '../script';

/**
 * 0:30 — the payout card on its own, at scale. This is the real .payout-hero
 * component from the app, enlarged rather than redrawn, so what a club sees
 * here is exactly what they will see in the product.
 *
 * This beat is also the hero loop: see the HeroLoop composition in Root.tsx.
 */
export const Act2Payout: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 24});

  return (
    <Stage>
      <style>{appCss}</style>
      <div
        style={{
          width: 420,
          transform: `scale(${2.6 * (0.97 + enter * 0.03)})`,
          opacity: enter,
        }}
      >
        <div className="payout-hero" style={{marginBottom: 0, padding: 24}}>
          <div className="payout-hero-eyebrow">LANDING IN YOUR ACCOUNT</div>
          <div className="payout-hero-amount" style={{fontSize: 52}}>
            <Money to={data.club.payout} start={6} duration={44} />
          </div>
          <div className="payout-hero-sub">
            <b>
              <Counter to={data.club.funded} start={6} duration={44} />
            </b>{' '}
            of {data.club.athletesTotal} athletes &middot;{' '}
            <b>{money(data.club.funded * data.club.duesPerAthlete)}</b> in dues
          </div>
        </div>
      </div>
    </Stage>
  );
};
