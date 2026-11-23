function createAnnotationSync({githubRequest, requireSuccess, verifyPrivateRepository, localRevisions, rememberRevisions, revisionId}) {
  const directory = 'reader-annotations';
  const schemaPath = `${directory}/schema.json`;
  const legacyPath = 'reader-annotations.json';
  const chapterFile = /^(?:bible|bofm|dc|pgp)\/[\w-]+\/[1-9]\d*\.json$/;
  const shaPattern = /^[0-9a-f]{40}$/;
  const encoder = new TextEncoder();
  let cache;

  function formatError(path) {
    return new Error(`Файл заметок в GitHub повреждён или имеет неподдерживаемый формат: ${path}.`);
  }

  function chapterPath(place) {
    const {edition, book, chapter} = parseRoute(place);
    return `${directory}/${edition}/${book}/${chapter}.json`;
  }

  function chaptersFor(revisions) {
    const chapters = new Map();
    for (const [id, revision] of revisions) {
      const path = chapterPath(revision.place);
      const chapter = chapters.get(path) ?? new Map();
      chapter.set(id, revision);
      chapters.set(path, chapter);
    }
    return chapters;
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

  function decodeRevisions(document, path) {
    try {
      const {version, revisions} = document;
      const legacy = path === legacyPath;
      if (!(version === 2 || legacy && version === 1) || !Array.isArray(revisions)) throw new Error();
      const byId = new Map();
      const entries = new Map();
      for (const revision of revisions) {
        const {id, entry, place, field, value, parents, updated} = revision;
        if (typeof id !== 'string' || !revisionId.test(id) || byId.has(id) ||
            typeof place !== 'string' || !parseRoute(place) || !legacy && chapterPath(place) !== path ||
            (entry !== undefined && (typeof entry !== 'string' || !revisionId.test(entry))) ||
            (updated !== undefined && (!Number.isSafeInteger(updated) || updated < 0)) ||
            !Array.isArray(parents) || parents.some(parent => typeof parent !== 'string' || !revisionId.test(parent) || parent === id) ||
            (version === 1 && (entry !== undefined || (field !== 'note' && field !== 'highlight'))) ||
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
      throw formatError(path);
    }
  }

  function encodeChapter(revisions) {
    const lines = [...revisions.keys()].sort().map(id => `    ${JSON.stringify(revisions.get(id))}`);
    return `{\n  "version": 2,\n  "revisions": [\n${lines.join(',\n')}\n  ]\n}\n`;
  }

  async function blobSha(content) {
    const bytes = encoder.encode(content);
    const header = encoder.encode(`blob ${bytes.length}\0`);
    const blob = new Uint8Array(header.length + bytes.length);
    blob.set(header);
    blob.set(bytes, header.length);
    // Git uses SHA-1 to identify the exact contents of a blob.
    const hash = await crypto.subtle.digest('SHA-1', blob);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function readBlob(get, sha, path) {
    const file = await get(`/git/blobs/${sha}`);
    try {
      if (file.encoding !== 'base64') throw new Error();
      const bytes = Uint8Array.from(atob(file.content), char => char.charCodeAt(0));
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    } catch {
      throw formatError(path);
    }
  }

  async function treeEntries(get, sha, recursive = false) {
    const {tree, truncated} = await get(`/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);
    if (truncated || !Array.isArray(tree)) throw new Error('GitHub вернул неполный список файлов заметок.');
    return tree;
  }

  function fileSha(entry, path) {
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !shaPattern.test(entry.sha)) {
      throw formatError(path);
    }
    return entry.sha;
  }

  async function readSnapshot(get, head, state) {
    if (state.snapshot?.head === head) return state.snapshot;
    const {tree} = await get(`/git/commits/${head}`);
    const root = await treeEntries(get, tree.sha);
    const legacy = root.find(entry => entry.path === legacyPath);
    const legacySha = legacy ? fileSha(legacy, legacyPath) : null;
    const folder = root.find(entry => entry.path === directory);
    if (folder && folder.type !== 'tree') throw formatError(directory);
    const folderSha = folder?.sha;
    let files = state.snapshot?.files;
    if (!files || state.snapshot.folderSha !== folderSha) {
      files = new Map();
      for (const entry of folderSha ? await treeEntries(get, folderSha, true) : []) {
        const path = `${directory}/${entry.path}`;
        if (path === schemaPath || chapterFile.test(entry.path)) files.set(path, fileSha(entry, path));
      }
    }
    state.snapshot = {head, rootSha: tree.sha, folderSha, files, legacySha};
    return state.snapshot;
  }

  async function readSchema(get, sha, state) {
    if (!sha) return null;
    if (state.schema?.sha === sha) return state.schema.value;
    const value = await readBlob(get, sha, schemaPath);
    if (value?.version !== 1 || (value.legacyImportedSha !== null &&
        (typeof value.legacyImportedSha !== 'string' || !shaPattern.test(value.legacyImportedSha)))) {
      throw formatError(schemaPath);
    }
    state.schema = {sha, value};
    return value;
  }

  async function importRevisions(get, state, path, sha, local, signal) {
    const previous = state.files.get(path);
    if (previous?.sha === sha && previous.ids.every(id => local.has(id))) return previous.ids;
    let ids;
    if (path !== legacyPath && local.size && await blobSha(encodeChapter(local)) === sha) {
      ids = [...local.keys()];
    } else {
      const revisions = decodeRevisions(await readBlob(get, sha, path), path);
      signal.throwIfAborted();
      rememberRevisions(revisions);
      ids = [...revisions.keys()];
    }
    state.files.set(path, {sha, ids});
    return ids;
  }

  async function readHead(request, ref) {
    const response = await request(`/git/ref/${ref}`);
    // Empty repositories may report a conflict or a missing default branch.
    if (response.status === 409 || response.status === 404) return null;
    requireSuccess(response);
    return (await response.json()).object.sha;
  }

  function encodeSchema(legacyImportedSha) {
    return JSON.stringify({version: 1, legacyImportedSha}, null, 2) + '\n';
  }

  async function initialize(request) {
    const response = await request(`/contents/${schemaPath}`, {
      method: 'PUT',
      body: JSON.stringify({message: 'Initialize reader annotations', content: btoa(encodeSchema(null))}),
    });
    if (response.status !== 409 && response.status !== 422) requireSuccess(response);
    return response;
  }

  async function collectChanges(get, snapshot, state, signal) {
    const {files, legacySha} = snapshot;
    const schema = await readSchema(get, files.get(schemaPath), state);
    const migrate = legacySha && legacySha !== schema?.legacyImportedSha;
    const local = localRevisions();
    if (migrate) await importRevisions(get, state, legacyPath, legacySha, local, signal);
    const chapters = chaptersFor(local);
    const remote = [...files].filter(([path]) => path !== schemaPath);
    const remoteIds = new Map();
    for (let offset = 0; offset < remote.length; offset += 8) {
      const batch = await Promise.allSettled(remote.slice(offset, offset + 8).map(async ([path, sha]) => {
        const ids = await importRevisions(get, state, path, sha, chapters.get(path) ?? new Map(), signal);
        remoteIds.set(path, new Set(ids));
      }));
      const failed = batch.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
    const changed = new Map();
    // Include edits made while the browser was fetching the latest versions.
    for (const [path, revisions] of chaptersFor(localRevisions())) {
      const ids = remoteIds.get(path);
      if (!ids || [...revisions.keys()].some(id => !ids.has(id))) changed.set(path, encodeChapter(revisions));
    }
    for (const path of state.files.keys()) {
      if (path !== legacyPath && !files.has(path)) state.files.delete(path);
    }
    if (migrate || !schema && (changed.size || remote.length)) changed.set(schemaPath, encodeSchema(legacySha));
    return changed;
  }

  async function publish(request, get, ref, snapshot, changed) {
    const tree = await get('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: snapshot.rootSha,
        tree: [...changed].map(([path, content]) => ({path, content, type: 'blob', mode: '100644'})),
      }),
    });
    const commit = await get('/git/commits', {
      method: 'POST',
      body: JSON.stringify({message: 'Sync reader annotations', parents: [snapshot.head], tree: tree.sha}),
    });
    const response = await request(`/git/refs/${ref}`, {
      method: 'PATCH',
      body: JSON.stringify({sha: commit.sha, force: false}),
    });
    if (response.status === 409 || (response.status === 422 && await readHead(request, ref) !== snapshot.head)) return false;
    requireSuccess(response);
    return true;
  }

  return async (config, repository, signal) => {
    const request = (path, options) => githubRequest(config.token, `/repos/${config.repo}${path}`, {...options, signal});
    const get = async (path, options) => {
      const response = await request(path, options);
      requireSuccess(response);
      return response.json();
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) repository = await verifyPrivateRepository(config, signal);
      const branch = repository.default_branch;
      if (!branch) throw new Error('GitHub не сообщил основную ветку репозитория.');
      const ref = 'heads/' + branch.split('/').map(encodeURIComponent).join('/');
      const key = `${config.repo}:${repository.id}:${branch}`;
      if (cache?.key !== key) cache = {key, files: new Map()};
      const state = cache;
      let head = await readHead(request, ref);
      if (!head) {
        if (!localRevisions().size) return;
        const initialized = await initialize(request);
        head = await readHead(request, ref);
        if (!head) {
          if (attempt === 3) requireSuccess(initialized);
          continue;
        }
      }
      const snapshot = await readSnapshot(get, head, state);
      const changed = await collectChanges(get, snapshot, state, signal);
      if (!changed.size || await publish(request, get, ref, snapshot, changed)) return;
    }
    throw new Error('Другое устройство обновляет записи. Читалка попробует синхронизировать их снова.');
  };
}
