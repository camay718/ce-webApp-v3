/**
 * Firebase設定 - V3版
 * 
 * 役割:
 * - Firebase基本設定の提供とApp初期化
 * - グローバルインスタンスの管理
 * - 初期化完了Promise管理
 * 
 * 重要: 認証処理は各ページで明示的に実行（競合防止）
 */

if (typeof window.firebaseV2Initialized === 'undefined') {
    console.log('🔄 Firebase設定ファイル読み込み開始');
    
    // Firebase設定（既存設定を維持）
    window.firebaseConfig = {
        apiKey: "AIzaSyDHujcHnKS1IKxcp1rBmfL6zNiraRVv_Q0",
        authDomain: "work-arrangement.firebaseapp.com",
        databaseURL: "https://work-arrangement-default-rtdb.firebaseio.com",
        projectId: "work-arrangement",
        storageBucket: "work-arrangement.firebasestorage.app",
        messagingSenderId: "373524055304",
        appId: "1:373524055304:web:aaa68f970ef640384c58bd",
        measurementId: "G-XQ9ZS2FNC1"
    };

    // データルート
    window.DATA_ROOT = 'ceScheduleV3';

    // グローバル変数
    window.auth = null;
    window.database = null;
    window.isFirebaseReady = false;
    window.firebaseV2Initialized = false;

    // Promise管理（初期化完了待機用）
    let initResolve, initReject, isResolved = false;
    window.firebaseInitPromise = new Promise((resolve, reject) => {
        initResolve = resolve;
        initReject = reject;
    });
    
    window.waitForFirebase = () => window.firebaseInitPromise;

    /**
     * Firebase基本初期化（認証なし）
     * 認証処理は意図的に除外し、各ページで明示的に実行
     */
    function initializeFirebaseV2() {
        if (window.firebaseV2Initialized) {
            if (!isResolved && initResolve) {
                isResolved = true;
                initResolve();
            }
            return;
        }
        
        try {
            // Firebase SDK待機
            if (typeof firebase === 'undefined') {
                console.log('⏳ Firebase SDK待機中...');
                setTimeout(initializeFirebaseV2, 200);
                return;
            }

            // Firebase App初期化
            let app;
            if (firebase.apps && firebase.apps.length > 0) {
                app = firebase.app();
                console.log('✅ 既存Firebase App使用');
            } else {
                app = firebase.initializeApp(window.firebaseConfig);
                console.log('✅ Firebase App初期化完了');
            }
            
            // サービスインスタンス作成
            window.auth = firebase.auth();
            window.database = firebase.database();
            window.firebaseV2Initialized = true;
            
            // 接続状態監視（エラーハンドリング付き）
            try {
                window.database.ref('.info/connected').on('value', function(snapshot) {
                    window.isFirebaseReady = snapshot.val();
                    console.log(snapshot.val() ? '✅ Firebase接続成功' : '❌ Firebase接続失敗');
                }, function(error) {
                    console.warn('⚠️ Firebase接続監視エラー:', error.message);
                });
            } catch (connectionError) {
                console.warn('⚠️ 接続監視設定失敗:', connectionError.message);
            }

            // Promise解決
            if (!isResolved && initResolve) {
                isResolved = true;
                initResolve();
            }
            
        } catch (error) {
            console.error('❌ Firebase初期化エラー:', error);
            if (!isResolved && initReject) {
                isResolved = true;
                initReject(error);
            }
        }
    }

    // 即座に初期化実行
    initializeFirebaseV2();
    console.log('🔒 Firebase設定ファイル読み込み完了');
}
