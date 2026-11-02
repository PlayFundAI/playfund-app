import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {appCss} from '../app-css';
import {copy} from '../script';

/** Where the button sits, and therefore where the cursor is heading. */
const BUTTON = {x: 960, y: 690};
const CURSOR_FROM = {x: 1580, y: 1010};
const CURSOR_START = 30;
const CURSOR_FRAMES = 44;

const Pointer: React.FC = () => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none">
    <path
      d="M5 2.5 L5 19.5 L9.4 15.6 L12.2 21.6 L15 20.3 L12.2 14.4 L18 14.1 Z"
      fill="#FFFFFF"
      stroke="#00302E"
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The close. No voiceover: the beat ends on a cursor settling onto the button,
 * which asks for the click more plainly than saying "explore a club pilot"
 * over a picture of a button that says "explore a club pilot".
 *
 * The wordmark is drawn by LogoLayer, which walks it in from the top-left
 * corner. Do not add one here.
 */
export const Act4Card: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const headline = spring({frame, fps, config: {damping: 200}, durationInFrames: 26});
  const button = spring({frame: frame - 14, fps, config: {damping: 200}, durationInFrames: 22});

  const travel = interpolate(frame, [CURSOR_START, CURSOR_START + CURSOR_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const cursorX = CURSOR_FROM.x + (BUTTON.x + 36 - CURSOR_FROM.x) * travel;
  const cursorY = CURSOR_FROM.y + (BUTTON.y + 12 - CURSOR_FROM.y) * travel;

  // The button answers the pointer only once it has actually arrived.
  const hover = interpolate(frame, [CURSOR_START + CURSOR_FRAMES - 6, CURSOR_START + CURSOR_FRAMES + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: '#004643', fontFamily: "'Inter', sans-serif"}}>
      <style>{appCss}</style>

      <div
        style={{
          position: 'absolute',
          top: 400,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: "'Anton', sans-serif",
          fontSize: 74,
          lineHeight: 1.12,
          color: 'var(--white)',
          whiteSpace: 'pre-line',
          opacity: headline,
          transform: `translateY(${(1 - headline) * 16}px)`,
        }}
      >
        {copy.act4Card.headline}
      </div>

      <div
        style={{
          position: 'absolute',
          top: BUTTON.y,
          left: BUTTON.x,
          transform: `translate(-50%, -50%) scale(${1 + hover * 0.025})`,
          opacity: button,
        }}
      >
        <div
          style={{
            // Matches .btn-light / :hover on the marketing site.
            background: hover > 0.5 ? 'var(--fund-green-dk)' : 'var(--fund-green)',
            color: 'var(--white)',
            fontSize: 22,
            fontWeight: 700,
            padding: '18px 42px',
            borderRadius: 12,
            whiteSpace: 'nowrap',
            boxShadow: `0 ${8 + hover * 8}px ${22 + hover * 14}px rgba(0,0,0,${0.12 + hover * 0.1})`,
          }}
        >
          {copy.act4Card.cta}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 780,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 20,
          color: 'rgba(255,255,255,0.68)',
          opacity: button,
        }}
      >
        {copy.act4Card.url}
      </div>

      <div style={{position: 'absolute', left: cursorX, top: cursorY}}>
        <Pointer />
      </div>
    </AbsoluteFill>
  );
};
