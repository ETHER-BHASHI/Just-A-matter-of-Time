document.addEventListener('DOMContentLoaded', async () => {
  const { userRoles = [] } = await chrome.storage.local.get('userRoles');
  if (userRoles.length) document.getElementById('roles').value = userRoles.join(', ');
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const rawRoles = document.getElementById('roles').value;
  const userRoles = rawRoles.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);

  await chrome.storage.local.set({ userRoles });
  
  const status = document.getElementById('statusMsg');
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 2000);
});