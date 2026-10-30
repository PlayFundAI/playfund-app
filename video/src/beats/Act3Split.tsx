import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Stage} from '../components/Stage';
import {appCss} from '../app-css';
import {money} from '../components/Money';
import {copy, data} from '../script';

/**
 * All of Act 3. One number becoming four, under the line that says a family
 * can spread the cost while the club is still paid in full.
 *
 * Both halves of that sentence are on screen: the dated cards are the family's
 * side, the ink strip under them is the club's. The schedule is never
 * narrated or captioned, because four dated cards already say it.
 *
 * This is the only beat that describes a credit offer, so the disclosure lives
 * here and the beat's floor in script.ts exists to keep it readable.
 */
export const Act3Split: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {installments} = data;

  // The total starts centre-stage, then lifts and shrinks to make room.
  const lift = interpolate(frame, [22, 48], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Arrives on "but we still pay the club everything up front".
  const club = spring({
    frame: frame - 104,
    fps,
    config: {damping: 200},
    durationInFrames: 30,
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
        }}
      >
        <div
          style={{
            textAlign: 'center',
            transform: `translateY(${lift * -22}px) scale(${1 - lift * 0.4})`,
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
              fontSize: 140,
              lineHeight: 1,
              color: 'var(--ink)',
            }}
          >
            {money(installments.total)}
          </div>
        </div>

        <div style={{display: 'flex', gap: 18, marginTop: lift * -26}}>
          {installments.schedule.map((date, i) => {
            const enter = spring({
              frame: frame - (44 + i * 9),
              fps,
              config: {damping: 200},
              durationInFrames: 26,
            });
            return (
              <div
                key={date}
                style={{
                  width: 232,
                  background: 'var(--white)',
                  border: '1px solid var(--line)',
                  borderTop: '4px solid var(--fund-green)',
                  borderRadius: 16,
                  padding: '22px 24px',
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 24}px)`,
                  boxShadow: '0 12px 34px rgba(0,70,67,0.08)',
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    color: 'var(--ink-soft)',
                    marginBottom: 8,
                  }}
                >
                  {date.toUpperCase()}
                </div>
                <div
                  style={{
                    fontFamily: "'Anton', sans-serif",
                    fontSize: 50,
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

        {/* The club's side of the same sentence. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: 982,
            marginTop: 22,
            padding: '18px 28px',
            background: 'var(--ink)',
            borderRadius: 16,
            opacity: club,
            transform: `translateY(${(1 - club) * 16}px)`,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: 'var(--fund-green)',
              }}
            >
              {copy.act3Split.clubLabel.toUpperCase()}
            </div>
            <div style={{fontSize: 17, color: 'rgba(255,255,255,0.72)', marginTop: 2}}>
              {copy.act3Split.clubWhen}
            </div>
          </div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 44,
              color: 'var(--white)',
              letterSpacing: '0.01em',
            }}
          >
            {copy.act3Split.clubWhen2.toUpperCase()}
          </div>
        </div>

        <div
          style={{
            maxWidth: 1000,
            marginTop: 26,
            textAlign: 'center',
            fontSize: 16,
            lineHeight: 1.55,
            color: 'var(--ink-soft)',
            opacity: interpolate(frame, [60, 80], [0, 1], {
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
