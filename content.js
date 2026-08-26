let seenHashes = new Set();

function getHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return 'msg_' + Math.abs(hash);
}

function processMessageNode(node) {
  const text = node.innerText ? node.innerText.trim() : '';
  if (!text || text.length < 15) return;

  const msgId = getHash(text);
  const container = node.closest('div.message-in, div.message-out, div[role="row"], div[data-testid="msg-container"]') || node;
  container.setAttribute('data-track-id', msgId);

  if (seenHashes.has(msgId)) return;
  seenHashes.add(msgId);

  chrome.runtime.sendMessage({ 
    type: 'PROCESS_TEXT', 
    text: text,
    track_id: msgId 
  });
}

function scanDOM() {
  const bubbles = document.querySelectorAll('div.copyable-text, [data-pre-plain-text], span.selectable-text');
  bubbles.forEach(b => processMessageNode(b));
}

// 4-Tier Jump & Scroll Message Handler
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === 'RESCAN_CHAT') {
    seenHashes.clear();
    scanDOM();
    sendResponse({ status: 'rescanned' });
    return;
  }

  if (req.type === 'SCROLL_TO_MESSAGE') {
    const comp = (req.company || '').toLowerCase().trim();
    const role = (req.role || '').toLowerCase().trim();
    const snip = (req.snippet || '').toLowerCase().trim();
    const trackId = req.track_id;

    let target = null;

    // Tier 1: Exact data-track-id match
    if (trackId) {
      target = document.querySelector(`[data-track-id="${trackId}"]`);
    }

    // Tier 2: Search all message bubble containers by text snippet
    const allBubbles = Array.from(document.querySelectorAll('div.message-in, div.message-out, div.copyable-text, [data-testid="msg-container"], div[role="row"]'));

    if (!target && snip) {
      target = allBubbles.reverse().find(el => (el.innerText || '').toLowerCase().includes(snip));
    }

    // Tier 3: Search by Company + Role tokens
    if (!target && comp) {
      const roleWords = role.split(/\s+/).filter(w => w.length > 2);
      target = allBubbles.reverse().find(el => {
        const txt = (el.innerText || '').toLowerCase();
        const hasComp = txt.includes(comp);
        const hasRole = roleWords.length === 0 || roleWords.some(w => txt.includes(w));
        return hasComp && hasRole;
      });
    }

    // Tier 4: Search all raw selectable text spans
    if (!target && comp) {
      const spans = Array.from(document.querySelectorAll('span.selectable-text, div.copyable-text'));
      const matchSpan = spans.reverse().find(s => (s.innerText || '').toLowerCase().includes(comp));
      if (matchSpan) {
        target = matchSpan.closest('div.message-in, div.message-out, div.copyable-text, div[role="row"]') || matchSpan;
      }
    }

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Pulsing Green Border & Background Flash
      target.style.transition = 'all 0.3s ease';
      target.style.boxShadow = '0 0 0 4px #00a884, 0 8px 24px rgba(0, 168, 132, 0.6)';
      target.style.backgroundColor = 'rgba(0, 168, 132, 0.18)';
      target.style.borderRadius = '8px';

      setTimeout(() => {
        target.style.boxShadow = '';
        target.style.backgroundColor = '';
      }, 2200);

      sendResponse({ status: 'found' });
    } else {
      console.warn('Placement Tracker: Message not visible in current DOM buffer.');
      sendResponse({ status: 'not_found' });
    }
    return true;
  }
});

const observer = new MutationObserver(() => scanDOM());

function init() {
  const app = document.querySelector('#app') || document.body;
  if (app) {
    observer.observe(app, { childList: true, subtree: true });
    scanDOM();
    document.addEventListener('click', () => setTimeout(scanDOM, 400));
  } else {
    setTimeout(init, 1500);
  }
}

init();