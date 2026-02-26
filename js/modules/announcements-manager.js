/**
 * js/modules/announcements-manager.js
 * お知らせ管理モジュール 完全版
 *
 * 修正内容:
 *   - ボタンイベントを DOMContentLoaded 後に確実に登録
 *   - カテゴリが「ロード中のまま」になるバグを修正
 *   - スレッドクリックでモーダル表示されないバグを修正
 *   - モーダル背景クリックで閉じる処理を修正
 *
 * 依存:
 *   firebase-config.js → window.database, window.DATA_ROOT, window.waitForFirebase
 *   auth-guard.js      → sessionStorage: targetUID, currentUsername, userRole
 *   constants.js       → window.DEPARTMENTS
 */

'use strict';

class AnnouncementsManager {

  constructor() {
    /* ── 状態 ── */
    this.currentUser       = null;   // { uid, username, displayName, role }
    this.categories        = {};     // { categoryId: categoryData }
    this.threads           = {};     // { threadId: threadData }
    this.currentCategoryId = null;   // null = すべて
    this.currentThreadId   = null;

    /* Firebase リスナー参照 */
    this._catRef    = null;
    this._threadRef = null;
    this._replyRef  = null;
    this._replyListenerId = null;   // 返信リスナーが張られているスレッドID

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
      await this._initDefaultCategories();   // 初回のみデフォルト作成
      this._listenCategories();              // リアルタイム監視開始
      this._listenThreads();
      this._bindEvents();                    // ボタンイベント登録
      this._applyPermissions();              // 権限による表示制御

      /* URLパラメータ ?thread=xxx で直接スレッドを開く */
      const threadId = new URLSearchParams(location.search).get('thread');
      if (threadId) setTimeout(() => this.openThread(threadId), 800);

      console.log('✅ AnnouncementsManager 初期化完了');
    } catch (err) {
      console.error('❌ AnnouncementsManager 初期化エラー:', err);
    }
  }

  /* Firebase 準備待ち */
  async _waitForFirebase() {
    if (window.waitForFirebase) return window.waitForFirebase();
    for (let i = 0; i < 50; i++) {
      if (window.database && window.DATA_ROOT) return;
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

    const snap = await this._db.ref(`${this._root}/users/${uid}`).once('value');
    const data = snap.val() || {};

    this.currentUser = {
      uid,
      username:    data.username    || username,
      displayName: data.displayName || data.username || username,
      role:        data.role        || role,
    };
  }

  /* ============================================================
     デフォルトカテゴリ初期化（初回のみ）
  ============================================================ */
  async _initDefaultCategories() {
    const snap = await this._db
      .ref(`${this._root}/announcements/categories`)
      .once('value');

    /* 既にカテゴリが存在する場合はスキップ */
    if (snap.exists() && Object.keys(snap.val()).length > 0) return;

    const depts = (window.DEPARTMENTS && window.DEPARTMENTS.length > 0)
      ? window.DEPARTMENTS
      : [
          '機器管理・人工呼吸', '血液浄化', '不整脈',
          '心・カテーテル',     '人工心肺・補助循環', '手術・麻酔',
          '会議・ミーティング・勉強会・打ち合わせ',
          '出張・研修内容',     'その他・連絡'
        ];

    const defaults = [
      { name: '重要なお知らせ', icon: '📢', order: 0 },
      { name: '業務連絡全般',   icon: '📋', order: 1 },
      ...depts.map((d, i) => ({ name: d, icon: '🏢', order: i + 2 })),
    ];

    const updates = {};
    defaults.forEach(cat => {
      const key = this._db
        .ref(`${this._root}/announcements/categories`)
        .push().key;
      updates[`${this._root}/announcements/categories/${key}`] = {
        ...cat,
        createdAt: Date.now(),
        createdBy: this.currentUser?.uid || 'system',
      };
    });

    await this._db.ref().update(updates);
    console.log('✅ デフォルトカテゴリ作成完了');
  }

  /* ============================================================
     リアルタイムリスナー
  ============================================================ */
  _listenCategories() {
    this._catRef = this._db
      .ref(`${this._root}/announcements/categories`)
      .orderByChild('order');

    this._catRef.on('value', snap => {
      this.categories = snap.val() || {};
      this._renderSidebar();
    });
  }

  _listenThreads() {
    this._threadRef = this._db
      .ref(`${this._root}/announcements/threads`)
      .orderByChild('timestamp');

    this._threadRef.on('value', snap => {
      this.threads = snap.val() || {};
      this._renderThreads(this.currentCategoryId);
    });
  }

  /* ============================================================
     サイドバー（カテゴリ一覧）描画
  ============================================================ */
  _renderSidebar() {
    const sidebar = document.getElementById('categoriesSidebar');
    if (!sidebar) return;

    /* order でソート */
    const cats = Object.entries(this.categories)
      .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

    const allItem = `
      <div class="cat-item ${this.currentCategoryId === null ? 'cat-active' : ''}"
           onclick="announcementsManager.selectCategory(null)">
        <span class="cat-icon">📌</span>
        <span class="cat-name">すべて</span>
        <span class="cat-count">${Object.keys(this.threads).length}</span>
      </div>`;

    const catItems = cats.map(([id, cat]) => {
      const count = Object.values(this.threads)
        .filter(t => t.category === id).length;
      return `
        <div class="cat-item ${this.currentCategoryId === id ? 'cat-active' : ''}"
             onclick="announcementsManager.selectCategory('${id}')">
          <span class="cat-icon">${this._esc(cat.icon || '📁')}</span>
          <span class="cat-name">${this._esc(cat.name)}</span>
          ${count > 0
            ? `<span class="cat-count">${count}</span>`
            : '<span class="cat-count" style="opacity:0;">0</span>'}
        </div>`;
    }).join('');

    sidebar.innerHTML = allItem + catItems;
  }

  selectCategory(categoryId) {
    this.currentCategoryId = categoryId;
    this._renderSidebar();
    this._renderThreads(categoryId);
  }

  /* ============================================================
     スレッド一覧描画
  ============================================================ */
  _renderThreads(categoryId) {
    const container = document.getElementById('threadsContainer');
    const titleEl   = document.getElementById('currentCategoryTitle');
    const countEl   = document.getElementById('threadCount');
    if (!container) return;

    /* カテゴリでフィルタ */
    const filtered = Object.entries(this.threads)
      .map(([id, t]) => ({ id, ...t }))
      .filter(t => categoryId === null || t.category === categoryId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    /* タイトル・件数 */
    if (titleEl) {
      titleEl.textContent = categoryId
        ? (this.categories[categoryId]?.name || 'カテゴリ')
        : 'すべてのお知らせ';
    }
    if (countEl) countEl.textContent = `${filtered.length} 件`;

    /* 空状態 */
    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-threads">
          <div style="font-size:2.5rem; margin-bottom:12px;">📭</div>
          <p>まだ投稿がありません</p>
          <p style="font-size:0.8rem; margin-top:6px; color:var(--text-muted);">
            【新規投稿】ボタンから投稿できます
          </p>
        </div>`;
      return;
    }

    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

    container.innerHTML = filtered.map(thread => {
      const isNew      = (thread.timestamp || 0) > threeDaysAgo;
      const dateStr    = thread.timestamp
        ? new Date(thread.timestamp).toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit',  minute: '2-digit'
          }).replace(/\//g, '.')
        : '';
      const replyCount = thread.replies
        ? Object.keys(thread.replies).length : 0;
      const catName    = this.categories[thread.category]?.name || '';
      const catIcon    = this.categories[thread.category]?.icon || '📁';

      return `
        <div class="thread-item"
             onclick="announcementsManager.openThread('${thread.id}')">
          <div class="thread-header-row">
            <div class="thread-title-wrap">
              <span class="thread-title">${this._esc(thread.title || '無題')}</span>
              ${isNew
                ? '<span class="badge-new">NEW</span>'
                : ''}
              ${catName
                ? `<span class="badge-cat">${this._esc(catIcon)} ${this._esc(catName)}</span>`
                : ''}
            </div>
          </div>
          <div class="thread-preview">
            ${this._esc((thread.content || '').substring(0, 80))}${(thread.content || '').length > 80 ? '…' : ''}
          </div>
          <div class="thread-meta">
            <span><i class="far fa-user"></i> ${this._esc(thread.authorName || thread.author || '匿名')}</span>
            <span><i class="far fa-clock"></i> ${dateStr}</span>
            <span><i class="far fa-comment"></i> ${replyCount}件</span>
            <span><i class="far fa-eye"></i> ${thread.views || 0}</span>
          </div>
        </div>`;
    }).join('');
  }

  /* ============================================================
     スレッド詳細モーダルを開く
  ============================================================ */
  async openThread(threadId) {
    /* threads にない場合は Firebase から直接取得 */
    if (!this.threads[threadId]) {
      const snap = await this._db
        .ref(`${this._root}/announcements/threads/${threadId}`)
        .once('value');
      if (!snap.exists()) { alert('スレッドが見つかりません'); return; }
      this.threads[threadId] = { id: threadId, ...snap.val() };
    }

    this.currentThreadId = threadId;
    const thread = this.threads[threadId];

    /* 閲覧数カウントアップ（トランザクション） */
    this._db
      .ref(`${this._root}/announcements/threads/${threadId}/views`)
      .transaction(v => (v || 0) + 1);

    /* モーダルへ情報をセット */
    const dateStr = thread.timestamp
      ? new Date(thread.timestamp).toLocaleString('ja-JP', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit',  minute: '2-digit'
        }).replace(/\//g, '.')
      : '';

    this._setEl('modalThreadTitle',   thread.title   || '無題');
    this._setEl('modalThreadAuthor',  thread.authorName || thread.author || '匿名');
    this._setEl('modalThreadDate',    dateStr);

    const contentEl = document.getElementById('modalThreadContent');
    if (contentEl) {
      contentEl.innerHTML = this._esc(thread.content || '')
        .replace(/\n/g, '<br>');
    }

    /* カテゴリ表示 */
    const catEl = document.getElementById('modalThreadCategory');
    if (catEl) {
      const cat = this.categories[thread.category];
      catEl.textContent = cat ? `${cat.icon || ''} ${cat.name}` : '';
    }

    /* 削除ボタン（admin のみ表示） */
    const deleteBtn = document.getElementById('deleteThreadBtn');
    if (deleteBtn) {
      deleteBtn.style.display =
        this.currentUser?.role === 'admin' ? 'inline-flex' : 'none';
    }

    /* モーダルを表示 */
    this._openModal('threadDetailModal');

    /* 返信リスナーを開始 */
    this._listenReplies(threadId);
  }

  /* ============================================================
     返信リスナー & 描画
  ============================================================ */
  _listenReplies(threadId) {
    /* 前のリスナーを解除 */
    if (this._replyRef && this._replyListenerId) {
      this._db
        .ref(`${this._root}/announcements/threads/${this._replyListenerId}/replies`)
        .off();
      this._replyRef = null;
    }

    this._replyListenerId = threadId;
    this._replyRef = this._db
      .ref(`${this._root}/announcements/threads/${threadId}/replies`)
      .orderByChild('timestamp');

    this._replyRef.on('value', snap => {
      this._renderReplies(snap.val() || {});
    });
  }

  _renderReplies(data) {
    const container = document.getElementById('repliesContainer');
    if (!container) return;

    const list = Object.entries(data)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (list.length === 0) {
      container.innerHTML = `
        <p style="text-align:center; padding:16px;
                  color:var(--text-muted); font-size:0.82rem;">
          まだ返信がありません
        </p>`;
      return;
    }

    container.innerHTML = list.map(r => {
      const dateStr = r.timestamp
        ? new Date(r.timestamp).toLocaleString('ja-JP', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit',   minute: '2-digit'
          }).replace(/\//g, '.')
        : '';
      const isMine = r.authorUid === this.currentUser?.uid;

      return `
        <div class="reply-item ${isMine ? 'reply-mine' : ''}">
          <div class="reply-meta">
            <strong>${this._esc(r.authorName || '匿名')}</strong>
            <span>${dateStr}</span>
          </div>
          <div class="reply-body">
            ${this._esc(r.content || '').replace(/\n/g, '<br>')}
          </div>
        </div>`;
    }).join('');
  }

  /* ============================================================
     新規投稿
  ============================================================ */
  async submitPost() {
    const title   = document.getElementById('postTitle')?.value.trim();
    const content = document.getElementById('postContent')?.value.trim();
    const catId   = document.getElementById('postCategory')?.value || '';

    if (!title)   { alert('タイトルを入力してください');   return; }
    if (!content) { alert('内容を入力してください');       return; }
    if (!catId)   { alert('カテゴリを選択してください');   return; }

    const btn = document.getElementById('submitPostBtn');
    if (btn) btn.disabled = true;

    try {
      const ref = this._db
        .ref(`${this._root}/announcements/threads`)
        .push();

      await ref.set({
        title,
        content,
        category:   catId,
        authorUid:  this.currentUser.uid,
        authorName: this.currentUser.displayName,
        timestamp:  Date.now(),
        views:      0,
      });

      this._closeModal('newPostModal');
      this.selectCategory(catId);   // 投稿したカテゴリへ移動
    } catch (err) {
      console.error('投稿エラー:', err);
      alert('投稿に失敗しました');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ============================================================
     返信送信
  ============================================================ */
  async submitReply() {
    const textarea = document.getElementById('replyInput');
    const content  = textarea?.value.trim();
    if (!content)              { alert('返信内容を入力してください'); return; }
    if (!this.currentThreadId) return;

    const btn = document.getElementById('submitReplyBtn');
    if (btn) btn.disabled = true;

    try {
      await this._db
        .ref(`${this._root}/announcements/threads/${this.currentThreadId}/replies`)
        .push()
        .set({
          content,
          authorUid:  this.currentUser.uid,
          authorName: this.currentUser.displayName,
          timestamp:  Date.now(),
        });

      if (textarea) textarea.value = '';
    } catch (err) {
      console.error('返信エラー:', err);
      alert('返信に失敗しました');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ============================================================
     スレッド削除（admin のみ）
  ============================================================ */
  async deleteThread(threadId) {
    if (this.currentUser?.role !== 'admin') {
      alert('削除権限がありません'); return;
    }
    if (!confirm('このスレッドを削除しますか？この操作は取り消せません。')) return;

    try {
      await this._db
        .ref(`${this._root}/announcements/threads/${threadId}`)
        .remove();
      this._closeModal('threadDetailModal');
    } catch (err) {
      console.error('削除エラー:', err);
      alert('削除に失敗しました');
    }
  }

  /* ============================================================
     カテゴリ追加（editor / admin）
  ============================================================ */
  async addCategory() {
    if (!['admin', 'editor'].includes(this.currentUser?.role)) {
      alert('カテゴリ追加権限がありません'); return;
    }

    const nameInput = document.getElementById('newCategoryName');
    const iconInput = document.getElementById('newCategoryIcon');
    const name = nameInput?.value.trim();
    const icon = iconInput?.value.trim() || '📁';

    if (!name) { alert('カテゴリ名を入力してください'); return; }

    /* 重複チェック */
    const exists = Object.values(this.categories)
      .some(c => c.name === name);
    if (exists) { alert('同名のカテゴリが既に存在します'); return; }

    const order = Object.keys(this.categories).length;
    const ref   = this._db
      .ref(`${this._root}/announcements/categories`)
      .push();

    await ref.set({
      name,
      icon,
      order,
      createdAt: Date.now(),
      createdBy: this.currentUser.uid,
    });

    if (nameInput) nameInput.value = '';
    if (iconInput) iconInput.value = '';

    /* モーダル内リスト更新 */
    this._renderCategoryListInModal();
  }

  /* ============================================================
     カテゴリ削除（admin のみ）
  ============================================================ */
  async deleteCategory(categoryId) {
    if (this.currentUser?.role !== 'admin') {
      alert('削除権限がありません'); return;
    }

    const count = Object.values(this.threads)
      .filter(t => t.category === categoryId).length;
    const msg = count > 0
      ? `このカテゴリには ${count} 件の投稿があります。\n削除してもよいですか？（投稿は残ります）`
      : 'このカテゴリを削除しますか？';

    if (!confirm(msg)) return;

    await this._db
      .ref(`${this._root}/announcements/categories/${categoryId}`)
      .remove();

    /* 削除したカテゴリを選択中だった場合は「すべて」へ */
    if (this.currentCategoryId === categoryId) {
      this.selectCategory(null);
    }
    this._renderCategoryListInModal();
  }

  /* ============================================================
     カテゴリ管理モーダル内リスト描画
  ============================================================ */
  _renderCategoryListInModal() {
    const list = document.getElementById('categoryListInModal');
    if (!list) return;

    const cats = Object.entries(this.categories)
      .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

    if (cats.length === 0) {
      list.innerHTML = `
        <p style="padding:12px; color:var(--text-muted);
                  font-size:0.82rem; text-align:center;">
          カテゴリがありません
        </p>`;
      return;
    }

    const isAdmin = this.currentUser?.role === 'admin';

    list.innerHTML = cats.map(([id, cat]) => {
      const count = Object.values(this.threads)
        .filter(t => t.category === id).length;
      return `
        <div class="cat-manage-item">
          <span class="cat-manage-name">
            ${this._esc(cat.icon || '📁')} ${this._esc(cat.name)}
          </span>
          <span class="cat-manage-count">${count}件</span>
          ${isAdmin
            ? `<button class="cat-del-btn"
                 onclick="announcementsManager.deleteCategory('${id}')">
                 <i class="fas fa-trash"></i>
               </button>`
            : ''}
        </div>`;
    }).join('');
  }

  /* ============================================================
     UIイベントバインド
  ============================================================ */
  _bindEvents() {

    /* ── 新規投稿ボタン ── */
    document.getElementById('newPostBtn')
      ?.addEventListener('click', () => this._openNewPostModal());

    /* ── カテゴリ管理ボタン ── */
    document.getElementById('categoryManagerBtn')
      ?.addEventListener('click', () => this._openCategoryModal());

    /* ── 新規投稿モーダル ── */
    document.getElementById('closePostModal')
      ?.addEventListener('click', () => this._closeModal('newPostModal'));

    document.getElementById('submitPostBtn')
      ?.addEventListener('click', () => this.submitPost());

    /* ── スレッド詳細モーダル ── */
    document.getElementById('closeThreadModal')
      ?.addEventListener('click', () => this._closeThreadModal());

    document.getElementById('deleteThreadBtn')
      ?.addEventListener('click', () => this.deleteThread(this.currentThreadId));

    /* ── 返信送信 ── */
    document.getElementById('submitReplyBtn')
      ?.addEventListener('click', () => this.submitReply());

    /* ── カテゴリ管理モーダル ── */
    document.getElementById('closeCategoryModal')
      ?.addEventListener('click', () => this._closeModal('categoryModal'));

    document.getElementById('addCategoryBtn')
      ?.addEventListener('click', () => this.addCategory());

    /* ── モーダル背景クリックで閉じる ── */
    ['newPostModal', 'threadDetailModal', 'categoryModal'].forEach(id => {
      document.getElementById(id)
        ?.addEventListener('click', e => {
          if (e.target.id === id) {
            if (id === 'threadDetailModal') {
              this._closeThreadModal();
            } else {
              this._closeModal(id);
            }
          }
        });
    });
  }

  /* ============================================================
     権限による表示制御
  ============================================================ */
  _applyPermissions() {
    const role = this.currentUser?.role;

    /* カテゴリ管理ボタン: editor / admin のみ表示 */
    const catMgrBtn = document.getElementById('categoryManagerBtn');
    if (catMgrBtn) {
      catMgrBtn.style.display =
        ['admin', 'editor'].includes(role) ? 'inline-flex' : 'none';
    }
  }

  /* ============================================================
     モーダル開閉ヘルパー
  ============================================================ */
  _openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.style.display = 'flex';
  }

  _closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';
  }

  /* 新規投稿モーダルを開く（カテゴリセレクトを最新状態に更新） */
  _openNewPostModal() {
    /* カテゴリのセレクトボックスを最新化 */
    const sel = document.getElementById('postCategory');
    if (sel) {
      const cats = Object.entries(this.categories)
        .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

      sel.innerHTML =
        `<option value="">カテゴリを選択してください</option>` +
        cats.map(([id, c]) =>
          `<option value="${id}">${this._esc(c.icon || '')} ${this._esc(c.name)}</option>`
        ).join('');

      /* 現在選択中のカテゴリをデフォルト選択 */
      if (this.currentCategoryId) sel.value = this.currentCategoryId;
    }

    /* 入力欄をクリア */
    const titleEl   = document.getElementById('postTitle');
    const contentEl = document.getElementById('postContent');
    if (titleEl)   titleEl.value   = '';
    if (contentEl) contentEl.value = '';

    this._openModal('newPostModal');
    titleEl?.focus();
  }

  /* カテゴリ管理モーダルを開く */
  _openCategoryModal() {
    this._renderCategoryListInModal();
    this._openModal('categoryModal');
  }

  /* スレッド詳細モーダルを閉じる（返信リスナーも解除） */
  _closeThreadModal() {
    this._closeModal('threadDetailModal');

    /* 返信リスナー解除 */
    if (this._replyRef && this._replyListenerId) {
      this._db
        .ref(`${this._root}/announcements/threads/${this._replyListenerId}/replies`)
        .off();
      this._replyRef        = null;
      this._replyListenerId = null;
    }

    this.currentThreadId = null;
  }

  /* ============================================================
     ユーティリティ
  ============================================================ */

  /* HTML エスケープ */
  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 要素のテキストをセット（要素が存在しない場合はスキップ） */
  _setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* ============================================================
     クリーンアップ
  ============================================================ */
  destroy() {
    if (this._db && this._root) {
      this._db.ref(`${this._root}/announcements/categories`).off();
      this._db.ref(`${this._root}/announcements/threads`).off();
      if (this._replyRef && this._replyListenerId) {
        this._db
          .ref(`${this._root}/announcements/threads/${this._replyListenerId}/replies`)
          .off();
      }
    }
  }
}

/* ============================================================
   グローバル登録 & 自動初期化
============================================================ */
window.announcementsManager = new AnnouncementsManager();

document.addEventListener('DOMContentLoaded', () => {
  /* 未認証ならログイン画面へ */
  const uid = sessionStorage.getItem('targetUID');
  if (!uid) {
    location.href = '../index.html';
    return;
  }
  window.announcementsManager.init();
});

window.addEventListener('beforeunload', () => {
  window.announcementsManager?.destroy();
});
