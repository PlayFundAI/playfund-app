import React from 'react';
import {appCss} from '../app-css';

// Overrides, applied after the app's own stylesheet so these win on order.
// The app is built to be a full-height mobile page inside a desktop wrapper;
// here it is a fixed-size panel inside a phone frame that does its own
// rounding, so the page-level and desktop-wrapper rules have to come off.
const videoOverrides = `
  html, body {
    height: 100%;
    background: transparent;
    display: block;
    overflow: hidden;
  }
  #app {
    width: 100%;
    height: 100%;
    min-height: 0;
    max-width: none;
    border-radius: 0;
    box-shadow: none;
    overflow: hidden;
  }
  /* Desktop padding (28px) is too tight at 390px wide; back to the mobile
     values the app uses below 768px. */
  .screen {
    padding: 24px 20px 40px;
    overflow: hidden;
    animation: none;
  }
  /* The app reveals its header by adding .visible on navigation. Nothing
     navigates in a video, so show it outright. */
  .header { opacity: 1; transform: none; }
`;

/**
 * The app's real markup and real stylesheet, sized to a phone viewport.
 * Children are screen-level content, equivalent to one `.screen` in the app.
 */
export const AppScreen: React.FC<{
  children: React.ReactNode;
  scrollY?: number;
}> = ({children, scrollY = 0}) => {
  return (
    <>
      <style>{appCss}</style>
      <style>{videoOverrides}</style>
      <div id="app">
        <div
          className="screen active"
          style={{transform: `translateY(${-scrollY}px)`}}
        >
          {children}
        </div>
      </div>
    </>
  );
};
