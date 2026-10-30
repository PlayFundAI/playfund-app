import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SplitStage} from '../components/Stage';
import {Phone} from '../components/Phone';
import {AppScreen} from '../components/AppScreen';
import {money} from '../components/Money';
import {copy, data} from '../script';

const CardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
);

const CalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

/**
 * 0:48 — the choice itself. This is screen-athlete-detail with the provider
 * genericized to "our payment partner", which is how the marketing site refers
 * to it. The product screen names the provider; a public video does not.
 */
export const Act3Dues: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const options = [
    {
      icon: <CardIcon />,
      title: 'Pay in full',
      subtitle: 'Full season dues charged today',
    },
    {
      icon: <CalIcon />,
      title: 'Pay over time',
      subtitle: 'Split dues through our payment partner',
    },
  ];

  return (
    <SplitStage caption={copy.act3Dues.caption}>
      <Phone scale={1.12}>
        <AppScreen>
          <div className="eyebrow">Parent</div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 28,
              color: 'var(--ink)',
              margin: '4px 0 14px',
            }}
          >
            Season dues
          </div>

          <div className="due-banner">
            <div className="due-banner-top">
              <div className="due-banner-label">
                {data.club.name.toUpperCase()}
              </div>
              <div className="due-banner-amt">{money(data.club.duesPerAthlete)}</div>
            </div>
          </div>

          {options.map((option, i) => {
            const enter = spring({
              frame: frame - (8 + i * 10),
              fps,
              config: {damping: 200},
              durationInFrames: 18,
            });
            const highlighted = i === 1;
            return (
              <div
                key={option.title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  border: `1.5px solid ${
                    highlighted ? 'var(--fund-green)' : 'var(--line)'
                  }`,
                  background: highlighted ? 'var(--paper-dim)' : 'var(--white)',
                  borderRadius: 'var(--r-lg)',
                  padding: '16px 16px',
                  marginBottom: 12,
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 14}px)`,
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 'var(--r-md)',
                    background: highlighted ? 'var(--fund-green)' : 'var(--paper-dim)',
                    color: highlighted ? 'var(--white)' : 'var(--ink-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <div style={{width: 18, height: 18}}>{option.icon}</div>
                </div>
                <div>
                  <div style={{fontSize: 15, fontWeight: 700, color: 'var(--ink)'}}>
                    {option.title}
                  </div>
                  <div style={{fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2}}>
                    {option.subtitle}
                  </div>
                </div>
              </div>
            );
          })}
        </AppScreen>
      </Phone>
    </SplitStage>
  );
};
