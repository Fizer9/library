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
    themeColor.content = dark ? '#0b0d12' : '#faf8f5';
    for (const toggle of document.querySelectorAll('[data-theme-toggle]')) toggle.checked = dark;
  }

  function set(theme) {
    savePreference('theme', theme);
    apply(theme);
  }

  apply(get());
  document.addEventListener('DOMContentLoaded', () => {
    for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
      toggle.checked = root.dataset.theme === 'dark';
      toggle.addEventListener('change', () => {
        set(toggle.checked ? 'dark' : 'light');
        dispatchEvent(new Event('reader-theme-change'));
      });
    }
  });
  addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === preferencePrefix + 'theme' || event.key === null)) apply(get());
  });

  return {get, set};
})();

(() => {
  const root = document.documentElement;
  const saved = Number(readPreference('interface-size'));
  const size = saved >= 85 && saved <= 150 && saved % 5 === 0 ? saved : 100;

  function apply(value) {
    root.style.setProperty('--interface-scale', value / 100);
  }

  apply(size);
  document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('interface-size');
    const output = document.getElementById('interface-size-value');

    function showValue() {
      const label = slider.value + '%';
      output.value = label;
      slider.setAttribute('aria-valuetext', label);
    }

    slider.valueAsNumber = size;
    showValue();
    slider.addEventListener('input', () => {
      apply(slider.valueAsNumber);
      showValue();
      savePreference('interface-size', slider.value);
    });
  });
})();
