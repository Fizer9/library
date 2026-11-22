const $ = id => document.getElementById(id);
const library = $('library-view');
const contents = $('contents-view');
const reader = $('reader-view');
const passage = $('passage');
const tocSidebar = $('toc-sidebar');
const tocPanel = $('toc-panel');
const tocDialog = $('toc-dialog');
const tocToggle = $('toc-toggle');
const tocContent = $('toc-content');
const tocNarrow = matchMedia('(max-width: 800px)');
const tocChapters = new Map();
const tocEditions = new Map();
const localEditions = new Map();
const fontToggle = $('font-toggle');
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

function readPreference(key) {
  try { return localStorage.getItem(`scriptures-flow:${key}`); } catch { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(`scriptures-flow:${key}`, value); } catch { /* Used in a browser without persistent storage. */ }
}

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
  if (href.startsWith('https://')) {
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
  }
  return element;
}

function renderLibrary() {
  $('book-file-panel').hidden = !hosted;
  const last = parseRoute(readPreference('last') ?? '');
  const resume = $('continue-link');
  resume.hidden = !last;
  if (last) {
    resume.href = route(last);
    resume.textContent = `Продолжить чтение · ${titleFor(last)}:${last.verse}`;
  }
  $('edition-grid').replaceChildren(...Object.entries(editions).map(([id, edition]) => {
    const card = document.createElement('article');
    card.className = 'edition-card';
    const title = document.createElement('h2');
    title.textContent = edition.name;
    card.append(title);
    if (id === 'bible') card.append(displayText(`${edition.subtitle} · 66 книг`, ''));
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const available = id === 'bible' || localEditions.has(id);
    actions.append(link(available ? 'Читать' : 'Выбрать главу', `#contents/${id}`, 'button'));
    card.append(actions);
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
  const chapterName = {dc: 'Раздел', fac: 'Факсимиле'}[book.id] ?? book.name;
  const chapters = Array.from({length: count}, (_, index) => {
    const chapter = index + 1;
    const destination = route({edition: editionId, book: book.id, chapter, verse: 1});
    const chapterLink = link(count === 1 ? book.name : `${chapterName} ${chapter}`, destination);
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
  if (tocNarrow.matches) {
    tocSidebar.hidden = true;
    if (tocPanel.parentElement !== tocDialog) tocDialog.append(tocPanel);
    tocToggle.setAttribute('aria-haspopup', 'dialog');
    tocToggle.setAttribute('aria-expanded', String(tocDialog.open));
  } else {
    if (tocDialog.open) tocDialog.close();
    if (tocPanel.parentElement !== tocSidebar) tocSidebar.append(tocPanel);
    tocSidebar.hidden = !(desktopTocOpen ?? Boolean(currentPlace));
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

function displayText(text, className) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function isReadableReference(destination) {
  if (!parseRoute(route(destination))) return false;
  if (destination.edition !== 'bible') return true;
  const verses = bibleData[destination.book][destination.chapter];
  return [destination.verse, destination.end ?? destination.verse].every(target => verses.some(([number]) => {
    const start = parseInt(number, 10);
    const end = parseInt(number.split(/[-–]/)[1], 10) || start;
    return start <= target && target <= end;
  }));
}

function bibleChapter(place) {
  const references = typeof bibleReferences === 'undefined' ? null : bibleReferences[place.book]?.[place.chapter];
  const verses = bibleData[place.book][place.chapter].map(([number, text]) => {
    const entries = references?.[parseInt(number, 10)];
    if (!entries) return [number, text];
    const parts = entries.split(' ').flatMap((reference, index) => {
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

function createStudyNotes(place) {
  const panel = document.createElement('section');
  panel.id = 'study-note';
  panel.className = 'study-note';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'study-note-title');
  let active;

  function close() {
    active?.setAttribute('aria-expanded', 'false');
    active?.focus({preventScroll: true});
    active = null;
    panel.hidden = true;
  }

  function openNote(button, note, row) {
    if (button === active) { close(); return; }
    active?.setAttribute('aria-expanded', 'false');
    active = button;
    button.setAttribute('aria-expanded', 'true');

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = 'study-note-title';
    title.textContent = note.title ?? `Сноска ${row.dataset.verse}${note.marker} · ${note.text}`;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'button';
    dismiss.textContent = 'Закрыть';
    dismiss.addEventListener('click', close);
    header.append(title, dismiss);
    panel.replaceChildren(header);
    for (const parts of note.paragraphs) {
      const paragraph = document.createElement('p');
      for (const part of parts) {
        if (typeof part === 'string') paragraph.append(part);
        else if (isReadableReference(part.place)) {
          const target = link(part.text, route(part.place));
          target.addEventListener('click', event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            history.replaceState(history.state, '', route({...place, verse: +row.dataset.verse, end: undefined}));
          });
          paragraph.append(target);
        } else paragraph.append(part.text);
      }
      panel.append(paragraph);
    }
    row.after(panel);
    panel.hidden = false;
    panel.scrollIntoView({block: 'nearest'});
  }

  function append(body, parts, row) {
    for (const part of parts) {
      if (typeof part === 'string') { body.append(part); continue; }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = part.title ? 'study-note-word study-note-verse' : 'study-note-word';
      button.setAttribute('aria-controls', panel.id);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', part.title ?? `Сноска ${row.dataset.verse}${part.marker}: ${part.text}`);
      if (part.marker) {
        const marker = document.createElement('sup');
        marker.textContent = part.marker;
        button.append(marker);
      }
      button.append(part.text);
      button.addEventListener('click', () => openNote(button, part, row));
      body.append(button);
    }
  }

  return {panel, append};
}

function showChapter(place, data, version) {
  const fragment = document.createDocumentFragment();
  if (data.intro?.length) {
    const preface = document.createElement('div');
    preface.className = 'chapter-preface';
    preface.append(...data.intro.map(text => displayText(text, '')));
    fragment.append(preface);
  }
  const notes = data.verses.some(([, , parts]) => parts) ? createStudyNotes(place) : null;
  let firstMarked;
  for (const [number, text, parts] of data.verses) {
    const start = Number.parseInt(number, 10);
    const end = Number.parseInt(number.split(/[-–]/)[1], 10) || start;
    const row = document.createElement('p');
    row.className = 'verse';
    row.id = `verse-${number}`;
    row.dataset.verse = String(start);
    const body = document.createElement('span');
    if (parts) notes.append(body, parts, row);
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
  if (notes) fragment.append(notes.panel);
  for (const paragraph of data.paragraphs ?? []) fragment.append(displayText(paragraph, 'section-paragraph'));
  passage.replaceChildren(fragment);
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
  clearTimeout(scrollTimer);
  restoredScrollY = null;
  $('jump-error').hidden = true;
  const place = parseRoute(location.hash);
  const edition = location.hash.match(/^#contents\/(bible|bofm|dc|pgp)$/)?.[1];
  currentPlace = place;
  reader.hidden = !place;
  library.hidden = Boolean(place || edition);
  contents.hidden = !edition;
  markTocChapter(place);
  syncToc();
  if (edition) {
    renderContents(edition);
    return;
  }
  if (!place) {
    renderLibrary();
    if (location.hash === '#library') {
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
tocContent.addEventListener('click', event => {
  if (tocDialog.open && event.target.closest('a') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) tocDialog.close();
});
fontToggle.addEventListener('click', () => updateFont(fontToggle.getAttribute('aria-pressed') !== 'true'));
openBookFile.addEventListener('click', () => bookFile.click());
bookFile.addEventListener('change', () => {
  const file = bookFile.files[0];
  if (hosted && file && !bookFile.disabled) void loadBookFile(file);
});
addEventListener('hashchange', () => {
  bookFileStatus.hidden = true;
  void render();
});
$('jump-form').addEventListener('submit', event => {
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
