/**
 * お知らせ掲示板管理システム
 * Firebase Realtime Database連携
 */

(function() {
    'use strict';

    class AnnouncementsManager {
        constructor() {
            this.db = null;
            this.currentUser = null;
            this.selectedCategory = 'all';
            this.categories = [];
            this.threads = [];
            this.init();
        }

        async init() {
            try {
                await this.waitForDependencies();
                this.loadCurrentUser();
                await this.initializeCategories();
                this.setupFirebaseListeners();
                console.log('✅ お知らせ掲示板システム初期化完了');
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

        async initializeCategories() {
            const categoriesRef = this.db.ref(`${window.DATA_ROOT}/announcements/categories`);
            const snapshot = await categoriesRef.once('value');
            const data = snapshot.val();

            if (!data || Object.keys(data).length === 0) {
                // 初期カテゴリ設定
                const defaultCategories = {
                    important: { name: '🔴 重要なお知らせ', order: 1 },
                    general: { name: '📢 全体業務連絡', order: 2 },
                    fieldSupport: { name: '機器管理・人工呼吸', order: 3 },
                    bloodPurification: { name: '血液浄化', order: 4 },
                    arrhythmia: { name: '不整脈', order: 5 },
                    cardiac: { name: '心・カテーテル', order: 6 },
                    circulation: { name: '人工心肺・補助循環', order: 7 },
                    surgery: { name: '手術・麻酔', order: 8 },
                    meeting: { name: '会議・ミーティング', order: 9 },
                    other: { name: 'その他・連絡', order: 10 }
                };
                await categoriesRef.set(defaultCategories);
                this.categories = Object.entries(defaultCategories).map(([id, cat]) => ({
                    id,
                    ...cat
                }));
            } else {
                this.categories = Object.entries(data).map(([id, cat]) => ({
                    id,
                    ...cat
                })).sort((a, b) => (a.order || 0) - (b.order || 0));
            }

            this.renderCategories();
            this.updateCategorySelect();
        }

        setupFirebaseListeners() {
            // スレッドのリアルタイム監視
            const threadsRef = this.db.ref(`${window.DATA_ROOT}/announcements/threads`);
            threadsRef.on('value', snapshot => {
                const data = snapshot.val();
                if (data) {
                    this.threads = Object.entries(data).map(([id, thread]) => ({
                        id,
                        ...thread
                    })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                } else {
                    this.threads = [];
                }
                this.renderThreads();
                this.updateCategoryCounts();
            });
        }

        renderCategories() {
            const container = document.getElementById('categoryList');
            const allCount = this.threads.length;

            const html = `
                <div class="category-item ${this.selectedCategory === 'all' ? 'active' : ''}" 
                     onclick="announcementsManager.selectCategory('all')">
                    <span>📋 すべて</span>
                    <span class="category-badge">${allCount}</span>
                </div>
                ${this.categories.map(cat => {
                    const count = this.threads.filter(t => t.category === cat.id).length;
                    return `
                        <div class="category-item ${this.selectedCategory === cat.id ? 'active' : ''}" 
                             onclick="announcementsManager.selectCategory('${cat.id}')">
                            <span>${cat.name}</span>
                            ${count > 0 ? `<span class="category-badge">${count}</span>` : ''}
                        </div>
                    `;
                }).join('')}
            `;

            container.innerHTML = html;
        }

        updateCategoryCounts() {
            this.renderCategories();
        }

        selectCategory(categoryId) {
            this.selectedCategory = categoryId;
            this.renderCategories();
            this.renderThreads();
        }

        renderThreads() {
            const container = document.getElementById('threadsList');
            
            let filteredThreads = this.selectedCategory === 'all'
                ? this.threads
                : this.threads.filter(t => t.category === this.selectedCategory);

            if (filteredThreads.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <h3>投稿がありません</h3>
                        <p>このカテゴリには投稿がありません</p>
                    </div>
                `;
                return;
            }

            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

            const html = filteredThreads.map(thread => {
                const category = this.categories.find(c => c.id === thread.category);
                const isNew = thread.timestamp > oneDayAgo;
                const date = new Date(thread.timestamp).toLocaleString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const replyCount = thread.replies ? Object.keys(thread.replies).length : 0;

                return `
                    <div class="thread-card" onclick="announcementsManager.openThreadDetail('${thread.id}')">
                        <div class="thread-header">
                            <div style="flex: 1;">
                                <div class="thread-title">
                                    ${thread.title}
                                    ${isNew ? '<span class="new-badge">NEW</span>' : ''}
                                </div>
                                <div class="thread-meta">
                                    <span><i class="far fa-user"></i> ${thread.author}</span>
                                    <span><i class="far fa-clock"></i> ${date}</span>
                                </div>
                            </div>
                            ${category ? `<span class="thread-category-tag">${category.name}</span>` : ''}
                        </div>
                        <div class="thread-content">
                            ${this.truncateText(thread.content, 150)}
                        </div>
                        <div class="thread-footer">
                            <div class="thread-stats">
                                <span><i class="far fa-comment"></i> ${replyCount} 件の返信</span>
                                <span><i class="far fa-eye"></i> ${thread.views || 0} 閲覧</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        truncateText(text, maxLength) {
            if (!text) return '';
            return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
        }

        updateCategorySelect() {
            const select = document.getElementById('threadCategory');
            select.innerHTML = '<option value="">選択してください</option>' +
                this.categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('');
        }

        async openThreadDetail(threadId) {
            const thread = this.threads.find(t => t.id === threadId);
            if (!thread) return;

            // 閲覧数カウントアップ
            const viewsRef = this.db.ref(`${window.DATA_ROOT}/announcements/threads/${threadId}/views`);
            const currentViews = thread.views || 0;
            await viewsRef.set(currentViews + 1);

            const category = this.categories.find(c => c.id === thread.category);
            const date = new Date(thread.timestamp).toLocaleString('ja-JP');
            const replyCount = thread.replies ? Object.keys(thread.replies).length : 0;

            document.getElementById('detailThreadTitle').textContent = thread.title;

            const canDelete = this.currentUser.role === 'admin';

            let content = `
                <div style="background: var(--surface-1); padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                        <div>
                            <strong style="color: var(--text-strong);">${thread.author}</strong>
                            <span style="color: var(--text-muted); margin-left: 12px;"><i class="far fa-clock"></i> ${date}</span>
                        </div>
                        ${canDelete ? `<button class="btn btn-danger" onclick="announcementsManager.deleteThread('${thread.id}')">
                            <i class="fas fa-trash"></i> 削除
                        </button>` : ''}
                    </div>
                    ${category ? `<span class="thread-category-tag">${category.name}</span>` : ''}
                    <p style="line-height: 1.8; margin-top: 16px; color: var(--text-color); white-space: pre-wrap;">${thread.content}</p>
                </div>

                <h3 style="margin: 24px 0 16px; color: var(--text-strong);">
                    <i class="far fa-comment"></i> 返信 (${replyCount}件)
                </h3>
            `;

            // 返信表示
            if (thread.replies) {
                const replies = Object.entries(thread.replies)
                    .map(([id, reply]) => ({ id, ...reply }))
                    .sort((a, b) => a.timestamp - b.timestamp);

                content += replies.map(reply => {
                    const replyDate = new Date(reply.timestamp).toLocaleString('ja-JP');
                    return `
                        <div style="padding: 16px; background: var(--surface-0); border-radius: 8px; margin-bottom: 12px;">
                            <div style="margin-bottom: 10px;">
                                <strong style="color: var(--text-strong);">${reply.author}</strong>
                                <span style="color: var(--text-muted); margin-left: 12px; font-size: 13px;">${replyDate}</span>
                            </div>
                            <p style="color: var(--text-color); margin: 0; white-space: pre-wrap;">${reply.content}</p>
                        </div>
                    `;
                }).join('');
            }

            // 返信フォーム
            content += `
                <div style="margin-top: 24px;">
                    <textarea id="replyContent" placeholder="返信を入力..." 
                        style="width: 100%; min-height: 100px; padding: 12px; border: 1px solid var(--glass-border); 
                        border-radius: 8px; background: var(--surface-0); color: var(--text-color); font-family: inherit; resize: vertical;"></textarea>
                    <button class="btn btn-primary" style="margin-top: 12px;" onclick="announcementsManager.submitReply('${thread.id}')">
                        <i class="fas fa-paper-plane"></i> 返信する
                    </button>
                </div>
            `;

            document.getElementById('threadDetailContent').innerHTML = content;
            document.getElementById('threadDetailModal').classList.add('active');
        }

        async submitReply(threadId) {
            const content = document.getElementById('replyContent').value.trim();
            if (!content) {
                alert('返信内容を入力してください');
                return;
            }

            const replyData = {
                author: this.currentUser.name,
                content: content,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            };

            try {
                const repliesRef = this.db.ref(`${window.DATA_ROOT}/announcements/threads/${threadId}/replies`);
                await repliesRef.push(replyData);

                // リロード
                this.openThreadDetail(threadId);
                alert('返信を投稿しました');
            } catch (error) {
                console.error('返信投稿エラー:', error);
                alert('返信の投稿に失敗しました');
            }
        }

        async deleteThread(threadId) {
            if (!confirm('この投稿を削除してもよろしいですか？\n※この操作は取り消せません')) {
                return;
            }

            try {
                await this.db.ref(`${window.DATA_ROOT}/announcements/threads/${threadId}`).remove();
                this.closeThreadDetailModal();
                alert('投稿を削除しました');
            } catch (error) {
                console.error('削除エラー:', error);
                alert('投稿の削除に失敗しました');
            }
        }

        closeThreadDetailModal() {
            document.getElementById('threadDetailModal').classList.remove('active');
        }
    }

    // グローバル関数
    window.openNewThreadModal = function() {
        document.getElementById('newThreadModal').classList.add('active');
    };

    window.closeNewThreadModal = function() {
        document.getElementById('newThreadModal').classList.remove('active');
        document.getElementById('newThreadForm').reset();
    };

    window.openCategoryModal = function() {
        document.getElementById('categoryModal').classList.add('active');
    };

    window.closeCategoryModal = function() {
        document.getElementById('categoryModal').classList.remove('active');
    };

    window.closeThreadDetailModal = function() {
        document.getElementById('threadDetailModal').classList.remove('active');
    };

    window.handleNewThreadSubmit = async function(event) {
        event.preventDefault();

        const category = document.getElementById('threadCategory').value;
        const title = document.getElementById('threadTitle').value.trim();
        const content = document.getElementById('threadContent').value.trim();

        if (!category || !title || !content) {
            alert('すべての項目を入力してください');
            return;
        }

        const threadData = {
            category: category,
            title: title,
            content: content,
            author: window.announcementsManager.currentUser.name,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            views: 0
        };

        try {
            const threadsRef = window.announcementsManager.db.ref(`${window.DATA_ROOT}/announcements/threads`);
            await threadsRef.push(threadData);

            window.closeNewThreadModal();
            alert('投稿を作成しました！');
        } catch (error) {
            console.error('投稿作成エラー:', error);
            alert('投稿の作成に失敗しました');
        }
    };

    window.addNewCategory = async function() {
        const name = document.getElementById('newCategoryName').value.trim();
        if (!name) {
            alert('カテゴリ名を入力してください');
            return;
        }

        const newId = 'cat_' + Date.now();
        const newCategory = {
            name: name,
            order: window.announcementsManager.categories.length + 1
        };

        try {
            const categoryRef = window.announcementsManager.db.ref(
                `${window.DATA_ROOT}/announcements/categories/${newId}`
            );
            await categoryRef.set(newCategory);

            document.getElementById('newCategoryName').value = '';
            alert('カテゴリを追加しました');

            // 再初期化
            await window.announcementsManager.initializeCategories();
        } catch (error) {
            console.error('カテゴリ追加エラー:', error);
            alert('カテゴリの追加に失敗しました');
        }
    };

    // 初期化
    window.announcementsManager = new AnnouncementsManager();
})();
