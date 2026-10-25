import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The app stylesheet is injected at runtime, so Remotion must not try to
// tree-shake or scope it.
Config.setChromiumOpenGlRenderer('angle');
