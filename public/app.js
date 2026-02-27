// State
let currentUser = null;
let allListings = [];
let currentFilter = 'all';
let editingId = null;
let searchQuery = '';
let providerFilter = '';

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

function getFiltered() {
  const q = searchQuery.toLowerCase();
  return allListings.filter(item => {
    const matchesProvider = !providerFilter || item.provider === providerFilter;
    const matchesSearch = !q ||
      item.title.toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q) ||
      item.provider.toLowerCase().includes(q) ||
      (item.creditType || '').toLowerCase().includes(q);
    return matchesProvider && matchesSearch;
  });
}

function render() {
  const grid = document.getElementById('grid');
  const listings = getFiltered();
  if (allListings.length === 0) {
    grid.innerHTML = '<div class="grid-loading">no listings yet — be the first to post</div>';
    return;
  }
  if (listings.length === 0) {
    grid.innerHTML = '<div class="grid-loading">no results</div>';
    return;
  }
  grid.innerHTML = listings.map((item, idx) => {
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
            <button class="card-msg" onclick="event.stopPropagation();openChat('${item.id}','${item.userId}')">contact</button>
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

function setSearch(val) {
  searchQuery = val.toLowerCase();
  render();
}

function setProvider(p, btn) {
  if (providerFilter === p) {
    providerFilter = '';
    btn.classList.remove('on');
  } else {
    providerFilter = p;
    document.querySelectorAll('.pill-provider').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }
  render();
}

function fil(type, btn) {
  document.querySelectorAll('.pill:not(.pill-provider)').forEach(p => p.classList.remove('on'));
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
  document.getElementById('feed').scrollIntoView({ behavior: 'smooth' });
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

// Chat state
let chatListingId = null;
let chatBuyerId = null;
let chatPollTimer = null;
let chatLastTimestamp = null;
let chatListingData = null;
let chatOtherUser = null;

function openChat(listingId, listingOwnerId) {
  if (!currentUser) { toast('log in to chat', true); return; }
  if (currentUser.id === listingOwnerId) {
    toast('check messages for buyer chats', true);
    return;
  }
  chatListingId = listingId;
  chatBuyerId = currentUser.id;
  chatLastTimestamp = null;
  chatListingData = allListings.find(l => l.id === listingId) || null;
  chatOtherUser = null;
  document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">loading...</div>';
  document.getElementById('chatInput').value = '';
  renderChatSidebar();
  openMo('chatMo');
  loadChatMessages(false);
  chatPollTimer = setInterval(() => loadChatMessages(true), 3000);
}

function openChatAs(listingId, buyerId) {
  chatListingId = listingId;
  chatBuyerId = buyerId;
  chatLastTimestamp = null;
  chatListingData = allListings.find(l => l.id === listingId) || null;
  chatOtherUser = null;
  document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">loading...</div>';
  document.getElementById('chatInput').value = '';
  renderChatSidebar();
  closeMo('convListMo');
  openMo('chatMo');
  loadChatMessages(false);
  chatPollTimer = setInterval(() => loadChatMessages(true), 3000);
}

function closeChatMo() {
  closeMo('chatMo');
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  chatListingId = null;
  chatBuyerId = null;
  chatLastTimestamp = null;
  chatListingData = null;
  chatOtherUser = null;
}

async function loadChatMessages(pollOnly) {
  if (!chatListingId || !chatBuyerId) return;
  try {
    let url = `/api/chat/${chatListingId}/messages?buyerId=${chatBuyerId}`;
    if (pollOnly && chatLastTimestamp) url += `&after=${encodeURIComponent(chatLastTimestamp)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    const container = document.getElementById('chatMessages');

    if (!pollOnly) {
      document.getElementById('chatMoTitle').textContent = data.listing?.title || 'chat';
      chatOtherUser = data.otherUser || null;
      if (!chatListingData && data.listing) chatListingData = data.listing;
      renderChatSidebar();
      if (data.messages.length === 0) {
        container.innerHTML = '<div class="chat-empty">no messages yet — say hi!</div>';
      } else {
        container.innerHTML = data.messages.map(m => chatMsgHtml(m)).join('');
      }
    } else {
      if (data.messages.length === 0) return;
      // Deduplicate: skip IDs already in DOM
      const rendered = new Set([...container.querySelectorAll('[data-id]')].map(el => el.dataset.id));
      const fresh = data.messages.filter(m => !rendered.has(m.id));
      if (fresh.length === 0) {
        chatLastTimestamp = data.messages[data.messages.length - 1].createdAt;
        return;
      }
      const emptyEl = container.querySelector('.chat-empty');
      if (emptyEl) emptyEl.remove();
      container.insertAdjacentHTML('beforeend', fresh.map(m => chatMsgHtml(m)).join(''));
    }

    if (data.messages.length > 0) {
      chatLastTimestamp = data.messages[data.messages.length - 1].createdAt;
    }
    container.scrollTop = container.scrollHeight;
  } catch (e) {
    // Silently fail on poll errors
  }
}

function chatMsgHtml(m) {
  const isOwn = currentUser && m.senderId === currentUser.id;
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div class="chat-msg ${isOwn ? 'chat-msg--own' : ''}" data-id="${m.id}">${esc(m.body)}<div class="chat-msg-meta">${time}</div></div>`;
}

async function sendChatMsg() {
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!body || !chatListingId) return;
  input.value = '';
  try {
    const payload = { body };
    if (currentUser && currentUser.id !== chatBuyerId) {
      payload.buyerId = chatBuyerId;
    }
    const res = await fetch(`/api/chat/${chatListingId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const msg = await res.json();
      const container = document.getElementById('chatMessages');
      if (!container.querySelector(`[data-id="${msg.id}"]`)) {
        const emptyEl = container.querySelector('.chat-empty');
        if (emptyEl) emptyEl.remove();
        container.insertAdjacentHTML('beforeend', chatMsgHtml(msg));
      }
      chatLastTimestamp = msg.createdAt;
      container.scrollTop = container.scrollHeight;
    } else {
      const err = await res.json();
      toast(err.error || 'failed to send', true);
    }
  } catch (e) {
    toast('network error', true);
  }
}

function renderChatSidebar() {
  const sidebar = document.getElementById('chatSidebar');
  if (!sidebar) return;
  const l = chatListingData;
  const other = chatOtherUser;
  const faceVal = l?.faceValue ? `$${(l.faceValue / 100).toLocaleString()}` : null;
  const askVal = l?.askingPrice ? `$${(l.askingPrice / 100).toLocaleString()}` : null;
  const otherListings = l ? allListings.filter(x => x.userId === l.userId && x.id !== l.id).slice(0, 3) : [];

  sidebar.innerHTML = `
    <div class="cs-section">
      <div class="cs-label">counterparty</div>
      ${other
        ? `<div class="cs-user">
            ${other.avatarUrl ? `<img class="cs-av" src="${esc(other.avatarUrl)}">` : `<div class="cs-av cs-av--init">${(other.username||'??').slice(0,2).toUpperCase()}</div>`}
            <div class="cs-username">${esc(other.username || 'unknown')}</div>
           </div>`
        : `<div class="cs-dim">loading...</div>`}
    </div>
    ${l ? `
      <div class="cs-section">
        <div class="cs-label">this listing</div>
        <div class="cs-listing-title">${esc(l.title || '')}</div>
        <div class="cs-tags">
          ${l.provider ? `<span class="cs-tag">${esc(l.provider)}</span>` : ''}
          ${l.creditType ? `<span class="cs-tag">${esc(l.creditType)}</span>` : ''}
        </div>
        <div class="cs-prices">
          ${faceVal ? `<div class="cs-price-row"><span class="cs-dim">face</span><span>${faceVal}</span></div>` : ''}
          ${askVal ? `<div class="cs-price-row"><span class="cs-dim">ask</span><span class="cs-neon">${askVal}</span></div>` : ''}
        </div>
        ${l.description ? `<div class="cs-desc">${esc(l.description)}</div>` : ''}
        ${l.proofLink ? `<div class="cs-row"><span class="cs-dim">proof</span><a href="${esc(l.proofLink)}" target="_blank" rel="noopener" class="cs-link">view ↗</a></div>` : ''}
        ${l.contactInfo ? `<div class="cs-row"><span class="cs-dim">contact</span><span class="cs-neon-text">${esc(l.contactInfo)}</span></div>` : ''}
      </div>
    ` : ''}
    ${otherListings.length > 0 ? `
      <div class="cs-section">
        <div class="cs-label">their other listings</div>
        ${otherListings.map(x => `
          <div class="cs-other" onclick="closeChatMo();setTimeout(()=>openChat('${x.id}','${x.userId}'),150)">
            <span class="cs-tag cs-tag--${x.type === 'selling' ? 'sell' : 'buy'}">${x.type}</span>
            <span class="cs-other-title">${esc(x.title)}</span>
            <span class="cs-other-price">$${(x.askingPrice/100).toLocaleString()}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

async function openConversations() {
  if (!currentUser) { toast('log in first', true); return; }
  openMo('convListMo');
  const container = document.getElementById('convList');
  container.innerHTML = '<div class="grid-loading">loading...</div>';
  try {
    const res = await fetch('/api/chat/conversations');
    if (!res.ok) { container.innerHTML = '<div class="grid-loading">failed to load</div>'; return; }
    const convos = await res.json();
    if (convos.length === 0) {
      container.innerHTML = '<div class="grid-loading">no conversations yet</div>';
      return;
    }
    container.innerHTML = convos.map(c => {
      const timeStr = new Date(c.lastAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
      const initials = (c.otherUsername || '??').slice(0, 2).toUpperCase();
      const avHtml = c.otherAvatarUrl
        ? `<img src="${esc(c.otherAvatarUrl)}">`
        : initials;
      return `<div class="conv-item" onclick="openChatAs('${c.listingId}','${c.buyerId}')">
        <div class="conv-item-av">${avHtml}</div>
        <div class="conv-item-info">
          <div class="conv-item-top">
            <span class="conv-item-name">${esc(c.otherUsername)}</span>
            <span class="conv-item-time">${timeStr}</span>
          </div>
          <div class="conv-item-listing">${esc(c.listingTitle)}</div>
          <div class="conv-item-preview">${esc(c.lastBody)}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="grid-loading">network error</div>';
  }
}

// Scroll
function scrollToFeed() {
  // Reset filter to "all" when browsing (fixes "my listings" → "browse" flow)
  currentFilter = 'all';
  searchQuery = '';
  providerFilter = '';
  const si = document.getElementById('searchInput');
  if (si) si.value = '';
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  const allPill = document.querySelector('.pill:not(.pill-provider)');
  if (allPill) allPill.classList.add('on');
  loadListings();
  document.getElementById('feed').scrollIntoView({ behavior: 'smooth' });
}
