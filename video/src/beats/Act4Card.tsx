import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Stage} from '../components/Stage';
import {appCss} from '../app-css';
import {copy} from '../script';

/** 1:04 — the close. */
export const Act4Card: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 32});
  const cta = spring({frame: frame - 16, fps, config: {damping: 200}, durationInFrames: 28});

  return (
    <Stage background="#004643">
      <style>{appCss}</style>
      <div style={{textAlign: 'center', opacity: enter}}>
        <div
          style={{
            fontFamily: "'Anton', sans-serif",
            fontSize: 30,
            letterSpacing: '0.02em',
            color: 'var(--white)',
            marginBottom: 34,
          }}
        >
          PLAY<span style={{color: 'var(--fund-green)'}}>FUND</span>
        </div>

        <div
          style={{
            fontFamily: "'Anton', sans-serif",
            fontSize: 74,
            lineHeight: 1.12,
            color: 'var(--white)',
            whiteSpace: 'pre-line',
            transform: `translateY(${(1 - enter) * 16}px)`,
          }}
        >
          {copy.act4Card.headline}
        </div>

        <div
          style={{
            marginTop: 46,
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            opacity: cta,
            transform: `translateY(${(1 - cta) * 14}px)`,
          }}
        >
          <div
            style={{
              background: 'var(--fund-green)',
              color: 'var(--white)',
              fontSize: 22,
              fontWeight: 700,
              padding: '18px 42px',
              borderRadius: 12,
            }}
          >
            {copy.act4Card.cta}
          </div>
          <div style={{fontSize: 20, color: 'rgba(255,255,255,0.68)'}}>
            {copy.act4Card.url}
          </div>
        </div>
      </div>
    </Stage>
  );
};
