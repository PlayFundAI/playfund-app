import React from 'react';

export const PHONE_W = 390;
export const PHONE_H = 844;

/**
 * Device frame. The app's own desktop wrapper already draws a rounded card
 * with a shadow, but it is tuned for a browser window rather than a 1080p
 * frame, so the frame is drawn here and switched off in AppScreen.
 */
export const Phone: React.FC<{
  children: React.ReactNode;
  scale?: number;
}> = ({children, scale = 1}) => {
  return (
    <div
      style={{
        width: PHONE_W,
        height: PHONE_H,
        transform: `scale(${scale})`,
        borderRadius: 54,
        padding: 11,
        background: '#00302E',
        boxShadow:
          '0 2px 6px rgba(0,70,67,0.10), 0 24px 60px rgba(0,70,67,0.18), 0 60px 140px rgba(0,70,67,0.16)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 43,
          overflow: 'hidden',
          background: '#FFFFFF',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
};
