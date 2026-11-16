<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
  strokeWidth: { type: [Number, String], default: 1.75 },
});

const ICON_MAP = {
  sun: {
    circles: [{ cx: 12, cy: 12, r: 4 }],
    paths: [
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41',
    ],
  },
  moon: {
    paths: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  },
  laptop: {
    paths: [
      'M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16',
    ],
  },
  monitor: {
    rects: [{ x: 2, y: 3, width: 20, height: 14, rx: 2 }],
    paths: ['M8 21h8', 'M12 17v4'],
  },
  smartphone: {
    rects: [{ x: 5, y: 2, width: 14, height: 20, rx: 2, ry: 2 }],
    paths: ['M12 18h.01'],
  },
  server: {
    rects: [
      { x: 2, y: 2, width: 20, height: 8, rx: 2, ry: 2 },
      { x: 2, y: 14, width: 20, height: 8, rx: 2, ry: 2 },
    ],
    paths: ['M6 6h.01', 'M6 18h.01'],
  },
  printer: {
    paths: [
      'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2',
      'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6',
    ],
    rects: [{ x: 6, y: 14, width: 12, height: 8, rx: 1 }],
  },
  package: {
    paths: [
      'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
      'M12 22V12',
      'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7',
      'm7.5 4.27 9 5.15',
    ],
  },
  'clipboard-check': {
    rects: [{ x: 8, y: 2, width: 8, height: 4, rx: 1, ry: 1 }],
    paths: [
      'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
      'm9 14 2 2 4-4',
    ],
  },
  headphones: {
    paths: [
      'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
    ],
  },
  'shield-check': {
    paths: [
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      'm9 12 2 2 4-4',
    ],
  },
  scale: {
    paths: [
      'm16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
      'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
      'M7 21h10',
      'M12 3v18',
      'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2',
    ],
  },
  'file-text': {
    paths: [
      'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
      'M14 2v4a2 2 0 0 0 2 2h4',
      'M10 9H8',
      'M16 13H8',
      'M16 17H8',
    ],
  },
  'pen-line': {
    paths: [
      'M12 20h9',
      'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z',
    ],
  },
  search: {
    circles: [{ cx: 11, cy: 11, r: 8 }],
    paths: ['m21 21-4.3-4.3'],
  },
  check: {
    paths: ['M20 6 9 17l-5-5'],
  },
  'check-circle': {
    circles: [{ cx: 12, cy: 12, r: 10 }],
    paths: ['m9 12 2 2 4-4'],
  },
  x: {
    paths: ['M18 6 6 18', 'm6 6 12 12'],
  },
  'x-circle': {
    circles: [{ cx: 12, cy: 12, r: 10 }],
    paths: ['m15 9-6 6', 'm9 9 6 6'],
  },
  'alert-triangle': {
    paths: [
      'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
      'M12 9v4',
      'M12 17h.01',
    ],
  },
  'alert-circle': {
    circles: [{ cx: 12, cy: 12, r: 10 }],
    paths: ['M12 8v4', 'M12 16h.01'],
  },
  'refresh-cw': {
    paths: [
      'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
      'M21 3v5h-5',
      'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
      'M8 16H3v5',
    ],
  },
  mail: {
    rects: [{ x: 2, y: 4, width: 20, height: 16, rx: 2 }],
    paths: ['m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  },
  lock: {
    rects: [{ x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }],
    paths: ['M7 11V7a5 5 0 0 1 10 0v4'],
  },
  eye: {
    paths: [
      'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
    ],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  'eye-off': {
    paths: [
      'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
      'M14.084 14.158a3 3 0 0 1-4.242-4.242',
      'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
      'm2 2 20 20',
    ],
  },
  'message-square': {
    paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  },
  globe: {
    circles: [{ cx: 12, cy: 12, r: 10 }],
    paths: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
  },
  settings: {
    paths: [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    ],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  repeat: {
    paths: [
      'm17 2 4 4-4 4',
      'M3 11v-1a4 4 0 0 1 4-4h14',
      'm7 22-4-4 4-4',
      'M21 13v1a4 4 0 0 1-4 4H3',
    ],
  },
  wallet: {
    paths: [
      'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
      'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
    ],
  },
  tag: {
    paths: [
      'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
    ],
    circles: [{ cx: 7.5, cy: 7.5, r: 0.75 }],
  },
  copy: {
    rects: [{ x: 8, y: 8, width: 14, height: 14, rx: 2, ry: 2 }],
    paths: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  },
  cpu: {
    rects: [
      { x: 4, y: 4, width: 16, height: 16, rx: 2 },
      { x: 9, y: 9, width: 6, height: 6, rx: 1 },
    ],
    paths: [
      'M15 2v2',
      'M15 20v2',
      'M2 15h2',
      'M2 9h2',
      'M20 15h2',
      'M20 9h2',
      'M9 2v2',
      'M9 20v2',
    ],
  },
  gauge: {
    paths: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  },
  'hard-drive': {
    paths: [
      'M22 12H2',
      'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      'M6 16h.01',
      'M10 16h.01',
    ],
  },
  'map-pin': {
    paths: [
      'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    ],
    circles: [{ cx: 12, cy: 10, r: 3 }],
  },
  'arrow-up-right': {
    paths: ['M7 7h10v10', 'M7 17 17 7'],
  },
  'chevron-right': {
    paths: ['m9 18 6-6-6-6'],
  },
  send: {
    paths: [
      'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
      'm21.854 2.147-10.94 10.939',
    ],
  },
  'log-out': {
    paths: [
      'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
      'm16 17 5-5-5-5',
      'M21 12H9',
    ],
  },
};

const icon = computed(() => ICON_MAP[props.name] || ICON_MAP.package);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <rect
      v-for="(r, idx) in icon.rects || []"
      :key="`r-${idx}`"
      v-bind="r"
    />
    <circle
      v-for="(c, idx) in icon.circles || []"
      :key="`c-${idx}`"
      v-bind="c"
    />
    <path
      v-for="(d, idx) in icon.paths || []"
      :key="`p-${idx}`"
      :d="d"
    />
  </svg>
</template>
