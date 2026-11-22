const MAX_EPUB_BYTES = 150 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const utf8 = new TextDecoder();

async function readZip(file) {
  if (file.size > MAX_EPUB_BYTES) throw new Error('Размер EPUB превышает 150 МБ.');
  const tailStart = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 || end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--;
  if (end < 0 || tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)) throw new Error('Не удалось открыть EPUB как ZIP-архив.');

  const count = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  const directoryEnd = directoryOffset + directorySize;
  if (directorySize > MAX_TEXT_BYTES || directoryEnd > tailStart + end) throw new Error('Оглавление EPUB повреждено.');
  const directory = new DataView(await file.slice(directoryOffset, directoryEnd).arrayBuffer());
  const entries = new Map();

  let cursor = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > directory.byteLength || directory.getUint32(cursor, true) !== 0x02014b50) throw new Error('Оглавление EPUB повреждено.');
    const nameLength = directory.getUint16(cursor + 28, true);
    const nameStart = cursor + 46;
    const next = nameStart + nameLength + directory.getUint16(cursor + 30, true) + directory.getUint16(cursor + 32, true);
    if (next > directory.byteLength) throw new Error('Оглавление EPUB повреждено.');
    const name = utf8.decode(new Uint8Array(directory.buffer, nameStart, nameLength));
    entries.set(name, {
      flags: directory.getUint16(cursor + 8, true), method: directory.getUint16(cursor + 10, true),
      packed: directory.getUint32(cursor + 20, true), size: directory.getUint32(cursor + 24, true),
      offset: directory.getUint32(cursor + 42, true),
    });
    cursor = next;
  }

  async function text(name) {
    const entry = entries.get(name);
    if (!entry || entry.size > MAX_TEXT_BYTES || entry.packed > MAX_TEXT_BYTES || (entry.flags & 1)) throw new Error('Файл главы в EPUB недоступен.');
    const header = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50) throw new Error('Файл главы в EPUB повреждён.');
    const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const end = start + entry.packed;
    if (end > directoryOffset) throw new Error('Файл главы в EPUB повреждён.');
    const compressed = file.slice(start, end);
    if (entry.method === 0 && entry.packed === entry.size) return utf8.decode(await compressed.arrayBuffer());
    if (entry.method !== 8) throw new Error('Способ сжатия EPUB не поддерживается.');
    const reader = compressed.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const output = new Uint8Array(entry.size);
    let written = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (written + value.length > output.length) {
          await reader.cancel();
          throw new Error('Размер главы в EPUB не совпадает с оглавлением.');
        }
        output.set(value, written);
        written += value.length;
      }
    } finally {
      reader.releaseLock();
    }
    if (written !== output.length) throw new Error('Размер главы в EPUB не совпадает с оглавлением.');
    return utf8.decode(output);
  }

  return {has: name => entries.has(name), text};
}

function epubDocument(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) throw new Error('Не удалось прочитать разметку главы EPUB.');
  return doc;
}

function epubChapterPath(place) {
  const prefix = place.edition === 'bofm' ? '' : `${editions[place.edition].path}/`;
  const part = place.book === 'fac' ? `abr/fac-${place.chapter}` : `${place.book}/${place.chapter}`;
  return `OEBPS/${prefix}${part}.xhtml`;
}

function epubText(node) {
  const copy = node.cloneNode(true);
  for (const marker of copy.querySelectorAll('.verse-number, .marker, .page-break, img, script, style')) marker.remove();
  return copy.textContent.replace(/\s+/gu, ' ').trim();
}

async function readEpubChapter(archive, place) {
  const doc = epubDocument(await archive.text(epubChapterPath(place)));
  const intro = [...doc.querySelectorAll('.study-intro, .study-summary')].map(epubText).filter(Boolean);
  const numbered = [...doc.querySelectorAll('.body-block .verse')];
  const verses = numbered.map(verse => [verse.querySelector('.verse-number')?.textContent.trim(), epubText(verse)]);
  if (verses.length && verses.every(([number, text]) => number && text)) return {intro, verses};
  if (place.book === 'od' || place.book === 'fac') {
    const paragraphs = [...doc.querySelectorAll('.body-block p')].map(epubText).filter(Boolean);
    if (paragraphs.length || intro.length) return {intro, paragraphs, verses: []};
  }
  throw new Error('Не удалось найти стихи в этой главе EPUB.');
}

async function inspectEpub(file) {
  const archive = await readZip(file);
  if (!archive.has('META-INF/container.xml') || !archive.has('OEBPS/content.opf')) throw new Error('Выбери официальное русское издание в формате EPUB.');
  const packageDoc = epubDocument(await archive.text('OEBPS/content.opf'));
  const languages = [...packageDoc.getElementsByTagNameNS('*', 'language')].map(node => node.textContent.trim().toLowerCase());
  if (!languages.some(language => ['ru','rus','ru-ru'].includes(language))) throw new Error('Для этой читалки нужен EPUB на русском языке.');
  const rights = [...packageDoc.getElementsByTagNameNS('*', 'rights')].map(node => node.textContent.trim()).filter(Boolean).join(' ');
  const keys = [];
  for (const id of ['bofm','dc','pgp']) {
    const edition = editions[id];
    const chapters = edition.books.flatMap(book => Array.from({length: book.count}, (_, i) => ({edition: id, book: book.id, chapter: i + 1})));
    if (!chapters.every(place => archive.has(epubChapterPath(place)))) continue;
    await readEpubChapter(archive, chapters[0]);
    keys.push(id);
  }
  if (!keys.length) throw new Error('В EPUB не найдены полные главы поддерживаемых русских изданий.');
  return {archive, keys, rights};
}

function openEpubStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('scriptures-flow', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('epubs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function epubStorage(mode, action) {
  const database = await openEpubStorage();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('epubs', mode);
      const request = action(transaction.objectStore('epubs'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function saveEpub(file, {keys, rights}) {
  return epubStorage('readwrite', store => {
    const read = store.get('library');
    read.onsuccess = () => {
      const records = (read.result ?? []).map(record => ({
        ...record,
        keys: record.keys.filter(key => !keys.includes(key)),
      })).filter(record => record.keys.length);
      store.put([...records, {file, keys, rights}], 'library');
    };
    return read;
  });
}

async function openLocalEditions() {
  const results = [];
  if (location.protocol === 'file:') {
    const encoded = await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'personal-editions.local.js';
      script.onload = () => {
        resolve(globalThis.flowLocalArchives ?? []);
        delete globalThis.flowLocalArchives;
        script.remove();
      };
      script.onerror = () => { script.remove(); resolve([]); };
      document.head.append(script);
    });
    const archives = await Promise.allSettled(encoded.map(data => {
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
      return inspectEpub(new Blob([bytes]));
    }));
    for (const archive of archives) {
      if (archive.status === 'fulfilled') results.push(archive.value);
    }
  }

  if (new Set(results.flatMap(({keys}) => keys)).size === 3) return results;
  try {
    const records = (await epubStorage('readonly', store => store.get('library'))) ?? [];
    const present = new Set(results.flatMap(({keys}) => keys));
    for (const {file, keys, rights} of records) {
      const missing = keys.filter(key => !present.has(key));
      if (missing.length) {
        results.push({archive: await readZip(file), keys: missing, rights});
        for (const key of missing) present.add(key);
      }
    }
  } catch { /* Browser storage may be disabled. */ }
  return results;
}
