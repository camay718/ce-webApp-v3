/**
 * チャットシステム管理
 * Firebase Realtime Database連携
 */

(function() {
    'use strict';

    class ChatManager {
        constructor() {
            this.db = null;
            this.currentUser = null;
            this.selectedRoomId = null;
            this.chatType = 'direct';
            this.rooms = [];
            this.allUsers = [];
            this.messagesListener = null;
            this.init();
        }

        async init() {
            try {
                await this.waitForDependencies();
                this.loadCurrentUser();
                await this.loadAllUsers();
                this.setupFirebaseListeners();
                this.checkUrlParams();
                console.log('✅ チャットシステム初期化完了');
            } catch (error) {
                console.error('❌ 初期化エラー:', error);
                alert('システムの初期化に失敗しました。ページを再読み込みしてください。');
            }
        }

        async waitForDependencies() {
            let attempts = 0;
            while (attempts < 100) {
                if (window.database && window.DATA_ROOT && window.firebase) {
                    this.db = window.database;
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            throw new Error('Firebase初期化タイムアウト');
        }

        loadCurrentUser() {
            const userData = localStorage.getItem('currentUser');
            if (userData) {
                this.currentUser = JSON.parse(userData);
            } else {
                this.currentUser = { name: 'ゲストユーザー', role: 'user' };
            }
        }

        async loadAllUsers() {
            // CEリストから全ユーザーを取得
            const ceListRef = this.db.ref(`${window.DATA_ROOT}/ceList`);
            const snapshot = await ceListRef.once('value');
            const data = snapshot.val();

            if (data && data.list) {
                this.allUsers = data.list.map(ce => ({
                    id: ce.id || ce.name,
                    name: ce.name,
                    department: ce.workType || '未設定'
                }));
            } else if (Array.isArray(data)) {
                this.allUsers = data.map(ce => ({
                    id: ce.id || ce.name,
                    name: ce.name,
                    department: ce.workType || '未設定'
                }));
            } else {
                // フォールバック：基本ユーザーリスト
                this.allUsers = [
                    '安孫子明博', '八鍬純', '杉山陽子', '中村圭佑', '石山智之', 
                    '亀井祐哉', '丸藤健', '三春摩弥', '斎藤大樹', '田中隆昭', 
                    '宇井勇気', '宇野沢徹', '佐藤将志', '庄司由紀', '小沼和樹', 
                    '武田優斗', '設樂佑介', '伊藤大晟', '上松野聖', '笹生貴之', 
                    '和田彩花', '伊藤大稀', '佐藤千優', '桑島亜依', '村田七星', 
                    '小林将己', '寒河江悠輝'
                ].map(name => ({
                    id: name,
                    name: name,
                    department: '未設定'
                }));
            }

            this.renderUserSelectList();
        }

        checkUrlParams() {
            const urlParams = new URLSearchParams(window.location.search);
            const roomId = urlParams.get('room');
            if (roomId) {
                setTimeout(() => {
                    this.selectRoom(roomId);
                }, 1000);
            }
        }

        setupFirebaseListeners() {
            // チャットルームのリアルタイム監視
            const roomsRef = this.db.ref(`${window.DATA_ROOT}/chats/rooms`);
            roomsRef.on('value', snapshot => {
                const data = snapshot.val();
                if (data) {
                    this.rooms = Object.entries(data).map(([id, room]) => ({
                        id,
                        ...room
                    })).sort((a, b) => {
                        const aTime = a.lastMessage?.timestamp || 0;
                        const bTime = b.lastMessage?.timestamp || 0;
                        return bTime - aTime;
                    });
                } else {
                    this.rooms = [];
                }
                this.renderRoomList();
            });
        }

        renderRoomList() {
            const container = document.getElementById('roomList');
            
            if (this.rooms.length === 0) {
                container.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
                        <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
                        <p>チャットルームがありません</p>
                        <p style="font-size: 13px; margin-top: 8px;">新規チャットを作成してください</p>
                    </div>
                `;
                return;
            }

            const html = this.rooms.map(room => {
                const isGroup = room.type === 'group';
                const lastMsg = room.lastMessage;
                const timeStr = lastMsg?.timestamp ? this.formatTimeAgo(lastMsg.timestamp) : '';
                const unreadCount = room.unreadCount?.[this.currentUser.name] || 0;
                const isActive = this.selectedRoomId === room.id;

                return `
                    <div class="room-item ${isActive ? 'active' : ''}" onclick="chatManager.selectRoom('${room.id}')">
                        <div class="room-header">
                            <span class="room-name">
                                ${isGroup ? '<i class="fas fa-users"></i>' : '<i class="fas fa-user"></i>'}
                                ${room.name}
                                ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
                            </span>
                            <span class="room-time">${timeStr}</span>
                        </div>
                        <div class="room-preview">
                            ${lastMsg?.content || 'メッセージがありません'}
                        </div>
                        ${unreadCount === 0 && lastMsg?.readBy?.[this.currentUser.name] ? 
                            '<div class="read-status">✓✓ 既読</div>' : ''}
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        searchRooms(query) {
            const lowerQuery = query.toLowerCase();
            const items = document.querySelectorAll('.room-item');
            
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                if (text.includes(lowerQuery)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        }

        async selectRoom(roomId) {
            this.selectedRoomId = roomId;
            const room = this.rooms.find(r => r.id === roomId);
            
            if (!room) return;

            // 未読をリセット
            const unreadRef = this.db.ref(`${window.DATA_ROOT}/chats/rooms/${roomId}/unreadCount/${this.currentUser.name}`);
            await unreadRef.set(0);

            this.renderRoomList();
            this.renderChatArea(room);
            this.setupMessagesListener(roomId);
        }

        renderChatArea(room) {
            const chatArea = document.getElementById('chatArea');
            const isGroup = room.type === 'group';
            const memberCount = room.members ? room.members.length : 0;

            chatArea.innerHTML = `
                <div class="chat-header">
                    <div class="chat-header-info">
                        <div class="chat-avatar">${room.name.charAt(0)}</div>
                        <div>
                            <h3 class="chat-title">${room.name}</h3>
                            <div class="chat-members">
                                ${isGroup ? `${memberCount}人のメンバー` : 'オンライン'}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="messages-area" id="messagesArea">
                    <div class="loading-spinner">
                        <div class="spinner"></div>
                        <p>メッセージを読み込み中...</p>
                    </div>
                </div>
                <div class="message-input-area">
                    <div class="input-wrapper">
                        <textarea class="message-input" id="messageInput" placeholder="メッセージを入力..." 
                            onkeydown="chatManager.handleKeyPress(event)"></textarea>
                        <button class="send-btn" onclick="chatManager.sendMessage()">
                            <i class="fas fa-paper-plane"></i> 送信
                        </button>
                    </div>
                </div>
            `;
        }

        setupMessagesListener(roomId) {
            // 既存のリスナーを解除
            if (this.messagesListener) {
                this.messagesListener.off();
            }

            // メッセージのリアルタイム監視
            this.messagesListener = this.db.ref(`${window.DATA_ROOT}/chats/messages/${roomId}`);
            this.messagesListener.on('value', snapshot => {
                this.renderMessages(snapshot.val());
            });
        }

        renderMessages(data) {
            const container = document.getElementById('messagesArea');
            
            if (!data || Object.keys(data).length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">💬</div>
                        <p>メッセージがありません</p>
                        <p style="font-size: 13px; margin-top: 8px;">最初のメッセージを送信しましょう</p>
                    </div>
                `;
                return;
            }

            const messages = Object.entries(data).map(([id, msg]) => ({
                id,
                ...msg
            })).sort((a, b) => a.timestamp - b.timestamp);

            let currentDate = '';
            let html = '';

            messages.forEach(msg => {
                const msgDate = new Date(msg.timestamp).toLocaleDateString('ja-JP');
                
                if (msgDate !== currentDate) {
                    currentDate = msgDate;
                    html += `<div class="date-divider"><span>${msgDate}</span></div>`;
                }

                const isOwn = msg.sender === this.currentUser.name;
                const time = new Date(msg.timestamp).toLocaleTimeString('ja-JP', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });

                html += `
                    <div class="message ${isOwn ? 'own' : ''}">
                        ${!isOwn ? `<div class="message-avatar">${msg.sender.charAt(0)}</div>` : ''}
                        <div class="message-content">
                            ${!isOwn ? `<div class="message-sender">${msg.sender}</div>` : ''}
                            <div class="message-bubble">${msg.content}</div>
                            <div class="message-time">
                                ${time}
                                ${isOwn ? (msg.readBy && Object.keys(msg.readBy).length > 1 ? 
                                    '<span class="read-receipt">✓✓</span>' : '<span>✓</span>') : ''}
                            </div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;

            // スクロールを最下部へ
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 100);

            // 既読をマーク
            this.markMessagesAsRead(messages);
        }

        async markMessagesAsRead(messages) {
            if (!this.selectedRoomId) return;

            const unreadMessages = messages.filter(msg => 
                msg.sender !== this.currentUser.name && 
                (!msg.readBy || !msg.readBy[this.currentUser.name])
            );

            for (const msg of unreadMessages) {
                const readByRef = this.db.ref(
                    `${window.DATA_ROOT}/chats/messages/${this.selectedRoomId}/${msg.id}/readBy/${this.currentUser.name}`
                );
                await readByRef.set(true);
            }
        }

        async sendMessage() {
            if (!this.selectedRoomId) return;

            const input = document.getElementById('messageInput');
            const content = input.value.trim();

            if (!content) return;

            const messageData = {
                sender: this.currentUser.name,
                content: content,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                readBy: {
                    [this.currentUser.name]: true
                }
            };

            try {
                // メッセージを送信
                const messagesRef = this.db.ref(`${window.DATA_ROOT}/chats/messages/${this.selectedRoomId}`);
                await messagesRef.push(messageData);

                // ルームの最終メッセージを更新
                const roomRef = this.db.ref(`${window.DATA_ROOT}/chats/rooms/${this.selectedRoomId}`);
                await roomRef.update({
                    lastMessage: {
                        content: content,
                        timestamp: Date.now(),
                        sender: this.currentUser.name
                    }
                });

                // 他のメンバーの未読カウントを増やす
                const room = this.rooms.find(r => r.id === this.selectedRoomId);
                if (room && room.members) {
                    for (const member of room.members) {
                        if (member !== this.currentUser.name) {
                            const unreadRef = this.db.ref(
                                `${window.DATA_ROOT}/chats/rooms/${this.selectedRoomId}/unreadCount/${member}`
                            );
                            const snapshot = await unreadRef.once('value');
                            const currentCount = snapshot.val() || 0;
                            await unreadRef.set(currentCount + 1);
                        }
                    }
                }

                input.value = '';
            } catch (error) {
                console.error('メッセージ送信エラー:', error);
                alert('メッセージの送信に失敗しました');
            }
        }

        handleKeyPress(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.sendMessage();
            }
        }

        renderUserSelectList() {
            const container = document.getElementById('userSelectList');
            
            const html = this.allUsers
                .filter(user => user.name !== this.currentUser.name)
                .map(user => `
                    <label class="user-select-item">
                        <input type="checkbox" value="${user.id}" name="selectedUsers">
                        <div>
                            <div style="font-weight: 500;">${user.name}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">${user.department}</div>
                        </div>
                    </label>
                `).join('');

            container.innerHTML = html;
        }

        async createNewChat() {
            const selectedCheckboxes = document.querySelectorAll('input[name="selectedUsers"]:checked');
            const selectedUsers = Array.from(selectedCheckboxes).map(cb => {
                return this.allUsers.find(u => u.id == cb.value);
            });

            if (selectedUsers.length === 0) {
                alert('メンバーを選択してください');
                return;
            }

            if (this.chatType === 'direct' && selectedUsers.length > 1) {
                alert('1対1チャットでは1人のみ選択してください');
                return;
            }

            let roomName, members;

            if (this.chatType === 'direct') {
                roomName = selectedUsers[0].name;
                members = [this.currentUser.name, selectedUsers[0].name];
            } else {
                roomName = document.getElementById('groupName').value.trim() || '新しいグループ';
                members = [this.currentUser.name, ...selectedUsers.map(u => u.name)];
            }

            const roomData = {
                name: roomName,
                type: this.chatType,
                members: members,
                createdBy: this.currentUser.name,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                lastMessage: {
                    content: '',
                    timestamp: Date.now()
                }
            };

            try {
                const roomsRef = this.db.ref(`${window.DATA_ROOT}/chats/rooms`);
                const newRoomRef = await roomsRef.push(roomData);

                window.closeNewChatModal();
                alert('チャットを作成しました！');

                // 作成したルームを選択
                setTimeout(() => {
                    this.selectRoom(newRoomRef.key);
                }, 500);
            } catch (error) {
                console.error('チャット作成エラー:', error);
                alert('チャットの作成に失敗しました');
            }
        }

        formatTimeAgo(timestamp) {
            const now = Date.now();
            const diff = now - timestamp;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (minutes < 1) return '今';
            if (minutes < 60) return `${minutes}分前`;
            if (hours < 24) return `${hours}時間前`;
            if (days < 7) return `${days}日前`;
            
            return new Date(timestamp).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
        }
    }

    // グローバル関数
    window.openNewChatModal = function() {
        document.getElementById('newChatModal').classList.add('active');
    };

    window.closeNewChatModal = function() {
        document.getElementById('newChatModal').classList.remove('active');
        document.getElementById('groupName').value = '';
        const checkboxes = document.querySelectorAll('input[name="selectedUsers"]');
        checkboxes.forEach(cb => cb.checked = false);
    };

    window.selectChatType = function(type) {
        window.chatManager.chatType = type;
        
        const directBtn = document.getElementById('directBtn');
        const groupBtn = document.getElementById('groupBtn');
        const groupNameField = document.getElementById('groupNameField');
        const memberLabel = document.getElementById('memberLabel');

        if (type === 'direct') {
            directBtn.classList.add('active');
            groupBtn.classList.remove('active');
            groupNameField.style.display = 'none';
            memberLabel.textContent = '相手を選択';
        } else {
            directBtn.classList.remove('active');
            groupBtn.classList.add('active');
            groupNameField.style.display = 'block';
            memberLabel.textContent = 'メンバーを選択';
        }
    };

    // 初期化
    window.chatManager = new ChatManager();
})();
