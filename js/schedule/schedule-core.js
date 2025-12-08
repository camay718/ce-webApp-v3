/**
 * スケジュール管理コア - Firebase統合版
 */
(function() {
    'use strict';

    class ScheduleCore {
        constructor() {
            this.database = window.database;
            this.dataRoot = window.DATA_ROOT;
            this.events = {}; // ローカルキャッシュ
            this.listeners = new Map(); // Firebase listeners
            this.init();
        }

        async init() {
            if (!this.database || !this.dataRoot) {
                console.error('❌ Firebase未初期化');
                return;
            }
            console.log('📊 スケジュールコア初期化完了');
        }

        // 月間データの監視開始
        listenToMonth(year, month, callback) {
            const monthKey = `${year}-${String(month).padStart(2, '0')}`;
            
            // 既存のリスナーを削除
            if (this.listeners.has(monthKey)) {
                this.listeners.get(monthKey).off();
            }

            // 日付範囲でクエリ
            const startDate = `${monthKey}-01`;
            const endDate = `${monthKey}-31`;
            
            const ref = this.database.ref(`${this.dataRoot}/events/byDate`)
                .orderByKey()
                .startAt(startDate)
                .endAt(endDate);

            const listener = ref.on('value', (snapshot) => {
                const data = snapshot.val() || {};
                
                // キャッシュ更新
                Object.keys(data).forEach(dateKey => {
                    const dayEvents = data[dateKey];
                    this.events[dateKey] = Object.keys(dayEvents || {}).map(eventId => ({
                        id: eventId,
                        ...dayEvents[eventId]
                    }));
                });

                console.log(`📊 ${monthKey} のデータを更新:`, Object.keys(data).length, '日分');
                callback && callback(this.events);
            });

            this.listeners.set(monthKey, { ref, off: () => ref.off('value', listener) });
        }

        // イベント取得
        getEventsByDate(dateKey) {
            return this.events[dateKey] || [];
        }

        // イベント追加
        async addEvent(eventData) {
            try {
                if (!eventData.date || !eventData.name) {
                    throw new Error('日付と業務名は必須です');
                }

                const eventRef = this.database.ref(`${this.dataRoot}/events/byDate/${eventData.date}`).push();
                const newEvent = {
                    ...eventData,
                    createdAt: Date.now(),
                    createdBy: window.currentUserData?.displayName || 'unknown',
                    assignments: eventData.assignments || []
                };

                await eventRef.set(newEvent);
                console.log('✅ イベント追加成功:', eventData.name);
                return eventRef.key;
            } catch (error) {
                console.error('❌ イベント追加エラー:', error);
                throw error;
            }
        }

        // イベント更新
        async updateEvent(dateKey, eventId, updateData) {
            try {
                const updatePayload = {
                    ...updateData,
                    updatedAt: Date.now(),
                    updatedBy: window.currentUserData?.displayName || 'unknown'
                };

                await this.database.ref(`${this.dataRoot}/events/byDate/${dateKey}/${eventId}`).update(updatePayload);
                console.log('✅ イベント更新成功:', eventId);
            } catch (error) {
                console.error('❌ イベント更新エラー:', error);
                throw error;
            }
        }

        // イベント削除
        async deleteEvent(dateKey, eventId) {
            try {
                await this.database.ref(`${this.dataRoot}/events/byDate/${dateKey}/${eventId}`).remove();
                console.log('✅ イベント削除成功:', eventId);
            } catch (error) {
                console.error('❌ イベント削除エラー:', error);
                throw error;
            }
        }

        // リスナー全削除
        destroy() {
            this.listeners.forEach(listener => listener.off());
            this.listeners.clear();
            console.log('📊 スケジュールコア破棄完了');
        }
    }

    // グローバル公開
    window.ScheduleCore = ScheduleCore;
    console.log('📊 スケジュールコア読み込み完了');
})();
