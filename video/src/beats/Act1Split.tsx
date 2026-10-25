import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Stage} from '../components/Stage';
import {appCss} from '../app-css';
import {copy} from '../script';

/**
 * 0:14 — the thesis, as the two halves of the homepage hero. Deliberately the
 * same shape a club already saw on playfundai.com before they clicked.
 */
export const Act1Split: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const card = (i: number) =>
    spring({frame: frame - i * 7, fps, config: {damping: 200}, durationInFrames: 28});

  const panel: React.CSSProperties = {
    width: 460,
    minHeight: 340,
    borderRadius: 22,
    padding: '46px 44px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };

  return (
    <Stage>
      <style>{appCss}</style>
      <div style={{display: 'flex', gap: 28}}>
        <div
          style={{
            ...panel,
            background: 'var(--paper-mid)',
            opacity: card(0),
            transform: `translateX(${(1 - card(0)) * -40}px)`,
          }}
        >
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 56,
              color: 'var(--fund-green-dk)',
              marginBottom: 14,
            }}
          >
            {copy.act1Split.families.kicker}
          </div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 38,
              lineHeight: 1.15,
              color: 'var(--ink)',
            }}
          >
            {copy.act1Split.families.line}
          </div>
        </div>

        <div
          style={{
            ...panel,
            background: 'var(--ink)',
            opacity: card(1),
            transform: `translateX(${(1 - card(1)) * 40}px)`,
          }}
        >
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 56,
              color: 'var(--fund-green)',
              marginBottom: 14,
            }}
          >
            {copy.act1Split.clubs.kicker}
          </div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 38,
              lineHeight: 1.15,
              color: 'var(--white)',
            }}
          >
            {copy.act1Split.clubs.line}
          </div>
        </div>
      </div>
    </Stage>
  );
};
