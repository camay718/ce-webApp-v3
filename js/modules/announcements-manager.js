/**
 * お知らせ掲示板管理モジュール (Announcements Manager)
 * 
 * 依存ファイル:
 *   - js/config/firebase-config.js  （window.database, window.DATA_ROOT）
 *   - js/utils/auth-guard.js         （AuthGuard.getSession()）
 *   - js/modules/user-manager.js     （window.userManager ※任意）
 *   - js/constants.js                （window.DEPARTMENTS）
 * 
 * Firebase パス:
 *   ceScheduleV3/announcements/categories/{categoryId}
 *   ceScheduleV3/announcements/threads/{threadId}
 *   ceScheduleV3/announcements/threads/{threadId}/replies/{replyId}
 * 
 * 権限:
 *   投稿・返信  : 全ユーザー
 *   カテゴリ管理: editor 以上
 *   スレッド削除: admin のみ
 */

class AnnouncementsManager {
    constructor() {
        this.db            = null;
        this.dataRoot      = null;
        this.currentUser   = null;      // { uid, username, displayName, role }
        this.categories    = {};        // { categoryId: { name, icon, order, ... } }
        this.threads       = {};        // { threadId: { title, content, ... } }
        this.currentCategoryId = 'all'; // 選択中カテゴリ
        this.currentThreadId   = null;  // 詳細表示中スレッド
        this.listeners     = [];        // 解除用リスナー参照
    }

    // =========================================================
    // 初期化
    // =========================================================

    async init() {
        console.log('[AnnouncementsManager] 初期化開始');
        try {
            // 1. Firebase 待機
            await this._waitForFirebase();

            // 2. ログインユーザー取得
            await this._loadCurrentUser();

            // 3. カテゴリ初期化（初回のみデフォルト作成）
            await this._initCategories();

            // 4. リアルタイムリスナー設定
            this._setupListeners();

            // 5. UI イベントバインド
            this._bindUIEvents();

            // 6. 権限に応じてボタン表示制御
            this._applyPermissions();

            console.log('[AnnouncementsManager] ✅ 初期化完了');
        } catch (err) {
            console.error('[AnnouncementsManager] ❌ 初期化失敗:', err);
        }
    }

    // Firebase 依存の待機
    async _waitForFirebase() {
        // firebase-config.js が提供する Promise を優先使用
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

    // ログインユーザー情報を取得
    async _loadCurrentUser() {
        // user-manager.js が初期化済みであればそちらを優先
        if (window.userManager?.currentUser) {
            this.currentUser = window.userManager.currentUser;
            console.log('[AnnouncementsManager] userManager からユーザー取得:', this.currentUser);
            return;
        }

        // AuthGuard のセッションから取得
        const session = window.AuthGuard ? window.AuthGuard.getSession() : null;
        if (session?.uid) {
            // Firebase の users/{uid} から詳細を取得
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
            // フォールバック（開発中 admin）
            this.currentUser = { uid: 'admin', username: 'admin', displayName: '管理者', role: 'admin' };
            console.warn('[AnnouncementsManager] セッション情報なし。admin でフォールバック');
        }
        console.log('[AnnouncementsManager] currentUser:', this.currentUser);
    }

    // =========================================================
    // カテゴリ初期化
    // =========================================================

    // デフォルトカテゴリ定義
    _getDefaultCategories() {
        // constants.js の DEPARTMENTS を活用
        const deptIcons = {
            '機器管理・人工呼吸'             : '🫁',
            '血液浄化'                       : '🩸',
            '不整脈'                         : '💓',
            '心・カテーテル'                 : '❤️',
            '人工心肺・補助循環'             : '🫀',
            '手術・麻酔'                     : '🏥',
            '会議・ミーティング・勉強会・打ち合わせ': '💬',
            '出張・研修内容'                 : '✈️',
            'その他・連絡'                   : 'ℹ️'
        };

        const defaults = [
            { name: '重要なお知らせ', icon: '🔴', order: 0 },
            { name: '全体業務連絡',   icon: '📢', order: 1 }
        ];

        // constants.js の DEPARTMENTS 順に追加
        const departments = window.DEPARTMENTS || Object.keys(deptIcons);
        departments.forEach((dept, i) => {
            defaults.push({
                name : dept,
                icon : deptIcons[dept] || '📌',
                order: i + 2
            });
        });

        return defaults;
    }

    async _initCategories() {
        const ref  = this.db.ref(`${this.dataRoot}/announcements/categories`);
        const snap = await ref.once('value');

        if (!snap.exists()) {
            console.log('[AnnouncementsManager] デフォルトカテゴリを作成します');
            const defaults = this._getDefaultCategories();
            const batch = {};
            defaults.forEach(cat => {
                const key     = ref.push().key;
                batch[key] = {
                    ...cat,
                    createdAt: new Date().toISOString(),
                    createdBy: this.currentUser.uid
                };
            });
            await ref.set(batch);
        }
    }

    // =========================================================
    // リアルタイムリスナー
    // =========================================================

    _setupListeners() {
        // カテゴリ監視
        const catRef = this.db.ref(`${this.dataRoot}/announcements/categories`);
        catRef.on('value', snap => {
            this.categories = snap.exists() ? snap.val() : {};
            this._renderCategories();
            this._populateCategorySelect();
        });
        this.listeners.push({ ref: catRef, event: 'value' });

        // スレッド監視
        const thrRef = this.db.ref(`${this.dataRoot}/announcements/threads`);
        thrRef.on('value', snap => {
            this.threads = snap.exists() ? snap.val() : {};
            this._renderThreads(this.currentCategoryId);
        });
        this.listeners.push({ ref: thrRef, event: 'value' });
    }

    // =========================================================
    // レンダリング
    // =========================================================

    // カテゴリサイドバーを描画
    _renderCategories() {
        const container = document.getElementById('categoriesList');
        if (!container) return;

        // 「すべて」ボタン
        const allCount = Object.keys(this.threads).length;
        let html = `
            <div class="category-item ${this.currentCategoryId === 'all' ? 'active' : ''}"
                 onclick="window.announcementsManager.selectCategory('all')">
                <span class="category-icon">📋</span>
                <span class="category-name">すべて</span>
                <span class="category-count">${allCount}</span>
            </div>`;

        // カテゴリ一覧（order 順）
        const sorted = Object.entries(this.categories)
            .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

        sorted.forEach(([id, cat]) => {
            const count = Object.values(this.threads)
                .filter(t => t.category === id).length;
            const isActive = this.currentCategoryId === id;
            html += `
                <div class="category-item ${isActive ? 'active' : ''}"
                     onclick="window.announcementsManager.selectCategory('${id}')">
                    <span class="category-icon">${cat.icon || '📌'}</span>
                    <span class="category-name">${this._esc(cat.name)}</span>
                    ${count > 0 ? `<span class="category-count">${count}</span>` : ''}
                </div>`;
        });

        container.innerHTML = html;
    }

    // スレッド一覧を描画
    _renderThreads(categoryId) {
        const container = document.getElementById('threadsList');
        const titleEl   = document.getElementById('currentCategoryTitle');
        const countEl   = document.getElementById('threadCount');
        if (!container) return;

        // フィルタリング
        let filtered = Object.entries(this.threads);
        if (categoryId !== 'all') {
            filtered = filtered.filter(([, t]) => t.category === categoryId);
        }

        // 新しい順にソート
        filtered.sort(([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0));

        // タイトル更新
        if (categoryId === 'all') {
            if (titleEl) titleEl.textContent = 'すべてのお知らせ';
        } else {
            const cat = this.categories[categoryId];
            if (titleEl) titleEl.textContent = cat ? `${cat.icon} ${cat.name}` : 'お知らせ';
        }
        if (countEl) countEl.textContent = filtered.length;

        // 空の場合
        if (filtered.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:4rem; color:var(--text-secondary);">
                    <i class="fas fa-inbox" style="font-size:3rem; margin-bottom:1rem; display:block;"></i>
                    まだ投稿がありません
                </div>`;
            return;
        }

        // スレッドカード描画
        const now = Date.now();
        const NEW_THRESHOLD = 3 * 24 * 60 * 60 * 1000; // 3日以内は NEW

        let html = '';
        filtered.forEach(([id, thread]) => {
            const isNew     = (now - (thread.timestamp || 0)) < NEW_THRESHOLD;
            const catName   = this.categories[thread.category]?.name || thread.category || '未分類';
            const catIcon   = this.categories[thread.category]?.icon || '📌';
            const replyCount = thread.replies ? Object.keys(thread.replies).length : 0;
            const dateStr   = this._formatDate(thread.timestamp);

            html += `
                <div class="thread-card" onclick="window.announcementsManager.openThread('${id}')">
                    <div class="thread-header">
                        <div>
                            <div class="thread-title">
                                ${isNew ? '<span class="new-badge">NEW</span>' : ''}
                                ${this._esc(thread.title)}
                            </div>
                            <div class="thread-meta">
                                <span><i class="fas fa-tag" style="color:var(--accent-color);"></i>
                                    ${catIcon} ${this._esc(catName)}</span>
                                <span><i class="fas fa-user"></i> ${this._esc(thread.authorName || '不明')}</span>
                                <span><i class="fas fa-calendar"></i> ${dateStr}</span>
                            </div>
                        </div>
                        <div class="thread-stats">
                            <span class="stat-item">
                                <i class="fas fa-comments"></i> ${replyCount}
                            </span>
                            <span class="stat-item">
                                <i class="fas fa-eye"></i> ${thread.views || 0}
                            </span>
                        </div>
                    </div>
                    ${thread.content ? `
                    <p style="color:var(--text-secondary); font-size:0.875rem;
                              overflow:hidden; display:-webkit-box;
                              -webkit-line-clamp:2; -webkit-box-orient:vertical;">
                        ${this._esc(thread.content)}
                    </p>` : ''}
                </div>`;
        });

        container.innerHTML = html;
    }

    // カテゴリ選択
    selectCategory(categoryId) {
        this.currentCategoryId = categoryId;
        this._renderCategories();
        this._renderThreads(categoryId);
    }

    // =========================================================
    // スレッド詳細
    // =========================================================

    async openThread(threadId) {
        const thread = this.threads[threadId];
        if (!thread) return;

        this.currentThreadId = threadId;

        // 閲覧数カウントアップ
        this.db.ref(`${this.dataRoot}/announcements/threads/${threadId}/views`)
            .transaction(v => (v || 0) + 1);

        // モーダルに情報をセット
        document.getElementById('threadDetailTitle').textContent = thread.title || '';
        document.getElementById('threadDetailAuthor').textContent = thread.authorName || '不明';
        document.getElementById('threadDetailDate').textContent   = this._formatDate(thread.timestamp);
        document.getElementById('threadDetailViews').textContent  = (thread.views || 0) + 1;
        document.getElementById('threadDetailContent').textContent = thread.content || '';

        // 削除ボタン表示（admin のみ）
        const adminActions = document.getElementById('adminActions');
        if (adminActions) {
            adminActions.style.display =
                this.currentUser.role === 'admin' ? 'block' : 'none';
        }

        // 返信を読み込む
        await this._loadReplies(threadId);

        // モーダルを開く
        document.getElementById('threadDetailModal').classList.add('active');
    }

    async _loadReplies(threadId) {
        const repliesRef  = this.db.ref(
            `${this.dataRoot}/announcements/threads/${threadId}/replies`
        );
        const snap = await repliesRef.once('value');
        const replies = snap.exists() ? snap.val() : {};
        this._renderReplies(replies);

        // リアルタイム更新（既存リスナーを解除してから再設定）
        repliesRef.off('value');
        repliesRef.on('value', s => {
            this._renderReplies(s.exists() ? s.val() : {});
        });
    }

    _renderReplies(replies) {
        const container = document.getElementById('repliesList');
        const countEl   = document.getElementById('replyCount');
        if (!container) return;

        const sorted = Object.entries(replies)
            .sort(([, a], [, b]) => (a.timestamp || 0) - (b.timestamp || 0));

        if (countEl) countEl.textContent = sorted.length;

        if (sorted.length === 0) {
            container.innerHTML = `
                <p style="color:var(--text-secondary); text-align:center; padding:1.5rem;">
                    まだ返信がありません。最初の返信を投稿しましょう！
                </p>`;
            return;
        }

        let html = '';
        sorted.forEach(([, reply]) => {
            html += `
                <div class="reply-card">
                    <div class="reply-header">
                        <span class="reply-author">
                            <i class="fas fa-user-circle"></i>
                            ${this._esc(reply.authorName || '不明')}
                        </span>
                        <span>${this._formatDate(reply.timestamp)}</span>
                    </div>
                    <div class="reply-content">${this._esc(reply.content)}</div>
                </div>`;
        });

        container.innerHTML = html;
    }

    // =========================================================
    // 投稿・返信・削除
    // =========================================================

    async submitPost(e) {
        e.preventDefault();
        const category = document.getElementById('postCategory').value;
        const title    = document.getElementById('postTitle').value.trim();
        const content  = document.getElementById('postContent').value.trim();

        if (!title || !content || !category) {
            alert('カテゴリ・タイトル・内容をすべて入力してください。');
            return;
        }

        try {
            const ref  = this.db.ref(`${this.dataRoot}/announcements/threads`);
            const key  = ref.push().key;
            await ref.child(key).set({
                title     : title,
                content   : content,
                category  : category,
                authorUid : this.currentUser.uid,
                authorName: this.currentUser.displayName,
                timestamp : Date.now(),
                views     : 0
            });

            // 監査ログ
            if (window.auditLogger?.log) {
                window.auditLogger.log('announcement_post', { title });
            }

            // フォームリセット＆モーダルを閉じる
            document.getElementById('newPostForm').reset();
            document.getElementById('newPostModal').classList.remove('active');
            console.log('[AnnouncementsManager] 投稿完了:', title);
        } catch (err) {
            console.error('[AnnouncementsManager] 投稿エラー:', err);
            alert('投稿に失敗しました。もう一度お試しください。');
        }
    }

    async submitReply(e) {
        e.preventDefault();
        const content = document.getElementById('replyContent').value.trim();
        if (!content || !this.currentThreadId) return;

        try {
            const ref = this.db.ref(
                `${this.dataRoot}/announcements/threads/${this.currentThreadId}/replies`
            );
            const key = ref.push().key;
            await ref.child(key).set({
                content   : content,
                authorUid : this.currentUser.uid,
                authorName: this.currentUser.displayName,
                timestamp : Date.now()
            });

            document.getElementById('replyContent').value = '';
            console.log('[AnnouncementsManager] 返信完了');
        } catch (err) {
            console.error('[AnnouncementsManager] 返信エラー:', err);
            alert('返信に失敗しました。もう一度お試しください。');
        }
    }

    async deleteThread() {
        if (this.currentUser.role !== 'admin') {
            alert('スレッドの削除は管理者のみ可能です。');
            return;
        }
        if (!this.currentThreadId) return;

        const thread = this.threads[this.currentThreadId];
        if (!confirm(`「${thread?.title}」を削除しますか？\nこの操作は取り消せません。`)) return;

        try {
            await this.db.ref(
                `${this.dataRoot}/announcements/threads/${this.currentThreadId}`
            ).remove();

            document.getElementById('threadDetailModal').classList.remove('active');
            this.currentThreadId = null;

            // 監査ログ
            if (window.auditLogger?.log) {
                window.auditLogger.log('announcement_delete', { title: thread?.title });
            }
            console.log('[AnnouncementsManager] スレッド削除完了');
        } catch (err) {
            console.error('[AnnouncementsManager] 削除エラー:', err);
            alert('削除に失敗しました。もう一度お試しください。');
        }
    }

    // =========================================================
    // カテゴリ管理
    // =========================================================

    async addCategory() {
        if (!['admin', 'editor'].includes(this.currentUser.role)) {
            alert('カテゴリの追加は編集者以上の権限が必要です。');
            return;
        }

        const input = document.getElementById('newCategoryName');
        const name  = input.value.trim();
        if (!name) {
            alert('カテゴリ名を入力してください。');
            return;
        }

        // 重複チェック
        const exists = Object.values(this.categories)
            .some(c => c.name === name);
        if (exists) {
            alert('同じ名前のカテゴリが既に存在します。');
            return;
        }

        try {
            const ref  = this.db.ref(`${this.dataRoot}/announcements/categories`);
            const key  = ref.push().key;
            const maxOrder = Object.values(this.categories)
                .reduce((max, c) => Math.max(max, c.order ?? 0), 0);

            await ref.child(key).set({
                name     : name,
                icon     : '📌',
                order    : maxOrder + 1,
                createdAt: new Date().toISOString(),
                createdBy: this.currentUser.uid
            });

            input.value = '';
            console.log('[AnnouncementsManager] カテゴリ追加:', name);
        } catch (err) {
            console.error('[AnnouncementsManager] カテゴリ追加エラー:', err);
            alert('カテゴリの追加に失敗しました。');
        }
    }

    async deleteCategory(categoryId) {
        if (this.currentUser.role !== 'admin') {
            alert('カテゴリの削除は管理者のみ可能です。');
            return;
        }

        const cat = this.categories[categoryId];
        if (!confirm(`カテゴリ「${cat?.name}」を削除しますか？\n※このカテゴリのスレッドは「未分類」として残ります。`)) return;

        try {
            await this.db.ref(
                `${this.dataRoot}/announcements/categories/${categoryId}`
            ).remove();
            console.log('[AnnouncementsManager] カテゴリ削除:', cat?.name);
        } catch (err) {
            console.error('[AnnouncementsManager] カテゴリ削除エラー:', err);
            alert('カテゴリの削除に失敗しました。');
        }
    }

    // カテゴリ管理モーダルの一覧を描画
    _renderCategoryManageList() {
        const container = document.getElementById('categoryManageList');
        if (!container) return;

        const sorted = Object.entries(this.categories)
            .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

        if (sorted.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary)">カテゴリがありません</p>';
            return;
        }

        const isAdmin = this.currentUser.role === 'admin';
        let html = '';
        sorted.forEach(([id, cat]) => {
            const count = Object.values(this.threads)
                .filter(t => t.category === id).length;
            html += `
                <div class="category-manage-item">
                    <div>
                        <span style="font-size:1.25rem; margin-right:0.5rem;">${cat.icon || '📌'}</span>
                        <span class="category-manage-name">${this._esc(cat.name)}</span>
                        <span style="color:var(--text-secondary); font-size:0.8rem; margin-left:0.5rem;">
                            (${count}件)
                        </span>
                    </div>
                    ${isAdmin ? `
                    <button class="btn-delete"
                            onclick="window.announcementsManager.deleteCategory('${id}')">
                        <i class="fas fa-trash"></i>
                    </button>` : '<span style="color:var(--text-secondary);font-size:0.75rem;">削除不可</span>'}
                </div>`;
        });

        container.innerHTML = html;
    }

    // 投稿フォームのセレクトを更新
    _populateCategorySelect() {
        const select = document.getElementById('postCategory');
        if (!select) return;

        const sorted = Object.entries(this.categories)
            .sort(([, a], [, b]) => (a.order ?? 99) - (b.order ?? 99));

        select.innerHTML = '<option value="">カテゴリを選択してください</option>';
        sorted.forEach(([id, cat]) => {
            const opt   = document.createElement('option');
            opt.value   = id;
            opt.textContent = `${cat.icon || ''} ${cat.name}`;
            select.appendChild(opt);
        });
    }

    // =========================================================
    // UI イベントバインド
    // =========================================================

    _bindUIEvents() {
        // 新規投稿ボタン
        const newPostBtn = document.getElementById('newPostBtn');
        if (newPostBtn) {
            newPostBtn.addEventListener('click', () => {
                document.getElementById('newPostModal').classList.add('active');
            });
        }

        // 投稿フォーム送信
        const newPostForm = document.getElementById('newPostForm');
        if (newPostForm) {
            newPostForm.addEventListener('submit', e => this.submitPost(e));
        }

        // カテゴリ管理ボタン
        const catManageBtn = document.getElementById('categoryManageBtn');
        if (catManageBtn) {
            catManageBtn.addEventListener('click', () => {
                this._renderCategoryManageList();
                document.getElementById('categoryManageModal').classList.add('active');
            });
        }

        // カテゴリ追加ボタン
        const addCatBtn = document.getElementById('addCategoryBtn');
        if (addCatBtn) {
            addCatBtn.addEventListener('click', () => this.addCategory());
        }

        // 返信フォーム送信
        const replyForm = document.getElementById('replyForm');
        if (replyForm) {
            replyForm.addEventListener('submit', e => this.submitReply(e));
        }

        // スレッド削除ボタン
        const delBtn = document.getElementById('deleteThreadBtn');
        if (delBtn) {
            delBtn.addEventListener('click', () => this.deleteThread());
        }

        // モーダル外クリックで閉じる
        ['newPostModal', 'categoryManageModal', 'threadDetailModal'].forEach(id => {
            const modal = document.getElementById(id);
            if (modal) {
                modal.addEventListener('click', e => {
                    if (e.target === modal) modal.classList.remove('active');
                });
            }
        });
    }

    // =========================================================
    // 権限による表示制御
    // =========================================================

    _applyPermissions() {
        const role = this.currentUser.role;

        // カテゴリ管理ボタン：editor 以上のみ表示
        const catManageBtn = document.getElementById('categoryManageBtn');
        if (catManageBtn) {
            catManageBtn.style.display =
                ['admin', 'editor'].includes(role) ? 'inline-flex' : 'none';
        }
    }

    // =========================================================
    // ユーティリティ
    // =========================================================

    _formatDate(timestamp) {
        if (!timestamp) return '日時不明';
        const d = new Date(timestamp);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} `
             + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

    // リスナー解除（ページ離脱時）
    destroy() {
        this.listeners.forEach(({ ref, event }) => ref.off(event));
        // 返信リスナーも解除
        if (this.currentThreadId) {
            this.db.ref(
                `${this.dataRoot}/announcements/threads/${this.currentThreadId}/replies`
            ).off('value');
        }
        console.log('[AnnouncementsManager] クリーンアップ完了');
    }
}

// =========================================================
// グローバル登録・自動起動
// =========================================================
window.announcementsManager = new AnnouncementsManager();

document.addEventListener('DOMContentLoaded', async () => {
    // AuthGuard で認証チェック（未ログインなら index.html へリダイレクト）
    if (window.AuthGuard) {
        const ok = await window.AuthGuard.init({ requireAuth: true });
        if (!ok) return;
    }
    // 初期化実行
    await window.announcementsManager.init();
});

console.log('[AnnouncementsManager] モジュール読み込み完了');
