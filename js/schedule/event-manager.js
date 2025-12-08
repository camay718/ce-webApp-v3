/**
 * イベント管理システム - 完全修正版
 */
(function() {
    'use strict';

    class EventManager {
        constructor() {
            this.isInitialized = false;
            this.currentEditingEvent = null;
            this.init();
        }

        async init() {
            try {
                await this.waitForDependencies();
                this.setupEventListeners();
                this.isInitialized = true;
                console.log('📅 イベントマネージャー初期化完了');
            } catch (error) {
                console.error('❌ イベントマネージャー初期化エラー:', error);
            }
        }

        async waitForDependencies() {
            let attempts = 0;
            while (attempts < 50) {
                if (window.database && window.DATA_ROOT && window.showMessage && 
                    window.DEPARTMENTS) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            throw new Error('EventManager: 依存関係の初期化タイムアウト');
        }

        setupEventListeners() {
            const buttons = [
                { id: 'addEventButtonDaily', method: 'openAddEventModal' },
                { id: 'addBulkEventBtn', method: 'openBulkAddModal' },
                { id: 'addMonthlyTaskBtn', method: 'openMonthlyTaskModal' }
            ];

            buttons.forEach(({ id, method }) => {
                const btn = document.getElementById(id);
                if (btn && !btn.dataset.eventManagerBound) {
                    btn.dataset.eventManagerBound = 'true';
                    btn.onclick = () => this[method]();
                }
            });
        }

        // 業務追加モーダル（CE配置対応版）
        openAddEventModal(department = null) {
            if (window.userRole === 'viewer') {
                window.showMessage('編集権限がありません', 'warning');
                return;
            }

            this.createAddEventModal(department);
        }

createAddEventModal(selectedDepartment = null) {
    const existingModal = document.getElementById('addEventModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'addEventModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="glass-card p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-bold">業務追加</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            
            <form id="addEventForm" class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-bold mb-2">
                            <i class="fas fa-building mr-2"></i>部門 *
                        </label>
                        <select id="eventDepartment" class="input-unified" required>
                            <option value="">部門を選択</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-bold mb-2">
                            <i class="fas fa-calendar mr-2"></i>日付 *
                        </label>
                        <input type="date" id="eventDate" class="input-unified" required>
                    </div>
                </div>
                
                <div>
                    <label class="block text-sm font-bold mb-2">
                        <i class="fas fa-tasks mr-2"></i>業務名 *
                    </label>
                    <input type="text" id="eventName" class="input-unified" 
                           placeholder="例: 手術室メンテナンス" required>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-bold mb-2">
                            <i class="fas fa-clock mr-2"></i>開始時間
                        </label>
                        <input type="time" id="eventStartTime" class="input-unified">
                    </div>
                    <div>
                        <label class="block text-sm font-bold mb-2">
                            <i class="fas fa-clock mr-2"></i>終了時間
                        </label>
                        <input type="time" id="eventEndTime" class="input-unified">
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-bold mb-2">
                            <i class="fas fa-hashtag mr-2"></i>予定件数
                        </label>
                        <input type="number" id="eventCount" class="input-unified" min="0" max="99" value="0" placeholder="0">
                    </div>
                    <div>
                        <label class="block text-sm font-bold mb-2">
                            <i class="fas fa-users mr-2"></i>必要人数
                        </label>
                        <input type="number" id="eventRequiredPeople" class="input-unified" min="0" max="20" value="0" placeholder="0">
                    </div>
                </div>
                
                <div>
                    <label class="block text-sm font-bold mb-2">
                        <i class="fas fa-info-circle mr-2"></i>詳細
                    </label>
                    <textarea id="eventDescription" class="input-unified" rows="2"
                              placeholder="業務の詳細を入力（任意）"></textarea>
                </div>
                
                <div class="flex space-x-3">
                    <button type="button" onclick="this.closest('.fixed').remove()" 
                            class="btn-unified btn-outline-unified flex-1">
                        キャンセル
                    </button>
                    <button type="submit" class="btn-unified btn-primary-unified flex-1">
                        <i class="fas fa-save mr-2"></i>保存
                    </button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    this.initializeEventModal(selectedDepartment);
}

// 業務保存処理の修正
async saveEvent() {
    const department = document.getElementById('eventDepartment')?.value;
    const name = document.getElementById('eventName')?.value?.trim();
    const startTime = document.getElementById('eventStartTime')?.value;
    const endTime = document.getElementById('eventEndTime')?.value;
    const count = parseInt(document.getElementById('eventCount')?.value) || 0;
    const requiredPeople = parseInt(document.getElementById('eventRequiredPeople')?.value) || 0;
    const date = document.getElementById('eventDate')?.value;
    const description = document.getElementById('eventDescription')?.value?.trim();

    if (!department || !name || !date) {
        window.showMessage('必須項目を入力してください', 'warning');
        return;
    }

    try {
        const eventRef = window.database.ref(`${window.DATA_ROOT}/events/byDate/${date}`).push();
        const eventData = {
            id: eventRef.key,
            department: department,
            name: name,
            startTime: startTime || null,
            endTime: endTime || null,
            count: count,
            requiredPeople: requiredPeople,
            date: date,
            description: description || null,
            assignedCEs: [], // 初期は空配列
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            createdBy: window.currentUserData?.displayName || 'unknown'
        };

        await eventRef.set(eventData);

        document.getElementById('addEventModal').remove();
        window.showMessage('業務を追加しました', 'success');

        if (window.dashboardAuth) {
            setTimeout(() => {
                window.dashboardAuth.loadAndRenderEventsForSelectedDate();
            }, 500);
        }

        console.log('✅ 業務保存完了:', eventData);

    } catch (error) {
        console.error('❌ 業務保存エラー:', error);
        window.showMessage('業務の保存に失敗しました', 'error');
    }
}

// 月次業務追加の修正
async saveMonthlyTask() {
    const department = document.getElementById('monthlyDepartment')?.value;
    const name = document.getElementById('monthlyTaskName')?.value?.trim();
    const month = document.getElementById('monthlyMonth')?.value;
    const count = parseInt(document.getElementById('monthlyEventCount')?.value) || 0;
    const requiredPeople = parseInt(document.getElementById('monthlyRequiredPeople')?.value) || 0;
    const description = document.getElementById('monthlyDescription')?.value?.trim();

    if (!department || !name || !month) {
        window.showMessage('必須項目を入力してください', 'warning');
        return;
    }

    try {
        // pushを使用してユニークキーで保存
        const taskRef = window.database.ref(`${window.DATA_ROOT}/monthlyTasks`).push();
        const taskData = {
            id: taskRef.key,
            department: department,
            name: name,
            month: parseInt(month),
            count: count,
            requiredPeople: requiredPeople,
            description: description || null,
            isMonthlyTask: true,
            assignedCEs: [],
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            createdBy: window.currentUserData?.displayName || 'unknown'
        };

        await taskRef.set(taskData);

        document.getElementById('monthlyTaskModal').remove();
        window.showMessage('月次業務を追加しました', 'success');

        console.log('✅ 月次業務保存完了:', taskData);

    } catch (error) {
        console.error('❌ 月次業務保存エラー:', error);
        window.showMessage('月次業務の保存に失敗しました', 'error');
    }
}

        // 期間一括業務追加モーダル
        openBulkAddModal() {
            if (window.userRole === 'viewer') {
                window.showMessage('編集権限がありません', 'warning');
                return;
            }

            const modal = document.createElement('div');
            modal.id = 'bulkEventModal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="glass-card p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold">期間一括業務追加</h3>
                        <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                    
                    <form id="bulkEventForm" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-bold mb-2">開始日 *</label>
                                <input type="date" id="bulkStartDate" class="input-unified" required>
                            </div>
                            <div>
                                <label class="block text-sm font-bold mb-2">終了日 *</label>
                                <input type="date" id="bulkEndDate" class="input-unified" required>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-bold mb-2">部門 *</label>
                            <select id="bulkDepartment" class="input-unified" required>
                                <option value="">部門を選択</option>
                            </select>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-bold mb-2">業務名 *</label>
                            <input type="text" id="bulkEventName" class="input-unified" 
                                   placeholder="例: 定期メンテナンス" required>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-bold mb-2">開始時間</label>
                                <input type="time" id="bulkStartTime" class="input-unified">
                            </div>
                            <div>
                                <label class="block text-sm font-bold mb-2">終了時間</label>
                                <input type="time" id="bulkEndTime" class="input-unified">
                            </div>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-bold mb-2">予定件数</label>
                                <select id="bulkEventCount" class="input-unified">
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-bold mb-2">必要人数</label>
                                <select id="bulkRequiredPeople" class="input-unified">
                                </select>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-bold mb-2">実施曜日</label>
                            <div class="flex space-x-2">
                                <label class="flex items-center">
                                    <input type="checkbox" value="1" class="bulk-weekday mr-1">
                                    <span class="text-sm">月</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" value="2" class="bulk-weekday mr-1">
                                    <span class="text-sm">火</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" value="3" class="bulk-weekday mr-1">
                                    <span class="text-sm">水</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" value="4" class="bulk-weekday mr-1">
                                    <span class="text-sm">木</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" value="5" class="bulk-weekday mr-1">
                                    <span class="text-sm">金</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" value="6" class="bulk-weekday mr-1">
                                    <span class="text-sm">土</span>
                                </label>
                                <label class="flex items-center">
                                    <input type="checkbox" value="0" class="bulk-weekday mr-1">
                                    <span class="text-sm">日</span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="flex space-x-3">
                            <button type="button" onclick="this.closest('.fixed').remove()" 
                                    class="btn-unified btn-outline-unified flex-1">
                                キャンセル
                            </button>
                            <button type="submit" class="btn-unified btn-primary-unified flex-1">
                                <i class="fas fa-calendar-plus mr-2"></i>一括追加
                            </button>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(modal);
            this.initializeBulkModal();
        }

        initializeBulkModal() {
            // 部門選択肢
            const deptSelect = document.getElementById('bulkDepartment');
            if (window.DEPARTMENTS && deptSelect) {
                window.DEPARTMENTS.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept;
                    option.textContent = dept;
                    deptSelect.appendChild(option);
                });
            }

            // 件数・人数選択肢
            const countSelect = document.getElementById('bulkEventCount');
            const peopleSelect = document.getElementById('bulkRequiredPeople');
            
            [countSelect, peopleSelect].forEach((select, index) => {
                if (select) {
                    for (let i = 0; i <= (index === 0 ? 20 : 10); i++) {
                        const option = document.createElement('option');
                        option.value = i;
                        option.textContent = index === 0 ? `${i}件` : `${i}名`;
                        option.selected = i === 1;
                        select.appendChild(option);
                    }
                }
            });

            const form = document.getElementById('bulkEventForm');
            if (form) {
                form.onsubmit = (e) => {
                    e.preventDefault();
                    this.saveBulkEvent();
                };
            }
        }

        async saveBulkEvent() {
            const startDate = document.getElementById('bulkStartDate')?.value;
            const endDate = document.getElementById('bulkEndDate')?.value;
            const department = document.getElementById('bulkDepartment')?.value;
            const name = document.getElementById('bulkEventName')?.value?.trim();
            const startTime = document.getElementById('bulkStartTime')?.value;
            const endTime = document.getElementById('bulkEndTime')?.value;
            const count = parseInt(document.getElementById('bulkEventCount')?.value) || 0;
            const requiredPeople = parseInt(document.getElementById('bulkRequiredPeople')?.value) || 0;
            
            const selectedWeekdays = Array.from(document.querySelectorAll('.bulk-weekday:checked'))
                .map(cb => parseInt(cb.value));

            if (!startDate || !endDate || !department || !name) {
                window.showMessage('必須項目を入力してください', 'warning');
                return;
            }

            if (selectedWeekdays.length === 0) {
                window.showMessage('実施曜日を選択してください', 'warning');
                return;
            }

            try {
                const start = new Date(startDate);
                const end = new Date(endDate);
                const updates = {};
                let eventCount = 0;
                
                for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
                    const weekday = date.getDay();
                    
                    if (selectedWeekdays.includes(weekday)) {
                        const dateKey = date.toISOString().slice(0, 10);
                        const eventRef = window.database.ref(`${window.DATA_ROOT}/events/byDate/${dateKey}`).push();
                        
                        const eventData = {
                            id: eventRef.key,
                            department: department,
                            name: name,
                            startTime: startTime || null,
                            endTime: endTime || null,
                            count: count,
                            requiredPeople: requiredPeople,
                            date: dateKey,
                            isBulkEvent: true,
                            assignedCEs: [],
                            createdAt: firebase.database.ServerValue.TIMESTAMP,
                            createdBy: window.currentUserData?.displayName || 'unknown'
                        };
                        
                        updates[`${window.DATA_ROOT}/events/byDate/${dateKey}/${eventRef.key}`] = eventData;
                        eventCount++;
                    }
                }

                await window.database.ref().update(updates);

                document.getElementById('bulkEventModal').remove();
                window.showMessage(`${eventCount}件の業務を一括追加しました`, 'success');

                if (window.dashboardAuth) {
                    window.dashboardAuth.renderDailySchedule();
                }

            } catch (error) {
                console.error('❌ 期間一括業務保存エラー:', error);
                window.showMessage('期間一括業務の保存に失敗しました', 'error');
            }
        }

        // 月次業務追加モーダル（実施日なし版）
        openMonthlyTaskModal() {
            if (window.userRole === 'viewer') {
                window.showMessage('編集権限がありません', 'warning');
                return;
            }

            const modal = document.createElement('div');
            modal.id = 'monthlyTaskModal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="glass-card p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold">月次業務追加</h3>
                        <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                    
                    <form id="monthlyTaskForm" class="space-y-4">
                        <div>
                            <label class="block text-sm font-bold mb-2">部門 *</label>
                            <select id="monthlyDepartment" class="input-unified" required>
                                <option value="">部門を選択</option>
                            </select>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-bold mb-2">業務名 *</label>
                            <input type="text" id="monthlyTaskName" class="input-unified" 
                                   placeholder="例: 月次点検" required>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-bold mb-2">実施月 *</label>
                            <select id="monthlyMonth" class="input-unified" required>
                                <option value="">月を選択</option>
                            </select>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-bold mb-2">予定件数</label>
                                <select id="monthlyEventCount" class="input-unified">
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-bold mb-2">必要人数</label>
                                <select id="monthlyRequiredPeople" class="input-unified">
                                </select>
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-bold mb-2">詳細</label>
                            <textarea id="monthlyDescription" class="input-unified" rows="3"
                                      placeholder="月次業務の詳細"></textarea>
                        </div>
                        
                        <div class="flex space-x-3">
                            <button type="button" onclick="this.closest('.fixed').remove()" 
                                    class="btn-unified btn-outline-unified flex-1">
                                キャンセル
                            </button>
                            <button type="submit" class="btn-unified btn-primary-unified flex-1">
                                <i class="fas fa-calendar-alt mr-2"></i>追加
                            </button>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(modal);
            this.initializeMonthlyModal();
        }

        initializeMonthlyModal() {
            // 部門選択肢
            const deptSelect = document.getElementById('monthlyDepartment');
            if (window.DEPARTMENTS && deptSelect) {
                window.DEPARTMENTS.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept;
                    option.textContent = dept;
                    deptSelect.appendChild(option);
                });
            }

            // 月選択肢
            const monthSelect = document.getElementById('monthlyMonth');
            if (monthSelect) {
                const currentMonth = new Date().getMonth() + 1;
                for (let i = 1; i <= 12; i++) {
                    const option = document.createElement('option');
                    option.value = i;
                    option.textContent = `${i}月`;
                    option.selected = i === currentMonth;
                    monthSelect.appendChild(option);
                }
            }

            // 件数・人数選択肢
            const countSelect = document.getElementById('monthlyEventCount');
            const peopleSelect = document.getElementById('monthlyRequiredPeople');
            
            [countSelect, peopleSelect].forEach((select, index) => {
                if (select) {
                    for (let i = 0; i <= (index === 0 ? 20 : 10); i++) {
                        const option = document.createElement('option');
                        option.value = i;
                        option.textContent = index === 0 ? `${i}件` : `${i}名`;
                        option.selected = i === 1;
                        select.appendChild(option);
                    }
                }
            });

            const form = document.getElementById('monthlyTaskForm');
            if (form) {
                form.onsubmit = (e) => {
                    e.preventDefault();
                    this.saveMonthlyTask();
                };
            }
        }

        async saveMonthlyTask() {
            const department = document.getElementById('monthlyDepartment')?.value;
            const name = document.getElementById('monthlyTaskName')?.value?.trim();
            const month = document.getElementById('monthlyMonth')?.value;
            const count = parseInt(document.getElementById('monthlyEventCount')?.value) || 0;
            const requiredPeople = parseInt(document.getElementById('monthlyRequiredPeople')?.value) || 0;
            const description = document.getElementById('monthlyDescription')?.value?.trim();

            if (!department || !name || !month) {
                window.showMessage('必須項目を入力してください', 'warning');
                return;
            }

            try {
                const taskData = {
                    id: `monthly_task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    department: department,
                    name: name,
                    month: parseInt(month),
                    count: count,
                    requiredPeople: requiredPeople,
                    description: description || null,
                    isMonthlyTask: true,
                    assignedCEs: [],
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    createdBy: window.currentUserData?.displayName || 'unknown'
                };

                await window.database.ref(`${window.DATA_ROOT}/monthlyTasks/${taskData.id}`).set(taskData);

                document.getElementById('monthlyTaskModal').remove();
                window.showMessage('月次業務を追加しました', 'success');

                console.log('✅ 月次業務保存完了:', taskData);

            } catch (error) {
                console.error('❌ 月次業務保存エラー:', error);
                window.showMessage('月次業務の保存に失敗しました', 'error');
            }
        }
    }

    window.EventManager = EventManager;
    console.log('📅 イベントマネージャークラス読み込み完了（完全修正版）');
})();
