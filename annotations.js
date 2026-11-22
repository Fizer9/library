(() => {
  const revisionPrefix = 'scriptures-flow:annotation:';
  const connectionKey = 'scriptures-flow:github-sync';
  const repositoryPattern = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;
  const revisionId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  const editor = $('annotation-dialog');
  const picker = $('annotation-picker');
  const notes = $('notes-dialog');
  const selectionActions = $('selection-actions');
  const settings = $('sync-dialog');
  const status = $('sync-status');
  const editorStatus = $('annotation-status');
  const inputs = {
    style: $('annotation-style'),
    title: $('annotation-heading'),
    note: $('annotation-note'),
    tags: $('annotation-tags'),
    notebooks: $('annotation-notebooks'),
  };
  const fieldNames = {
    style: 'Оформление', title: 'Заголовок', note: 'Заметка', tags: 'Теги', notebooks: 'Блокноты',
  };
  const defaultStyle = 'fill-yellow';
  // Immutable revisions let devices merge edits and deletions without relying on their clocks.
  let editing;
  let saveTimer;
  let repaintPending = false;
  let selectedFragments;
  let wholeVerse;
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
      const key = revision.entry ?? revision.place;
      const entry = annotations.get(key) ?? {
        key, id: revision.entry, place: revision.place, fields: new Map(), updated: 0,
      };
      const versions = entry.fields.get(revision.field) ?? [];
      versions.push(revision);
      entry.fields.set(revision.field, versions);
      entry.updated = Math.max(entry.updated, revision.updated ?? 0);
      annotations.set(key, entry);
    }
    for (const entry of annotations.values()) {
      entry.fragments = entry.fields.get('anchor')?.[0]?.value;
      entry.values = {};
      entry.alternatives = new Map();
      for (const field of Object.keys(inputs)) {
        const values = [...new Set((entry.fields.get(field) ?? []).map(revision => revision.value))].sort();
        const initial = field === 'style'
          ? (entry.fields.get('highlight')?.some(revision => revision.value) ? defaultStyle : 'none')
          : '';
        entry.values[field] = values.find(value => value && value !== 'none') ?? values[0] ?? initial;
        if (values.length > 1) entry.alternatives.set(field, values.filter(value => value !== entry.values[field]));
      }
    }
    return annotations;
  }

  function isVisible(entry) {
    const {title, note, style, tags, notebooks} = entry.values;
    return (!entry.id || entry.fragments) && (title || note || style !== 'none' || tags || notebooks || entry.alternatives.size);
  }

  function entriesByDate(annotations) {
    return [...annotations.values()].filter(isVisible).sort((a, b) => b.updated - a.updated || a.key.localeCompare(b.key));
  }

  function repaint() {
    let annotations;
    try { annotations = entriesByDate(currentAnnotations()); } catch {
      if (notes.open) showNotesMessage('Не удалось прочитать записи в этом браузере.');
      return;
    }
    if (notes.open) renderNotes(annotations);
    if (annotationText.selection()) {
      repaintPending = true;
      return;
    }
    repaintPending = false;
    const byVerse = new Map();
    for (const entry of annotations) {
      for (const part of entry.fragments ?? [{verse: entry.place}]) {
        const covered = byVerse.get(part.verse) ?? [];
        covered.push({entry, fragment: entry.fragments ? part : null});
        byVerse.set(part.verse, covered);
      }
    }
    for (const button of passage.querySelectorAll('[data-annotation]')) {
      const covered = byVerse.get(button.dataset.annotation) ?? [];
      button.textContent = covered.length > 1 ? String(covered.length) : covered.length ? '✎' : '+';
      button.dataset.entries = covered.map(({entry}) => entry.key).join(' ');
      button.setAttribute('aria-label', `Заметки и выделения, стих ${button.dataset.number}${covered.length ? `, записей: ${covered.length}` : ''}`);
      button.title = 'Заметки и выделения';
      annotationText.paint(button.closest('.verse').querySelector('.verse-text'), covered);
    }
  }

  function referenceLabel(entry) {
    const start = parseRoute(entry.place);
    const last = parseRoute(entry.fragments?.at(-1).verse ?? entry.place);
    const end = last.end ?? last.verse;
    return `${titleFor(start)}:${start.verse}${end > start.verse ? `–${end}` : ''}`;
  }

  function makeEntry(place, fragments) {
    const id = fragments ? crypto.randomUUID() : undefined;
    return {
      place, fragments, id, key: id ?? place, fields: new Map(), alternatives: new Map(),
      values: {note: '', title: '', style: 'none', tags: '', notebooks: ''},
    };
  }

  function quoteFor(entry) {
    return entry.fragments?.map(fragment => fragment.quote).join(' ') ?? '';
  }

  function showConflicts() {
    const versions = $('annotation-versions');
    const conflicts = $('annotation-conflicts');
    versions.replaceChildren();
    for (const [field, values] of editing.alternatives) {
      for (const value of values) {
        const item = document.createElement('li');
        const label = field === 'style' ? [...inputs.style.options].find(option => option.value === value).text : value;
        item.textContent = `${fieldNames[field]} · ${label || 'Удалено'}`;
        versions.append(item);
      }
    }
    conflicts.hidden = !editing.alternatives.size;
    conflicts.open = !conflicts.hidden;
  }

  function showEditor(entry, {mark = false, suggestMark = false} = {}) {
    editing = entry;
    $('annotation-title').textContent = referenceLabel(entry);
    const quote = $('annotation-quote');
    quote.textContent = quoteFor(entry);
    quote.hidden = !quote.textContent;
    editorStatus.hidden = true;
    for (const [field, input] of Object.entries(inputs)) input.value = editing.values[field];
    editing.suggestMark = suggestMark;
    if (mark || suggestMark) inputs.style.value = defaultStyle;
    $('annotation-delete-note').hidden = !(entry.values.title || entry.values.note);
    showConflicts();
    editor.showModal();
    (mark ? inputs.style : inputs.note).focus();
    if (mark) saveAnnotation();
  }

  function storeRevision(entry, field, value) {
    const revision = {
      id: crypto.randomUUID(), place: entry.place, field, value, updated: Date.now(),
      ...(entry.id && {entry: entry.id}),
      parents: (entry.fields.get(field) ?? []).map(parent => parent.id),
    };
    localStorage.setItem(revisionPrefix + revision.id, JSON.stringify(revision));
    entry.fields.set(field, [revision]);
  }

  function groupNames(value) {
    return [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))];
  }

  function saveAnnotation(resolve = []) {
    clearTimeout(saveTimer);
    if (!editing) return true;
    const values = Object.fromEntries(Object.entries(inputs).map(([field, input]) => [field, input.value.trim()]));
    for (const field of ['tags', 'notebooks']) values[field] = groupNames(values[field]).join(',');
    if (editing.suggestMark && !values.note && !values.title && values.style === defaultStyle) {
      values.style = editing.values.style;
    }
    let changed = false;
    let failed = false;
    try {
      for (const [field, value] of Object.entries(values)) {
        if (!resolve.includes(field) && value === editing.values[field]) continue;
        if (editing.id && !editing.fields.has('anchor')) storeRevision(editing, 'anchor', editing.fragments);
        storeRevision(editing, field, value);
        editing.values[field] = value;
        editing.alternatives.delete(field);
        changed = true;
      }
    } catch {
      failed = true;
    }
    if (changed) {
      if (values.style === defaultStyle) editing.suggestMark = false;
      showConflicts();
      $('annotation-delete-note').hidden = !(editing.values.title || editing.values.note);
      repaint();
      scheduleSync();
    }
    if (changed || failed) {
      editorStatus.textContent = failed ? 'Не удалось сохранить все изменения в этом браузере.' : 'Сохранено на устройстве';
      editorStatus.classList.toggle('error', failed);
      editorStatus.hidden = false;
    }
    return !failed;
  }

  function showNotesMessage(message) {
    $('notes-empty').textContent = message;
    $('notes-empty').hidden = !message;
  }

  function updateFilter(select, names, label) {
    const selected = select.value;
    select.replaceChildren(new Option(label, ''), ...names.map(name => new Option(name, name)));
    if (names.includes(selected)) select.value = selected;
  }

  function entryButton(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'annotation-preview';
    const title = document.createElement('strong');
    title.textContent = entry.values.title || referenceLabel(entry);
    const preview = document.createElement('span');
    preview.textContent = entry.values.note || quoteFor(entry);
    preview.hidden = !preview.textContent;
    button.append(title, preview);
    button.addEventListener('click', () => {
      if (picker.open) picker.close();
      showEditor(entry);
    });
    return button;
  }

  function renderNotes(entries) {
    const query = $('notes-search').value.trim().toLocaleLowerCase('ru');
    const tag = $('notes-tag');
    const notebook = $('notes-notebook');
    const names = field => [...new Set(entries.flatMap(entry => groupNames(entry.values[field])))].sort((a, b) => a.localeCompare(b, 'ru'));
    updateFilter(tag, names('tags'), 'Все теги');
    updateFilter(notebook, names('notebooks'), 'Все блокноты');
    const items = [];
    for (const entry of entries) {
      if (tag.value && !groupNames(entry.values.tags).includes(tag.value) ||
          notebook.value && !groupNames(entry.values.notebooks).includes(notebook.value)) continue;
      const searchable = [referenceLabel(entry), quoteFor(entry), ...Object.values(entry.values)];
      if (!searchable.some(text => text.toLocaleLowerCase('ru').includes(query))) continue;
      const item = document.createElement('li');
      const jump = link(referenceLabel(entry), entry.place, 'annotation-jump');
      jump.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        notes.close();
        const place = parseRoute(entry.place);
        open(place.verse === 1 && !place.end ? {...place, end: 1} : place);
      });
      item.append(entryButton(entry), jump);
      items.push(item);
    }
    $('notes-list').replaceChildren(...items);
    showNotesMessage(items.length ? '' : entries.length ? 'Ничего не найдено.' : 'Заметок и выделений пока нет.');
  }

  function showPicker(entries, verse) {
    wholeVerse = verse;
    $('annotation-whole-verse').hidden = !verse;
    $('annotation-choices').replaceChildren(...entries.map(entry => {
      const item = document.createElement('li');
      item.append(entryButton(entry));
      return item;
    }));
    picker.showModal();
  }

  function refreshSelection() {
    selectedFragments = annotationText.selection();
    selectionActions.hidden = !selectedFragments;
    if (!selectedFragments && repaintPending) repaint();
  }

  function useSelection(mark) {
    const fragments = selectedFragments;
    if (!fragments) return;
    getSelection().removeAllRanges();
    refreshSelection();
    const signature = JSON.stringify(fragments);
    let existing;
    try {
      existing = entriesByDate(currentAnnotations()).find(entry => entry.fragments && JSON.stringify(entry.fragments) === signature);
    } catch { /* The editor will report storage failures on save. */ }
    showEditor(existing ?? makeEntry(fragments[0].verse, fragments), {
      mark: mark && (!existing || existing.values.style === 'none'),
      suggestMark: !mark && !existing,
    });
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
      if (![1, 2].includes(version) || !Array.isArray(revisions)) throw new Error();
      const byId = new Map();
      const entries = new Map();
      for (const revision of revisions) {
        const {id, entry, place, field, value, parents, updated} = revision;
        const legacyField = field === 'note' || field === 'highlight';
        if (typeof id !== 'string' || !revisionId.test(id) || byId.has(id) ||
            typeof place !== 'string' || !parseRoute(place) ||
            (entry !== undefined && (typeof entry !== 'string' || !revisionId.test(entry))) ||
            (updated !== undefined && (!Number.isSafeInteger(updated) || updated < 0)) ||
            !Array.isArray(parents) || parents.some(parent => typeof parent !== 'string' || !revisionId.test(parent) || parent === id) ||
            (version === 1 && (entry !== undefined || !legacyField)) ||
            !validField(field, value, place, entry)) throw new Error();
        if (entry) {
          const info = entries.get(entry) ?? {place, hasAnchor: false};
          if (info.place !== place) throw new Error();
          info.hasAnchor ||= field === 'anchor';
          entries.set(entry, info);
        }
        byId.set(id, revision);
      }
      if ([...entries.values()].some(entry => !entry.hasAnchor)) throw new Error();
      for (const {parents, place, field, entry} of revisions) {
        for (const id of parents) {
          const parent = byId.get(id);
          if (parent?.place !== place || parent.field !== field || parent.entry !== entry) throw new Error();
        }
      }
      return byId;
    } catch {
      throw new Error('Файл заметок в GitHub повреждён или имеет неподдерживаемый формат.');
    }
  }

  function validField(field, value, place, entry) {
    switch (field) {
      case 'anchor': return entry !== undefined && annotationText.validFragments(value, place);
      case 'highlight': return entry === undefined && typeof value === 'boolean';
      case 'style': return typeof value === 'string' && /^(?:none|(?:fill|line)-(?:yellow|green|blue|rose))$/.test(value);
      case 'title': return typeof value === 'string' && value.length <= 180;
      case 'note': return typeof value === 'string' && value.length <= 10000;
      case 'tags':
      case 'notebooks': return typeof value === 'string' && value.length <= 400;
      default: return false;
    }
  }

  function encodeRevisions(revisions) {
    const values = [...revisions.values()];
    const version = values.some(({entry, field}) => entry || !['note', 'highlight'].includes(field)) ? 2 : 1;
    const json = JSON.stringify({version, revisions: values});
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

  passage.addEventListener('chapter-shown', () => {
    refreshSelection();
    repaint();
  });
  passage.addEventListener('click', event => {
    if (annotationText.selection() || event.target.closest('.study-note-word')) return;
    const target = event.target.closest('[data-entries]');
    if (!target) return;
    const {annotation: verse, entries: keys} = target.dataset;
    let annotations;
    try { annotations = currentAnnotations(); } catch { annotations = new Map(); }
    const entries = keys.split(' ').map(key => annotations.get(key)).filter(Boolean);
    if (!entries.length && verse) showEditor(makeEntry(verse));
    else if (entries.length === 1 && (!verse || entries[0].place === verse && !entries[0].id)) showEditor(entries[0]);
    else if (entries.length) showPicker(entries, verse);
  });
  $('annotation-picker-close').addEventListener('click', () => picker.close());
  $('annotation-whole-verse').addEventListener('click', () => {
    const existing = currentAnnotations().get(wholeVerse);
    picker.close();
    showEditor(existing ?? makeEntry(wholeVerse));
  });
  $('annotation-form').addEventListener('submit', event => {
    event.preventDefault();
    if (saveAnnotation()) editor.close();
  });
  $('annotation-form').addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAnnotation, 1000);
  });
  $('annotation-style').addEventListener('change', () => {
    editing.suggestMark = false;
    saveAnnotation();
  });
  $('annotation-resolve').addEventListener('click', () => saveAnnotation([...editing.alternatives.keys()]));
  $('annotation-delete-note').addEventListener('click', () => {
    if (!confirm('Удалить заголовок и текст этой заметки?')) return;
    inputs.title.value = inputs.note.value = '';
    if (saveAnnotation(['title', 'note'])) editor.close();
  });
  editor.addEventListener('cancel', event => {
    if (!saveAnnotation()) event.preventDefault();
  });
  editor.addEventListener('close', () => {
    clearTimeout(saveTimer);
    editing = null;
  });
  selectionActions.addEventListener('pointerdown', event => event.preventDefault());
  document.addEventListener('selectionchange', refreshSelection);
  $('selection-mark').addEventListener('click', () => useSelection(true));
  $('selection-note').addEventListener('click', () => useSelection(false));
  for (const button of document.querySelectorAll('[data-open-notes]')) {
    button.addEventListener('click', () => {
      notes.showModal();
      repaint();
    });
  }
  for (const filter of ['notes-search', 'notes-tag', 'notes-notebook']) $(filter).addEventListener('input', repaint);
  $('notes-close').addEventListener('click', () => notes.close());
  addEventListener('hashchange', refreshSelection);
  addEventListener('pagehide', () => saveAnnotation());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveAnnotation();
  });
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
