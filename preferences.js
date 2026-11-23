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
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = dark;
  }

  function set(theme) {
    savePreference('theme', theme);
    apply(theme);
  }

  apply(get());
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('theme-toggle');
    toggle.checked = root.dataset.theme === 'dark';
    toggle.addEventListener('change', () => {
      set(toggle.checked ? 'dark' : 'light');
      dispatchEvent(new Event('reader-theme-change'));
    });
  });
  addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === preferencePrefix + 'theme' || event.key === null)) apply(get());
  });

  return {get, set};
})();
