'use strict';

const motionVideo = document.querySelector('video');

async function startWallpaperVideo(url) {
  motionVideo.muted = true;
  motionVideo.src = url;
  let timeout;
  try {
    await Promise.race([
      motionVideo.play(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Video could not be decoded')), 15000); })
    ]);
    if (!motionVideo.videoWidth) throw new Error('The file contains no video');
  } finally { clearTimeout(timeout); }
}

function setWallpaperPaused(paused) {
  if (paused) motionVideo.pause();
  else return motionVideo.play();
}
