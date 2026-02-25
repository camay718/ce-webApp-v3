// ============================================================
// js/modules/announcements-manager.js
// お知らせ管理モジュール（バグ修正版）
// ============================================================

class AnnouncementsManager {
  constructor() {
    this.currentUser    = null;
    this.categories     = {};
    this.threads        = {};
    this.currentCategoryId = null;
    this.currentThreadId   = null;
    this._catListener      = null;
    this._threadListener   = null;
    this._replyListener    = null;
    this._db   = null;
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
      await this._initCategories();   // デフォルトカテゴリ作成
      this._setupListeners();         // リアルタイム監視
      this._bindEvents();             // ボタンイベント
      this._applyPermissions();       // 権限に応じた表示制御

      // URLパラメータでスレッドを直接開く
      const params = new URLSearchParams(location.search);
      const threadId = params.get('thread');
      if (threadId) setTimeout(() => this.openThread(threadId), 800);

      console.log('✅ AnnouncementsManager 初期化完了');
    } catch (e) {
      console.error('❌ AnnouncementsManager 初期化エラー:', e);
    }
  }

  async _waitForFirebase() {
    for (let i = 0; i < 50; i++) {
      if (window.database && window.DATA_ROOT) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Firebase 初期化タイムアウト');
  }

  // ─────────────────────────────────────────
  // ユーザー読み込み
  // ─────────────────────────────────────────
  async _loadCurrentUser() {
    const uid      = sessionStorage.getItem('targetUID');
    const username = sessionStorage.getItem('currentUsername');
    const role     = sessionStorage.getItem('userRole') || 'viewer';

    if (!uid || !username) {
      alert('ログインが必要です');
      location.href = '../index.html';
      throw new Error('未認証');
    }

    const snap = await this._db.ref(`${this._root}/users/${uid}`).once('value');
    const data = snap.val() || {};
    this.currentUser = {
      uid,
      username:    data.username    || username,
      displayName: data.displayName || data.username || username,
      role:        data.role        || role,
    };
  }

  // ─────────────────────────────────────────
  // デフォルトカテゴリ初期化
  // ─────────────────────────────────────────
  async _initCategories() {
    const snap = await this._db.ref(`${this._root}/announcements/categories`).once('value');
    if (snap.exists()) return; // 既にある場合はスキップ

    const depts = window.DEPARTMENTS || [
      '業務A','業務B','業務C','業務D','業務E',
      '業務F','業務G','業務H','業務I'
    ];
    const defaults = [
      { name: '重要なお知らせ',    icon: '📢', order: 0 },
      { name: '業務連絡全般',      icon: '📋', order: 1 },
      ...depts.map((d, i) => ({ name: d, icon: '🏢', order: i + 2 })),
    ];

    const updates = {};
    defaults.forEach(cat => {
      const key = this._db.ref(`${this._root}/announcements/categories`).push().key;
      updates[`${this._root}/announcements/categories/${key}`] = {
        ...cat,
        createdAt: Date.now(),
        createdBy: this.currentUser?.uid || 'system',
      };
    });
    await this._db.ref().update(updates);
    console.log('✅ デフォルトカテゴリ作成完了');
  }

  // ─────────────────────────────────────────
  // リアルタイムリスナー
  // ─────────────────────────────────────────
  _setupListeners() {
    // カテゴリ
    this._catListener = this._db.ref(`${this._root}/announcements/categories`)
      .orderByChild('order').on('value', snap => {
        this.categories = snap.val() || {};
        this._renderCategories();
      });

    // スレッド
    this._threadListener = this._db.ref(`${this._root}/announcements/threads`)
      .orderByChild('timestamp').on('value', snap => {
        this.threads = snap.val() || {};
        this._renderThreads(this.currentCategoryId);
      });
  }

  // ─────────────────────────────────────────
  // カテゴリ描画
  // ─────────────────────────────────────────
  _renderCategories() {
    const sidebar = document.getElementById('categoriesSidebar');
    if (!sidebar) return;

    const cats = Object.entries(this.categories)
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    if (cats.length === 0) {
      sidebar.innerHTML = `<div style="padding:16px;color:#888;font-size:0.85rem;">カテゴリなし</div>`;
      return;
    }

    sidebar.innerHTML = [
      `<div class="cat-item ${this.currentCategoryId === null ? 'active' : ''}"
           onclick="announcementsManager.selectCategory(null)"
           style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;">
        📌 <span>すべて</span>
      </div>`,
      ...cats.map(([id, cat]) => {
        const count = Object.values(this.threads).filter(t => t.category === id).length;
        return `
          <div class="cat-item ${this.currentCategoryId === id ? 'active' : ''}"
               onclick="announcementsManager.selectCategory('${id}')"
               style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;border-left:3px solid transparent;">
            <span>${this._esc(cat.icon || '📁')} ${this._esc(cat.name)}</span>
            ${count > 0 ? `<span style="background:#4ade80;color:#111;border-radius:10px;padding:2px 8px;font-size:0.75rem;font-weight:600;">${count}</span>` : ''}
          </div>`;
      })
    ].join('');

    // active スタイル適用
    sidebar.querySelectorAll('.cat-item').forEach(el => {
      el.style.borderLeftColor = el.classList.contains('active') ? 'var(--brand-primary, #4ade80)' : 'transparent';
      el.style.background = el.classList.contains('active') ? 'rgba(74,222,128,0.08)' : '';
    });

    // 初期選択
    if (this.currentCategoryId === null) {
      this._renderThreads(null);
    }
  }

  selectCategory(categoryId) {
    this.currentCategoryId = categoryId;
    this._renderCategories();
    this._renderThreads(categoryId);
  }

  // ─────────────────────────────────────────
  // スレッド描画
  // ─────────────────────────────────────────
  _renderThreads(categoryId) {
    const container = document.getElementById('threadsContainer');
    const titleEl   = document.getElementById('currentCategoryTitle');
    const countEl   = document.getElementById('threadCount');
    if (!container) return;

    let filtered = Object.entries(this.threads)
      .map(([id, t]) => ({ id, ...t }))
      .filter(t => categoryId === null || t.category === categoryId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (titleEl) {
      titleEl.textContent = categoryId
        ? (this.categories[categoryId]?.name || 'カテゴリ')
        : 'すべてのお知らせ';
    }
    if (countEl) countEl.textContent = `${filtered.length} 件`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-muted,#888);">
          <div style="font-size:2.5rem;margin-bottom:12px;">📭</div>
          <p>投稿がありません</p>
        </div>`;
      return;
    }

    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    container.innerHTML = filtered.map(thread => {
      const isNew     = (thread.timestamp || 0) > threeDaysAgo;
      const dateStr   = thread.timestamp
        ? new Date(thread.timestamp).toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(/\//g, '.')
        : '';
      const replyCount = thread.replies ? Object.keys(thread.replies).length : 0;
      const catName    = this.categories[thread.category]?.name || '';

      return `
        <div class="thread-item" onclick="announcementsManager.openThread('${thread.id}')"
             style="padding:16px;border-bottom:1px solid var(--glass-border,rgba(255,255,255,0.07));cursor:pointer;transition:background 0.2s;"
             onmouseover="this.style.background='rgba(255,255,255,0.03)'"
             onmouseout="this.style.background=''">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <span style="font-size:0.95rem;font-weight:600;color:var(--text-color,#e0e0e0);">${this._esc(thread.title || '無題')}</span>
                ${isNew ? '<span style="background:#ef4444;color:white;padding:2px 7px;border-radius:8px;font-size:0.72rem;font-weight:700;">NEW</span>' : ''}
                ${catName ? `<span style="background:rgba(74,222,128,0.15);color:#4ade80;padding:2px 8px;border-radius:8px;font-size:0.72rem;">${this._esc(catName)}</span>` : ''}
              </div>
              <div style="font-size:0.82rem;color:var(--text-muted,#888);display:flex;gap:16px;flex-wrap:wrap;">
                <span><i class="far fa-user"></i> ${this._esc(thread.authorName || thread.author || '匿名')}</span>
                <span><i class="far fa-clock"></i> ${dateStr}</span>
                <span><i class="far fa-comment"></i> ${replyCount}件</span>
                <span><i class="far fa-eye"></i> ${thread.views || 0}</span>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ─────────────────────────────────────────
  // スレッド詳細
  // ─────────────────────────────────────────
  async openThread(threadId) {
    const thread = this.threads[threadId];
    if (!thread) {
      // Firebase から直接取得
      const snap = await this._db.ref(`${this._root}/announcements/threads/${threadId}`).once('value');
      if (!snap.exists()) { alert('スレッドが見つかりません'); return; }
      this.threads[threadId] = { id: threadId, ...snap.val() };
    }
    this.currentThreadId = threadId;

    // 閲覧数カウントアップ
    this._db.ref(`${this._root}/announcements/threads/${threadId}/views`)
      .transaction(v => (v || 0) + 1);

    this._showThreadModal(this.threads[threadId]);
    this._loadReplies(threadId);
  }

  _showThreadModal(thread) {
    const modal = document.getElementById('threadDetailModal');
    if (!modal) return;

    const dateStr = thread.timestamp
      ? new Date(thread.timestamp).toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(/\//g, '.')
      : '';
    const isAdmin = this.currentUser?.role === 'admin';

    document.getElementById('modalThreadTitle').textContent   = thread.title || '無題';
    document.getElementById('modalThreadAuthor').textContent  = thread.authorName || thread.author || '匿名';
    document.getElementById('modalThreadDate').textContent    = dateStr;
    document.getElementById('modalThreadContent').innerHTML   = this._esc(thread.content || '').replace(/\n/g, '<br>');

    const deleteBtn = document.getElementById('deleteThreadBtn');
    if (deleteBtn) deleteBtn.style.display = isAdmin ? 'inline-flex' : 'none';

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  _loadReplies(threadId) {
    if (this._replyListener) {
      this._db.ref(`${this._root}/announcements/threads/${this._replyListenerThreadId}/replies`).off();
    }
    this._replyListenerThreadId = threadId;
    this._replyListener = this._db.ref(`${this._root}/announcements/threads/${threadId}/replies`)
      .orderByChild('timestamp').on('value', snap => {
        this._renderReplies(snap.val() || {});
      });
  }

  _renderReplies(replies) {
    const container = document.getElementById('repliesContainer');
    if (!container) return;
    const list = Object.entries(replies)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:#888;font-size:0.85rem;">返信はありません</div>`;
      return;
    }

    container.innerHTML = list.map(r => {
      const dateStr = r.timestamp
        ? new Date(r.timestamp).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(/\//g, '.')
        : '';
      return `
        <div style="padding:12px;border-left:3px solid var(--brand-primary,#4ade80);background:var(--surface-0,rgba(20,20,40,0.5));border-radius:0 8px 8px 0;margin-bottom:10px;">
          <div style="font-size:0.82rem;color:var(--text-muted,#888);margin-bottom:6px;">
            <strong style="color:var(--text-color,#e0e0e0);">${this._esc(r.authorName || '匿名')}</strong>　${dateStr}
          </div>
          <div style="font-size:0.9rem;color:var(--text-color,#e0e0e0);">${this._esc(r.content || '').replace(/\n/g,'<br>')}</div>
        </div>`;
    }).join('');
  }

  // ─────────────────────────────────────────
  // 新規投稿
  // ─────────────────────────────────────────
  async submitPost() {
    const title    = document.getElementById('postTitle')?.value.trim();
    const content  = document.getElementById('postContent')?.value.trim();
    const catSelect= document.getElementById('postCategory');
    const catId    = catSelect?.value || '';

    if (!title)   { alert('タイトルを入力してください'); return; }
    if (!content) { alert('内容を入力してください'); return; }
    if (!catId)   { alert('カテゴリを選択してください'); return; }

    const btn = document.getElementById('submitPostBtn');
    if (btn) btn.disabled = true;

    try {
      const ref = this._db.ref(`${this._root}/announcements/threads`).push();
      await ref.set({
        title,
        content,
        category:   catId,
        authorUid:  this.currentUser.uid,
        authorName: this.currentUser.displayName,
        timestamp:  Date.now(),
        views:      0,
      });
      this._closeNewPostModal();
      // 投稿したカテゴリへ移動
      this.selectCategory(catId);
    } catch (e) {
      console.error('投稿エラー:', e);
      alert('投稿に失敗しました');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─────────────────────────────────────────
  // 返信
  // ─────────────────────────────────────────
  async submitReply() {
    const textarea = document.getElementById('replyInput');
    const content  = textarea?.value.trim();
    if (!content || !this.currentThreadId) return;

    const btn = document.getElementById('submitReplyBtn');
    if (btn) btn.disabled = true;

    try {
      const ref = this._db.ref(`${this._root}/announcements/threads/${this.currentThreadId}/replies`).push();
      await ref.set({
        content,
        authorUid:  this.currentUser.uid,
        authorName: this.currentUser.displayName,
        timestamp:  Date.now(),
      });
      textarea.value = '';
    } catch (e) {
      console.error('返信エラー:', e);
      alert('返信に失敗しました');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─────────────────────────────────────────
  // スレッド削除
  // ─────────────────────────────────────────
  async deleteThread(threadId) {
    if (this.currentUser?.role !== 'admin') { alert('権限がありません'); return; }
    if (!confirm('このスレッドを削除しますか？この操作は取り消せません。')) return;
    try {
      await this._db.ref(`${this._root}/announcements/threads/${threadId}`).remove();
      this._closeThreadModal();
    } catch (e) {
      console.error('削除エラー:', e);
      alert('削除に失敗しました');
    }
  }

  // ─────────────────────────────────────────
  // カテゴリ追加・削除
  // ─────────────────────────────────────────
  async addCategory(name, icon) {
    if (!['admin','editor'].includes(this.currentUser?.role)) { alert('権限がありません'); return; }
    if (!name.trim()) { alert('カテゴリ名を入力してください'); return; }

    const exists = Object.values(this.categories).some(c => c.name === name.trim());
    if (exists) { alert('同名のカテゴリが既に存在します'); return; }

    const order = Object.keys(this.categories).length;
    const ref   = this._db.ref(`${this._root}/announcements/categories`).push();
    await ref.set({
      name:      name.trim(),
      icon:      icon || '📁',
      order,
      createdAt: Date.now(),
      createdBy: this.currentUser.uid,
    });
  }

  async deleteCategory(categoryId) {
    if (this.currentUser?.role !== 'admin') { alert('権限がありません'); return; }
    const count = Object.values(this.threads).filter(t => t.category === categoryId).length;
    if (count > 0) {
      if (!confirm(`このカテゴリには ${count} 件の投稿があります。削除しますか？（投稿は残ります）`)) return;
    } else {
      if (!confirm('このカテゴリを削除しますか？')) return;
    }
    await this._db.ref(`${this._root}/announcements/categories/${categoryId}`).remove();
  }

  // ─────────────────────────────────────────
  // UIイベントバインド
  // ─────────────────────────────────────────
  _bindEvents() {
    // 【新規投稿】ボタン
    const newPostBtn = document.getElementById('newPostBtn');
    if (newPostBtn) {
      newPostBtn.addEventListener('click', () => this._openNewPostModal());
    }

    // 【カテゴリ管理】ボタン
    const catMgrBtn = document.getElementById('categoryManagerBtn');
    if (catMgrBtn) {
      catMgrBtn.addEventListener('click', () => this._openCategoryModal());
    }

    // 新規投稿モーダル: 送信
    const submitPostBtn = document.getElementById('submitPostBtn');
    if (submitPostBtn) {
      submitPostBtn.addEventListener('click', () => this.submitPost());
    }

    // 新規投稿モーダル: 閉じる
    const closePostModal = document.getElementById('closePostModal');
    if (closePostModal) {
      closePostModal.addEventListener('click', () => this._closeNewPostModal());
    }

    // スレッド詳細モーダル: 閉じる
    const closeThreadModal = document.getElementById('closeThreadModal');
    if (closeThreadModal) {
      closeThreadModal.addEventListener('click', () => this._closeThreadModal());
    }

    // 返信送信
    const submitReplyBtn = document.getElementById('submitReplyBtn');
    if (submitReplyBtn) {
      submitReplyBtn.addEventListener('click', () => this.submitReply());
    }

    // スレッド削除
    const deleteThreadBtn = document.getElementById('deleteThreadBtn');
    if (deleteThreadBtn) {
      deleteThreadBtn.addEventListener('click', () => this.deleteThread(this.currentThreadId));
    }

    // カテゴリ追加
    const addCatBtn = document.getElementById('addCategoryBtn');
    if (addCatBtn) {
      addCatBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('newCategoryName');
        const iconInput = document.getElementById('newCategoryIcon');
        this.addCategory(nameInput?.value || '', iconInput?.value || '📁');
        if (nameInput) nameInput.value = '';
        if (iconInput) iconInput.value = '';
      });
    }

    // カテゴリ管理モーダル: 閉じる
    const closeCatModal = document.getElementById('closeCategoryModal');
    if (closeCatModal) {
      closeCatModal.addEventListener('click', () => this._closeCategoryModal());
    }

    // モーダル背景クリックで閉じる
    ['newPostModal','threadDetailModal','categoryModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => {
        if (e.target === el) {
          el.classList.add('hidden');
          el.style.display = 'none';
        }
      });
    });
  }

  // ─────────────────────────────────────────
  // 権限UI
  // ─────────────────────────────────────────
  _applyPermissions() {
    const role = this.currentUser?.role;
    const catMgrBtn = document.getElementById('categoryManagerBtn');
    if (catMgrBtn) {
      catMgrBtn.style.display = ['admin','editor'].includes(role) ? 'inline-flex' : 'none';
    }
  }

  // ─────────────────────────────────────────
  // モーダル開閉
  // ─────────────────────────────────────────
  _openNewPostModal() {
    const modal = document.getElementById('newPostModal');
    if (!modal) return;
    // カテゴリセレクト更新
    const sel = document.getElementById('postCategory');
    if (sel) {
      const cats = Object.entries(this.categories)
        .sort((a,b) => (a[1].order||0)-(b[1].order||0));
      sel.innerHTML = `<option value="">カテゴリを選択...</option>`
        + cats.map(([id,c]) => `<option value="${id}">${this._esc(c.icon||'')} ${this._esc(c.name)}</option>`).join('');
      if (this.currentCategoryId) sel.value = this.currentCategoryId;
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  _closeNewPostModal() {
    const modal = document.getElementById('newPostModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    document.getElementById('postTitle').value   = '';
    document.getElementById('postContent').value = '';
  }

  _closeThreadModal() {
    const modal = document.getElementById('threadDetailModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    if (this._replyListener && this.currentThreadId) {
      this._db.ref(`${this._root}/announcements/threads/${this.currentThreadId}/replies`).off();
      this._replyListener = null;
    }
    this.currentThreadId = null;
  }

  _openCategoryModal() {
    const modal = document.getElementById('categoryModal');
    if (!modal) return;
    this._renderCategoryList();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  _closeCategoryModal() {
    const modal = document.getElementById('categoryModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  _renderCategoryList() {
    const list = document.getElementById('categoryListInModal');
    if (!list) return;
    const cats = Object.entries(this.categories)
      .sort((a,b) => (a[1].order||0)-(b[1].order||0));
    const isAdmin = this.currentUser?.role === 'admin';

    list.innerHTML = cats.map(([id, cat]) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:0.9rem;color:var(--text-color,#e0e0e0);">${this._esc(cat.icon||'📁')} ${this._esc(cat.name)}</span>
        ${isAdmin ? `<button onclick="announcementsManager.deleteCategory('${id}')"
          style="background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.78rem;">削除</button>` : ''}
      </div>`).join('');
  }

  // ─────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────
  _esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  destroy() {
    if (this._db && this._root) {
      this._db.ref(`${this._root}/announcements/categories`).off();
      this._db.ref(`${this._root}/announcements/threads`).off();
      if (this._replyListener && this.currentThreadId) {
        this._db.ref(`${this._root}/announcements/threads/${this.currentThreadId}/replies`).off();
      }
    }
  }
}

// ─────────────────────────────────────────
// グローバル登録 & 自動初期化
// ─────────────────────────────────────────
window.announcementsManager = new AnnouncementsManager();

document.addEventListener('DOMContentLoaded', () => {
  const uid = sessionStorage.getItem('targetUID');
  if (!uid) { location.href = '../index.html'; return; }
  window.announcementsManager.init();
});

window.addEventListener('beforeunload', () => {
  window.announcementsManager?.destroy();
});
