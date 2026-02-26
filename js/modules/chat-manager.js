/**
 * js/modules/chat-manager.js
 * チャット管理モジュール 完全版
 *
 * 依存:
 *   ../config/firebase-config.js  → window.database, window.DATA_ROOT, window.waitForFirebase
 *   ../utils/auth-guard.js        → sessionStorage: targetUID, currentUsername, userRole
 */

'use strict';

class ChatManager {

  constructor() {
    /* ── 状態 ── */
    this.currentUser    = null;   // { uid, username, displayName, role }
    this.allUsers       = {};     // { uid: userData }
    this.rooms          = {};     // { roomId: roomData }  自分がメンバーのもの
    this.currentRoomId  = null;

    /* 新規チャット作成 */
    this.chatType      = 'direct';   // 'direct' | 'group'
    this.selectedUids  = [];

    /* 編集中メッセージ */
    this._editRoomId = null;
    this._editMsgId  = null;

    /* Firebase リスナー参照 */
    this._roomsRef = null;
    this._msgsRef  = null;

    /* DB・ルートパス（init後にセット） */
    this._db   = null;
    this._root = null;
  }

  /* ============================================================
     初期化
  ============================================================ */
  async init() {
    try {
      await this._waitForFirebase();
      this._db   = window.database;
      this._root = window.DATA_ROOT;   // 'ceScheduleV3'

      await this._loadCurrentUser();
      await this._loadAllUsers();
      this._listenRooms();
      this._bindUI();
      this._openRoomFromURL();

      console.log('✅ ChatManager 初期化完了:', this.currentUser.displayName);
    } catch (err) {
      console.error('❌ ChatManager 初期化エラー:', err);
    }
  }

  /* Firebase 準備待ち */
  async _waitForFirebase() {
    if (window.waitForFirebase) return window.waitForFirebase();
    for (let i = 0; i < 50; i++) {
      if (window.database && window.DATA_ROOT && window.auth) return;
      await this._sleep(100);
    }
    throw new Error('Firebase 初期化タイムアウト');
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ============================================================
     ユーザー読み込み
  ============================================================ */
  async _loadCurrentUser() {
    const uid      = sessionStorage.getItem('targetUID');
    const username = sessionStorage.getItem('currentUsername');
    const role     = sessionStorage.getItem('userRole') || 'viewer';

    if (!uid || !username) {
      alert('ログインが必要です');
      location.href = '../index.html';
      throw new Error('未認証');
    }

    /* Firebase からフル情報取得 */
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
    this.allUsers = snap.val() || {};
  }

  /* ============================================================
     ルーム一覧リスナー
  ============================================================ */
  _listenRooms() {
    const uid     = this.currentUser.uid;
    const isAdmin = this.currentUser.role === 'admin';

    this._roomsRef = this._db.ref(`${this._root}/chats/rooms`);
    this._roomsRef.on('value', snap => {
      const all = snap.val() || {};
      /* admin は全件、一般ユーザーは自分がメンバーのみ */
      this.rooms = {};
      Object.entries(all).forEach(([id, room]) => {
        if (isAdmin || room.members?.[uid]) {
          this.rooms[id] = room;
        }
      });
      this._renderRooms();
    });
  }

  /* ============================================================
     サイドバー描画
  ============================================================ */
  _renderRooms() {
    const list  = document.getElementById('roomsList');
    const badge = document.getElementById('totalUnreadBadge');
    if (!list) return;

    const uid = this.currentUser.uid;

    /* 最終メッセージ時刻の降順ソート */
    const sorted = Object.entries(this.rooms).sort(([, a], [, b]) =>
      (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0)
    );

    /* 全未読合計 */
    let totalUnread = 0;
    sorted.forEach(([, r]) => { totalUnread += r.unreadCount?.[uid] || 0; });
    if (badge) {
      badge.textContent   = totalUnread > 99 ? '99+' : totalUnread;
      badge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
    }

    if (sorted.length === 0) {
      list.innerHTML = `
        <div style="padding:24px 16px; text-align:center;
                    color:var(--text-muted); font-size:0.82rem;">
          トークルームはありません
        </div>`;
      return;
    }

    list.innerHTML = sorted.map(([id, room]) => {
      const unread  = room.unreadCount?.[uid] || 0;
      const isGroup = room.type === 'group';
      const timeStr = room.lastMessageAt ? this._timeAgo(room.lastMessageAt) : '';
      const avatarCls = isGroup ? 'room-avatar grp' : 'room-avatar';
      const avatarInner = isGroup
        ? '<i class="fas fa-users"></i>'
        : this._initials(room.name || '?');

      return `
        <div class="room-item ${id === this.currentRoomId ? 'active' : ''}"
             onclick="chatManager.selectRoom('${id}')">
          <div class="${avatarCls}">${avatarInner}</div>
          <div class="room-info">
            <div class="room-name">${this._esc(room.name || '無名')}</div>
            <div class="room-last">${this._esc(room.lastMessage || '')}</div>
          </div>
          <div class="room-meta">
            <span class="room-time">${timeStr}</span>
            ${unread > 0
              ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>`
              : ''}
          </div>
        </div>`;
    }).join('');
  }

  /* ============================================================
     ルーム選択
  ============================================================ */
  async selectRoom(roomId) {
    /* 前のメッセージリスナーを解除 */
    if (this._msgsRef && this.currentRoomId) {
      this._db.ref(`${this._root}/chats/messages/${this.currentRoomId}`).off();
      this._msgsRef = null;
    }

    this.currentRoomId = roomId;
    const room = this.rooms[roomId];
    if (!room) return;

    /* ── UI 切り替え ── */
    document.getElementById('chatEmpty').style.display     = 'none';
    const area = document.getElementById('chatRoomArea');
    area.style.display = 'flex';

    /* アバター */
    const avEl = document.getElementById('chatRoomAvatar');
    if (room.type === 'group') {
      avEl.innerHTML  = '<i class="fas fa-users"></i>';
      avEl.className  = 'room-avatar grp';
    } else {
      avEl.textContent = this._initials(room.name || '?');
      avEl.className   = 'room-avatar';
    }

    /* タイトル・メンバー */
    document.getElementById('chatRoomTitle').textContent = room.name || '無名';
    if (room.members) {
      const names = Object.keys(room.members).map(uid => {
        const u = this.allUsers[uid];
        return u ? (u.displayName || u.username) : uid;
      });
      document.getElementById('chatRoomSub').textContent = names.join('、');
    }

    /* 送信ボタン有効化 */
    document.getElementById('sendBtn').disabled = false;

    /* サイドバーのアクティブ状態を再描画 */
    this._renderRooms();

    /* 未読クリア */
    await this._markAsRead(roomId);

    /* メッセージリスナー開始 */
    this._listenMessages(roomId);

    /* スマホ: サイドバーを閉じる */
    document.getElementById('roomsSidebar')?.classList.remove('sp-open');
    document.getElementById('spBackdrop')?.classList.remove('sp-open');
  }

  /* ============================================================
     未読クリア（Firebase）
  ============================================================ */
  async _markAsRead(roomId) {
    const uid = this.currentUser.uid;
    try {
      await this._db
        .ref(`${this._root}/chats/rooms/${roomId}/unreadCount/${uid}`)
        .set(0);
    } catch (e) {
      console.warn('未読クリアエラー:', e);
    }
  }

  /* ============================================================
     メッセージリスナー
  ============================================================ */
  _listenMessages(roomId) {
    const ref = this._db
      .ref(`${this._root}/chats/messages/${roomId}`)
      .orderByChild('timestamp')
      .limitToLast(100);

    this._msgsRef = ref;
    ref.on('value', snap => {
      this._renderMessages(snap.val() || {});
    });
  }

  /* ============================================================
     メッセージ描画
  ============================================================ */
  _renderMessages(data) {
    const area = document.getElementById('messagesArea');
    if (!area) return;

    const uid  = this.currentUser.uid;
    const msgs = Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (msgs.length === 0) {
      area.innerHTML = `
        <div style="flex:1; display:flex; flex-direction:column;
                    align-items:center; justify-content:center;
                    color:var(--text-muted); gap:10px; padding:40px;">
          <i class="fas fa-comment-slash" style="font-size:2rem; opacity:0.25;"></i>
          <p style="font-size:0.85rem;">まだメッセージがありません</p>
        </div>`;
      return;
    }

    let lastDate = '';
    const html = msgs.map(msg => {
      /* 日付区切り */
      const d       = new Date(msg.timestamp || 0);
      const dateStr = d.toLocaleDateString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
      });
      let dateDivider = '';
      if (dateStr !== lastDate) {
        lastDate = dateStr;
        dateDivider = `
          <div class="date-sep"><span>${dateStr}</span></div>`;
      }

      /* システムメッセージ */
      if (msg.type === 'system') {
        return `${dateDivider}
          <div class="msg-row system">
            <div class="msg-bubble">${this._esc(msg.content)}</div>
          </div>`;
      }

      const isSelf    = msg.senderUid === uid;
      const timeStr   = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const sender    = msg.senderName || '不明';
      const readCnt   = msg.readBy
        ? Object.keys(msg.readBy).filter(k => k !== msg.senderUid).length
        : 0;
      const editMark  = msg.editedAt
        ? '<span class="msg-edited">（編集済）</span>'
        : '';

      /* アクションボタン（自分のメッセージのみ） */
      const actions = isSelf ? `
        <div class="msg-actions">
          <button class="act-btn" title="編集"
            onclick="chatManager.openEditModal('${this.currentRoomId}','${msg.id}',\`${this._escTpl(msg.content)}\`)">
            <i class="fas fa-edit"></i>
          </button>
          <button class="act-btn del" title="削除"
            onclick="chatManager.deleteMessage('${this.currentRoomId}','${msg.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>` : '';

      /* アバター（相手のみ） */
      const avatar = !isSelf
        ? `<div class="msg-av">${this._initials(sender)}</div>`
        : '';

      /* 送信者名（相手のみ） */
      const senderLine = !isSelf
        ? `<div class="msg-sender">${this._esc(sender)}</div>`
        : '';

      return `${dateDivider}
        <div class="msg-row ${isSelf ? 'self' : 'other'}">
          ${senderLine}
          <div class="msg-bubble-row">
            ${avatar}
            <div class="msg-bubble">${this._esc(msg.content)}</div>
            ${actions}
          </div>
          <div class="msg-meta">
            <span class="msg-time">${timeStr}</span>
            ${editMark}
            ${isSelf && readCnt > 0
              ? `<span class="msg-read">✓✓ 既読${readCnt}</span>`
              : ''}
          </div>
        </div>`;
    }).join('');

    area.innerHTML = html;

    /* 最下部へスクロール */
    area.scrollTop = area.scrollHeight;
  }

  /* ============================================================
     メッセージ送信
  ============================================================ */
  async sendMessage() {
    const input   = document.getElementById('chatInput');
    const content = input?.value.trim();
    if (!content || !this.currentRoomId) return;

    const uid  = this.currentUser.uid;
    const room = this.rooms[this.currentRoomId];

    /* 入力欄をすぐクリア */
    input.value = '';
    input.style.height = '44px';

    try {
      /* メッセージ書き込み */
      const msgRef = this._db
        .ref(`${this._root}/chats/messages/${this.currentRoomId}`)
        .push();
      await msgRef.set({
        content,
        senderUid:  uid,
        senderName: this.currentUser.displayName,
        timestamp:  Date.now(),
        readBy:     { [uid]: true },
      });

      /* ルームの lastMessage / unreadCount を一括更新 */
      const updates = {
        [`${this._root}/chats/rooms/${this.currentRoomId}/lastMessage`]:
          content.length > 40 ? content.substring(0, 40) + '…' : content,
        [`${this._root}/chats/rooms/${this.currentRoomId}/lastMessageAt`]:
          Date.now(),
      };

      if (room?.members) {
        Object.keys(room.members).forEach(memberId => {
          if (memberId !== uid) {
            const cur = room.unreadCount?.[memberId] || 0;
            updates[
              `${this._root}/chats/rooms/${this.currentRoomId}/unreadCount/${memberId}`
            ] = cur + 1;
          }
        });
      }
      await this._db.ref().update(updates);

    } catch (err) {
      console.error('送信エラー:', err);
      alert('送信に失敗しました');
    } finally {
      input.focus();
    }
  }

  /* ============================================================
     メッセージ削除
  ============================================================ */
  async deleteMessage(roomId, msgId) {
    if (!confirm('このメッセージを削除しますか？')) return;
    try {
      await this._db
        .ref(`${this._root}/chats/messages/${roomId}/${msgId}`)
        .remove();
    } catch (err) {
      console.error('削除エラー:', err);
      alert('削除に失敗しました');
    }
  }

  /* ============================================================
     メッセージ編集
  ============================================================ */
  openEditModal(roomId, msgId, content) {
    this._editRoomId = roomId;
    this._editMsgId  = msgId;
    const input = document.getElementById('editInput');
    if (input) input.value = content;
    document.getElementById('editModal')?.classList.remove('hidden');
    input?.focus();
  }

  async submitEdit() {
    const newContent = document.getElementById('editInput')?.value.trim();
    if (!newContent || !this._editMsgId) return;

    try {
      await this._db
        .ref(`${this._root}/chats/messages/${this._editRoomId}/${this._editMsgId}`)
        .update({ content: newContent, editedAt: Date.now() });

      document.getElementById('editModal')?.classList.add('hidden');
    } catch (err) {
      console.error('編集エラー:', err);
      alert('編集に失敗しました');
    } finally {
      this._editRoomId = null;
      this._editMsgId  = null;
    }
  }

  /* ============================================================
     新規ルーム作成
  ============================================================ */
  switchChatType(type) {
    this.chatType     = type;
    this.selectedUids = [];

    document.getElementById('tab1on1')
      .classList.toggle('active', type === 'direct');
    document.getElementById('tabGroup')
      .classList.toggle('active', type === 'group');

    const grpInput = document.getElementById('groupNameInput');
    if (grpInput) grpInput.style.display = type === 'group' ? 'block' : 'none';

    this._renderUserList();
    this._updateCreateBtn();
  }

  _renderUserList() {
    const list  = document.getElementById('userSelectList');
    if (!list) return;

    const myUid = this.currentUser.uid;
    const users = Object.entries(this.allUsers)
      .filter(([uid]) => uid !== myUid)
      .sort(([, a], [, b]) =>
        (a.displayName || '').localeCompare(b.displayName || '', 'ja')
      );

    if (users.length === 0) {
      list.innerHTML = `
        <div style="padding:16px; text-align:center;
                    color:var(--text-muted); font-size:0.82rem;">
          ユーザーが見つかりません
        </div>`;
      return;
    }

    list.innerHTML = users.map(([uid, u]) => {
      const name = u.displayName || u.username || uid;
      const sel  = this.selectedUids.includes(uid);
      return `
        <div class="usr-item ${sel ? 'sel' : ''}"
             onclick="chatManager.toggleUser('${uid}')">
          <div class="usr-av">${this._initials(name)}</div>
          <span class="usr-name">${this._esc(name)}</span>
          <div class="usr-check">
            ${sel ? '<i class="fas fa-check"></i>' : ''}
          </div>
        </div>`;
    }).join('');
  }

  toggleUser(uid) {
    const idx = this.selectedUids.indexOf(uid);
    if (this.chatType === 'direct') {
      /* 1対1: 選択は1人だけ */
      this.selectedUids = idx >= 0 ? [] : [uid];
    } else {
      if (idx >= 0) this.selectedUids.splice(idx, 1);
      else          this.selectedUids.push(uid);
    }
    this._renderUserList();
    this._updateCreateBtn();
  }

  _updateCreateBtn() {
    const btn    = document.getElementById('createRoomBtn');
    if (!btn) return;
    const grpOk  = this.chatType === 'direct' ||
                   document.getElementById('groupNameInput')?.value.trim() !== '';
    btn.disabled = this.selectedUids.length === 0 || !grpOk;
  }

  async createRoom() {
    if (this.selectedUids.length === 0) return;

    const uid  = this.currentUser.uid;
    const type = this.chatType;

    /* 1対1: 既存ルームを再利用 */
    if (type === 'direct') {
      const existing = await this._findDirectRoom(uid, this.selectedUids[0]);
      if (existing) {
        this._closeNewChatModal();
        this.selectRoom(existing);
        return;
      }
    }

    /* ルーム名を決定 */
    const otherUser = this.allUsers[this.selectedUids[0]];
    const roomName  = type === 'direct'
      ? (otherUser?.displayName || otherUser?.username || '不明')
      : (document.getElementById('groupNameInput')?.value.trim() || 'グループ');

    /* メンバーオブジェクト */
    const members = { [uid]: true };
    this.selectedUids.forEach(id => { members[id] = true; });

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
    await this._sleep(300); // リスナー更新を待つ
    this.selectRoom(roomRef.key);
  }

  async _findDirectRoom(uid1, uid2) {
    const snap = await this._db.ref(`${this._root}/chats/rooms`).once('value');
    const all  = snap.val() || {};
    for (const [id, room] of Object.entries(all)) {
      if (
        room.type === 'direct' &&
        room.members?.[uid1] &&
        room.members?.[uid2] &&
        Object.keys(room.members).length === 2
      ) {
        return id;
      }
    }
    return null;
  }

  /* ============================================================
     モーダル開閉
  ============================================================ */
  openNewChatModal() {
    this.chatType     = 'direct';
    this.selectedUids = [];

    document.getElementById('tab1on1')?.classList.add('active');
    document.getElementById('tabGroup')?.classList.remove('active');
    const grpInput = document.getElementById('groupNameInput');
    if (grpInput) { grpInput.style.display = 'none'; grpInput.value = ''; }
    document.getElementById('createRoomBtn').disabled = true;
    document.getElementById('newChatModal')?.classList.remove('hidden');
    this._renderUserList();
  }

  _closeNewChatModal() {
    document.getElementById('newChatModal')?.classList.add('hidden');
    this.selectedUids = [];
  }

  /* ============================================================
     UIイベントバインド
  ============================================================ */
  _bindUI() {

    /* ── 新規トーク ── */
    document.getElementById('newChatBtn')
      ?.addEventListener('click', () => this.openNewChatModal());
    document.getElementById('emptyNewBtn')
      ?.addEventListener('click', () => this.openNewChatModal());

    /* モーダル閉じる */
    document.getElementById('modalCloseBtn')
      ?.addEventListener('click', () => this._closeNewChatModal());
    document.getElementById('newChatModal')
      ?.addEventListener('click', e => {
        if (e.target === document.getElementById('newChatModal'))
          this._closeNewChatModal();
      });

    /* タブ切り替え */
    document.getElementById('tab1on1')
      ?.addEventListener('click', () => this.switchChatType('direct'));
    document.getElementById('tabGroup')
      ?.addEventListener('click', () => this.switchChatType('group'));

    /* グループ名入力 */
    document.getElementById('groupNameInput')
      ?.addEventListener('input', () => this._updateCreateBtn());

    /* 作成ボタン */
    document.getElementById('createRoomBtn')
      ?.addEventListener('click', () => this.createRoom());

    /* ── 送信 ── */
    /* 送信ボタン */
    document.getElementById('sendBtn')
      ?.addEventListener('click', () => this.sendMessage());

    /* テキストエリア:
         Enter       → 改行（デフォルト動作、preventDefault しない）
         Ctrl+Enter  → 送信
         Shift+Enter → 改行（デフォルト動作）
         自動高さ調整 */
    const textarea = document.getElementById('chatInput');
    if (textarea) {
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.sendMessage();
        }
        /* Enter のみ・Shift+Enter はデフォルト（改行）のまま */
      });
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 130) + 'px';
      });
    }

    /* ── スマホ: サイドバートグル ── */
    document.getElementById('spToggleBtn')
      ?.addEventListener('click', () => {
        document.getElementById('roomsSidebar')?.classList.toggle('sp-open');
        document.getElementById('spBackdrop')?.classList.toggle('sp-open');
      });
    document.getElementById('spBackdrop')
      ?.addEventListener('click', () => {
        document.getElementById('roomsSidebar')?.classList.remove('sp-open');
        document.getElementById('spBackdrop')?.classList.remove('sp-open');
      });
  }

  /* URLパラメータ ?room=xxx でルームを直接開く */
  _openRoomFromURL() {
    const roomId = new URLSearchParams(location.search).get('room');
    if (roomId) setTimeout(() => this.selectRoom(roomId), 600);
  }

  /* ============================================================
     ユーティリティ
  ============================================================ */

  /* イニシャル（アバター用）*/
  _initials(name) {
    return String(name || '?').trim().charAt(0).toUpperCase();
  }

  /* HTML エスケープ（XSS対策・改行→<br>） */
  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  /* テンプレートリテラル属性用エスケープ（バックティック・$ を無効化）*/
  _escTpl(str) {
    return String(str || '')
      .replace(/\\/g, '\\\\')
      .replace(/`/g,  '\\`')
      .replace(/\$/g, '\\$');
  }

  /* 経過時間フォーマット */
  _timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60_000);
    const h = Math.floor(diff / 3_600_000);
    const d = Math.floor(diff / 86_400_000);
    if (m  <  1) return 'たった今';
    if (m  < 60) return `${m}分前`;
    if (h  < 24) return `${h}時間前`;
    if (d  <  7) return `${d}日前`;
    return new Date(ts).toLocaleDateString('ja-JP',
      { month: '2-digit', day: '2-digit' });
  }

  /* ============================================================
     クリーンアップ
  ============================================================ */
  destroy() {
    if (this._roomsRef) {
      this._db.ref(`${this._root}/chats/rooms`).off();
    }
    if (this._msgsRef && this.currentRoomId) {
      this._db.ref(`${this._root}/chats/messages/${this.currentRoomId}`).off();
    }
  }
}

/* ============================================================
   グローバル登録 & 自動初期化
============================================================ */
window.chatManager = new ChatManager();

document.addEventListener('DOMContentLoaded', () => {
  /* 未認証ならログイン画面へ */
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
