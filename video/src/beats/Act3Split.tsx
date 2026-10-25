import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Stage} from '../components/Stage';
import {appCss} from '../app-css';
import {money} from '../components/Money';
import {copy, data} from '../script';

/**
 * 0:56 — one number becoming four. The clearest single image in the video, and
 * the only beat that describes a credit offer, so the disclosure lives here and
 * holds for the rest of the beat.
 */
export const Act3Split: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {installments} = data;

  // The total starts centre-stage, then lifts and shrinks to make room.
  const lift = interpolate(frame, [22, 46], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <Stage>
      <style>{appCss}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: 1400,
          transform: 'scale(1.18)',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            transform: `translateY(${lift * -40}px) scale(${1 - lift * 0.42})`,
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'var(--ink-faint)',
              marginBottom: 8,
            }}
          >
            SEASON DUES
          </div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 150,
              lineHeight: 1,
              color: 'var(--ink)',
            }}
          >
            {money(installments.total)}
          </div>
        </div>

        <div
          style={{
            fontFamily: "'Anton', sans-serif",
            fontSize: 34,
            color: 'var(--fund-green-dk)',
            opacity: interpolate(frame, [40, 56], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            marginTop: lift * -20,
            marginBottom: 26,
          }}
        >
          {copy.act3Split.heading}
        </div>

        <div style={{display: 'flex', gap: 20}}>
          {installments.schedule.map((date, i) => {
            const enter = spring({
              frame: frame - (48 + i * 8),
              fps,
              config: {damping: 200},
              durationInFrames: 26,
            });
            return (
              <div
                key={date}
                style={{
                  width: 260,
                  background: 'var(--white)',
                  border: '1px solid var(--line)',
                  borderTop: '4px solid var(--fund-green)',
                  borderRadius: 16,
                  padding: '26px 28px',
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 26}px)`,
                  boxShadow: '0 12px 34px rgba(0,70,67,0.08)',
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    color: 'var(--ink-soft)',
                    marginBottom: 10,
                  }}
                >
                  {date.toUpperCase()}
                </div>
                <div
                  style={{
                    fontFamily: "'Anton', sans-serif",
                    fontSize: 56,
                    lineHeight: 1,
                    color: 'var(--ink)',
                  }}
                >
                  {money(installments.each)}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            maxWidth: 1060,
            marginTop: 34,
            textAlign: 'center',
            fontSize: 17,
            lineHeight: 1.55,
            color: 'var(--ink-soft)',
            opacity: interpolate(frame, [52, 72], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {copy.act3Split.disclosure}
        </div>
      </div>
    </Stage>
  );
};
