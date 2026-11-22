(() => {
  const revisionPrefix = 'scriptures-flow:annotation:';
  const connectionKey = 'scriptures-flow:github-sync';
  const repositoryPattern = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;
  const revisionId = /^[0-9a-f-]{36}$/;
  const editor = $('annotation-dialog');
  const noteInput = $('annotation-note');
  const highlightInput = $('annotation-highlight');
  const settings = $('sync-dialog');
  const status = $('sync-status');
  // Immutable revisions let devices merge edits and deletions without relying on their clocks.
  let editing;
  let connection;
  let activeSync;
  let syncTimer;
  let syncAgain = false;

  function loadConnection() {
    try {
      const saved = JSON.parse(localStorage.getItem(connectionKey));
      return repositoryPattern.test(saved?.repo ?? '') && typeof saved.token === 'string' ? saved : null;
    } catch {
      return null;
    }
  }

  function localRevisions() {
    const revisions = new Map();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(revisionPrefix)) continue;
      const revision = JSON.parse(localStorage.getItem(key));
      if (revision) revisions.set(revision.id, revision);
    }
    return revisions;
  }

  function currentAnnotations() {
    const revisions = localRevisions();
    const superseded = new Set();
    for (const {parents} of revisions.values()) {
      for (const id of parents) superseded.add(id);
    }
    const annotations = new Map();
    for (const revision of revisions.values()) {
      if (superseded.has(revision.id)) continue;
      const fields = annotations.get(revision.place) ?? {note: [], highlight: []};
      fields[revision.field].push(revision);
      annotations.set(revision.place, fields);
    }
    return annotations;
  }

  function repaint() {
    let annotations;
    try { annotations = currentAnnotations(); } catch { return; }
    for (const button of passage.querySelectorAll('[data-annotation]')) {
      const fields = annotations.get(button.dataset.annotation);
      const hasNote = fields?.note.some(revision => revision.value);
      const highlighted = fields?.highlight.some(revision => revision.value);
      button.closest('.verse').classList.toggle('personal-highlight', Boolean(highlighted));
      button.textContent = hasNote ? '✎' : '+';
      const state = [hasNote && 'есть заметка', highlighted && 'выделено'].filter(Boolean).join(', ');
      button.setAttribute('aria-label', `Личная заметка и выделение, стих ${button.dataset.number}${state ? `, ${state}` : ''}`);
      button.title = 'Личная заметка и выделение';
    }
  }

  function showEditor(button) {
    const {annotation: place, number} = button.dataset;
    $('annotation-title').textContent = `${titleFor(parseRoute(place))}:${number}`;
    const submit = $('annotation-form').querySelector('[type="submit"]');
    let fields;
    try {
      fields = currentAnnotations().get(place) ?? {note: [], highlight: []};
      $('annotation-error').hidden = true;
      submit.disabled = false;
    } catch {
      noteInput.value = '';
      highlightInput.checked = false;
      $('annotation-conflicts').hidden = true;
      submit.disabled = true;
      $('annotation-error').textContent = 'Не удалось прочитать записи в этом браузере.';
      $('annotation-error').hidden = false;
      editor.showModal();
      return;
    }
    const notes = [...new Set(fields.note.map(revision => revision.value))].sort();
    const highlights = new Set(fields.highlight.map(revision => revision.value));
    const versions = $('annotation-versions');
    const conflicts = $('annotation-conflicts');
    versions.replaceChildren(...notes.slice(1).map(value => {
      const item = document.createElement('li');
      item.textContent = value || 'Заметка удалена на другом устройстве.';
      return item;
    }));
    conflicts.hidden = notes.length < 2;
    conflicts.open = !conflicts.hidden;
    $('annotation-resolve').checked = false;
    noteInput.value = notes[0] ?? '';
    highlightInput.checked = highlights.has(true);
    editing = {place, fields, note: noteInput.value, highlight: highlightInput.checked};
    editor.showModal();
  }

  function saveAnnotation(event) {
    event.preventDefault();
    const values = {note: noteInput.value.trim(), highlight: highlightInput.checked};
    let changed = false;
    try {
      for (const field of ['note', 'highlight']) {
        const resolveNote = field === 'note' && $('annotation-resolve').checked;
        if (!resolveNote && values[field] === editing[field]) continue;
        const revision = {
          id: crypto.randomUUID(),
          place: editing.place,
          field,
          value: values[field],
          parents: editing.fields[field].map(revision => revision.id),
        };
        localStorage.setItem(revisionPrefix + revision.id, JSON.stringify(revision));
        editing[field] = values[field];
        editing.fields[field] = [revision];
        if (field === 'note') $('annotation-resolve').checked = false;
        changed = true;
      }
      editor.close();
    } catch {
      $('annotation-error').textContent = 'Не удалось сохранить все изменения в этом браузере.';
      $('annotation-error').hidden = false;
    }
    if (changed) {
      repaint();
      scheduleSync();
    }
  }

  function renderSettings() {
    $('sync-form').hidden = Boolean(connection);
    for (const id of ['sync-repository', 'sync-disconnect', 'sync-now']) $(id).hidden = !connection;
    $('sync-repository').textContent = connection?.repo ?? '';
    $('sync-now').disabled = Boolean(activeSync);
  }

  function githubRequest(config, path, options = {}) {
    return fetch(`https://api.github.com/repos/${config.repo}${path}`, {
      ...options,
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        ...(options.body && {'Content-Type': 'application/json'}),
      },
    });
  }

  function requireSuccess(response) {
    if (response.ok) return;
    if (response.status === 401) throw new Error('Токен GitHub недействителен или истёк. Подключи репозиторий заново.');
    if (response.status === 403 || response.status === 404) {
      throw new Error('GitHub ограничил доступ. Проверь репозиторий, токен и права Contents.');
    }
    if (response.status === 429) throw new Error('GitHub временно ограничил число запросов.');
    throw new Error(`Запрос к GitHub завершился с ошибкой (${response.status}).`);
  }

  async function verifyPrivateRepository(config, signal) {
    const response = await githubRequest(config, '', {signal});
    requireSuccess(response);
    const repository = await response.json();
    if (repository.private !== true || repository.visibility !== 'private') {
      throw new Error('Для синхронизации выбери приватный репозиторий.');
    }
  }

  function decodeRevisions(file) {
    try {
      if (file.encoding !== 'base64') throw new Error();
      const bytes = Uint8Array.from(atob(file.content), char => char.charCodeAt(0));
      const {version, revisions} = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      if (version !== 1 || !Array.isArray(revisions)) throw new Error();
      const byId = new Map();
      for (const revision of revisions) {
        const {id, place, field, value, parents} = revision;
        if (!revisionId.test(id) || byId.has(id) || typeof place !== 'string' || !parseRoute(place) ||
            !Array.isArray(parents) || parents.some(parent => !revisionId.test(parent) || parent === id) ||
            !(field === 'note' && typeof value === 'string' && value.length <= 10000 ||
              field === 'highlight' && typeof value === 'boolean')) throw new Error();
        byId.set(id, revision);
      }
      for (const {parents, place, field} of revisions) {
        for (const id of parents) {
          const parent = byId.get(id);
          if (parent?.place !== place || parent.field !== field) throw new Error();
        }
      }
      return byId;
    } catch {
      throw new Error('Файл заметок в GitHub повреждён или имеет неподдерживаемый формат.');
    }
  }

  function encodeRevisions(revisions) {
    const json = JSON.stringify({version: 1, revisions: [...revisions.values()]});
    const bytes = new TextEncoder().encode(json);
    if (bytes.length > 1_000_000) throw new Error('Файл заметок достиг предела синхронизации (1 МБ).');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function reconcile(config, signal) {
    const path = '/contents/reader-annotations.json';
    for (let attempt = 0; attempt < 3; attempt++) {
      await verifyPrivateRepository(config, signal);
      const response = await githubRequest(config, path, {signal});
      if (response.status !== 404) requireSuccess(response);
      const file = response.status === 404 ? null : await response.json();
      const remote = file ? decodeRevisions(file) : new Map();
      signal.throwIfAborted();
      const local = localRevisions();
      for (const [id, revision] of remote) {
        if (!local.has(id)) localStorage.setItem(revisionPrefix + id, JSON.stringify(revision));
      }
      if ([...local.keys()].every(id => remote.has(id))) return;
      for (const [id, revision] of local) remote.set(id, revision);
      const result = await githubRequest(config, path, {
        method: 'PUT',
        signal,
        body: JSON.stringify({
          message: 'Sync reader annotations',
          content: encodeRevisions(remote),
          ...(file && {sha: file.sha}),
        }),
      });
      if (result.status === 409 || result.status === 422 && !file) continue;
      requireSuccess(result);
      return;
    }
    throw new Error('Другое устройство обновляет записи. Читалка попробует синхронизировать их снова.');
  }

  async function synchronize() {
    if (!connection) return;
    if (!navigator.onLine) {
      status.textContent = 'Нет интернета. Записи хранятся в этом браузере.';
      return;
    }
    if (activeSync) {
      syncAgain = true;
      return;
    }
    const running = new AbortController();
    activeSync = running;
    status.textContent = 'Синхронизация…';
    renderSettings();
    try {
      await reconcile(connection, AbortSignal.any([running.signal, AbortSignal.timeout(30000)]));
      if (activeSync === running) status.textContent = `Синхронизировано в ${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}.`;
    } catch (error) {
      if (activeSync === running) {
        status.textContent = error instanceof TypeError || error.name === 'TimeoutError'
          ? 'Не удалось связаться с GitHub. Читалка попробует снова.'
          : error.message;
      }
    } finally {
      repaint();
      if (activeSync === running) {
        activeSync = null;
        renderSettings();
        if (syncAgain) scheduleSync();
        syncAgain = false;
      }
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    if (connection) syncTimer = setTimeout(synchronize, 800);
  }

  $('sync-form').addEventListener('submit', async event => {
    event.preventDefault();
    const config = {repo: $('sync-repo').value.trim().toLowerCase(), token: $('sync-token').value.trim()};
    if (!repositoryPattern.test(config.repo) || !config.token) {
      status.textContent = 'Укажи репозиторий в формате владелец/название и введи токен.';
      return;
    }
    const connect = $('sync-connect');
    connect.disabled = true;
    status.textContent = 'Проверка репозитория…';
    try {
      await verifyPrivateRepository(config, AbortSignal.timeout(15000));
      localStorage.setItem(connectionKey, JSON.stringify(config));
      $('sync-token').value = '';
      connection = config;
      void synchronize();
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? 'Не удалось связаться с GitHub. Проверь подключение к интернету.'
        : error.message;
    } finally {
      connect.disabled = false;
      renderSettings();
    }
  });

  $('sync-disconnect').addEventListener('click', () => {
    localStorage.removeItem(connectionKey);
    updateConnection(null);
  });

  function updateConnection(config) {
    activeSync?.abort();
    activeSync = null;
    syncAgain = false;
    connection = config;
    status.textContent = connection ? '' : 'GitHub отключён. Записи сохранены в этом браузере.';
    renderSettings();
    scheduleSync();
  }

  passage.addEventListener('chapter-shown', repaint);
  passage.addEventListener('click', event => {
    const button = event.target.closest('[data-annotation]');
    if (button) showEditor(button);
  });
  $('annotation-form').addEventListener('submit', saveAnnotation);
  $('annotation-cancel').addEventListener('click', () => editor.close());
  $('sync-settings').addEventListener('click', () => {
    renderSettings();
    settings.showModal();
  });
  $('sync-close').addEventListener('click', () => settings.close());
  $('sync-now').addEventListener('click', () => void synchronize());
  addEventListener('online', scheduleSync);
  addEventListener('offline', () => {
    if (connection) status.textContent = 'Нет интернета. Записи хранятся в этом браузере.';
  });
  addEventListener('storage', event => {
    if (event.key === connectionKey || event.key === null) updateConnection(loadConnection());
    if (event.key?.startsWith(revisionPrefix) || event.key === null) repaint();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSync();
  });
  setInterval(() => {
    if (!document.hidden && navigator.onLine) scheduleSync();
  }, 60000);
  connection = loadConnection();
  repaint();
  scheduleSync();
})();
