const preferencePrefix = 'scriptures-flow:';

function readPreference(key) {
  try { return localStorage.getItem(preferencePrefix + key); } catch { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(preferencePrefix + key, value); } catch { /* Used in a browser without persistent storage. */ }
}

const readerTheme = (() => {
  const root = document.documentElement;
  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  const themeColor = document.querySelector('meta[name="theme-color"]');

  function get() {
    const theme = readPreference('theme');
    return theme === 'light' || theme === 'dark' ? theme : null;
  }

  function apply(theme) {
    const dark = theme === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    colorScheme.content = root.dataset.theme;
    themeColor.content = dark ? '#191512' : '#f6eee4';
    document.getElementById('theme-toggle')?.setAttribute('aria-pressed', String(dark));
  }

  function set(theme) {
    savePreference('theme', theme);
    apply(theme);
  }

  apply(get());
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('theme-toggle');
    toggle.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
    toggle.addEventListener('click', () => {
      set(root.dataset.theme === 'dark' ? 'light' : 'dark');
      dispatchEvent(new Event('reader-theme-change'));
    });
  });
  addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === preferencePrefix + 'theme' || event.key === null)) apply(get());
  });

  return {get, set};
})();
