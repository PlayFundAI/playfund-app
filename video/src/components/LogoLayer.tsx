import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {LOGO_HOME, LogoSpot, logoSpots, timeline} from '../script';

/** Frames the mark takes to arrive at a position and to leave it again. */
const SETTLE = 12;

const Wordmark: React.FC<{onDark: boolean}> = ({onDark}) => (
  <div
    style={{
      fontFamily: "'Anton', sans-serif",
      fontSize: 30,
      letterSpacing: '0.02em',
      lineHeight: 1,
      whiteSpace: 'nowrap',
      color: onDark ? '#FFFFFF' : '#004643',
    }}
  >
    PLAY<span style={{color: '#5BA888'}}>FUND</span>
  </div>
);

/**
 * One wordmark for the whole film. It sits top-left by default and travels to
 * wherever a beat wants it (script.ts `logoSpots`), rather than being cut out
 * of one place and drawn in another. Beats must not draw their own.
 *
 * Colour crossfades between two stacked copies instead of interpolating a hex
 * value, so the green stays exactly the brand green at every point in the move.
 */
export const LogoLayer: React.FC = () => {
  const frame = useCurrentFrame();

  // Two keyframes per beat: arrived, and about to leave. The gap between one
  // beat's "leaving" and the next's "arrived" is the move.
  const keys: {f: number; spot: LogoSpot}[] = [];
  let at = 0;
  for (const beat of timeline) {
    const spot = logoSpots[beat.id] ?? LOGO_HOME;
    keys.push({f: at + SETTLE, spot});
    at += beat.frames;
    keys.push({f: at - SETTLE, spot});
  }

  const frames = keys.map((k) => k.f);
  const track = (get: (s: LogoSpot) => number) =>
    interpolate(frame, frames, keys.map((k) => get(k.spot)), {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });

  const x = track((s) => s.x);
  const y = track((s) => s.y);
  const scale = track((s) => s.scale);
  const onDark = track((s) => (s.onDark ? 1 : 0));

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        <div style={{position: 'relative'}}>
          <div style={{opacity: 1 - onDark}}>
            <Wordmark onDark={false} />
          </div>
          <div style={{position: 'absolute', inset: 0, opacity: onDark}}>
            <Wordmark onDark />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
