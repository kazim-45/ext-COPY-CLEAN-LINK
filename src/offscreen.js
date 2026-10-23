// Offscreen document: the only way a service worker can write to the clipboard.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'copy') return;
  const buf = document.getElementById('buf');
  buf.value = String(msg.text);
  buf.focus();
  buf.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  buf.value = '';
  sendResponse({ ok });
});
