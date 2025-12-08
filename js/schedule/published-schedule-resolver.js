/**
 * 公開勤務表連動システム
 */
class PublishedScheduleResolver {
    constructor() {
        this.publishedSchedules = [];
        this.cache = new Map();
        this.init();
    }

    async init() {
        try {
            await window.waitForFirebase();
            await this.loadPublishedSchedules();
            this.setupRealtimeUpdates();
            console.log('✅ 公開勤務表連動システム初期化完了');
        } catch (error) {
            console.error('❌ 公開勤務表連動システム初期化エラー:', error);
        }
    }

    async loadPublishedSchedules() {
        try {
            const snapshot = await window.database.ref(`${window.DATA_ROOT}/workSchedules`).once('value');
            const data = snapshot.val() || {};
            
            this.publishedSchedules = Object.keys(data).map(periodKey => ({
                key: periodKey,
                ...data[periodKey]
            })).filter(schedule => {
                return window.userRole === 'admin' || (schedule.metadata?.isVisible !== false);
            }).sort((a, b) => (b.metadata?.publishedAt || 0) - (a.metadata?.publishedAt || 0));

            this.cache.clear();
            console.log(`✅ 公開勤務表読み込み完了: ${this.publishedSchedules.length}件`);
        } catch (error) {
            console.error('❌ 公開勤務表読み込みエラー:', error);
        }
    }

    async getCEWorkStatusForDate(ceId, dateKey) {
        const cacheKey = `${ceId}_${dateKey}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const relevantSchedules = this.publishedSchedules.filter(schedule => {
            const metadata = schedule.metadata || {};
            return dateKey >= metadata.startDate && dateKey <= metadata.endDate;
        });

        if (relevantSchedules.length === 0) {
            return null;
        }

        if (relevantSchedules.length > 1) {
            const conflicts = this.checkConflicts(ceId, dateKey, relevantSchedules);
            if (conflicts.length > 0) {
                console.warn('⚠️ 勤務表競合検出:', conflicts);
                return { status: '競合', workType: 'ERROR', desired: false };
            }
        }

        const schedule = relevantSchedules[0];
        const scheduleData = schedule.scheduleData || {};
        const workTypeOverrides = schedule.workTypeOverrides || {};
        const ceList = schedule.ceList || [];
        
        const ce = ceList.find(c => c.id === ceId);
        if (!ce) return null;

        const workData = scheduleData[ceId]?.[dateKey];
        if (!workData) return null;

        const effectiveWorkType = this.getEffectiveWorkType(ceId, dateKey, ce, workTypeOverrides);
        const status = workData.customText?.trim() || workData.status;
        
        const result = {
            status: status,
            workType: effectiveWorkType,
            desired: workData.desired || false
        };

        this.cache.set(cacheKey, result);
        return result;
    }

    checkConflicts(ceId, dateKey, schedules) {
        const statuses = schedules.map(schedule => {
            const scheduleData = schedule.scheduleData || {};
            const workData = scheduleData[ceId]?.[dateKey];
            return workData ? (workData.customText?.trim() || workData.status) : null;
        }).filter(status => status !== null);

        const uniqueStatuses = [...new Set(statuses)];
        return uniqueStatuses.length > 1 ? uniqueStatuses : [];
    }

    getEffectiveWorkType(ceId, dateKey, ce, workTypeOverrides) {
        const overrides = workTypeOverrides[ceId];
        if (Array.isArray(overrides)) {
            const validOverrides = overrides.filter(override => 
                dateKey >= override.startDate && dateKey <= override.endDate
            );
            if (validOverrides.length > 0) {
                const latest = validOverrides.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
                return latest.workType;
            }
        } else if (overrides && overrides.startDate && dateKey >= overrides.startDate && dateKey <= overrides.endDate) {
            return overrides.workType;
        }
        
        return ce.workType || 'ME';
    }

    setupRealtimeUpdates() {
        window.database.ref(`${window.DATA_ROOT}/workSchedules`).on('value', async () => {
            console.log('🔄 公開勤務表データ更新検知');
            await this.loadPublishedSchedules();
            
            if (window.ceManager && typeof window.ceManager.updateCEIconsFromSchedule === 'function') {
                window.ceManager.updateCEIconsFromSchedule();
            }
        });
    }

    async applyCEStatusToList(dateKey) {
        const ceItems = document.querySelectorAll('#ceListContainer .ce-item');
        const ceList = window.ceManager?.ceList || [];

        for (let i = 0; i < ceItems.length; i++) {
            const item = ceItems[i];
            const ce = ceList[i];
            if (!ce) continue;

            item.classList.remove('worktype-ope', 'worktype-me', 'worktype-hd', 'worktype-flex', 'worktype-error');
            item.querySelectorAll('.status-badge').forEach(badge => badge.remove());

            const workStatus = await this.getCEWorkStatusForDate(ce.id, dateKey);
            
            if (workStatus) {
                if (workStatus.workType === 'ERROR') {
                    item.classList.add('worktype-error');
                } else {
                    item.classList.add(`worktype-${workStatus.workType.toLowerCase()}`);
                }
                
                if (workStatus.status && workStatus.status !== 'A') {
                    const badge = document.createElement('div');
                    badge.className = 'status-badge';
                    badge.textContent = workStatus.status;
                    
                    const statusColors = {
                        'A1': '#FF9800', 'B': '#9C27B0', '非': '#607D8B',
                        '×': '#F44336', '年': '#2196F3', '出': '#2196F3', '研': '#795548',
                        '競合': '#FF0000'
                    };
                    if (statusColors[workStatus.status]) {
                        badge.style.background = statusColors[workStatus.status];
                        badge.style.color = 'white';
                    }
                    
                    item.appendChild(badge);
                }
                
                item.dataset.workType = workStatus.workType;
            } else {
                item.classList.add(`worktype-${(ce.workType || 'ME').toLowerCase()}`);
                item.dataset.workType = ce.workType || 'ME';
            }
        }
    }
}

window.PublishedScheduleResolver = PublishedScheduleResolver;
