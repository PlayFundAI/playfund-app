import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SplitStage} from '../components/Stage';
import {appCss} from '../app-css';
import {copy, data} from '../script';

const Column: React.FC<{
  label: string;
  items: readonly string[];
  tone: 'kept' | 'moved';
  enter: number;
}> = ({label, items, tone, enter}) => {
  const moved = tone === 'moved';
  return (
    <div
      style={{
        width: 330,
        background: moved ? 'var(--ink)' : 'var(--white)',
        border: `1px solid ${moved ? 'var(--ink)' : 'var(--line)'}`,
        borderRadius: 18,
        padding: '26px 26px 22px',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 16}px)`,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: moved ? 'var(--fund-green)' : 'var(--ink-faint)',
          marginBottom: 16,
        }}
      >
        {label.toUpperCase()}
      </div>
      {items.map((item) => (
        <div
          key={item}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 0',
            fontSize: 19,
            fontWeight: 500,
            color: moved ? 'var(--white)' : 'var(--ink)',
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: moved ? 'var(--fund-green)' : 'var(--ink-faint)',
              flexShrink: 0,
            }}
          />
          {item}
        </div>
      ))}
    </div>
  );
};

/**
 * Closes Act 2 by answering the objection a club raises the moment it is
 * impressed: we already have a platform.
 *
 * It claims a division of labour and nothing more. There is no integration,
 * nothing syncs, and whether a club can even switch its existing card
 * payments off is unverified on one platform and unknown on another
 * (pilot-prep-punchlist.md section 14). Do not restate this as "works with"
 * or "connects to" without that research landing first.
 */
export const Act2Alongside: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const at = (i: number) =>
    spring({frame: frame - i * 9, fps, config: {damping: 200}, durationInFrames: 26});

  return (
    <SplitStage caption={copy.act2Alongside.caption}>
      <style>{appCss}</style>
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 20}}>
        <Column
          label={copy.act2Alongside.staysLabel}
          items={data.alongside.stays}
          tone="kept"
          enter={at(0)}
        />
        <Column
          label={copy.act2Alongside.movesLabel}
          items={data.alongside.moves}
          tone="moved"
          enter={at(1)}
        />
      </div>
    </SplitStage>
  );
};
