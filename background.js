chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error(err));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PROCESS_TEXT') {
    handleIncomingText(request.text, request.track_id).then(res => sendResponse(res));
    return true;
  }
});

async function addLog(text, type = 'info') {
  const { logs = [] } = await chrome.storage.local.get('logs');
  logs.unshift({ text, type, time: new Date().toLocaleTimeString() });
  if (logs.length > 30) logs.pop();
  await chrome.storage.local.set({ logs });
}

// Automatic Synonym Clusters
const ROLE_CLUSTERS = {
  sde: [
    'sde', 'sde1', 'sde2', 'sde3', 'swe', 'software engineer', 'software developer', 
    'developer', 'full stack developer', 'full stack', 'associate engineer', 
    'graduate engineer trainee', 'get', 'backend', 'frontend', 'programmer'
  ],
  analyst: [
    'analyst', 'data analyst', 'business analyst', 'bi analyst', 'data scientist', 
    'data engineer', 'bi ', 'analytics', 'decision scientist'
  ],
  creator: [
    'content creator', 'creator', 'video editor', 'graphic designer', 'media',
    'creative associate', 'copywriter', 'social media'
  ],
  product: [
    'product manager', 'associate product manager', 'apm', 'product analyst', 'pm'
  ]
};

function expandTargetKeywords(userRoles) {
  const expanded = new Set();
  userRoles.forEach(r => {
    const cleanRole = r.toLowerCase().trim();
    expanded.add(cleanRole);
    for (const [key, cluster] of Object.entries(ROLE_CLUSTERS)) {
      if (cluster.some(alias => alias.includes(cleanRole) || cleanRole.includes(alias))) {
        cluster.forEach(alias => expanded.add(alias));
      }
    }
  });
  return Array.from(expanded);
}

function parsePlacementMessage(raw) {
  const clean = raw.replace(/\*/g, '').trim();

  // 1. Extract Links (Separate Apply Forms from WhatsApp Groups)
  const allUrls = clean.match(/https?:\/\/[^\s\)\>\]]+/gi) || [];
  let apply_url = null;
  let group_url = null;

  for (const url of allUrls) {
    if (url.includes('chat.whatsapp.com')) {
      if (!group_url) group_url = url;
    } else {
      if (!apply_url) apply_url = url;
    }
  }

  // 2. Extract Company Name
  let company_name = 'Campus Placement';
  const companyMatch = clean.match(/(?:company|firm|organization|drive for|hiring at|recruiter)\s*[:\-–]\s*([^\n\r,]+)/i) ||
                       clean.match(/(?:drive|campus hiring)\s*[:\-–]?\s*([A-Za-z0-9\s&]+)/i);
  if (companyMatch) {
    company_name = companyMatch[1].trim();
  } else {
    const firstLine = clean.split('\n')[0].trim();
    if (firstLine.length > 2 && firstLine.length < 45 && !firstLine.includes(':')) {
      company_name = firstLine.split('|')[0].replace(/FTE|Drive|Hiring|Campus|Batch|\d{4}/gi, '').trim() || firstLine;
    }
  }

  // 3. Extract Role
  let job_role = '';
  const roleMatch = clean.match(/(?:job role|role|position|profile|designation|hiring for)\s*[:\-–]\s*([^\n\r,]+)/i);
  if (roleMatch) {
    job_role = roleMatch[1].trim();
  } else {
    const standardKeywords = [
      'Content Creator', 'Video Editor', 'Creator', 'Media', 'Graphic Designer',
      'Data Analyst', 'Business Analyst', 'Analyst', 'BI Developer', 'BI Analyst', 
      'Software Engineer', 'Software Developer', 'Associate Engineer', 'SDE3', 'SDE2', 'SDE1', 'SDE', 
      'Graduate Engineer Trainee', 'GET', 'Developer', 'Consultant', 'Associate', 'Intern', 'Data Scientist', 'Product Manager'
    ];
    for (const kw of standardKeywords) {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(clean)) {
        job_role = kw;
        break;
      }
    }
  }

  // 4. Extract CTC
  let ctc = '';
  const ctcMatch = clean.match(/(?:ctc|package|stipend|salary|compensation)\s*[:\-–]\s*([^\n\r,]+)/i);
  if (ctcMatch) {
    ctc = ctcMatch[1].trim();
  }

  // 5. Extract Multi-Portal / Application Instructions (e.g. "Apply through new RM only")
  let portal_instruction = '';
  const portalMatch = clean.match(/(?:apply(?: through| on| via| at)?|registration(?: on| via| link| at)?|portal|mode of application)\s*[:\-–]?\s*([^\n\r]+)/i);
  if (portalMatch) {
    const val = portalMatch[0].trim();
    // Don't duplicate if it's just a raw URL
    if (!val.startsWith('http') && val.length < 80) {
      portal_instruction = val;
    }
  }

  // 6. Extract Eligibility & Backlog criteria
  let eligibility = 'All eligible';
  const eligMatch = clean.match(/(?:eligibility|criteria|branches|qualification|batch)\s*[:\-–]\s*([^\n\r]+)/i);
  const backlogMatch = clean.match(/(?:no backlogs allowed|backlogs?|cgpa\s*[:\-–]?\s*\d+(?:\.\d+)?)/i);
  
  if (eligMatch) {
    eligibility = eligMatch[1].trim();
    if (backlogMatch && !eligibility.toLowerCase().includes('backlog')) {
      eligibility += ` • ${backlogMatch[0].trim()}`;
    }
  } else if (backlogMatch) {
    eligibility = backlogMatch[0].trim();
  }

  // 7. Extract Deadline
  let deadlineLine = clean;
  const deadlineMatch = clean.match(/(?:deadline|last date|apply before|closes by|due date|form closes|end date)\s*[:\-–]?\s*([^\n\r]+(?:\n[^\n\r]+)?)/i);
  if (deadlineMatch) {
    deadlineLine = deadlineMatch[1];
  }

  const deadline_iso = parseStrictDeadline(deadlineLine);
  const is_job_opening = Boolean((roleMatch || job_role) && (apply_url || portal_instruction || deadline_iso));

  return {
    is_job_opening,
    company_name,
    job_role: job_role || 'General Role',
    ctc,
    portal_instruction,
    eligibility,
    apply_url,
    group_url,
    deadline_iso
  };
}

function parseStrictDeadline(str) {
  const year = 2026;
  const months = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  let hours = 23, minutes = 59;
  const time12 = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const time24 = str.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);

  if (time12) {
    let h = parseInt(time12[1], 10);
    const m = time12[2] ? parseInt(time12[2], 10) : 0;
    const meridian = time12[3].toLowerCase();

    if (meridian === 'pm' && h < 12) h += 12;
    if (meridian === 'am' && h === 12) h = 0;
    hours = h;
    minutes = m;
  } else if (time24) {
    hours = parseInt(time24[1], 10);
    minutes = parseInt(time24[2], 10);
  }

  const textDate = str.match(/(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]+)(?:\s*(\d{4}))?/i);
  if (textDate) {
    const d = parseInt(textDate[1], 10);
    const mStr = textDate[2].toLowerCase();
    const y = textDate[3] ? parseInt(textDate[3], 10) : year;

    if (months[mStr] !== undefined) {
      const target = new Date(y, months[mStr], d, hours, minutes, 0);
      return !isNaN(target.getTime()) ? target.toISOString() : null;
    }
  }

  const numDate = str.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  if (numDate) {
    const d = parseInt(numDate[1], 10);
    const m = parseInt(numDate[2], 10) - 1;
    const y = numDate[3] ? (numDate[3].length === 2 ? 2000 + parseInt(numDate[3], 10) : parseInt(numDate[3], 10)) : year;
    const target = new Date(y, m, d, hours, minutes, 0);
    return !isNaN(target.getTime()) ? target.toISOString() : null;
  }

  return null;
}

async function handleIncomingText(rawText, trackId) {
  const { userRoles = [], trackedJobs = [] } = await chrome.storage.local.get(['userRoles', 'trackedJobs']);

  if (!userRoles.length) {
    await addLog('No roles configured. Set them in panel.', 'error');
    return { success: false, reason: 'No Roles Set' };
  }

  const job = parsePlacementMessage(rawText);
  if (!job.is_job_opening) {
    await addLog('Skipped: Not a placement post.', 'info');
    return { success: false, reason: 'Not a placement message' };
  }

const activeKeywordFamily = expandTargetKeywords(userRoles);
const cleanJobRole = (job.job_role || '').toLowerCase();

const isMatch = activeKeywordFamily.some(alias => {
  const regex = new RegExp(`\\b${alias}\\b`, 'i');
  return regex.test(cleanJobRole);
});

if (!isMatch) {
  await addLog(`Skipped: "${job.company_name}" (${job.job_role}) does not match [${userRoles.join(', ')}]`, 'warn');
  return { success: false, reason: 'Role mismatch' };
}

  const isDup = trackedJobs.some(
    j => j.company_name.toLowerCase() === job.company_name.toLowerCase() &&
         j.job_role.toLowerCase() === job.job_role.toLowerCase()
  );
  if (isDup) {
    await addLog(`Skipped: Duplicate for ${job.company_name}`, 'info');
    return { success: false, reason: 'Duplicate' };
  }

  let deadlineMs = job.deadline_iso ? new Date(job.deadline_iso).getTime() : null;
  if (!deadlineMs || isNaN(deadlineMs)) {
    const fallbackDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    job.deadline_iso = fallbackDate.toISOString();
    deadlineMs = fallbackDate.getTime();
  }

  const msRemaining = deadlineMs - Date.now();
  if (msRemaining <= 0) {
    await addLog(`Skipped: Expired deadline (${new Date(deadlineMs).toLocaleTimeString()})`, 'warn');
    return { success: false, reason: 'Deadline expired' };
  }

  const record = {
    id: `job_${Date.now()}`,
    dom_id: trackId,
    company_name: job.company_name,
    job_role: job.job_role,
    ctc: job.ctc,
    portal_instruction: job.portal_instruction,
    eligibility: job.eligibility,
    apply_url: job.apply_url,
    group_url: job.group_url,
    deadline_iso: job.deadline_iso,
    raw_snippet: rawText.slice(0, 50).trim()
  };

  trackedJobs.push(record);
  trackedJobs.sort((a, b) => new Date(a.deadline_iso) - new Date(b.deadline_iso));
  await chrome.storage.local.set({ trackedJobs });

  const minsLeft = Math.ceil(msRemaining / (60 * 1000));
  await addLog(`🎉 Added: ${record.company_name} (${record.job_role}) - ${minsLeft}m left`, 'success');

  chrome.notifications.create(`alert_${record.id}`, {
    type: 'basic',
    iconUrl: 'icon.png',
    title: `🚨 ${record.company_name} - ${record.job_role} ${record.ctc ? `(${record.ctc})` : ''}`,
    message: `${record.portal_instruction ? `📌 ${record.portal_instruction}\n` : ''}Deadline: ${new Date(record.deadline_iso).toLocaleTimeString()}`,
    priority: 2
  });

  return { success: true, job: record };
}