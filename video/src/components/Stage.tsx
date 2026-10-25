import React from 'react';
import {AbsoluteFill} from 'remotion';
import './fonts';

/** The 1920x1080 ground every beat sits on. */
export const Stage: React.FC<{
  children: React.ReactNode;
  background?: string;
}> = ({children, background = '#F4F7F6'}) => {
  return (
    <AbsoluteFill
      style={{
        background,
        fontFamily: "'Inter', sans-serif",
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/**
 * Headline left, phone right. A portrait app screen leaves a 1920x1080 frame
 * two-thirds empty on its own, and the video has to carry its argument with
 * the sound off, which the voiceover cannot do. Deleting the `caption` prop
 * falls back to a centred phone.
 */
export const SplitStage: React.FC<{
  caption?: string;
  children: React.ReactNode;
  captionOffset?: number;
}> = ({caption, children, captionOffset = 0}) => {
  return (
    <Stage>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 96,
        }}
      >
        {caption ? (
          <div
            style={{
              width: 660,
              fontFamily: "'Anton', sans-serif",
              fontSize: 72,
              lineHeight: 1.14,
              color: '#004643',
              whiteSpace: 'pre-line',
              transform: `translateY(${captionOffset}px)`,
            }}
          >
            {caption}
          </div>
        ) : null}
        {children}
      </div>
    </Stage>
  );
};
