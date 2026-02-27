// State
let currentUser = null;
let allListings = [];
let currentFilter = 'all';
let editingId = null;

// Init
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadListings();
});

// Auth
async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      document.getElementById('navLoggedOut').classList.add('hide');
      document.getElementById('navLoggedIn').classList.add('show');
      document.getElementById('navUsername').textContent = currentUser.username;
      if (currentUser.avatarUrl) {
        document.getElementById('navAvatar').src = currentUser.avatarUrl;
      }
    }
  } catch (e) {
    // Not logged in
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  document.getElementById('navLoggedOut').classList.remove('hide');
  document.getElementById('navLoggedIn').classList.remove('show');
  toast('logged out');
  loadListings(); // Re-render to remove edit/delete controls
}

// Listings
async function loadListings() {
  try {
    const url = currentFilter === 'all' ? '/api/listings' : `/api/listings?type=${currentFilter}`;
    const res = await fetch(url);
    if (res.ok) {
      allListings = await res.json();
      render();
    }
  } catch (e) {
    document.getElementById('grid').innerHTML = '<div class="grid-loading">failed to load listings</div>';
  }
}

function render() {
  const grid = document.getElementById('grid');
  if (allListings.length === 0) {
    grid.innerHTML = '<div class="grid-loading">no listings yet — be the first to post</div>';
    return;
  }
  grid.innerHTML = allListings.map((item, idx) => {
    const isMine = currentUser && item.userId === currentUser.id;
    const faceVal = item.faceValue ? `$${(item.faceValue / 100).toLocaleString()}` : '';
    const askVal = `$${(item.askingPrice / 100).toLocaleString()}`;
    const initials = (item.username || '??').slice(0, 2).toUpperCase();

    return `
      <div class="card" data-type="${item.type}" style="animation-delay: ${idx * 0.04}s">
        <div class="card-top">
          <span class="card-type ${item.type === 'selling' ? 'card-type--sell' : 'card-type--buy'}">${item.type}</span>
          <span class="card-provider">${esc(item.provider)}</span>
        </div>
        <div class="card-title">${esc(item.title)}</div>
        <div class="card-desc">${esc(item.description || '')}</div>
        <div class="card-meta">
          ${item.creditType ? `<span class="card-chip">${esc(item.creditType)}</span>` : ''}
          ${faceVal ? `<span class="card-chip">face: ${faceVal}</span>` : ''}
        </div>
        <div class="card-bottom">
          <div class="card-price">${askVal}<span class="label">${item.type === 'selling' ? 'ask' : 'budget'}</span></div>
          <div class="card-user">
            ${item.avatarUrl
              ? `<img class="card-av" src="${esc(item.avatarUrl)}" style="border-radius:50%" width="26" height="26">`
              : `<div class="card-av">${initials}</div>`
            }
            <span class="card-uname">${esc(item.username || 'anon')}</span>
            <button class="card-msg" onclick="event.stopPropagation();revealContact('${item.id}')">contact</button>
          </div>
        </div>
        <div class="card-contact" id="contact-${item.id}">${esc(item.contactInfo || '')}</div>
        ${isMine ? `
          <div class="card-own-controls">
            <button class="card-own-btn card-own-btn--edit" onclick="event.stopPropagation();editListing('${item.id}')">edit</button>
            <button class="card-own-btn card-own-btn--del" onclick="event.stopPropagation();deleteListing('${item.id}')">delete</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function revealContact(id) {
  const el = document.getElementById('contact-' + id);
  if (el) el.classList.toggle('show');
}

function fil(type, btn) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  btn.classList.add('on');
  currentFilter = type;
  loadListings();
}

function showMyListings() {
  // Filter to only show current user's listings
  if (!currentUser) return;
  const mine = allListings.filter(l => l.userId === currentUser.id);
  const grid = document.getElementById('grid');
  if (mine.length === 0) {
    grid.innerHTML = '<div class="grid-loading">you have no listings yet</div>';
    return;
  }
  // Temporarily swap allListings for render
  const saved = allListings;
  allListings = mine;
  render();
  allListings = saved;

  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  scrollToFeed();
}

// CRUD
function parseCents(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[$,]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100);
}

async function submitListing() {
  if (!currentUser) {
    toast('log in first', true);
    return;
  }

  const body = {
    type: document.getElementById('postType').value,
    provider: document.getElementById('postProvider').value,
    title: document.getElementById('postTitle').value,
    faceValue: parseCents(document.getElementById('postFaceValue').value),
    askingPrice: parseCents(document.getElementById('postAskingPrice').value),
    creditType: document.getElementById('postCreditType').value,
    description: document.getElementById('postDescription').value,
    proofLink: document.getElementById('postProofLink').value,
    contactInfo: document.getElementById('postContactInfo').value,
  };

  if (!body.title || !body.askingPrice || !body.contactInfo) {
    toast('fill in title, price, and contact info', true);
    return;
  }

  try {
    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `/api/listings/${editingId}` : '/api/listings';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      closeMo('postMo');
      clearForm();
      editingId = null;
      toast(editingId ? 'listing updated' : 'listing posted');
      loadListings();
    } else {
      const err = await res.json();
      toast(err.error || 'failed to post', true);
    }
  } catch (e) {
    toast('network error', true);
  }
}

function editListing(id) {
  const item = allListings.find(l => l.id === id);
  if (!item) return;

  editingId = id;
  document.getElementById('postMoTitle').textContent = 'Edit listing';
  document.getElementById('postType').value = item.type;
  document.getElementById('postProvider').value = item.provider;
  document.getElementById('postTitle').value = item.title;
  document.getElementById('postFaceValue').value = item.faceValue ? (item.faceValue / 100).toString() : '';
  document.getElementById('postAskingPrice').value = (item.askingPrice / 100).toString();
  document.getElementById('postCreditType').value = item.creditType;
  document.getElementById('postDescription').value = item.description || '';
  document.getElementById('postProofLink').value = item.proofLink || '';
  document.getElementById('postContactInfo').value = item.contactInfo || '';
  openMo('postMo');
}

async function deleteListing(id) {
  if (!confirm('delete this listing?')) return;
  try {
    const res = await fetch(`/api/listings/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast('listing deleted');
      loadListings();
    } else {
      toast('failed to delete', true);
    }
  } catch (e) {
    toast('network error', true);
  }
}

function clearForm() {
  document.getElementById('postType').value = 'selling';
  document.getElementById('postProvider').value = 'OpenAI';
  document.getElementById('postTitle').value = '';
  document.getElementById('postFaceValue').value = '';
  document.getElementById('postAskingPrice').value = '';
  document.getElementById('postCreditType').value = 'redemption code';
  document.getElementById('postDescription').value = '';
  document.getElementById('postProofLink').value = '';
  document.getElementById('postContactInfo').value = '';
  document.getElementById('postMoTitle').textContent = 'New listing';
  editingId = null;
}

// Modal
function openMo(id) { document.getElementById(id).classList.add('open'); }
function closeMo(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'postMo') clearForm();
}

// Toast
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => { t.className = 'toast'; }, 2500);
}

// Scroll
function scrollToFeed() {
  document.getElementById('feed').scrollIntoView({ behavior: 'smooth' });
}
