import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SplitStage} from '../components/Stage';
import {Phone} from '../components/Phone';
import {AppScreen} from '../components/AppScreen';
import {money} from '../components/Money';
import {copy, data} from '../script';

/** 0:00 — the bill a family is handed. One number, no comfort. */
export const Act1Dues: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const rise = spring({frame, fps, config: {damping: 200}, durationInFrames: 30});
  const due = spring({frame: frame - 30, fps, config: {damping: 200}, durationInFrames: 26});

  return (
    <SplitStage caption={copy.act1Dues.caption}>
      <div style={{transform: `translateY(${(1 - rise) * 26}px)`, opacity: rise}}>
        <Phone scale={1.12}>
          <AppScreen>
            <div className="eyebrow">{copy.act1Dues.eyebrow}</div>
            <div className="step-progress">
              <div className="step-progress-item done">
                <div className="step-progress-dot" />
                Add athlete
              </div>
              <div className="step-progress-sep">&rsaquo;</div>
              <div className="step-progress-item active">
                <div className="step-progress-dot" />
                Choose payment
              </div>
              <div className="step-progress-sep">&rsaquo;</div>
              <div className="step-progress-item">
                <div className="step-progress-dot" />
                Pay
              </div>
            </div>

            <div
              style={{
                fontFamily: "'Anton', sans-serif",
                fontSize: 30,
                lineHeight: 1.1,
                color: 'var(--ink)',
                margin: '6px 0 16px',
              }}
            >
              {copy.act1Dues.amountLabel}
            </div>

            <div className="due-banner">
              <div className="due-banner-top">
                <div className="due-banner-label">{copy.act1Dues.label}</div>
                <div className="due-banner-amt">
                  {money(data.club.duesPerAthlete)}
                </div>
              </div>
              <div className="breakdown-heading">WHAT THIS COVERS</div>
              <div className="breakdown-panel">
                {data.duesBreakdown.map((line) => (
                  <div className="breakdown-row" key={line.label}>
                    <div className="breakdown-row-left">
                      <div className="breakdown-row-label">{line.label}</div>
                    </div>
                    <div className="breakdown-row-amt">{money(line.amount)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--unpaid)',
                background: 'var(--unpaid-bg)',
                borderRadius: 'var(--r-md)',
                padding: '13px 14px',
                opacity: due,
                transform: `translateY(${(1 - due) * 10}px)`,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                width={16}
                height={16}
                style={{flexShrink: 0}}
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {copy.act1Dues.due}
            </div>
          </AppScreen>
        </Phone>
      </div>
    </SplitStage>
  );
};
