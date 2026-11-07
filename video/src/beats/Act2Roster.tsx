import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SplitStage} from '../components/Stage';
import {Phone} from '../components/Phone';
import {AppScreen} from '../components/AppScreen';
import {Counter} from '../components/Money';
import {copy, data} from '../script';

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Clock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

/** 0:20 — the ledger filling, athlete by athlete. */
export const Act2Roster: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <SplitStage caption={copy.act2Roster.caption}>
      <Phone scale={1.12}>
        <AppScreen>
          <div className="eyebrow">{copy.act2Roster.eyebrow}</div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 28,
              lineHeight: 1.1,
              color: 'var(--ink)',
              margin: '4px 0 6px',
            }}
          >
            {copy.act2Roster.heading}
          </div>
          <div style={{fontSize: 14, color: 'var(--ink-soft)', marginBottom: 18}}>
            <b style={{color: 'var(--ink)'}}>
              <Counter to={data.club.funded} start={5} duration={46} />
            </b>{' '}
            of {data.club.athletesTotal} athletes funded
          </div>

          <div className="stat-bar" style={{marginBottom: 20}}>
            <div
              className="stat-bar-fill"
              style={{
                width: `${
                  spring({frame: frame - 5, fps, config: {damping: 200}, durationInFrames: 46}) *
                  (data.club.funded / data.club.athletesTotal) *
                  100
                }%`,
                transition: 'none',
              }}
            />
          </div>

          {data.roster.map((athlete, i) => {
            const enter = spring({
              frame: frame - (6 + i * 6),
              fps,
              config: {damping: 200},
              durationInFrames: 16,
            });
            const funded = athlete.status === 'funded';
            return (
              <div
                key={athlete.name}
                className="roster-row"
                style={{
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 10}px)`,
                  ...({
                    '--status-color': funded ? 'var(--paid)' : 'var(--progress)',
                    '--status-bg': funded ? 'var(--paid-bg)' : 'var(--progress-bg)',
                  } as React.CSSProperties),
                }}
              >
                <div className="roster-icon">{funded ? <Check /> : <Clock />}</div>
                <div className="roster-name-block">
                  <div className="roster-name">{athlete.name}</div>
                  <div className="roster-age">{athlete.age}</div>
                </div>
                <div className="roster-right">
                  <span
                    className="status-pill"
                    style={{
                      background: funded ? 'var(--paid-bg)' : 'var(--progress-bg)',
                      color: funded ? 'var(--paid)' : 'var(--progress)',
                    }}
                  >
                    {funded ? 'Funded' : 'Deciding'}
                  </span>
                </div>
              </div>
            );
          })}
        </AppScreen>
      </Phone>
    </SplitStage>
  );
};
