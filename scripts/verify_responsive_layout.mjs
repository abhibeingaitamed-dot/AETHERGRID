import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = resolve(root, 'frontend/src/styles.css');
const appPath = resolve(root, 'frontend/src/App.tsx');
const audioPath = resolve(root, 'frontend/src/audio/WebAudioSynthesizer.ts');
const headerPath = resolve(root, 'frontend/src/components/TelemetryHeader.tsx');

const [css, app, audio, header] = await Promise.all([
  readFile(cssPath, 'utf8'),
  readFile(appPath, 'utf8'),
  readFile(audioPath, 'utf8'),
  readFile(headerPath, 'utf8'),
]);

const clamp = (minimum, preferred, maximum) => Math.min(Math.max(preferred, minimum), maximum);
const assertCloseEnough = (value, minimum, message) => assert.ok(value >= minimum - 0.01, `${message}: ${value.toFixed(2)} < ${minimum}`);

assert.match(css, /grid-template-areas:\s*\n\s*"header header header"\s*\n\s*"left center right"/);
assert.match(css, /\.center-dock\s*\{/);
assert.match(css, /\.telemetry-column\s*\{/);
assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 821px\)/);
assert.match(css, /@media \(max-width: 820px\)/);
assert.match(app, /className="center-column"/);
assert.match(app, /className="center-dock"/);
assert.match(app, /className="telemetry-column"/);
assert.match(audio, /export type SoundscapeMode = 'cinematic' \| 'haptics';/);
assert.doesNotMatch(audio, /'minimalist'|'muted'/);
assert.match(header, /value="cinematic"/);
assert.match(header, /value="haptics"/);
assert.doesNotMatch(header, /value="muted"|value="minimalist"/);

const rulePattern = /([^{}]+)\{([^{}]*)\}/gs;
for (const match of css.matchAll(rulePattern)) {
  const selectors = match[1].split(',').map((selector) => selector.trim());
  const isHudPanel = selectors.some((selector) => /\.(oscilloscope-panel|chaos-suite|impact-panel|agent-terminal)$/.test(selector));
  assert.equal(isHudPanel && /position:\s*absolute/.test(match[2]), false, `HUD panel rule is absolutely positioned: ${match[1].trim()}`);
}

const requestedViewports = [
  [1920, 1080],
  [1440, 900],
  [1280, 720],
  [1377, 777],
  [1536, 864],
  [1024, 768],
  [821, 600],
  [820, 600],
];

const noIntersection = (left, right) => left.right <= right.left + 0.01
  || right.right <= left.left + 0.01
  || left.bottom <= right.top + 0.01
  || right.bottom <= left.top + 0.01;

function checkViewport(width, height) {
  if (width <= 820) {
    assert.ok(width > 0 && height > 0, `invalid stacked viewport ${width}x${height}`);
    return { mode: 'stacked', panels: 6 };
  }

  const medium = width <= 1100;
  const compactDesktop = width <= 1250;
  const padding = clamp(12, width * 0.0135, 24);
  const gap = medium ? 10 : compactDesktop ? 10 : clamp(10, width * 0.0115, 22);
  const minimumColumns = medium ? [196, 390] : compactDesktop ? [198, 360, 286] : [210, 380, 310];
  const availableWidth = width - padding * 2 - gap * (minimumColumns.length - 1);
  assertCloseEnough(availableWidth, minimumColumns.reduce((sum, value) => sum + value, 0), `grid minimum width at ${width}x${height}`);

  const headerHeight = 76;
  const footerHeight = 18;
  const rowCount = medium ? 3 : 2;
  const bodyHeight = height - padding * 2 - headerHeight - footerHeight - gap * rowCount;
  assert.ok(bodyHeight > 0, `HUD body has no usable height at ${width}x${height}`);

  if (medium) {
    const leftWidth = minimumColumns[0];
    const centerWidth = availableWidth - leftWidth - gap;
    const left = { left: padding, right: padding + leftWidth, top: padding + headerHeight + gap, bottom: padding + headerHeight + gap + bodyHeight };
    const center = { left: left.right + gap, right: padding + availableWidth, top: left.top, bottom: left.bottom };
    assert.ok(noIntersection(left, center), `left and center rails intersect at ${width}x${height}`);
    assert.ok(centerWidth >= minimumColumns[1], `center minimum width at ${width}x${height}`);

    const rightTop = center.bottom + gap;
    const right = { left: padding, right: padding + availableWidth, top: rightTop, bottom: rightTop + 210 };
    assert.ok(right.top >= center.bottom, `telemetry row overlaps center row at ${width}x${height}`);
    return { mode: 'two-column', panels: 6 };
  }

  const fractions = compactDesktop ? [0.72, 1.45, 0.94] : [0.78, 1.6, 0.98];
  const extra = availableWidth - minimumColumns.reduce((sum, value) => sum + value, 0);
  const fractionTotal = fractions.reduce((sum, value) => sum + value, 0);
  const columnWidths = minimumColumns.map((minimum, index) => minimum + extra * (fractions[index] / fractionTotal));
  const top = padding + headerHeight + gap;
  const bottom = top + bodyHeight;
  const columns = columnWidths.map((columnWidth, index) => {
    const left = padding + columnWidths.slice(0, index).reduce((sum, value) => sum + value, 0) + gap * index;
    return { left, right: left + columnWidth, top, bottom };
  });
  for (let index = 1; index < columns.length; index += 1) {
    assert.ok(noIntersection(columns[index - 1], columns[index]), `column overlap at ${width}x${height}`);
  }

  const center = columns[1];
  const dockHeight = clamp(170, height * 0.2, 214);
  const chaos = { left: center.left, right: center.left + (center.right - center.left - gap) / 2, top: center.bottom - dockHeight, bottom: center.bottom };
  const terminal = { left: chaos.right + gap, right: center.right, top: chaos.top, bottom: chaos.bottom };
  assert.ok(noIntersection(chaos, terminal), `center dock overlap at ${width}x${height}`);

  const oscilloscopeHeight = clamp(156, height * 0.19, 205);
  const impactHeight = clamp(248, height * 0.29, 310);
  const dockCardHeight = clamp(142, height * 0.17, 184);
  const right = columns[2];
  const rightItems = [
    { left: right.left, right: right.right, top: right.top, bottom: right.top + oscilloscopeHeight },
    { left: right.left, right: right.right, top: right.top + oscilloscopeHeight + gap, bottom: right.top + oscilloscopeHeight + gap + impactHeight },
  ];
  const dockTop = rightItems[1].bottom + gap;
  for (let card = 0; card < 3; card += 1) {
    rightItems.push({ left: right.left, right: right.right, top: dockTop + card * (dockCardHeight + gap), bottom: dockTop + card * (dockCardHeight + gap) + dockCardHeight });
  }
  for (let index = 1; index < rightItems.length; index += 1) {
    assert.ok(rightItems[index].top >= rightItems[index - 1].bottom, `right telemetry overlap at ${width}x${height}`);
  }
  return { mode: 'three-column', panels: 8 };
}

for (const [width, height] of requestedViewports) {
  const result = checkViewport(width, height);
  console.log(`responsive layout passed: ${width}x${height} (${result.mode}, ${result.panels} bounded regions)`);
}
