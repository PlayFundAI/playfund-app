import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SplitStage} from '../components/Stage';
import {Phone} from '../components/Phone';
import {AppScreen} from '../components/AppScreen';
import {money} from '../components/Money';
import {copy, data} from '../script';

/**
 * 0:40 — the whole overview, so the three states read as one panel. The
 * "Needs another option" label is the design reference's and is deliberate:
 * a decline is a fork, not a dead end.
 */
export const Act2Buckets: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const buckets = [
    {
      label: 'Funded',
      dot: 'status-bucket-dot--green',
      amount: data.club.fundedAmount,
      count: data.club.funded,
    },
    {
      label: 'Still deciding',
      dot: 'status-bucket-dot--amber',
      amount: data.club.decidingAmount,
      count: data.club.deciding,
    },
    {
      label: 'Needs another option',
      dot: 'status-bucket-dot--red',
      amount: data.club.needsOptionAmount,
      count: data.club.needsOption,
    },
  ];

  return (
    <SplitStage caption={copy.act2Buckets.caption}>
      <Phone scale={1.12}>
        <AppScreen>
          <div style={{marginBottom: 14}}>
            <div className="eyebrow" style={{marginBottom: 2}}>
              Club
            </div>
            <div style={{fontSize: 15, fontWeight: 700, color: 'var(--ink)'}}>
              {data.club.name}
            </div>
            <div style={{fontSize: 12, color: 'var(--ink-soft)'}}>
              {data.club.location}
            </div>
          </div>

          <div className="payout-hero">
            <div className="payout-hero-eyebrow">LANDING IN YOUR ACCOUNT</div>
            <div className="payout-hero-amount">{money(data.club.payout)}</div>
            <div className="payout-hero-sub">
              <b>{data.club.funded}</b> of {data.club.athletesTotal} athletes
            </div>
          </div>

          <div className="status-buckets">
            {buckets.map((bucket, i) => {
              const enter = spring({
                frame: frame - (14 + i * 12),
                fps,
                config: {damping: 200},
                durationInFrames: 24,
              });
              return (
                <div
                  key={bucket.label}
                  className="status-bucket"
                  style={{opacity: enter, transform: `translateX(${(1 - enter) * 12}px)`}}
                >
                  <div className="status-bucket-left">
                    <div className={`status-bucket-dot ${bucket.dot}`} />
                    <div className="status-bucket-label">{bucket.label}</div>
                  </div>
                  <div className="status-bucket-right">
                    <div className="status-bucket-amount">{money(bucket.amount)}</div>
                    <div className="status-bucket-count">{bucket.count} athletes</div>
                  </div>
                </div>
              );
            })}
          </div>
        </AppScreen>
      </Phone>
    </SplitStage>
  );
};
