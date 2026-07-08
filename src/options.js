import browser from 'webextension-polyfill';

const DEFAULTS = { cc: 'us', searchRewrite: true };

const $cc = document.getElementById('cc');
const $sr = document.getElementById('searchRewrite');
const $status = document.getElementById('status');
let saveTimer = null;

function flash(msg) {
  $status.textContent = msg;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { $status.textContent = ''; }, 1500);
}

browser.storage.sync.get(DEFAULTS).then((opts) => {
  $cc.value = (opts.cc || DEFAULTS.cc).toLowerCase();
  $sr.checked = opts.searchRewrite !== false;
});

function persist() {
  browser.storage.sync.set({
    cc: $cc.value,
    searchRewrite: $sr.checked,
  }).then(() => {
    flash('Сохранено');
  });
}

$cc.addEventListener('change', persist);
$sr.addEventListener('change', persist);