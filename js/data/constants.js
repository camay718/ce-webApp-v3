/**
 * CEスケジュール管理システム V2 - 定数定義
 * 勤務区分表統合対応版（名前管理改善）
 */

// Firebaseのデータルート
window.DATA_ROOT = 'ceScheduleV2';

// 部門リスト（9部門・3x3レイアウト対応）
window.DEPARTMENTS = [
    '機器管理・人工呼吸',
    '血液浄化', 
    '不整脈',
    '心・カテーテル',
    '人工心肺・補助循環',
    '手術・麻酔',
    '会議・ミーティング・勉強会・打ち合わせ',
    '出張・研修内容',
    'その他・連絡'
];

// 部門アイコンマップ
window.DEPARTMENT_ICONS = {
    '機器管理・人工呼吸': 'lungs',
    '血液浄化': 'tint',
    '不整脈': 'heartbeat',
    '心・カテーテル': 'heart',
    '人工心肺・補助循環': 'procedures',
    '手術・麻酔': 'user-md',
    '会議・ミーティング・勉強会・打ち合わせ': 'comments',
    '出張・研修内容': 'plane',
    'その他・連絡': 'info-circle'
};

// 部門カラーマップ
window.DEPARTMENT_COLORS = {
    '機器管理・人工呼吸': '#90EE90',
    '血液浄化': '#FFB6C1',
    '不整脈': '#9370DB',
    '心・カテーテル': '#32CD32',
    '人工心肺・補助循環': '#4169E1',
    '手術・麻酔': '#87CEEB',
    '会議・ミーティング・勉強会・打ち合わせ': '#9E9E9E',
    '出張・研修内容': '#9E9E9E',
    'その他・連絡': '#9E9E9E'
};

// 勤務区分（CEタイプ）
window.WORK_TYPE_CLASSIFICATIONS = ['OPE', 'ME', 'HD', 'FLEX'];

// 日々の勤務状態
window.DAILY_WORK_STATUSES = ['A', 'A1', 'B', '非', '×', '年', '出', '研'];

// 勤務区分色定義（エクセルデータに準拠）
window.WORK_TYPE_COLORS = {
    'OPE': { 
        base: '#87CEEB',    // 水色
        A1: '#1E3A8A',      // 紺（A1の場合）
        textColor: '#1E3A8A'
    },
    'ME': { 
        base: '#90EE90',    // 黄緑
        textColor: '#006400'
    },
    'HD': { 
        base: '#FFB6C1',    // ピンク
        textColor: '#8B008B'
    },
    'FLEX': { 
        base: '#FFFF99',    // 黄色
        textColor: '#B8860B'
    }
};

// 勤務時間帯定義（エクセルデータから）
window.WORK_TIME_DEFINITIONS = {
    'A': { 
        time: '8:00～16:30', 
        break: '11:45～12:30',
        label: '日勤'
    },
    'A1': { 
        time: '7:00～15:30', 
        break: '11:45～12:30',
        label: '早出'
    },
    'B': { 
        time: '8:00～翌8:00', 
        break: '11:45～12:45及び16:45～17:45',
        label: '当直'
    },
    '非': { label: '非番' },
    '×': { label: '休日' },
    '年': { label: '有給休暇' },
    '出': { label: '出張' },
    '研': { label: '研修' }
};

// CE勤務状態からバッジへの変換（既存互換性）
window.STATUS_TO_BADGE_MAP = {
    'A': '',
    'A1': '早',
    'B': '当',
    '非': '非',
    '×': '休',
    '年': '年',
    '出': '出',
    '研': '研'
};

// 監査ログアクションの表示名
window.AUDIT_ACTION_MAP = {
    'login': 'ログイン',
    'logout': 'ログアウト',
    'ce_add': 'CE追加',
    'ce_delete': 'CE削除',
    'ce_reorder': 'CE並び替え',
    'ce_sort': 'CE並び替え（自動）',
    'work_schedule_update': '勤務区分表更新',
    'work_schedule_create': '勤務表作成',
    'work_type_change': '勤務区分変更',
    'event_add': '業務追加',
    'event_edit': '業務編集',
    'event_delete': '業務削除',
    'event_assign': '業務にCE割当',
    'event_unassign': '業務からCE解除',
    'monthly_task_add': '月次業務追加',
    'monthly_task_edit': '月次業務編集',
    'monthly_task_delete': '月次業務削除',
    'monthly_task_execute': '月次業務実施',
    'monthly_task_assign': '月次業務にCE割当',
    'monthly_task_unassign': '月次業務からCE解除',
    'bulk_event_add': '期間一括業務追加'
};

// 初期CEリスト（システム初期化用）
// name: アイコン表示名（短縮名）, fullName: フルネーム
window.CE_LIST_INITIAL = [
    { name: '田中', fullName: '田中 太郎', workType: 'ME' },
    { name: '佐藤', fullName: '佐藤 花子', workType: 'OPE' },
    { name: '鈴木', fullName: '鈴木 一郎', workType: 'HD' },
    { name: '高橋', fullName: '高橋 恵子', workType: 'FLEX' },
    { name: '渡辺', fullName: '渡辺 健太', workType: 'ME' }
];
