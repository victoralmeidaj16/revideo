import { makeProject } from '@revideo/core';
import mixedMediaScene from './mixed-media-scene';
import './global.css';

export default makeProject({
  scenes: [mixedMediaScene],
  settings: {
    shared: {
      size: { x: 1080, y: 1920 },
    },
  },
});
