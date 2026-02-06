/**
 * ユーザー管理モジュール (User Manager)
 * ログインユーザーと全ユーザーの情報を一元管理
 * CEリストとは独立したログインユーザー管理を実現
 */

class UserManager {
    constructor() {
        this.currentUser = null; // 現在のログインユーザー情報
        this.allUsers = []; // 全ユーザーのキャッシュ
        this.initialized = false;
        this.isInitializing = false;
        this.db = null;
        this.auth = null;
    }

    /**
     * 初期化（Firebase依存を待機）
     */
    async init() {
        if (this.initialized || this.isInitializing) {
            console.log('[UserManager] Already initialized or initializing');
            return;
        }

        this.isInitializing = true;
        console.log('[UserManager] Initialization started...');

        try {
            // Firebase依存の待機
            await this.waitForFirebase();

            // 現在のログインユーザーの読み込み
            await this.loadCurrentUser();

            // 全ユーザーの読み込み
            await this.loadAllUsers();

            this.initialized = true;
            this.isInitializing = false;
            console.log('[UserManager] ✅ Initialization completed successfully');
            console.log('[UserManager] Current User:', this.currentUser);
            console.log('[UserManager] Total Users:', this.allUsers.length);

        } catch (error) {
            this.isInitializing = false;
            console.error('[UserManager] ❌ Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Firebase依存の待機
     */
    async waitForFirebase() {
        const maxAttempts = 50;
        let attempts = 0;

        while (attempts < maxAttempts) {
            if (window.database && window.auth && window.DATA_ROOT) {
                this.db = window.database;
                this.auth = window.auth;
                console.log('[UserManager] Firebase dependencies loaded');
                return;
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error('[UserManager] Firebase dependencies not loaded after timeout');
    }

    /**
     * 現在のログインユーザーの読み込み
     */
    async loadCurrentUser() {
        try {
            // SessionStorageから取得
            const targetUID = sessionStorage.getItem('targetUID');
            const currentUsername = sessionStorage.getItem('currentUsername');
            const userRole = sessionStorage.getItem('userRole');

            // LocalStorageからも確認（後方互換性）
            const localUsername = localStorage.getItem('currentUsername');
            const localRole = localStorage.getItem('currentUserRole');

            const username = currentUsername || localUsername;
            const role = userRole || localRole;

            if (!username) {
                // デフォルトユーザー（開発中）
                console.warn('[UserManager] No username found in session. Using default "admin"');
                this.currentUser = {
                    uid: targetUID || 'admin-uid',
                    username: 'admin',
                    displayName: '管理者',
                    role: 'admin'
                };
                return;
            }

            // Firebaseから詳細情報を取得
            const userRef = this.db.ref(`${window.DATA_ROOT}/users`);
            const snapshot = await userRef.orderByChild('username').equalTo(username).once('value');

            if (snapshot.exists()) {
                const userData = Object.values(snapshot.val())[0];
                this.currentUser = {
                    uid: userData.uid || targetUID,
                    username: userData.username || username,
                    displayName: userData.displayName || userData.name || username,
                    role: userData.role || role || 'user',
                    department: userData.department || '',
                    isCE: userData.isCE || false,
                    ceId: userData.ceId || null
                };
                console.log('[UserManager] Current user loaded from Firebase:', this.currentUser);
            } else {
                // Firebaseにない場合は新規作成
                console.warn('[UserManager] User not found in Firebase. Creating new user record...');
                await this.createUserInFirebase({
                    uid: targetUID || `user-${Date.now()}`,
                    username: username,
                    displayName: username,
                    role: role || 'user'
                });
            }

        } catch (error) {
            console.error('[UserManager] Error loading current user:', error);
            // フォールバック
            this.currentUser = {
                uid: 'fallback-uid',
                username: sessionStorage.getItem('currentUsername') || 'guest',
                displayName: 'ゲストユーザー',
                role: 'user'
            };
        }
    }

    /**
     * 全ユーザーの読み込み
     */
    async loadAllUsers() {
        try {
            const usersRef = this.db.ref(`${window.DATA_ROOT}/users`);
            const snapshot = await usersRef.once('value');

            if (snapshot.exists()) {
                this.allUsers = Object.entries(snapshot.val()).map(([key, user]) => ({
                    id: key,
                    uid: user.uid,
                    username: user.username,
                    displayName: user.displayName || user.name || user.username,
                    role: user.role || 'user',
                    department: user.department || '',
                    isCE: user.isCE || false,
                    ceId: user.ceId || null
                }));

                console.log(`[UserManager] Loaded ${this.allUsers.length} users from Firebase`);
            } else {
                console.warn('[UserManager] No users found in Firebase. Initializing from CE List...');
                await this.initializeUsersFromCEList();
            }

            // リアルタイム監視の設定
            usersRef.on('value', (snapshot) => {
                if (snapshot.exists()) {
                    this.allUsers = Object.entries(snapshot.val()).map(([key, user]) => ({
                        id: key,
                        uid: user.uid,
                        username: user.username,
                        displayName: user.displayName || user.name || user.username,
                        role: user.role || 'user',
                        department: user.department || '',
                        isCE: user.isCE || false,
                        ceId: user.ceId || null
                    }));
                    console.log('[UserManager] Users updated in realtime:', this.allUsers.length);
                }
            });

        } catch (error) {
            console.error('[UserManager] Error loading all users:', error);
            this.allUsers = [];
        }
    }

    /**
     * Firebaseに新規ユーザーを作成
     */
    async createUserInFirebase(userData) {
        try {
            const userRef = this.db.ref(`${window.DATA_ROOT}/users/${userData.uid}`);
            const newUser = {
                uid: userData.uid,
                username: userData.username,
                displayName: userData.displayName || userData.username,
                role: userData.role || 'user',
                department: userData.department || '',
                isCE: userData.isCE || false,
                ceId: userData.ceId || null,
                createdAt: new Date().toISOString()
            };

            await userRef.set(newUser);
            this.currentUser = newUser;
            console.log('[UserManager] User created successfully in Firebase:', newUser);

        } catch (error) {
            console.error('[UserManager] Error creating user in Firebase:', error);
            throw error;
        }
    }

    /**
     * CEリストから初期ユーザーを作成
     */
    async initializeUsersFromCEList() {
        try {
            // CEManagerが初期化されていることを確認
            if (!window.ceManager || !window.ceManager.ceList) {
                console.warn('[UserManager] CEManager not available. Skipping user initialization from CE List.');
                return;
            }

            const ceList = window.ceManager.ceList;
            const usersRef = this.db.ref(`${window.DATA_ROOT}/users`);

            console.log(`[UserManager] Initializing ${ceList.length} users from CE List...`);

            for (const ce of ceList) {
                const uid = `ce-${ce.id}`;
                const userData = {
                    uid: uid,
                    username: ce.name,
                    displayName: ce.name,
                    role: 'user',
                    department: '',
                    isCE: true,
                    ceId: ce.id,
                    createdAt: new Date().toISOString()
                };

                await usersRef.child(uid).set(userData);
            }

            // 管理者ユーザーの追加
            await usersRef.child('admin-uid').set({
                uid: 'admin-uid',
                username: 'admin',
                displayName: '管理者',
                role: 'admin',
                department: '管理部',
                isCE: false,
                ceId: null,
                createdAt: new Date().toISOString()
            });

            console.log('[UserManager] ✅ Users initialized from CE List successfully');
            await this.loadAllUsers(); // 再読み込み

        } catch (error) {
            console.error('[UserManager] Error initializing users from CE List:', error);
        }
    }

    /**
     * ユーザーIDからユーザー情報を取得
     */
    getUserById(userId) {
        return this.allUsers.find(u => u.id === userId || u.uid === userId);
    }

    /**
     * ユーザー名からユーザー情報を取得
     */
    getUserByUsername(username) {
        return this.allUsers.find(u => u.username === username);
    }

    /**
     * 表示名からユーザー情報を取得
     */
    getUserByDisplayName(displayName) {
        return this.allUsers.find(u => u.displayName === displayName);
    }

    /**
     * CEのみのユーザーリストを取得
     */
    getCEUsers() {
        return this.allUsers.filter(u => u.isCE === true);
    }

    /**
     * 管理者のみのユーザーリストを取得
     */
    getAdminUsers() {
        return this.allUsers.filter(u => u.role === 'admin');
    }

    /**
     * クリーンアップ
     */
    destroy() {
        if (this.db) {
            const usersRef = this.db.ref(`${window.DATA_ROOT}/users`);
            usersRef.off();
        }
        this.currentUser = null;
        this.allUsers = [];
        this.initialized = false;
        console.log('[UserManager] Destroyed');
    }
}

// グローバルインスタンスの作成
window.userManager = new UserManager();

// 自動初期化（DOMContentLoadedで実行）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => window.userManager.init(), 500);
    });
} else {
    setTimeout(() => window.userManager.init(), 500);
}

console.log('[UserManager] Module loaded');
