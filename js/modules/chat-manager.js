/**
 * チャット管理モジュール (Chat Manager)
 *
 * 依存ファイル:
 *   - js/config/firebase-config.js  （window.database, window.DATA_ROOT）
 *   - js/utils/auth-guard.js         （AuthGuard.getSession()）
 *   - js/modules/user-manager.js     （window.userManager ※任意）
 *
 * Firebase パス:
 *   ceScheduleV3/chats/rooms/{roomId}
 *   ceScheduleV3/chats/messages/{roomId}/{messageId}
 *
 * 権限:
 *   チャット閲覧・送信 : 自分がメンバーのルームのみ
 *   ルーム作成         : 全ユーザー
 */

class ChatManager {
    constructor() {
        this.db              = null;
        this.dataRoot        = null;
        this.currentUser     = null;   // { uid, username, displayName, role }
        this.allUsers        = [];     // 全ユーザーキャッシュ
        this.rooms           = {};     // { roomId: roomData }
        this.currentRoomId   = null;
        this.chatType        = 'direct'; // 'direct' | 'group'
        this.selectedUserIds = [];       // 新規チャット用選択ユーザー
        this.msgListener     = null;     // 現在のメッセージリスナー解除関数
        this.roomsListener   = null;
    }

    // =========================================================
    // 初期化
    // =========================================================

    async init() {
        console.log('[ChatManager] 初期化開始');
        try {
            await this._waitForFirebase();
            await this._loadCurrentUser();
            await this._loadAllUsers();
            this._setupRoomsListener();
            this._bindUIEvents();

            // URLパラメータでルーム直接開く
            const params = new URLSearchParams(location.search);
            const roomParam = params.get('room');
            if (roomParam) {
                setTimeout(() => this.selectRoom(roomParam), 800);
            }

            console.log('[ChatManager] ✅ 初期化完了');
        } catch (err) {
            console.error('[ChatManager] ❌ 初期化失敗:', err);
        }
    }

    async _waitForFirebase() {
        if (window.waitForFirebase) {
            await window.waitForFirebase();
        } else {
            let attempts = 0;
            while (!(window.database && window.DATA_ROOT) && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }
        }
        if (!window.database) throw new Error('Firebase database が利用できません');
        this.db       = window.database;
        this.dataRoot = window.DATA_ROOT;
    }

    async _loadCurrentUser() {
        // user-manager.js が初期化済みであれば優先使用
        if (window.userManager?.currentUser) {
            this.currentUser = window.userManager.currentUser;
            console.log('[ChatManager] userManager からユーザー取得:', this.currentUser);
            return;
        }

        const session = window.AuthGuard ? window.AuthGuard.getSession() : null;
        if (session?.uid) {
            try {
                const snap = await this.db
                    .ref(`${this.dataRoot}/users/${session.uid}`)
                    .once('value');
                const data = snap.val();
                this.currentUser = {
                    uid        : session.uid,
                    username   : session.username,
                    displayName: data?.displayName || data?.name || session.username,
                    role       : data?.role || session.role || 'user'
                };
            } catch {
                this.currentUser = {
                    uid        : session.uid,
                    username   : session.username,
                    displayName: session.username,
                    role       : session.role || 'user'
                };
            }
        } else {
            // 開発中フォールバック
            this.currentUser = { uid: 'admin', username: 'admin', displayName: '管理者', role: 'admin' };
            console.warn('[ChatManager] セッション情報なし。admin でフォールバック');
        }
        console.log('[ChatManager] currentUser:', this.currentUser);
    }

    async _loadAllUsers() {
        try {
            const snap = await this.db.ref(`${this.dataRoot}/users`).once('value');
            if (snap.exists()) {
                this.allUsers = Object.entries(snap.val())
                    .map(([key, u]) => ({
                        id         : key,
                        uid        : u.uid || key,
                        username   : u.username,
                        displayName: u.displayName || u.name || u.username,
                        role       : u.role || 'user'
                    }))
                    // 自分自身は除外
                    .filter(u => u.uid !== this.currentUser.uid);
            } else {
                // Firebase にユーザーがなければ CE_LIST_INITIAL を使用
                const ce = window.CE_LIST_INITIAL || [];
                this.allUsers = ce.map((c, i) => ({
                    id         : `ce-${i}`,
                    uid        : `ce-${i}`,
                    username   : c.name,
                    displayName: c.fullName || c.name,
                    role       : 'user'
                })).filter(u => u.uid !== this.currentUser.uid);
            }
            console.log('[ChatManager] ユーザー数:', this.allUsers.length);
        } catch (err) {
            console.error('[ChatManager] ユーザー取得エラー:', err);
            this.allUsers = [];
        }
    }

    // =========================================================
    // ルームリスナー
    // =========================================================

    _setupRoomsListener() {
        const ref = this.db.ref(`${this.dataRoot}/chats/rooms`);
        ref.on('value', snap => {
            const all = snap.exists() ? snap.val() : {};
            // 自分がメンバーのルームだけフィルタ
            this.rooms = {};
            Object.entries(all).forEach(([id, room]) => {
                if (room.members && room.members[this.currentUser.uid]) {
                    this.rooms[id] = room;
                }
            });
            this._renderRoomList();
        });
        this.roomsListener = ref;
    }

    // =========================================================
    // ルーム一覧レンダリング
    // =========================================================

    _renderRoomList() {
        const container = document.getElementById('roomsList');
        if (!container) return;

        // 最終メッセージ時刻の降順でソート
        const sorted = Object.entries(this.rooms)
            .sort(([, a], [, b]) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0));

        // 未読総数を計算してバッジ更新
        let totalUnread = 0;
        sorted.forEach(([, room]) => {
            totalUnread += (room.unreadCount?.[this.currentUser.uid] || 0);
        });
        const totalBadge = document.getElementById('totalUnreadBadge');
        if (totalBadge) {
            if (totalUnread > 0) {
                totalBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
                totalBadge.style.display = 'flex';
            } else {
                totalBadge.style.display = 'none';
            }
        }

        if (sorted.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:2.5rem 1rem; color:var(--text-secondary);">
                    <i class="fas fa-comment-slash" style="font-size:2rem; display:block; margin-bottom:0.75rem; opacity:0.4;"></i>
                    チャットがありません<br>
                    <span style="font-size:0.8125rem;">「新規チャット」で始めましょう</span>
                </div>`;
            return;
        }

        let html = '';
        sorted.forEach(([id, room]) => {
            const unread    = room.unreadCount?.[this.currentUser.uid] || 0;
            const isActive  = id === this.currentRoomId;
            const isGroup   = room.type === 'group';
            const avatar    = isGroup ? '👥' : '👤';
            const name      = room.name || '不明なルーム';
            const lastMsg   = room.lastMessage
                ? this._esc(room.lastMessage).substring(0, 30) + (room.lastMessage.length > 30 ? '…' : '')
                : 'まだメッセージがありません';
            const timeStr   = this._formatTime(room.lastMessageAt || room.createdAt);

            html += `
                <div class="room-item ${isActive ? 'active' : ''}"
                     onclick="window.chatManager.selectRoom('${id}')">
                    <div class="room-avatar">${avatar}</div>
                    <div class="room-info">
                        <div class="room-name">${this._esc(name)}</div>
                        <div class="room-last-message" style="${unread > 0 ? 'color:var(--text-primary);font-weight:500;' : ''}">
                            ${lastMsg}
                        </div>
                    </div>
                    <div class="room-meta">
                        <span class="room-time">${timeStr}</span>
                        ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                    </div>
                </div>`;
        });

        container.innerHTML = html;
    }

    // =========================================================
    // ルーム選択・メッセージ表示
    // =========================================================

    selectRoom(roomId) {
        if (!this.rooms[roomId]) return;

        this.currentRoomId = roomId;
        const room = this.rooms[roomId];
        const memberCount = room.members ? Object.keys(room.members).length : 0;

        // ヘッダー更新
        const headerName    = document.getElementById('roomHeaderName');
        const headerMembers = document.getElementById('roomHeaderMembers');
        const headerAvatar  = document.getElementById('roomHeaderAvatar');
        if (headerName)    headerName.textContent    = room.name || '不明なルーム';
        if (headerMembers) headerMembers.textContent = `${memberCount}名`;
        if (headerAvatar)  headerAvatar.textContent  = room.type === 'group' ? '👥' : '👤';

        // 空状態を非表示、チャットルームを表示
        document.getElementById('chatEmpty').style.display = 'none';
        const chatRoom = document.getElementById('chatRoom');
        chatRoom.classList.add('active');

        // 送信ボタン有効化
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) sendBtn.disabled = false;

        // ルーム一覧の選択状態を更新
        this._renderRoomList();

        // 既読処理
        this._markAsRead(roomId);

        // メッセージリスナー設定
        this._setupMessageListener(roomId);
    }

    _setupMessageListener(roomId) {
        // 既存リスナーを解除
        if (this.msgListener) {
            this.msgListener();
            this.msgListener = null;
        }

        const ref = this.db.ref(`${this.dataRoot}/chats/messages/${roomId}`);
        const handler = ref.on('value', snap => {
            const msgs = snap.exists() ? snap.val() : {};
            this._renderMessages(msgs);
            // 新着メッセージは既読にする
            if (this.currentRoomId === roomId) {
                this._markAsRead(roomId);
            }
        });
        // 解除用クロージャ
        this.msgListener = () => ref.off('value', handler);
    }

    // =========================================================
    // メッセージレンダリング
    // =========================================================

    _renderMessages(messages) {
        const area = document.getElementById('messagesArea');
        if (!area) return;

        const sorted = Object.entries(messages)
            .sort(([, a], [, b]) => (a.timestamp || 0) - (b.timestamp || 0));

        if (sorted.length === 0) {
            area.innerHTML = `
                <div style="text-align:center; padding:3rem; color:var(--text-secondary);">
                    <i class="fas fa-comment-dots" style="font-size:2.5rem; display:block; margin-bottom:1rem; opacity:0.3;"></i>
                    最初のメッセージを送信してください
                </div>`;
            return;
        }

        let html = '';
        let lastDateStr = '';

        sorted.forEach(([msgId, msg]) => {
            const isMine   = msg.senderUid === this.currentUser.uid;
            const dateStr  = this._formatDateOnly(msg.timestamp);
            const timeStr  = this._formatTimeOnly(msg.timestamp);
            const readBy   = msg.readBy ? Object.keys(msg.readBy) : [];
            // 自分以外の既読者数
            const readCount = readBy.filter(uid => uid !== this.currentUser.uid).length;

            // 日付区切り
            if (dateStr !== lastDateStr) {
                html += `<div class="date-divider">${dateStr}</div>`;
                lastDateStr = dateStr;
            }

            if (isMine) {
                // 自分のメッセージ（右側）
                html += `
                    <div class="message-row mine">
                        <div class="message-content-wrap">
                            <div class="message-bubble">
                                ${this._esc(msg.content)}
                            </div>
                            <div class="message-footer">
                                ${readCount > 0
                                    ? `<span class="message-read">既読 ${readCount}</span>`
                                    : ''}
                                <span class="message-time">${timeStr}</span>
                            </div>
                        </div>
                    </div>`;
            } else {
                // 相手のメッセージ（左側）
                const senderInitial = (msg.senderName || '?').charAt(0);
                html += `
                    <div class="message-row others">
                        <div class="message-avatar-small">${senderInitial}</div>
                        <div class="message-content-wrap">
                            <div class="message-sender-name">${this._esc(msg.senderName || '不明')}</div>
                            <div class="message-bubble">
                                ${this._esc(msg.content)}
                            </div>
                            <div class="message-footer">
                                <span class="message-time">${timeStr}</span>
                            </div>
                        </div>
                    </div>`;
            }
        });

        area.innerHTML = html;
        // 最新メッセージまでスクロール
        area.scrollTop = area.scrollHeight;
    }

    // =========================================================
    // メッセージ送信
    // =========================================================

    async sendMessage() {
        const input = document.getElementById('chatInput');
        if (!input) return;

        const content = input.value.trim();
        if (!content || !this.currentRoomId) return;

        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) sendBtn.disabled = true;

        try {
            const msgRef = this.db.ref(
                `${this.dataRoot}/chats/messages/${this.currentRoomId}`
            );
            const key = msgRef.push().key;

            // readBy に自分を登録（送信と同時に自分は既読）
            const readBy = { [this.currentUser.uid]: true };

            await msgRef.child(key).set({
                content   : content,
                senderUid : this.currentUser.uid,
                senderName: this.currentUser.displayName,
                timestamp : Date.now(),
                readBy    : readBy
            });

            // ルームの lastMessage を更新
            const roomRef = this.db.ref(
                `${this.dataRoot}/chats/rooms/${this.currentRoomId}`
            );
            const room = this.rooms[this.currentRoomId];
            const updates = {
                lastMessage  : content,
                lastMessageAt: Date.now(),
                lastMessageBy: this.currentUser.uid
            };

            // 自分以外のメンバーの未読数をインクリメント
            if (room?.members) {
                Object.keys(room.members).forEach(uid => {
                    if (uid !== this.currentUser.uid) {
                        updates[`unreadCount/${uid}`] = (room.unreadCount?.[uid] || 0) + 1;
                    }
                });
            }

            await roomRef.update(updates);

            input.value = '';
            input.style.height = 'auto';
            if (sendBtn) sendBtn.disabled = false;
            console.log('[ChatManager] メッセージ送信完了');

        } catch (err) {
            console.error('[ChatManager] 送信エラー:', err);
            alert('メッセージの送信に失敗しました。もう一度お試しください。');
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    // =========================================================
    // 既読処理
    // =========================================================

    async _markAsRead(roomId) {
        try {
            // 未読カウントをリセット
            await this.db.ref(
                `${this.dataRoot}/chats/rooms/${roomId}/unreadCount/${this.currentUser.uid}`
            ).set(0);

            // 直近100件のメッセージに readBy を記録
            const msgsSnap = await this.db
                .ref(`${this.dataRoot}/chats/messages/${roomId}`)
                .limitToLast(100)
                .once('value');

            if (!msgsSnap.exists()) return;

            const updates = {};
            msgsSnap.forEach(child => {
                const msg = child.val();
                if (!msg.readBy?.[this.currentUser.uid]) {
                    updates[`${child.key}/readBy/${this.currentUser.uid}`] = true;
                }
            });

            if (Object.keys(updates).length > 0) {
                await this.db
                    .ref(`${this.dataRoot}/chats/messages/${roomId}`)
                    .update(updates);
            }
        } catch (err) {
            console.error('[ChatManager] 既読処理エラー:', err);
        }
    }

    // =========================================================
    // 新規チャット作成
    // =========================================================

    // チャットタイプ切替（モーダル内）
    switchChatType(type) {
        this.chatType = type;
        this.selectedUserIds = [];

        document.getElementById('tabDirect').classList.toggle('active', type === 'direct');
        document.getElementById('tabGroup').classList.toggle('active', type === 'group');
        document.getElementById('groupNameSection').style.display =
            type === 'group' ? 'block' : 'none';

        const label = document.getElementById('userSelectLabel');
        if (label) {
            label.textContent = type === 'direct'
                ? 'チャットする相手を選択'
                : 'グループメンバーを選択（複数可）';
        }

        this._renderUserSelectList();
        this._updateCreateBtnState();
    }

    // ユーザー選択リストを描画
    _renderUserSelectList() {
        const container = document.getElementById('userSelectList');
        if (!container) return;

        if (this.allUsers.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:1.5rem; color:var(--text-secondary);">
                    ユーザーが見つかりません
                </div>`;
            return;
        }

        let html = '';
        this.allUsers.forEach(user => {
            const isSelected = this.selectedUserIds.includes(user.uid);
            const roleLabel  = user.role === 'admin'  ? '<span class="user-role-badge role-admin">管理者</span>'
                             : user.role === 'editor' ? '<span class="user-role-badge role-editor">編集者</span>'
                             : '';
            html += `
                <div class="user-select-item ${isSelected ? 'selected' : ''}"
                     onclick="window.chatManager.toggleUserSelect('${user.uid}')">
                    <div class="user-checkbox"></div>
                    <span class="user-display-name">${this._esc(user.displayName)}</span>
                    ${roleLabel}
                </div>`;
        });

        container.innerHTML = html;
    }

    toggleUserSelect(uid) {
        if (this.chatType === 'direct') {
            // 1対1は1人だけ選択
            this.selectedUserIds = this.selectedUserIds.includes(uid) ? [] : [uid];
        } else {
            // グループは複数選択
            const idx = this.selectedUserIds.indexOf(uid);
            if (idx >= 0) {
                this.selectedUserIds.splice(idx, 1);
            } else {
                this.selectedUserIds.push(uid);
            }
        }
        this._renderUserSelectList();
        this._updateCreateBtnState();
    }

    _updateCreateBtnState() {
        const btn = document.getElementById('createChatBtn');
        if (!btn) return;
        const valid = this.chatType === 'direct'
            ? this.selectedUserIds.length === 1
            : this.selectedUserIds.length >= 1;
        btn.disabled = !valid;
    }

    async createRoom() {
        if (this.selectedUserIds.length === 0) return;

        const btn = document.getElementById('createChatBtn');
        if (btn) btn.disabled = true;

        try {
            const allMemberUids = [this.currentUser.uid, ...this.selectedUserIds];

            if (this.chatType === 'direct') {
                // 1対1: 既存の direct ルームがあれば再利用
                const existingId = await this._findExistingDirectRoom(this.selectedUserIds[0]);
                if (existingId) {
                    document.getElementById('newChatModal').classList.remove('active');
                    this.selectRoom(existingId);
                    return;
                }
            }

            // ルーム名の決定
            let roomName = '';
            if (this.chatType === 'group') {
                const inputName = document.getElementById('groupNameInput').value.trim();
                if (inputName) {
                    roomName = inputName;
                } else {
                    // 参加者名を並べてグループ名に
                    const names = this.selectedUserIds
                        .map(uid => this.allUsers.find(u => u.uid === uid)?.displayName || uid)
                        .slice(0, 3);
                    roomName = names.join('、') + (this.selectedUserIds.length > 3 ? '...他' : '');
                }
            } else {
                // 1対1: 相手の名前をルーム名に
                const partner = this.allUsers.find(u => u.uid === this.selectedUserIds[0]);
                roomName = partner?.displayName || '1対1チャット';
            }

            // members を { uid: true } 形式に変換
            const members = {};
            allMemberUids.forEach(uid => { members[uid] = true; });

            // Firebase にルームを作成
            const ref  = this.db.ref(`${this.dataRoot}/chats/rooms`);
            const key  = ref.push().key;
            await ref.child(key).set({
                name       : roomName,
                type       : this.chatType,
                members    : members,
                createdBy  : this.currentUser.uid,
                createdAt  : Date.now(),
                lastMessage: '',
                lastMessageAt: Date.now(),
                unreadCount: {}
            });

            // モーダルを閉じて新しいルームを開く
            document.getElementById('newChatModal').classList.remove('active');
            document.getElementById('groupNameInput').value = '';
            this.selectedUserIds = [];

            setTimeout(() => this.selectRoom(key), 500);
            console.log('[ChatManager] ルーム作成完了:', roomName);

        } catch (err) {
            console.error('[ChatManager] ルーム作成エラー:', err);
            alert('チャットの作成に失敗しました。もう一度お試しください。');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 既存の 1対1 ルームを探す
    async _findExistingDirectRoom(partnerUid) {
        const entry = Object.entries(this.rooms).find(([, room]) => {
            if (room.type !== 'direct') return false;
            const memberUids = Object.keys(room.members || {});
            return memberUids.length === 2
                && memberUids.includes(this.currentUser.uid)
                && memberUids.includes(partnerUid);
        });
        return entry ? entry[0] : null;
    }

    // =========================================================
    // UI イベントバインド
    // =========================================================

    _bindUIEvents() {
        // 新規チャットボタン
        const newChatBtn = document.getElementById('newChatBtn');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', () => {
                this.chatType        = 'direct';
                this.selectedUserIds = [];
                document.getElementById('tabDirect').classList.add('active');
                document.getElementById('tabGroup').classList.remove('active');
                document.getElementById('groupNameSection').style.display = 'none';
                document.getElementById('groupNameInput').value = '';
                this._renderUserSelectList();
                this._updateCreateBtnState();
                document.getElementById('newChatModal').classList.add('active');
            });
        }

        // チャット作成ボタン
        const createChatBtn = document.getElementById('createChatBtn');
        if (createChatBtn) {
            createChatBtn.addEventListener('click', () => this.createRoom());
        }

        // 送信ボタン
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }

        // テキストエリア：Enter送信 / Shift+Enter改行
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            // 高さ自動調整
            chatInput.addEventListener('input', () => {
                chatInput.style.height = 'auto';
                chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
                const sendBtn = document.getElementById('sendBtn');
                if (sendBtn) sendBtn.disabled = chatInput.value.trim() === '';
            });
        }

        // モーダル外クリックで閉じる
        const modal = document.getElementById('newChatModal');
        if (modal) {
            modal.addEventListener('click', e => {
                if (e.target === modal) modal.classList.remove('active');
            });
        }

        // モバイル: 小画面でサイドバートグルボタン表示
        const toggleBtn = document.getElementById('sidebarToggleBtn');
        if (toggleBtn && window.innerWidth <= 520) {
            toggleBtn.style.display = 'inline-flex';
        }
    }

    // =========================================================
    // ユーティリティ
    // =========================================================

    _formatTime(timestamp) {
        if (!timestamp) return '';
        const d   = new Date(timestamp);
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');

        if (d.toDateString() === now.toDateString()) {
            return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        const diff = now - d;
        if (diff < 7 * 24 * 60 * 60 * 1000) {
            const days = ['日','月','火','水','木','金','土'];
            return days[d.getDay()] + '曜日';
        }
        return `${d.getMonth()+1}/${d.getDate()}`;
    }

    _formatDateOnly(timestamp) {
        if (!timestamp) return '';
        const d   = new Date(timestamp);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return '今日';
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return '昨日';
        return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
    }

    _formatTimeOnly(timestamp) {
        if (!timestamp) return '';
        const d   = new Date(timestamp);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // クリーンアップ
    destroy() {
        if (this.roomsListener) this.roomsListener.off();
        if (this.msgListener)   this.msgListener();
        console.log('[ChatManager] クリーンアップ完了');
    }
}

// =========================================================
// グローバル登録・自動起動
// =========================================================
window.chatManager = new ChatManager();

document.addEventListener('DOMContentLoaded', async () => {
    // AuthGuard で認証チェック
    if (window.AuthGuard) {
        const ok = await window.AuthGuard.init({ requireAuth: true });
        if (!ok) return;
    }
    await window.chatManager.init();
});

console.log('[ChatManager] モジュール読み込み完了');
