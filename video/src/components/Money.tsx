import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';

export const money = (n: number, cents = false) =>
  '$' +
  n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });

/**
 * A figure that counts up. Decelerating, so it arrives rather than stops: a
 * linear count reads as a loading spinner, which is the opposite of the point.
 */
export const Money: React.FC<{
  to: number;
  from?: number;
  start?: number;
  duration?: number;
  cents?: boolean;
}> = ({to, from = 0, start = 0, duration = 55, cents = false}) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [start, start + duration], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  // Round to the step the formatter will show, so the last few frames do not
  // flicker between two renderings of the same number.
  const step = cents ? 100 : 1;
  return <>{money(Math.round(value * step) / step, cents)}</>;
};

export const Counter: React.FC<{
  to: number;
  start?: number;
  duration?: number;
}> = ({to, start = 0, duration = 55}) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [start, start + duration], [0, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return <>{Math.round(value).toLocaleString('en-US')}</>;
};
