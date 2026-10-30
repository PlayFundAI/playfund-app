import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {SplitStage} from '../components/Stage';
import {appCss} from '../app-css';
import {copy, data} from '../script';

const Panel: React.FC<{
  label: string;
  items: readonly string[];
  ours?: boolean;
  enter: number;
  slide: number;
}> = ({label, items, ours = false, enter, slide}) => (
  <div
    style={{
      width: 300,
      background: ours ? 'var(--ink)' : 'var(--white)',
      border: `1px solid ${ours ? 'var(--ink)' : 'var(--line)'}`,
      borderRadius: 18,
      padding: '24px 24px 20px',
      opacity: enter,
      transform: `translateX(${slide}px)`,
    }}
  >
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.04em',
        color: ours ? 'var(--fund-green)' : 'var(--ink-faint)',
        marginBottom: 14,
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
          padding: '8px 0',
          fontSize: 18,
          fontWeight: 500,
          color: ours ? 'var(--white)' : 'var(--ink)',
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: ours ? 'var(--fund-green)' : 'var(--ink-faint)',
            flexShrink: 0,
          }}
        />
        {item}
      </div>
    ))}
  </div>
);

/**
 * Closes the club act by answering the objection a club raises the moment it
 * is impressed: we already have a platform.
 *
 * The two panels pull APART rather than together, and the dashed rule between
 * them is the point of the beat: these are two systems running side by side,
 * not one plugged into the other. Nothing syncs, and whether a club can even
 * switch its existing card payments off is unverified on one platform and
 * unknown on another (pilot-prep-punchlist.md section 14). Do not redraw this
 * with an arrow, a bridge or a merge.
 */
export const Act2Alongside: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const enter = spring({frame, fps, config: {damping: 200}, durationInFrames: 24});
  // They begin overlapping and separate, which reads as "these stay apart".
  const apart = spring({
    frame: frame - 14,
    fps,
    config: {damping: 200},
    durationInFrames: 30,
  });
  const gap = 10 + apart * 34;

  return (
    <SplitStage caption={copy.act2Alongside.caption}>
      <style>{appCss}</style>
      <div style={{display: 'flex', alignItems: 'stretch', gap: 0}}>
        <Panel
          label={copy.act2Alongside.theirsLabel}
          items={data.alongside.theirs}
          enter={enter}
          slide={-gap}
        />
        <div
          style={{
            width: 2,
            alignSelf: 'stretch',
            margin: '8px 0',
            borderLeft: '2px dashed var(--line)',
            opacity: apart,
          }}
        />
        <Panel
          label={copy.act2Alongside.oursLabel}
          items={data.alongside.ours}
          ours
          enter={enter}
          slide={gap}
        />
      </div>
    </SplitStage>
  );
};
