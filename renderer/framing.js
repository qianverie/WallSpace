(function () {
'use strict';

const DEFAULT_FRAMING = Object.freeze({ zoom: 1, x: 0, y: 0 });
const FRAME_WIDTH = 1600;
const FRAME_HEIGHT = 900;

function imagePlacement(image, desktop, style, framing, viewport = desktop) {
  const scaleX = desktop.width / image.width;
  const scaleY = desktop.height / image.height;
  let scale = 1;
  if (style === 'fill' || style === 'span') scale = Math.max(scaleX, scaleY);
  if (style === 'fit') scale = Math.min(scaleX, scaleY);
  const width = style === 'stretch' ? desktop.width : image.width * scale;
  const height = style === 'stretch' ? desktop.height : image.height * scale;
  const tile = style === 'tile';
  const x = desktop.x + (tile ? 0 : (desktop.width - width) / 2);
  const y = desktop.y + (tile ? 0 : (desktop.height - height) / 2);
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  return {
    x: centerX + (x - centerX) * framing.zoom + framing.x * viewport.width,
    y: centerY + (y - centerY) * framing.zoom + framing.y * viewport.height,
    width: width * framing.zoom, height: height * framing.zoom, tile
  };
}

function monitorBounds(monitors) {
  const x = Math.min(...monitors.map(m => m.x));
  const y = Math.min(...monitors.map(m => m.y));
  return {
    x, y,
    width: Math.max(...monitors.map(m => m.x + m.width)) - x,
    height: Math.max(...monitors.map(m => m.y + m.height)) - y
  };
}

function framingViewport(bounds, width = FRAME_WIDTH, height = FRAME_HEIGHT) {
  const scale = Math.min(width / bounds.width, height / bounds.height);
  const viewportWidth = width / scale;
  const viewportHeight = height / scale;
  return {
    scale,
    x: bounds.x - (viewportWidth - bounds.width) / 2,
    y: bounds.y - (viewportHeight - bounds.height) / 2,
    width: viewportWidth, height: viewportHeight
  };
}

const framingGeometry = { DEFAULT_FRAMING, FRAME_WIDTH, FRAME_HEIGHT, imagePlacement, monitorBounds, framingViewport };
if (typeof module !== 'undefined') module.exports = framingGeometry;
else window.framingGeometry = framingGeometry;
})();
