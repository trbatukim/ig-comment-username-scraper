const _browser = typeof browser !== 'undefined' ? browser : chrome;

const statusEl    = document.getElementById('status');
const scrapeBtn   = document.getElementById('scrape-btn');
const downloadBtn = document.getElementById('download-btn');
const countEl     = document.getElementById('count');
const realNamesTggl = document.getElementById('real-names-toggle');

let pendingResult = null;

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

function setLoading(on) {
  scrapeBtn.disabled = on;
}

// Listen for messages coming back from the content script
_browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'progress') {
    setStatus(msg.text);
  } else if (msg.action === 'done') {
    setLoading(false);
    pendingResult = {
      post_url: msg.postUrl,
      scraped_at: new Date().toISOString(),
      total_unique_commenters: msg.commenters.length,
      commenters: msg.commenters,
    };
    setStatus(`${msg.commenters.length} farklı kullanıcı bulundu.`, 'success');
    countEl.textContent = '';
    downloadBtn.style.display = 'block';
    document.getElementById('real-names-label').style.display = 'block';
  } else if (msg.action === 'error') {
    setLoading(false);
    setStatus(msg.text, 'error');
  }
});

scrapeBtn.addEventListener('click', async () => {
  const [tab] = await _browser.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.match(/instagram\.com\/(p|reel)\//)) {
    setStatus('Navigate to an Instagram post or reel first.', 'error');
    return;
  }

  pendingResult = null;
  downloadBtn.style.display = 'none';
  countEl.textContent = '';
  document.getElementById('real-names-label').style.display = 'none';
  setLoading(true);
  setStatus('Injecting scraper...');

  // Inject content script if not already present, then trigger scrape
  try {
    await _browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch {
    // Already injected — that's fine
  }

  _browser.tabs.sendMessage(tab.id, { action: 'scrape', includeRealNames: realNamesTggl.checked });
  setStatus('Yorumlar yükleniyor...');
});

function toReadableJSON(data) {
  return JSON.stringify(data, null, 2)
    // Recombine UTF-16 surrogate pairs (covers emoji, decorative bold Unicode, etc.)
    .replace(/\\uD([89ABab][0-9A-Fa-f]{2})\\uD([C-Fc-f][0-9A-Fa-f]{2})/g, (_, hi, lo) =>
      String.fromCodePoint(
        0x10000 + ((parseInt('D' + hi, 16) - 0xD800) << 10) + (parseInt('D' + lo, 16) - 0xDC00)
      )
    )
    // Unescape remaining BMP non-ASCII sequences (Turkish letters, etc.)
    .replace(/\\u([0-9A-Fa-f]{4})/g, (match, hex) => {
      const code = parseInt(hex, 16);
      if (code < 0x20 || code === 0x22 || code === 0x5C) return match;
      return String.fromCharCode(code);
    });
}

downloadBtn.addEventListener('click', () => {
  if (!pendingResult) return;

  const json = toReadableJSON(pendingResult);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `ig_commenters_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
