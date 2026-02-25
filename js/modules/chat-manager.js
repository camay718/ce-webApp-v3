// ============================================================
// js/modules/chat-manager.js
// チャット管理モジュール（完全修正版）
// ============================================================

class ChatManager {
  constructor() {
    this.currentUser = null;   // { uid, username, displayName, role }
    this.allUsers    = {};      // { uid: userData }
    this.rooms       = {};      // { roomId: roomData }
    this.currentRoomId = null;
    this.currentChatType = 'direct'; // 'direct' | 'group'
    this.selectedUsers = [];
    this._roomsListener = null;
    this._msgListener   = null;
    this._editingMsgId  = null;
    this._editingRoomId = null;
    this._db = null;
    this._root = null;
  }

  // ─────────────────────────────────────────
  // 初期化
  // ─────────────────────────────────────────
  async init() {
    try {
      await this._waitForFirebase();
      this._db   = window.database;
      this._root = window.DATA_ROOT;

      await this._loadCurrentUser();
      await this._loadAllUsers();
      this._setupRoomsListener();
      this._bindUIEvents();
      this._openRoomFromURL();

      console.log('✅ ChatManager 初期化完了:', this.currentUser);
    } catch (e) {
      console.error('❌ ChatManager 初期化エラー:', e);
    }
  }

  async _waitForFirebase() {
    for (let i = 0; i < 50; i++) {
      if (window.database && window.DATA_ROOT && window.auth) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Firebase 初期化タイムアウト');
  }

  // ─────────────────────────────────────────
  // ユーザー読み込み
  // ─────────────────────────────────────────
  async _loadCurrentUser() {
    // 1. AuthGuard → sessionStorage
    const uid      = sessionStorage.getItem('targetUID');
    const username = sessionStorage.getItem('currentUsername');
    const role     = sessionStorage.getItem('userRole') || 'viewer';

    if (!uid || !username) {
      alert('ログインが必要です');
      location.href = '../index.html';
      throw new Error('未認証');
    }

    // Firebase からフル情報を取得
    const snap = await this._db.ref(`${this._root}/users/${uid}`).once('value');
    const data = snap.val() || {};

    this.currentUser = {
      uid,
      username:    data.username    || username,
      displayName: data.displayName || data.username || username,
      role:        data.role        || role,
    };
  }

  async _loadAllUsers() {
    const snap = await this._db.ref(`${this._root}/users`).once('value');
    const data = snap.val() || {};
    this.allUsers = data;
  }

  // ─────────────────────────────────────────
  // ルームリスナー
  // ─────────────────────────────────────────
  _setupRoomsListener() {
    const ref = this._db.ref(`${this._root}/chats/rooms`);
    this._roomsListener = ref.on('value', snap => {
      const all = snap.val() || {};
      // 自分がメンバーのルームのみ（admin は全件見れる）
      const myRooms = {};
      const uid   = this.currentUser.uid;
      const isAdmin = this.currentUser.role === 'admin';
      Object.entries(all).forEach(([id, room]) => {
        if (isAdmin || (room.members && room.members[uid])) {
          myRooms[id] = room;
        }
      });
      this.rooms = myRooms;
      this._renderRoomList();
    });
  }

  // ─────────────────────────────────────────
  // サイドバー描画
  // ─────────────────────────────────────────
  _renderRoomList() {
    const list = document.getElementById('roomsList');
    const totalBadge = document.getElementById('totalUnreadBadge');
    if (!list) return;

    const uid = this.currentUser.uid;
    const sorted = Object.entries(this.rooms).sort((a, b) => {
      return (b[1].lastMessageAt || b[1].createdAt || 0) - (a[1].lastMessageAt || a[1].createdAt || 0);
    });

    let totalUnread = 0;
    if (sorted.length === 0) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:#888;font-size:0.85rem;">トークはありません</div>`;
    } else {
      list.innerHTML = sorted.map(([id, room]) => {
        const unread = (room.unreadCount && room.unreadCount[uid]) ? room.unreadCount[uid] : 0;
        totalUnread += unread;
        const isGroup = room.type === 'group';
        const avatar  = isGroup
          ? `<div class="room-avatar group-avatar"><i class="fas fa-users"></i></div>`
          : `<div class="room-avatar">${this._initials(room.name || '?')}</div>`;
        const timeStr = room.lastMessageAt ? this._fmtTimeAgo(room.lastMessageAt) : '';
        return `
          <div class="room-item ${id === this.currentRoomId ? 'active' : ''}"
               onclick="chatManager.selectRoom('${id}')">
            ${avatar}
            <div class="room-info">
              <div class="room-name">${this._esc(room.name || '無名')}</div>
              <div class="room-last-msg">${this._esc(room.lastMessage || '')}</div>
            </div>
            <div class="room-meta">
              <span class="room-time">${timeStr}</span>
              ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
            </div>
          </div>`;
      }).join('');
    }

    // 合計未読バッジ
    if (totalBadge) {
      totalBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      totalBadge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
    }
  }

  // ─────────────────────────────────────────
  // ルーム選択
  // ─────────────────────────────────────────
  async selectRoom(roomId) {
    if (this._msgListener && this.currentRoomId) {
      this._db.ref(`${this._root}/chats/messages/${this.currentRoomId}`).off();
      this._msgListener = null;
    }
    this.currentRoomId = roomId;
    const room = this.rooms[roomId];
    if (!room) return;

    // ルームヘッダー更新
    document.getElementById('chatEmptyState').style.display   = 'none';
    const area = document.getElementById('chatRoomArea');
    area.style.display = 'flex';

    const isGroup = room.type === 'group';
    const avatarEl = document.getElementById('chatRoomAvatar');
    avatarEl.textContent = isGroup ? '' : this._initials(room.name || '?');
    if (isGroup) {
      avatarEl.innerHTML = '<i class="fas fa-users"></i>';
      avatarEl.className = 'room-avatar group-avatar';
    } else {
      avatarEl.className = 'room-avatar';
    }
    document.getElementById('chatRoomTitle').textContent = room.name || '無名';

    // メンバー名一覧
    if (room.members) {
      const memberNames = Object.keys(room.members).map(uid => {
        const u = this.allUsers[uid];
        return u ? (u.displayName || u.username) : uid;
      });
      document.getElementById('chatRoomMembers').textContent = memberNames.join('、');
    }

    document.getElementById('sendBtn').disabled = false;

    // サイドバーの active 状態更新
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const items = document.querySelectorAll('.room-item');
    items.forEach(el => {
      if (el.onclick && el.getAttribute('onclick')?.includes(roomId)) el.classList.add('active');
    });
    this._renderRoomList(); // active 再描画

    // 未読をクリア（Firebase）
    await this._markAsRead(roomId);

    // メッセージリスナー起動
    this._setupMessageListener(roomId);

    // スマホ: サイドバー閉じる
    if (window.innerWidth <= 600) {
      document.getElementById('roomsSidebar').classList.add('hidden-mobile');
    }
  }

  // ─────────────────────────────────────────
  // 未読クリア
  // ─────────────────────────────────────────
  async _markAsRead(roomId) {
    const uid = this.currentUser.uid;
    try {
      // unreadCount[uid] = 0
      await this._db.ref(`${this._root}/chats/rooms/${roomId}/unreadCount/${uid}`).set(0);
    } catch (e) {
      console.warn('未読クリアエラー:', e);
    }
  }

  // ─────────────────────────────────────────
  // メッセージリスナー & 描画
  // ─────────────────────────────────────────
  _setupMessageListener(roomId) {
    const ref = this._db.ref(`${this._root}/chats/messages/${roomId}`)
      .orderByChild('timestamp').limitToLast(100);
    this._msgListener = ref.on('value', snap => {
      const data = snap.val() || {};
      this._renderMessages(data, roomId);
    });
  }

  _renderMessages(data, roomId) {
    const area = document.getElementById('messagesArea');
    if (!area) return;
    const uid = this.currentUser.uid;
    const msgs = Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    let lastDate = '';
    let html = '';

    msgs.forEach(msg => {
      // 日付区切り
      const d = new Date(msg.timestamp || 0);
      const dateStr = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      if (dateStr !== lastDate) {
        html += `<div class="date-divider"><span>${dateStr}</span></div>`;
        lastDate = dateStr;
      }

      const isSelf   = msg.senderUid === uid;
      const isSystem = msg.type === 'system';
      const timeStr  = new Date(msg.timestamp || 0).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const senderName = msg.senderName || '不明';
      const readCount  = msg.readBy ? Object.keys(msg.readBy).filter(k => k !== msg.senderUid).length : 0;
      const editedMark = msg.editedAt ? '<span class="msg-edited">(編集済)</span>' : '';

      if (isSystem) {
        html += `<div class="msg-row system"><div class="msg-bubble">${this._esc(msg.content)}</div></div>`;
        return;
      }

      // アバター（相手のみ）
      const avatarHtml = !isSelf
        ? `<div class="msg-avatar">${this._initials(senderName)}</div>`
        : '';

      // アクションボタン（自分のメッセージのみ編集・削除）
      const actionBtns = isSelf ? `
        <div class="msg-actions">
          <button class="msg-action-btn" title="編集"
            onclick="chatManager.openEditModal('${roomId}','${msg.id}',\`${this._escAttr(msg.content)}\`)">
            <i class="fas fa-edit"></i>
          </button>
          <button class="msg-action-btn delete" title="削除"
            onclick="chatManager.deleteMessage('${roomId}','${msg.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>` : '';

      html += `
        <div class="msg-row ${isSelf ? 'self' : 'other'}">
          ${!isSelf ? `<div class="msg-sender-name">${this._esc(senderName)}</div>` : ''}
          <div class="msg-bubble-wrap">
            ${avatarHtml}
            <div>
              <div class="msg-bubble">${this._esc(msg.content)}</div>
            </div>
            ${actionBtns}
          </div>
          <div class="msg-meta">
            <span class="msg-time">${timeStr}</span>
            ${editedMark}
            ${isSelf && readCount > 0 ? `<span class="msg-read">✓✓ 既読${readCount}</span>` : ''}
          </div>
        </div>`;
    });

    area.innerHTML = html || `<div class="chat-empty"><i class="fas fa-comment-slash"></i><p>まだメッセージがありません</p></div>`;
    area.scrollTop = area.scrollHeight;
  }

  // ─────────────────────────────────────────
  // メッセージ送信
  // ─────────────────────────────────────────
  async sendMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content || !this.currentRoomId) return;

    const uid  = this.currentUser.uid;
    const room = this.rooms[this.currentRoomId];
    input.value = '';
    input.style.height = '44px';
    document.getElementById('sendBtn').disabled = true;

    try {
      const msgRef = this._db.ref(`${this._root}/chats/messages/${this.currentRoomId}`).push();
      await msgRef.set({
        content,
        senderUid:  uid,
        senderName: this.currentUser.displayName,
        timestamp:  Date.now(),
        readBy:     { [uid]: true },
      });

      // ルーム最終メッセージ & 未読カウント更新
      const updates = {
        [`${this._root}/chats/rooms/${this.currentRoomId}/lastMessage`]:   content,
        [`${this._root}/chats/rooms/${this.currentRoomId}/lastMessageAt`]: Date.now(),
      };
      if (room && room.members) {
        Object.keys(room.members).forEach(memberId => {
          if (memberId !== uid) {
            updates[`${this._root}/chats/rooms/${this.currentRoomId}/unreadCount/${memberId}`]
              = (room.unreadCount?.[memberId] || 0) + 1;
          }
        });
      }
      await this._db.ref().update(updates);
    } catch (e) {
      console.error('送信エラー:', e);
    } finally {
      document.getElementById('sendBtn').disabled = false;
      input.focus();
    }
  }

  // ─────────────────────────────────────────
  // 削除・編集
  // ─────────────────────────────────────────
  async deleteMessage(roomId, msgId) {
    if (!confirm('このメッセージを削除しますか？')) return;
    try {
      await this._db.ref(`${this._root}/chats/messages/${roomId}/${msgId}`).remove();
    } catch (e) {
      console.error('削除エラー:', e);
      alert('削除に失敗しました');
    }
  }

  openEditModal(roomId, msgId, content) {
    this._editingRoomId = roomId;
    this._editingMsgId  = msgId;
    document.getElementById('editInput').value = content;
    document.getElementById('editModal').classList.remove('hidden');
    document.getElementById('editInput').focus();
  }

  async submitEdit() {
    const newContent = document.getElementById('editInput').value.trim();
    if (!newContent || !this._editingMsgId) return;
    try {
      await this._db.ref(`${this._root}/chats/messages/${this._editingRoomId}/${this._editingMsgId}`).update({
        content:  newContent,
        editedAt: Date.now(),
      });
      document.getElementById('editModal').classList.add('hidden');
    } catch (e) {
      console.error('編集エラー:', e);
      alert('編集に失敗しました');
    }
  }

  // ─────────────────────────────────────────
  // 新規チャット作成
  // ─────────────────────────────────────────
  switchChatType(type) {
    this.currentChatType = type;
    this.selectedUsers = [];
    document.getElementById('tab1on1').classList.toggle('active', type === 'direct');
    document.getElementById('tabGroup').classList.toggle('active', type === 'group');
    document.getElementById('groupNameInput').style.display = type === 'group' ? 'block' : 'none';
    this._renderUserSelectList();
    this._updateCreateBtnState();
  }

  _renderUserSelectList() {
    const list  = document.getElementById('userSelectList');
    const myUid = this.currentUser.uid;
    const users = Object.entries(this.allUsers)
      .filter(([uid]) => uid !== myUid)
      .sort((a, b) => (a[1].displayName || '').localeCompare(b[1].displayName || ''));

    if (users.length === 0) {
      list.innerHTML = `<div style="padding:16px; text-align:center; color:#888;">ユーザーが見つかりません</div>`;
      return;
    }

    list.innerHTML = users.map(([uid, u]) => {
      const name    = u.displayName || u.username || uid;
      const sel     = this.selectedUsers.includes(uid);
      return `
        <div class="user-select-item ${sel ? 'selected' : ''}"
             onclick="chatManager.toggleUserSelect('${uid}')">
          <div class="usr-avatar">${this._initials(name)}</div>
          <span class="usr-name">${this._esc(name)}</span>
          <div class="usr-check">${sel ? '<i class="fas fa-check"></i>' : ''}</div>
        </div>`;
    }).join('');
  }

  toggleUserSelect(uid) {
    const idx = this.selectedUsers.indexOf(uid);
    if (this.currentChatType === 'direct') {
      // 1対1: 1人だけ選択
      this.selectedUsers = idx >= 0 ? [] : [uid];
    } else {
      if (idx >= 0) this.selectedUsers.splice(idx, 1);
      else this.selectedUsers.push(uid);
    }
    this._renderUserSelectList();
    this._updateCreateBtnState();
  }

  _updateCreateBtnState() {
    const btn = document.getElementById('createRoomBtn');
    const ok  = this.selectedUsers.length > 0
      && (this.currentChatType === 'direct' || document.getElementById('groupNameInput').value.trim() !== '');
    btn.disabled = !ok;
  }

  async createRoom() {
    if (this.selectedUsers.length === 0) return;
    const uid  = this.currentUser.uid;
    const type = this.currentChatType;

    // 1対1の場合：既存ルームをチェック
    if (type === 'direct') {
      const existing = await this._findExistingDirectRoom(uid, this.selectedUsers[0]);
      if (existing) {
        this._closeNewChatModal();
        this.selectRoom(existing);
        return;
      }
    }

    const otherUid  = this.selectedUsers[0];
    const otherUser = this.allUsers[otherUid];
    const groupName = document.getElementById('groupNameInput').value.trim();
    const roomName  = type === 'direct'
      ? (otherUser?.displayName || otherUser?.username || '不明')
      : groupName;

    const members = { [uid]: true };
    this.selectedUsers.forEach(id => { members[id] = true; });

    const roomRef = this._db.ref(`${this._root}/chats/rooms`).push();
    await roomRef.set({
      name:          roomName,
      type,
      members,
      creator:       uid,
      createdAt:     Date.now(),
      lastMessage:   '',
      lastMessageAt: 0,
      unreadCount:   {},
    });

    this._closeNewChatModal();
    this.selectRoom(roomRef.key);
  }

  async _findExistingDirectRoom(uid1, uid2) {
    const snap = await this._db.ref(`${this._root}/chats/rooms`).once('value');
    const all  = snap.val() || {};
    for (const [id, room] of Object.entries(all)) {
      if (room.type === 'direct' && room.members?.[uid1] && room.members?.[uid2]
          && Object.keys(room.members).length === 2) {
        return id;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────
  // UIイベント
  // ─────────────────────────────────────────
  _bindUIEvents() {
    // 新規チャットボタン
    document.getElementById('newChatBtn')?.addEventListener('click', () => {
      this.openNewChatModal();
    });
    document.getElementById('modalCloseBtn')?.addEventListener('click', () => {
      this._closeNewChatModal();
    });
    document.getElementById('newChatModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('newChatModal')) this._closeNewChatModal();
    });

    // 作成ボタン
    document.getElementById('createRoomBtn')?.addEventListener('click', () => {
      this.createRoom();
    });

    // グループ名入力
    document.getElementById('groupNameInput')?.addEventListener('input', () => {
      this._updateCreateBtnState();
    });

    // 送信ボタン
    document.getElementById('sendBtn')?.addEventListener('click', () => {
      this.sendMessage();
    });

    // テキストエリア: Enter → 改行、送信ボタンのみで送信
    const input = document.getElementById('chatInput');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          // Enter 単独では何もしない（改行扱い）—デフォルト通り
          // ※ 送信はボタンのみ
          // e.preventDefault(); // コメントアウト: 改行を許可
        }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
    }

    // スマホ: サイドバートグル
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('roomsSidebar').classList.remove('hidden-mobile');
    });
    document.getElementById('sidebarCloseBtn')?.addEventListener('click', () => {
      document.getElementById('roomsSidebar').classList.add('hidden-mobile');
    });
  }

  openNewChatModal() {
    this.selectedUsers = [];
    this.currentChatType = 'direct';
    document.getElementById('tab1on1').classList.add('active');
    document.getElementById('tabGroup').classList.remove('active');
    document.getElementById('groupNameInput').style.display = 'none';
    document.getElementById('groupNameInput').value = '';
    document.getElementById('createRoomBtn').disabled = true;
    document.getElementById('newChatModal').classList.remove('hidden');
    this._renderUserSelectList();
  }

  _closeNewChatModal() {
    document.getElementById('newChatModal').classList.add('hidden');
    this.selectedUsers = [];
  }

  _openRoomFromURL() {
    const params = new URLSearchParams(location.search);
    const roomId = params.get('room');
    if (roomId) setTimeout(() => this.selectRoom(roomId), 500);
  }

  // ─────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────
  _initials(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }

  _escAttr(str) {
    return String(str || '').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  }

  _fmtTimeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1)  return 'たった今';
    if (m < 60) return `${m}分前`;
    if (h < 24) return `${h}時間前`;
    if (d < 7)  return `${d}日前`;
    return new Date(ts).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  }

  destroy() {
    if (this._db && this._root && this.currentRoomId) {
      this._db.ref(`${this._root}/chats/messages/${this.currentRoomId}`).off();
    }
    if (this._db && this._root) {
      this._db.ref(`${this._root}/chats/rooms`).off();
    }
  }
}

// ─────────────────────────────────────────
// グローバル登録 & 自動初期化
// ─────────────────────────────────────────
window.chatManager = new ChatManager();

document.addEventListener('DOMContentLoaded', () => {
  // AuthGuard チェック後に初期化
  const uid = sessionStorage.getItem('targetUID');
  if (!uid) {
    location.href = '../index.html';
    return;
  }
  window.chatManager.init();
});

window.addEventListener('beforeunload', () => {
  window.chatManager?.destroy();
});
