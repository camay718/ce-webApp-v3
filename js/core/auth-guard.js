/**
 * 認証ガード - 全ページ共通認証システム
 */
(function(){
    if (window.AuthGuard) return;
    
    window.AuthGuard = {
        async init({ requireAuth = true } = {}) {
            try {
                await window.waitForFirebase?.();
                
                // 分析ページは全権限でアクセス許可
                const analyticsPages = [
                    '/pages/analytics.html',
                    '/analytics/assignment-summary.html',
                    '/analytics/department-timeline.html',
                    '/analytics/personal-timeline.html'
                ];
                
                const isAnalyticsPage = analyticsPages.some(path => 
                    location.pathname.endsWith(path) || location.pathname.includes(path)
                );
                
                // セッション復元（URL→sessionStorage→localStorageの順）
                const params = new URLSearchParams(location.search);
                const uid = params.get('uid') || sessionStorage.getItem('targetUID') || 
                           JSON.parse(localStorage.getItem('dashboardAuth')||'{}').uid;
                const username = params.get('username') || sessionStorage.getItem('currentUsername') || 
                                JSON.parse(localStorage.getItem('dashboardAuth')||'{}').username;
                const role = params.get('role') || sessionStorage.getItem('userRole') || 
                            JSON.parse(localStorage.getItem('dashboardAuth')||'{}').role || 'viewer';
                
                if (uid && username) {
                    sessionStorage.setItem('targetUID', uid);
                    sessionStorage.setItem('currentUsername', username);
                    sessionStorage.setItem('userRole', role);
                    console.log('✅ 認証情報復元完了:', { uid: uid.substring(0,8) + '...', username, role });
                }
                
                // 分析ページの場合はログイン済みのみチェック
                if (isAnalyticsPage) {
                    if (!sessionStorage.getItem('targetUID') || !sessionStorage.getItem('currentUsername')) {
                        console.warn('認証が必要です。ログインに戻ります。');
                        location.href = '../index.html';
                        return false;
                    }
                } else if (requireAuth && (!sessionStorage.getItem('targetUID') || !sessionStorage.getItem('currentUsername'))) {
                    console.warn('認証が必要です。ログインに戻ります。');
                    location.href = '../index.html';
                    return false;
                }
                
                // 匿名認証の確保
                if (!window.auth?.currentUser) {
                    try { 
                        await window.auth.signInAnonymously(); 
                        console.log('✅ 匿名認証完了');
                    } catch (e) { 
                        console.warn('匿名認証失敗', e); 
                    }
                }
                
                return true;
            } catch (error) {
                console.error('AuthGuard初期化エラー:', error);
                if (requireAuth) {
                    location.href = '../index.html';
                }
                return false;
            }
        },
        
        getSession() {
            return {
                uid: sessionStorage.getItem('targetUID'),
                username: sessionStorage.getItem('currentUsername'),
                role: sessionStorage.getItem('userRole') || 'viewer'
            };
        },
        
        async getUserData() {
            const { uid } = this.getSession();
            if (!uid) return null;
            
            try {
                const snapshot = await window.database.ref(`${window.DATA_ROOT}/users/${uid}`).once('value');
                return snapshot.val();
            } catch (error) {
                console.error('ユーザーデータ取得エラー:', error);
                return null;
            }
        }
    };
})();
