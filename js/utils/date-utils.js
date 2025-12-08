/**
 * 日付処理ユーティリティ - V2統合版
 */
(function() {
    'use strict';

    // 基本的な日付フォーマット関数
    function formatDateISO(date) {
        if (!date || !(date instanceof Date)) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatMonthYear(date) {
        if (!date || !(date instanceof Date)) return '';
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        return `${year}年${month}月`;
    }

    function isSameDay(date1, date2) {
        if (!date1 || !date2) return false;
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    function getToday() {
        return new Date();
    }

    function isToday(date) {
        return isSameDay(date, getToday());
    }

    // 月間カレンダー用の日付配列生成
    function generateCalendarDates(year, month) {
        try {
            const firstDay = new Date(year, month - 1, 1);
            const startWeekday = firstDay.getDay(); // 0=日曜日
            const daysInMonth = new Date(year, month, 0).getDate();
            const dates = [];

            // 前月の日付を追加
            const prevMonth = month === 1 ? 12 : month - 1;
            const prevYear = month === 1 ? year - 1 : year;
            const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
            
            for (let i = startWeekday - 1; i >= 0; i--) {
                dates.push({
                    date: new Date(prevYear, prevMonth - 1, daysInPrevMonth - i),
                    isCurrentMonth: false,
                    isPrevMonth: true
                });
            }

            // 当月の日付を追加
            for (let day = 1; day <= daysInMonth; day++) {
                dates.push({
                    date: new Date(year, month - 1, day),
                    isCurrentMonth: true,
                    isPrevMonth: false
                });
            }

            // 翌月の日付を追加（42日になるまで）
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            let nextDay = 1;
            while (dates.length < 42) {
                dates.push({
                    date: new Date(nextYear, nextMonth - 1, nextDay),
                    isCurrentMonth: false,
                    isPrevMonth: false
                });
                nextDay++;
            }

            return dates;
        } catch (error) {
            console.error('カレンダー日付生成エラー:', error);
            return [];
        }
    }

    // グローバル公開
    window.DateUtils = {
        formatDateISO,
        formatMonthYear,
        isSameDay,
        getToday,
        isToday,
        generateCalendarDates
    };

    console.log('📅 日付ユーティリティ読み込み完了');
})();
