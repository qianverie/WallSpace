'use strict';

(() => {
  const panel = $('#motion-library');
  const video = $('#motion-preview');
  const monitor = $('#motion-monitor');
  const monitorList = $('#motion-monitor-list');
  const badge = $('#motion-active-badge');
  const list = $('#motion-items');
  let source = 'featured';
  let local = [], active = [], displays = [];
  let selected = null, busy = false, feedback = '';
  let searchRequest = 0, previewRequest = 0, closeTimer = 0;

  const isOpen = () => panel.classList.contains('is-open') && !panel.classList.contains('is-closing');

  function paintActiveBadge() {
    if (!badge) return;
    if (!active.length) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    const first = active[0];
    const suffix = active.length > 1 ? ` +${active.length - 1}` : '';
    badge.textContent = `◆ ${t('motionLibrary')} · ${first.title}${suffix}`;
    badge.hidden = false;
  }

  function paintMonitorButtons() {
    if (!monitorList) return;
    monitorList.replaceChildren(...displays.map(display => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'motion-monitor-btn' + (display.id === monitor.value ? ' is-active' : '');
      btn.setAttribute('aria-pressed', String(display.id === monitor.value));
      btn.textContent = `${pad(display.index + 1, 2)} · ${display.width}×${display.height}`;
      btn.addEventListener('click', () => {
        if (monitor.value === display.id) return;
        monitor.value = display.id;
        feedback = '';
        paintMonitorButtons();
        updateControls();
      });
      return btn;
    }));
  }

  function updateControls() {
    const connected = displays.find(display => display.id === monitor.value);
    panel.style.setProperty('--motion-ratio', connected ? connected.width / connected.height : 16 / 9);
    const current = active.find(item => item.monitorId === monitor.value);
    const playing = current && t(current.reconnecting ? 'motionReconnecting' : current.paused ? 'motionPaused' : 'motionPlaying');
    $('#motion-status').textContent = feedback || (playing ? `${playing} · ${current.title}` : '');
    $('#btn-motion-play').disabled = busy || !selected || !connected;
    $('#btn-motion-stop').disabled = busy || !current;
    paintActiveBadge();
  }

  function updateDisplays(monitors) {
    displays = monitors.filter(display => display.active && display.width > 0 && display.height > 0);
    const previous = monitor.value;
    monitor.replaceChildren(...displays.map(display => {
      const option = document.createElement('option');
      option.value = display.id;
      option.textContent = `${pad(display.index + 1, 2)} · ${display.width}×${display.height}`;
      return option;
    }));
    if (displays.some(display => display.id === previous)) monitor.value = previous;
    paintMonitorButtons();
    updateControls();
  }

  function clearPreview() {
    previewRequest++;
    selected = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    $('#motion-title').textContent = '';
    $('#motion-attribution').textContent = '';
    updateControls();
  }

  async function preview(item) {
    selected = item;
    feedback = '';
    list.querySelectorAll('.motion-item').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.id === item.id));
    });
    $('#motion-title').textContent = item.title;
    $('#motion-attribution').textContent = [item.author, item.aspect].filter(Boolean).join(' · ');
    const request = ++previewRequest;
    updateControls();
    try {
      const url = await api.previewMotion(item.id);
      if (request !== previewRequest) return;
      video.src = url;
      await video.play();
    } catch {
      if (request !== previewRequest) return;
      feedback = t('motionPreviewFailed');
      updateControls();
    }
  }

  function drawItems(items, emptyMessage) {
    list.replaceChildren();
    if (!items.length) {
      list.textContent = t(emptyMessage);
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'motion-item';
      button.dataset.id = item.id;
      button.setAttribute('aria-pressed', String(selected?.id === item.id));
      if (item.poster) {
        const image = document.createElement('img');
        image.src = item.poster;
        image.alt = '';
        image.loading = 'lazy';
        button.appendChild(image);
      }
      const title = document.createElement('span');
      title.textContent = item.title;
      button.appendChild(title);
      button.addEventListener('click', () => preview(item));
      list.appendChild(button);
    }
  }

  async function searchFeatured() {
    clearPreview();
    const request = ++searchRequest;
    list.textContent = t('motionLoading');
    try {
      const found = await api.searchMotion($('#motion-search').value, lang);
      if (request !== searchRequest) return;
      drawItems(found, 'motionEmptyFeatured');
    } catch (error) {
      if (request === searchRequest) list.textContent = `${t('failedLabel')} / ${error.message}`;
    }
  }

  function changeSource(next) {
    source = next;
    searchRequest++;
    feedback = '';
    clearPreview();
    $('#btn-motion-local').setAttribute('aria-pressed', String(next === 'local'));
    $('#btn-motion-featured').setAttribute('aria-pressed', String(next === 'featured'));
    $('#btn-motion-import').hidden = next !== 'local';
    $('#motion-search-form').hidden = next !== 'featured';
    if (next === 'local') drawItems(local, 'motionEmptyLocal');
    else searchFeatured();
  }

  async function open() {
    if (isOpen()) return;
    clearTimeout(closeTimer);
    closeTimer = 0;
    $('#search').blur();
    $('#chrome').inert = $('#grid').inert = true;
    panel.classList.remove('is-closing');
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    $('#btn-motion-close').focus();
    updateDisplays(S.monitors);
    api.readStatus(true);
    changeSource(source);
    try {
      const result = await api.motionLibrary();
      local = result.items;
      active = result.active;
      if (isOpen() && source === 'local') drawItems(local, 'motionEmptyLocal');
      updateControls();
    } catch (error) { list.textContent = error.message; }
  }

  function close() {
    if (!panel.classList.contains('is-open')) return;
    searchRequest++;
    clearPreview();
    clearTimeout(closeTimer);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
      closeTimer = 0;
      panel.classList.remove('is-open', 'is-closing');
      panel.setAttribute('aria-hidden', 'true');
      $('#chrome').inert = $('#grid').inert = false;
      $('#btn-motion').focus();
    };
    if (reduced) { finish(); return; }
    panel.classList.add('is-closing');
    closeTimer = setTimeout(finish, 340);
  }

  $('#btn-motion').addEventListener('click', open);
  badge?.addEventListener('click', open);
  $('#btn-motion-close').addEventListener('click', close);
  $('#btn-motion-local').addEventListener('click', () => changeSource('local'));
  $('#btn-motion-featured').addEventListener('click', () => changeSource('featured'));
  $('#motion-search-form').addEventListener('submit', event => { event.preventDefault(); searchFeatured(); });
  $('#btn-motion-import').addEventListener('click', async () => {
    try {
      local = await api.importMotion();
      if (source === 'local') drawItems(local, 'motionEmptyLocal');
    } catch (error) { feedback = error.message; updateControls(); }
  });
  monitor.addEventListener('change', () => { feedback = ''; updateControls(); });
  $('#btn-motion-play').addEventListener('click', async () => {
    if (!selected || !monitor.value || busy) return;
    busy = true;
    feedback = t('motionStarting');
    updateControls();
    try { active = await api.playMotion(selected.id, monitor.value); feedback = ''; }
    catch (error) { feedback = `${t('applyFailed')} / ${error.message}`; }
    finally { busy = false; updateControls(); }
  });
  $('#btn-motion-stop').addEventListener('click', async () => {
    try { active = await api.stopMotion(monitor.value); feedback = ''; }
    catch (error) { feedback = error.message; }
    updateControls();
  });
  api.on('displays:changed', status => {
    if (isOpen() && status.ok) updateDisplays(status.monitors || []);
  });
  api.on('motion:active', entries => { active = entries; updateControls(); });
  api.motionLibrary().then(result => {
    if (result?.active) { active = result.active; paintActiveBadge(); }
  }).catch(() => {});
  document.addEventListener('keydown', event => {
    if (isOpen() && event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      close();
    }
  });
})();
