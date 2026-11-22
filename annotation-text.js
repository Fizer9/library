const annotationText = (() => {
  const maxQuoteLength = 12000;
  const maxVerses = 150;

  function verseText(body) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('sup, .study-note-verse')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const parts = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      parts.push({node, start: text.length});
      text += node.data;
    }
    return {text, parts};
  }

  function selection() {
    const selected = getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return null;
    const range = selected.getRangeAt(0);
    if (!passage.contains(range.startContainer) || !passage.contains(range.endContainer)) return null;
    const fragments = [];
    let length = 0;
    for (const body of passage.querySelectorAll('.verse-text')) {
      if (!range.intersectsNode(body)) continue;
      const {text, parts} = verseText(body);
      let start;
      let end;
      for (const {node, start: offset} of parts) {
        if (!range.intersectsNode(node)) continue;
        start ??= offset + (node === range.startContainer ? range.startOffset : 0);
        end = offset + (node === range.endContainer ? range.endOffset : node.length);
      }
      if (start === undefined) continue;
      const raw = text.slice(start, end);
      const quote = raw.trim();
      if (!quote) continue;
      length += quote.length;
      if (length > maxQuoteLength || fragments.length === maxVerses) return null;
      const verse = body.closest('.verse').querySelector('[data-annotation]').dataset.annotation;
      fragments.push({verse, start: start + raw.length - raw.trimStart().length, quote});
    }
    return fragments.length ? fragments : null;
  }

  function validFragments(fragments, place) {
    if (!Array.isArray(fragments) || !fragments.length || fragments.length > maxVerses) return false;
    const chapter = place.slice(0, place.lastIndexOf('/'));
    let length = 0;
    const verses = new Set();
    for (const fragment of fragments) {
      const {verse, start, quote} = fragment ?? {};
      if (typeof verse !== 'string' || !verse.startsWith(chapter + '/') || !parseRoute(verse) ||
          verses.has(verse) || !Number.isSafeInteger(start) || start < 0 ||
          typeof quote !== 'string' || !quote.trim()) return false;
      verses.add(verse);
      length += quote.length;
    }
    return fragments[0].verse === place && length <= maxQuoteLength;
  }

  function locate(text, fragment) {
    if (!fragment) return [0, text.length];
    const {start, quote} = fragment;
    if (text.startsWith(quote, start)) return [start, start + quote.length];
    // If the edition's text changed, relocate only an unambiguous match.
    const found = text.indexOf(quote);
    return found >= 0 && text.indexOf(quote, found + 1) < 0 ? [found, found + quote.length] : null;
  }

  function paint(body, entries) {
    for (const mark of body.querySelectorAll('.personal-mark')) mark.replaceWith(...mark.childNodes);
    body.normalize();
    if (!entries.length) return;
    const {text, parts} = verseText(body);
    const intervals = [];
    for (const {entry, fragment} of entries) {
      const bounds = locate(text, fragment);
      if (bounds) intervals.push({entry, start: bounds[0], end: bounds[1]});
    }
    for (const {node, start} of parts) {
      const end = start + node.length;
      const intersecting = intervals.filter(interval => interval.start < end && interval.end > start);
      if (!intersecting.length) continue;
      const boundaries = new Set([start, end]);
      for (const interval of intersecting) {
        boundaries.add(Math.max(start, interval.start));
        boundaries.add(Math.min(end, interval.end));
      }
      const points = [...boundaries].sort((a, b) => a - b);
      const content = document.createDocumentFragment();
      for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];
        const covered = intersecting.filter(interval => interval.start <= from && interval.end >= to);
        const piece = node.data.slice(from - start, to - start);
        if (!covered.length) {
          content.append(piece);
          continue;
        }
        const mark = document.createElement('mark');
        mark.className = 'personal-mark';
        const entries = covered.map(interval => interval.entry);
        mark.dataset.entries = entries.map(entry => entry.key).join(' ');
        const fill = entries.find(entry => entry.values.style.startsWith('fill-'));
        const line = entries.find(entry => entry.values.style.startsWith('line-'));
        if (fill) mark.classList.add(fill.values.style);
        if (line) mark.classList.add(line.values.style);
        if (!fill && !line) mark.classList.add('note-anchor');
        mark.textContent = piece;
        content.append(mark);
      }
      node.replaceWith(content);
    }
  }

  return {selection, paint, validFragments};
})();
