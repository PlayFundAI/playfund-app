import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Stage} from '../components/Stage';
import {appCss} from '../app-css';
import {Money, money} from '../components/Money';
import {copy, data} from '../script';

/**
 * 0:06 — the club's side of the same week. Pure motion graphic, no app screen,
 * because this is the one thing the product does not have a screen for: the
 * bills that land whether or not dues have come in.
 */
export const Act1Expenses: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const total = data.expenses.reduce((n, e) => n + e.amount, 0);

  return (
    <Stage>
      <style>{appCss}</style>
      <div
        style={{
          width: 820,
          background: 'var(--white)',
          border: '1px solid var(--line)',
          borderRadius: 20,
          padding: '38px 44px 34px',
          boxShadow: '0 18px 50px rgba(0,70,67,0.10)',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.03em',
            color: 'var(--fund-green)',
            marginBottom: 6,
          }}
        >
          {copy.act1Expenses.eyebrow.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily: "'Anton', sans-serif",
            fontSize: 42,
            lineHeight: 1.1,
            color: 'var(--ink)',
            marginBottom: 26,
          }}
        >
          {copy.act1Expenses.heading}
        </div>

        {data.expenses.map((expense, i) => {
          const at = 18 + i * 16;
          const enter = spring({
            frame: frame - at,
            fps,
            config: {damping: 200},
            durationInFrames: 22,
          });
          return (
            <div
              key={expense.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '20px 0',
                borderBottom: '1px solid var(--line)',
                opacity: enter,
                transform: `translateY(${(1 - enter) * 14}px)`,
              }}
            >
              <div style={{fontSize: 24, fontWeight: 500, color: 'var(--ink)'}}>
                {expense.label}
              </div>
              <div
                style={{
                  fontFamily: "'Anton', sans-serif",
                  fontSize: 30,
                  color: 'var(--ink)',
                }}
              >
                {money(expense.amount)}
              </div>
            </div>
          );
        })}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingTop: 22,
            opacity: interpolate(frame, [76, 94], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.03em',
              color: 'var(--ink-faint)',
            }}
          >
            DUE NOW
          </div>
          <div
            style={{
              fontFamily: "'Anton', sans-serif",
              fontSize: 54,
              color: 'var(--unpaid)',
            }}
          >
            <Money to={total} start={76} duration={40} />
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 22,
          fontSize: 15,
          color: 'var(--ink-faint)',
        }}
      >
        {copy.act1Expenses.footnote}
      </div>
    </Stage>
  );
};
