let jobs = [];

function getRemainingTime(isoDate) {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return { text: "CLOSED", isUrgent: false, isClosed: true };

  const pad = (n) => String(n).padStart(2, '0');

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  let timeString = '';
  if (days > 0) {
    timeString = `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
  } else {
    timeString = `${hours}h ${pad(mins)}m ${pad(secs)}s`;
  }

  return {
    text: timeString,
    isUrgent: diff <= 30 * 60 * 1000,
    isWarning: diff <= 2 * 60 * 60 * 1000 && diff > 30 * 60 * 1000,
    isClosed: false
  };
}

function renderCards() {
  const list = document.getElementById('jobList');
  const empty = document.getElementById('emptyMsg');
  const count = document.getElementById('activeCount');

  list.innerHTML = '';
  count.textContent = jobs.length;
  empty.style.display = jobs.length === 0 ? 'block' : 'none';

  jobs.forEach(job => {
    const time = getRemainingTime(job.deadline_iso);
    const card = document.createElement('div');
    card.className = `card ${time.isUrgent ? 'urgent' : time.isWarning ? 'warning' : 'normal'}`;
    card.setAttribute('data-id', job.id);

    card.innerHTML = `
      <div class="card-top">
        <span class="company">${job.company_name}</span>
        ${job.ctc ? `<span class="badge-ctc">💰 ${job.ctc}</span>` : ''}
      </div>
      <div class="role">${job.job_role}</div>
      <div class="eligibility">🎯 ${job.eligibility}</div>
      
      ${job.portal_instruction ? `
        <div class="portal-instruction-banner">
          <span>📌</span>
          <span>${job.portal_instruction}</span>
        </div>
      ` : ''}

      <div class="timer-box">
        <span class="timer-label">Closing in:</span>
        <span class="timer-val" style="color: ${time.isUrgent ? '#ef4444' : '#0f172a'}" id="timer_${job.id}">${time.text}</span>
      </div>

      <div class="card-actions">
        ${!time.isClosed && job.apply_url ? `<a href="${job.apply_url}" target="_blank" class="btn-apply">Apply Form</a>` : ''}
        ${job.group_url ? `<a href="${job.group_url}" target="_blank" class="btn-group">📢 Group</a>` : ''}
        <button class="btn-dismiss" data-id="${job.id}">Dismiss</button>
      </div>
    `;

    // 1-Click Jump to Message in WhatsApp
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-apply') || e.target.closest('.btn-group') || e.target.closest('.btn-dismiss')) {
        return;
      }

      const tabs = await chrome.tabs.query({});
      const waTab = tabs.find(t => t.url && t.url.includes('web.whatsapp.com'));
      
      if (waTab?.id) {
        await chrome.tabs.update(waTab.id, { active: true });
        if (waTab.windowId) {
          await chrome.windows.update(waTab.windowId, { focused: true });
        }

        chrome.tabs.sendMessage(waTab.id, {
          type: 'SCROLL_TO_MESSAGE',
          track_id: job.dom_id,
          snippet: job.raw_snippet,
          company: job.company_name,
          role: job.job_role
        });
      }
    });

    list.appendChild(card);
  });

  document.querySelectorAll('.btn-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-id');
      const targetJob = jobs.find(j => j.id === id);
      const jobLabel = targetJob ? `${targetJob.company_name} (${targetJob.job_role})` : 'this opening';

      const confirmed = window.confirm(`Are you sure you want to dismiss ${jobLabel}?`);
      if (!confirmed) return;

      jobs = jobs.filter(j => j.id !== id);
      await chrome.storage.local.set({ trackedJobs: jobs });
      renderCards();
    });
  });
}

function renderLogs(logs = []) {
  const container = document.getElementById('logContainer');
  container.innerHTML = logs.map(l => `<div class="log-entry ${l.type}">[${l.time}] ${l.text}</div>`).join('');
}

function updateTimers() {
  jobs.forEach(job => {
    const el = document.getElementById(`timer_${job.id}`);
    if (el) {
      const time = getRemainingTime(job.deadline_iso);
      el.textContent = time.text;
      el.style.color = time.isUrgent ? '#ef4444' : '#0f172a';
    }
  });
}

async function init() {
  const data = await chrome.storage.local.get(['trackedJobs', 'logs', 'userRoles']);
  jobs = data.trackedJobs || [];
  
  if (data.userRoles && data.userRoles.length > 0) {
    document.getElementById('roleInput').value = data.userRoles.join(', ');
  }

  renderCards();
  renderLogs(data.logs || []);
  setInterval(updateTimers, 1000);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.trackedJobs) {
      jobs = changes.trackedJobs.newValue || [];
      renderCards();
    }
    if (changes.logs) {
      renderLogs(changes.logs.newValue || []);
    }
  });

  document.getElementById('btnSaveRoles').addEventListener('click', async () => {
    const raw = document.getElementById('roleInput').value;
    const userRoles = raw.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
    await chrome.storage.local.set({ userRoles });

    // Instantly purge cards in storage that do not match the updated keywords
    const { trackedJobs = [] } = await chrome.storage.local.get('trackedJobs');
    const filteredJobs = trackedJobs.filter(job => {
      const role = (job.job_role || '').toLowerCase();
      return userRoles.some(r => role.includes(r) || r.includes(role));
    });

    jobs = filteredJobs;
    await chrome.storage.local.set({ trackedJobs: filteredJobs });
    renderCards();

    const confirmEl = document.getElementById('saveConfirm');
    confirmEl.style.display = 'block';
    setTimeout(() => { confirmEl.style.display = 'none'; }, 2000);

    const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'RESCAN_CHAT' });
    }
  });
}

document.addEventListener('DOMContentLoaded', init);