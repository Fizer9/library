const $ = id => document.getElementById(id);
const library = $('library-view');
const settings = $('settings-view');
const contents = $('contents-view');
const reader = $('reader-view');
const passage = $('passage');
const tocSidebar = $('toc-sidebar');
const tocPanel = $('toc-panel');
const tocDialog = $('toc-dialog');
const tocToggle = $('toc-toggle');
const tocContent = $('toc-content');
const tocNarrow = matchMedia('(max-width: 800px)');
const studyNarrow = matchMedia('(max-width: 960px)');
const studySidebar = $('study-sidebar');
const studyDialog = $('study-dialog');
const studyNote = $('study-note');
const studyBody = $('study-note-body');
const studyClose = $('study-close');
const tocChapters = new Map();
const tocEditions = new Map();
const localEditions = new Map();
const fontToggle = $('font-toggle');
const largeTextSetting = $('large-text-setting');
const jumpForm = $('jump-form');
const bookFile = $('book-file');
const openBookFile = $('open-book-file');
const bookFileStatus = $('book-file-status');
const hosted = location.protocol === 'https:' || location.protocol === 'http:';
let currentPlace = null;
let rendering = 0;
let scrollTimer;
let restoredScrollY = null;
let desktopTocOpen;
let currentTocChapter;
let activeStudyButton;

function chapterCount(edition, book) {
  return edition === 'bible' ? Object.keys(bibleData[book.id] ?? {}).length : book.count;
}

function parseRoute(hash) {
  const match = hash.match(/^#(bible|bofm|dc|pgp)\/([\w-]+)\/(\d+)\/(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const [, edition, bookId, chapter, verse, end] = match;
  const book = editions[edition].books.find(item => item.id === bookId);
  if (!book || +chapter < 1 || +chapter > chapterCount(edition, book) || +verse < 1 || (end && +end < +verse)) return null;
  return {edition, book: bookId, chapter: +chapter, verse: +verse, ...(end && {end: +end})};
}

function route(place) {
  return `#${place.edition}/${place.book}/${place.chapter}/${place.verse}${place.end ? `-${place.end}` : ''}`;
}

function titleFor(place) {
  const book = editions[place.edition].books.find(item => item.id === place.book);
  return `${book.name} ${place.chapter}`;
}

function open(place) {
  const hash = route(place);
  if (location.hash === hash) void render();
  else location.hash = hash;
}

function link(text, href, className = '') {
  const element = document.createElement('a');
  element.href = href;
  element.textContent = text;
  element.className = className;
  if (href.startsWith('https://') && !href.startsWith(church)) {
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
  }
  return element;
}

function renderLibrary() {
  const isAvailable = id => id === 'bible' || localEditions.has(id);
  $('book-file-panel').hidden = !hosted || Object.keys(editions).every(isAvailable);
  const last = parseRoute(readPreference('last') ?? '');
  const resume = $('continue-link');
  resume.hidden = !last;
  if (last) {
    resume.href = route(last);
    const verse = last.end ? `${last.verse}–${last.end}` : last.verse;
    $('continue-title').textContent = `${titleFor(last)}:${verse}`;
  }
  $('edition-grid').replaceChildren(...Object.entries(editions).map(([id, edition]) => {
    const card = document.createElement('article');
    card.className = 'edition-card';
    card.dataset.edition = id;
    const available = isAvailable(id);
    const cover = link('', `#contents/${id}`, 'edition-cover');
    const title = document.createElement('h3');
    title.textContent = edition.name;
    cover.append(title);
    if (edition.subtitle) cover.append(displayText(`${edition.subtitle} · ${edition.books.length} книг`, 'edition-meta'));
    else if (!available) cover.append(displayText('Требуется EPUB', 'edition-meta'));
    const action = document.createElement('span');
    action.className = 'edition-action';
    action.textContent = available ? 'Читать' : 'Оглавление';
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    action.append(arrow);
    cover.append(action);
    card.append(cover);
    return card;
  }));
}

function tocList(items) {
  const list = document.createElement('ul');
  for (const item of items) {
    const row = document.createElement('li');
    row.append(item);
    list.append(row);
  }
  return list;
}

function tocBranch(title, items) {
  const branch = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = title;
  branch.append(summary, tocList(items));
  return branch;
}

function tocBook(editionId, book) {
  const count = chapterCount(editionId, book);
  const heading = {dc: 'Разделы', od: 'Официальные заявления', fac: 'Факсимиле'}[book.id] ?? book.name;
  const chapters = Array.from({length: count}, (_, index) => {
    const chapter = index + 1;
    const destination = route({edition: editionId, book: book.id, chapter, verse: 1});
    const chapterLink = link(count === 1 ? book.name : String(chapter), destination);
    tocChapters.set(destination, chapterLink);
    return chapterLink;
  });
  if (count === 1) return chapters[0];
  const branch = tocBranch(heading, chapters);
  branch.className = 'chapter-list';
  return branch;
}

function buildToc() {
  const collections = Object.entries(editions).map(([id, edition]) => {
    const items = id === 'bible'
      ? ['Ветхий Завет', 'Новый Завет'].map(group => tocBranch(group, edition.books.filter(book => book.group === group).map(book => tocBook(id, book))))
      : edition.books.map(book => tocBook(id, book));
    const collection = tocBranch(edition.name, items);
    tocEditions.set(id, collection);
    return collection;
  });
  tocContent.append(tocList(collections));
}

function renderContents(edition) {
  const heading = $('contents-title');
  heading.textContent = editions[edition].name;
  const navigation = $('edition-contents');
  if (navigation.dataset.edition !== edition) {
    const list = tocEditions.get(edition).lastElementChild.cloneNode(true);
    for (const branch of list.querySelectorAll('details[open]')) branch.open = false;
    for (const chapter of list.querySelectorAll('[aria-current]')) chapter.removeAttribute('aria-current');
    const firstBook = list.querySelector('.chapter-list');
    for (let branch = firstBook; branch; branch = branch.parentElement.closest('details')) branch.open = true;
    navigation.replaceChildren(list);
    navigation.dataset.edition = edition;
  }
  window.scrollTo(0, 0);
  heading.focus({preventScroll: true});
}

function revealTocChapter() {
  if (!currentTocChapter?.getClientRects().length || !tocContent.clientHeight) return;
  const scrollArea = tocContent.getBoundingClientRect();
  const chapter = currentTocChapter.getBoundingClientRect();
  if (chapter.top < scrollArea.top || chapter.bottom > scrollArea.bottom) {
    tocContent.scrollTop += chapter.top - scrollArea.top - (scrollArea.height - chapter.height) / 2;
  }
}

function markTocChapter(place) {
  currentTocChapter?.removeAttribute('aria-current');
  currentTocChapter = place ? tocChapters.get(route({...place, verse: 1, end: undefined})) : undefined;
  currentTocChapter?.setAttribute('aria-current', 'page');
  for (let branch = currentTocChapter?.closest('details'); branch; branch = branch.parentElement.closest('details')) branch.open = true;
}

function syncToc() {
  if (!settings.hidden && tocDialog.open) tocDialog.close();
  if (tocNarrow.matches) {
    tocSidebar.hidden = true;
    if (tocPanel.parentElement !== tocDialog) tocDialog.append(tocPanel);
    tocToggle.setAttribute('aria-haspopup', 'dialog');
    tocToggle.setAttribute('aria-expanded', String(tocDialog.open));
  } else {
    if (tocDialog.open) tocDialog.close();
    if (tocPanel.parentElement !== tocSidebar) tocSidebar.append(tocPanel);
    tocSidebar.hidden = !settings.hidden || !(desktopTocOpen ?? Boolean(currentPlace));
    tocToggle.removeAttribute('aria-haspopup');
    tocToggle.setAttribute('aria-expanded', String(!tocSidebar.hidden));
  }
  revealTocChapter();
}

function closeToc() {
  if (tocDialog.open) tocDialog.close();
  else desktopTocOpen = false;
  syncToc();
  tocToggle.focus({preventScroll: true});
}

function adjacent(place, step) {
  const books = editions[place.edition].books;
  const index = books.findIndex(book => book.id === place.book);
  const chapter = place.chapter + step;
  if (chapter >= 1 && chapter <= chapterCount(place.edition, books[index])) return {...place, chapter, verse: 1, end: undefined};
  const book = books[index + step];
  if (!book) return null;
  return {...place, book: book.id, chapter: step > 0 ? 1 : chapterCount(place.edition, book), verse: 1, end: undefined};
}

function renderNavigation(place) {
  for (const [id, step] of [['previous', -1], ['next', 1]]) {
    const target = adjacent(place, step);
    const button = $(id);
    button.hidden = !target;
    if (target) {
      button.href = route(target);
      button.setAttribute('aria-label', `${button.textContent} · ${titleFor(target)}`);
    }
  }
}

function enableChapterSwipe() {
  let swipe;

  addEventListener('touchstart', event => {
    swipe = null;
    if (event.touches.length !== 1 || !currentPlace || !reader.contains(event.target) ||
        !window.getSelection()?.isCollapsed) return;
    const {identifier, clientX, clientY} = event.touches[0];
    swipe = {identifier, x: clientX, y: clientY, version: rendering};
  }, {capture: true, passive: true});
  reader.addEventListener('touchmove', event => {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || swipe?.identifier !== touch.identifier) return;
    if (!window.getSelection()?.isCollapsed) { swipe = null; return; }
    const dx = Math.abs(touch.clientX - swipe.x);
    const dy = Math.abs(touch.clientY - swipe.y);
    if (dy > 12 && dy > dx) swipe = null;
    else if (dx > 12 && dx > dy * 1.5 && event.cancelable) event.preventDefault();
  }, {passive: false});
  reader.addEventListener('touchend', event => {
    const touch = event.changedTouches[0];
    if (swipe?.identifier !== touch.identifier) return;
    const {x, y, version} = swipe;
    swipe = null;
    const dx = touch.clientX - x;
    const dy = touch.clientY - y;
    if (version !== rendering || Math.abs(dx) < Math.max(48, Math.abs(dy) * 1.5) ||
        !window.getSelection()?.isCollapsed) return;
    if (event.cancelable) event.preventDefault();
    const target = adjacent(currentPlace, dx < 0 ? 1 : -1);
    if (target) open(target);
  }, {passive: false});
  reader.addEventListener('touchcancel', () => { swipe = null; });
}

function displayText(text, className) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function verseBounds(number) {
  const start = Number.parseInt(number, 10);
  return [start, Number.parseInt(number.split(/[-–]/)[1], 10) || start];
}

function isReadableReference(destination) {
  if (!parseRoute(route(destination))) return false;
  if (destination.edition !== 'bible') return true;
  const verses = bibleData[destination.book][destination.chapter];
  return [destination.verse, destination.end ?? destination.verse].every(target => verses.some(([number]) => {
    const [start, end] = verseBounds(number);
    return start <= target && target <= end;
  }));
}

function bibleChapter(place) {
  const references = typeof bibleReferences === 'undefined' ? null : bibleReferences[place.book]?.[place.chapter];
  const verses = bibleData[place.book][place.chapter].map(([number, text]) => {
    const [start, end] = verseBounds(number);
    const entries = new Set();
    for (let verse = start; verse <= end; verse++) {
      for (const reference of references?.[verse]?.split(' ') ?? []) entries.add(reference);
    }
    if (!entries.size) return [number, text];
    const parts = [...entries].flatMap((reference, index) => {
      const [book, chapter, range] = reference.split('.');
      const [verse, end] = range.split('-').map(Number);
      const target = {edition: 'bible', book, chapter: +chapter, verse, ...(end && {end})};
      const label = `${titleFor(target)}:${verse}${end ? `–${end}` : ''}`;
      return [...(index ? [' · '] : []), {text: label, place: target}];
    });
    const note = {text: 'Ссылки', title: `Параллельные места · ${titleFor(place)}:${number}`, paragraphs: [parts]};
    return [number, text, [text, ' ', note]];
  });
  return {verses};
}

function syncStudyPanel() {
  if (!activeStudyButton) return;
  if (studyNarrow.matches) {
    studySidebar.hidden = true;
    if (studyNote.parentElement !== studyDialog) studyDialog.append(studyNote);
    if (!studyDialog.open) studyDialog.showModal();
  } else {
    if (studyDialog.open) studyDialog.close();
    if (studyNote.parentElement !== studySidebar) studySidebar.append(studyNote);
    studySidebar.hidden = false;
  }
}

function closeStudyNote(restoreFocus = true) {
  const button = activeStudyButton;
  if (!button) return;
  const top = button.getBoundingClientRect().top;
  activeStudyButton = null;
  button.setAttribute('aria-expanded', 'false');
  if (studyDialog.open) studyDialog.close();
  studySidebar.hidden = true;
  studyBody.replaceChildren();
  if (restoreFocus) {
    if (!studyNarrow.matches) window.scrollBy(0, button.getBoundingClientRect().top - top);
    button.focus({preventScroll: true});
  }
}

function enableStudySwipe() {
  let swipe;

  function resetSwipe() {
    swipe = null;
    studyDialog.classList.remove('swiping');
    studyDialog.style.removeProperty('--study-swipe');
  }

  studyDialog.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary || !studyNote.contains(event.target)) return;
    swipe = {id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false};
  });
  studyDialog.addEventListener('pointermove', event => {
    if (swipe?.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (!swipe.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      if (dx <= Math.abs(dy) * 1.3) { resetSwipe(); return; }
      swipe.dragging = true;
      studyDialog.classList.add('swiping');
      studyDialog.setPointerCapture(event.pointerId);
    }
    studyDialog.style.setProperty('--study-swipe', `${Math.max(0, dx)}px`);
  });
  studyDialog.addEventListener('pointerup', event => {
    if (swipe?.id !== event.pointerId) return;
    const threshold = Math.min(110, studyDialog.offsetWidth / 3);
    const dismiss = swipe.dragging && event.clientX - swipe.x >= threshold;
    resetSwipe();
    if (dismiss) closeStudyNote();
  });
  studyDialog.addEventListener('pointercancel', event => {
    if (swipe?.id === event.pointerId) resetSwipe();
  });
  studyDialog.addEventListener('close', resetSwipe);
}

async function loadStudyPreview(container, place, edition) {
  try {
    const data = place.edition === 'bible' ? {verses: bibleData[place.book][place.chapter]} : await readEpubChapter(edition.archive, place);
    const verses = data.verses.filter(([number]) => {
      const [start, end] = verseBounds(number);
      return end >= place.verse && start <= (place.end ?? place.verse);
    });
    const lines = verses.map(([number, text]) => {
      const line = displayText(text, 'study-preview-verse');
      const marker = document.createElement('b');
      marker.textContent = `${number} `;
      line.prepend(marker);
      return line;
    });
    if (!lines.length && data.paragraphs?.length) lines.push(displayText(data.paragraphs[0], 'study-preview-verse'));
    container.replaceChildren(...(lines.length ? lines : [displayText('Отрывок можно открыть в полной главе.', 'study-preview-status')]));
  } catch {
    container.replaceChildren(displayText('Не удалось загрузить отрывок.', 'study-preview-status'));
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

function createStudyPreview(place, origin) {
  const card = document.createElement('section');
  card.className = 'study-preview';
  card.tabIndex = -1;
  const title = document.createElement('h3');
  title.textContent = `${titleFor(place)}:${place.verse}${place.end ? `–${place.end}` : ''}`;
  const body = document.createElement('div');
  const edition = localEditions.get(place.edition);
  const available = place.edition === 'bible' || edition;
  const fullChapter = available ? link('Открыть главу', route(place), 'button') : link('Открыть главу на сайте Церкви', sourceFor(place), 'button');
  if (available) {
    fullChapter.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      history.replaceState(history.state, '', route(origin));
      if (fullChapter.hash === location.hash) {
        event.preventDefault();
        void render();
      }
    });
    body.setAttribute('aria-busy', 'true');
    body.append(displayText('Открываю отрывок…', 'study-preview-status'));
    void loadStudyPreview(body, place, edition);
  } else {
    body.append(displayText('Для предпросмотра добавь эту книгу на устройство.', 'study-preview-status'));
  }
  card.append(title, body, fullChapter);
  return card;
}

function openStudyNote(button, note, place, verse) {
  if (button === activeStudyButton) { closeStudyNote(); return; }
  const top = button.getBoundingClientRect().top;
  activeStudyButton?.setAttribute('aria-expanded', 'false');
  activeStudyButton = button;
  button.setAttribute('aria-expanded', 'true');
  $('study-note-title').textContent = note.title ?? `Сноска ${verse}${note.marker} · ${note.text}`;
  const origin = {...place, verse, end: undefined};
  const previews = new Map();
  const paragraphs = note.paragraphs.map(parts => {
    const paragraph = document.createElement('p');
    for (const part of parts) {
      if (typeof part === 'string') { paragraph.append(part); continue; }
      if (part.href) { paragraph.append(link(part.text, part.href, 'study-reference')); continue; }
      if (!isReadableReference(part.place)) { paragraph.append(part.text); continue; }
      const key = route(part.place);
      if (!previews.has(key)) previews.set(key, createStudyPreview(part.place, origin));
      const card = previews.get(key);
      const reference = document.createElement('button');
      reference.type = 'button';
      reference.className = 'study-reference';
      reference.textContent = part.text;
      reference.addEventListener('click', () => {
        studyBody.scrollTop += card.getBoundingClientRect().top - studyBody.getBoundingClientRect().top - 5;
        card.focus({preventScroll: true});
      });
      paragraph.append(reference);
    }
    return paragraph;
  });
  studyBody.replaceChildren(...paragraphs, ...previews.values());
  syncStudyPanel();
  studyBody.scrollTop = 0;
  if (!studyNarrow.matches) window.scrollBy(0, button.getBoundingClientRect().top - top);
  studyClose.focus({preventScroll: true});
}

function appendStudyNotes(body, parts, place, verse) {
  for (const part of parts) {
    if (typeof part === 'string') { body.append(part); continue; }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = part.title ? 'study-note-word study-note-verse' : 'study-note-word';
    button.setAttribute('aria-controls', studyNote.id);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', part.title ?? `Сноска ${verse}${part.marker}: ${part.text}`);
    button.append(part.text);
    if (part.marker) {
      const marker = document.createElement('sup');
      marker.textContent = part.marker;
      button.append(marker);
    }
    button.addEventListener('click', () => openStudyNote(button, part, place, verse));
    body.append(button);
  }
}

function showChapter(place, data, version) {
  const fragment = document.createDocumentFragment();
  if (data.intro?.length) {
    const preface = document.createElement('div');
    preface.className = 'chapter-preface';
    preface.append(...data.intro.map(text => displayText(text, '')));
    fragment.append(preface);
  }
  let firstMarked;
  for (const [number, text, parts] of data.verses) {
    const [start, end] = verseBounds(number);
    const row = document.createElement('p');
    row.className = 'verse';
    row.id = `verse-${number}`;
    row.dataset.verse = String(start);
    const body = document.createElement('span');
    body.className = 'verse-text';
    body.dataset.annotation = route({...place, verse: start, end: end > start ? end : undefined});
    if (parts) appendStudyNotes(body, parts, place, start);
    else body.textContent = text;
    const numberLink = link(number, route({...place, verse: start, end: undefined}), 'verse-number');
    numberLink.setAttribute('aria-label', `Стих ${number}`);
    row.append(numberLink, body);
    if (end >= place.verse && start <= (place.end ?? place.verse) && (place.verse !== 1 || place.end)) {
      row.setAttribute('aria-current', 'true');
      firstMarked ??= row;
    }
    fragment.append(row);
  }
  for (const paragraph of data.paragraphs ?? []) fragment.append(displayText(paragraph, 'section-paragraph'));
  passage.replaceChildren(fragment);
  passage.dispatchEvent(new Event('chapter-shown'));
  renderSource(place, data.rights);
  if (!firstMarked && place.verse > 1) {
    const error = $('jump-error');
    error.textContent = `В ${titleFor(place)} не найден стих ${place.verse}. Открыта глава.`;
    error.hidden = false;
  }
  savePreference('last', route(firstMarked ? place : {...place, verse: 1, end: undefined}));
  requestAnimationFrame(() => {
    if (version !== rendering) return;
    if (firstMarked) firstMarked.scrollIntoView({block: 'center'});
    else window.scrollTo(0, 0);
    restoredScrollY = window.scrollY;
  });
}

function renderSource(place, rights) {
  const source = $('source-info');
  source.replaceChildren();
  if (rights) source.append(displayText(rights, ''));
  source.append(link(place.edition === 'bible' ? 'Синодальный перевод · eBible.org' : 'Открыть на сайте Церкви', sourceFor(place)));
  if (place.edition === 'bible') {
    const credit = document.createElement('p');
    credit.append('Параллельные места: ', link('OpenBible.info', 'https://www.openbible.info/labs/cross-references/'), ' · ',
      link('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'),
      ' · Выборка до 10 ссылок на стих с пересчётом нумерации по ',
      link('CrossWire JSword', 'https://github.com/crosswire/jsword/blob/master/src/main/resources/org/crosswire/jsword/versification/SynodalProt.properties'), '.');
    source.append(credit);
  }
  source.hidden = false;
}

function showUnavailable(place, message, allowFile = false) {
  passage.replaceChildren(displayText(message, 'reading-message'), link('Открыть официальный текст', sourceFor(place), 'button primary'));
  if (allowFile) {
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.textContent = openBookFile.textContent;
    button.addEventListener('click', () => bookFile.click());
    actions.append(button);
    passage.append(actions);
  }
}

async function render() {
  const version = ++rendering;
  closeStudyNote(false);
  clearTimeout(scrollTimer);
  restoredScrollY = null;
  $('jump-error').hidden = true;
  const hash = location.hash;
  const place = parseRoute(hash);
  const edition = hash.match(/^#contents\/(bible|bofm|dc|pgp)$/)?.[1];
  const showSettings = hash === '#settings';
  currentPlace = place;
  reader.hidden = !place;
  library.hidden = Boolean(place || edition || showSettings);
  settings.hidden = !showSettings;
  jumpForm.hidden = tocToggle.hidden = showSettings;
  contents.hidden = !edition;
  $('home-link').setAttribute('aria-current', library.hidden ? 'false' : 'page');
  $('settings-link').setAttribute('aria-current', showSettings ? 'page' : 'false');
  markTocChapter(place);
  syncToc();
  if (showSettings) {
    window.scrollTo(0, 0);
    $('settings-title').focus({preventScroll: true});
    return;
  }
  if (edition) {
    renderContents(edition);
    return;
  }
  if (!place) {
    renderLibrary();
    if (hash === '#library') {
      window.scrollTo(0, 0);
      $('library-title').focus({preventScroll: true});
    }
    return;
  }

  $('reader-title').textContent = titleFor(place);
  const collection = place.edition === 'bible' ? 'Библия · Синодальный перевод' : editions[place.edition].name;
  $('collection-label').replaceChildren(link(collection, `#contents/${place.edition}`));
  $('reader-title').focus({preventScroll: true});
  renderNavigation(place);
  $('source-info').hidden = true;
  passage.setAttribute('aria-busy', 'false');

  if (place.edition === 'bible') {
    showChapter(place, bibleChapter(place), version);
    return;
  }

  const imported = localEditions.get(place.edition);
  if (!imported) {
    showUnavailable(place, 'Эта книга ещё не добавлена на этом устройстве.', hosted);
    window.scrollTo(0, 0);
    return;
  }
  passage.replaceChildren(displayText('Открываю главу…', 'reading-message'));
  passage.setAttribute('aria-busy', 'true');
  try {
    const data = await readEpubChapter(imported.archive, place);
    if (version === rendering) showChapter(place, {...data, rights: imported.rights}, version);
  } catch {
    if (version === rendering) showUnavailable(place, 'Не удалось открыть локальный текст этой главы.');
  } finally {
    if (version === rendering) passage.setAttribute('aria-busy', 'false');
  }
}

function updateFont(large) {
  document.documentElement.dataset.textSize = large ? 'large' : 'normal';
  fontToggle.setAttribute('aria-pressed', String(large));
  largeTextSetting.checked = large;
  savePreference('large-text', String(large));
}

function reportBookFile(message, error = false) {
  bookFileStatus.textContent = message;
  bookFileStatus.classList.toggle('error', error);
  bookFileStatus.hidden = false;
}

async function loadBookFile(file) {
  bookFile.disabled = openBookFile.disabled = true;
  reportBookFile('Открываю книгу…');
  try {
    const edition = await inspectEpub(file);
    for (const key of edition.keys) localEditions.set(key, edition);
    const names = edition.keys.map(key => editions[key].name).join(', ');
    try {
      await saveEpub(file, edition);
      reportBookFile(`Добавлено: ${names}.`);
    } catch {
      reportBookFile(`Открыто в этой вкладке: ${names}. Браузер не сохранил файл.`, true);
    }
    await render();
  } catch (error) {
    reportBookFile(error.message, true);
  } finally {
    bookFile.value = '';
    bookFile.disabled = openBookFile.disabled = false;
  }
}

async function start() {
  updateFont(readPreference('large-text') === 'true');
  for (const {archive, keys, rights} of await openLocalEditions()) {
    for (const key of keys) localEditions.set(key, {archive, rights});
  }
  await render();
}

if (hosted && window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(error => {
    console.warn('Не удалось настроить автономный режим.', error);
  });
}

buildToc();
syncToc();
tocToggle.addEventListener('click', () => {
  if (tocNarrow.matches) {
    tocDialog.showModal();
  } else {
    desktopTocOpen = tocSidebar.hidden;
  }
  syncToc();
});
$('toc-close').addEventListener('click', closeToc);
tocDialog.addEventListener('close', syncToc);
tocNarrow.addEventListener('change', syncToc);
studyClose.addEventListener('click', () => closeStudyNote());
enableStudySwipe();
enableChapterSwipe();
studyDialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeStudyNote();
});
studyNarrow.addEventListener('change', syncStudyPanel);
addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeStudyButton && !studyDialog.open) closeStudyNote();
});
tocContent.addEventListener('click', event => {
  if (tocDialog.open && event.target.closest('a') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) tocDialog.close();
});
fontToggle.addEventListener('click', () => updateFont(!largeTextSetting.checked));
largeTextSetting.addEventListener('change', () => updateFont(largeTextSetting.checked));
openBookFile.addEventListener('click', () => bookFile.click());
bookFile.addEventListener('change', () => {
  const file = bookFile.files[0];
  if (hosted && file && !bookFile.disabled) void loadBookFile(file);
});
addEventListener('hashchange', () => {
  bookFileStatus.hidden = true;
  void render();
});
jumpForm.addEventListener('submit', event => {
  event.preventDefault();
  const destination = parseReference($('jump-input').value, currentPlace?.edition ?? 'bible');
  if (destination && parseRoute(route(destination))) open(destination);
  else {
    $('jump-error').textContent = 'Не удалось найти это место. Попробуй «Ин. 3:16» или «2 Нефий 31:5».';
    $('jump-error').hidden = false;
    $('jump-input').focus();
  }
});
addEventListener('scroll', () => {
  if (!currentPlace || passage.getAttribute('aria-busy') === 'true') return;
  if (window.scrollY === restoredScrollY) return;
  restoredScrollY = null;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const verses = [...passage.querySelectorAll('[data-verse]')];
    const headerBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const first = verses.find(row => row.getBoundingClientRect().bottom > headerBottom);
    if (first) savePreference('last', route({...currentPlace, verse: +first.dataset.verse, end: undefined}));
  }, 120);
}, {passive: true});
void start();
