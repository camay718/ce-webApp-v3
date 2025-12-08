/**
 * CE日別勤務状態管理システム - Firebase同期対応版
 */
(function() {
    'use strict';

    class CEDailyStatusManager {
        constructor() {
            this.selectedDate = new Date();
            this.statusData = {}; // {ceId: status}
            this.isInitialized = false;
            this.statusListener = null;
            this.init();
        }

        async init() {
            try {
                await this.waitForDependencies();
                this.setupEventListeners();
                await this.setupRealtimeStatusListener();
                this.isInitialized = true;
                console.log('📅 CE日別勤務状態管理初期化完了');
            } catch (error) {
                console.error('❌ CE日別勤務状態管理初期化エラー:', error);
            }
        }

        async waitForDependencies() {
            let attempts = 0;
            while (attempts < 50) {
                if (window.database && window.DATA_ROOT && window.ceManager && window.showMessage) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            throw new Error('CEDailyStatusManager: 依存関係初期化タイムアウト');
        }

        setupEventListeners() {
            const dateInput = document.getElementById('ceStatusDate');
            if (dateInput && !dateInput.dataset.bound) {
                dateInput.dataset.bound = 'true';
                dateInput.value = this.formatDate(this.selectedDate);
                dateInput.onchange = async (e) => {
                    this.selectedDate = new Date(e.target.value + 'T00:00:00');
                    await this.setupRealtimeStatusListener();
                    this.updateMainCEList();
                };
            }
        }

        async setupRealtimeStatusListener() {
            // 既存のリスナーを削除
            if (this.statusListener) {
                this.statusListener.off();
            }

            const dateKey = this.formatDate(this.selectedDate);
            const statusRef = window.database.ref(`${window.DATA_ROOT}/ceStatus/byDate/${dateKey}`);
            
            this.statusListener = statusRef.on('value', (snapshot) => {
                this.statusData = snapshot.val() || {};
                this.renderCEManagementTable();
                this.updateMainCEList();
                console.log(`✅ ${dateKey} の勤務状態リアルタイム更新`);
            });
        }

        async updateCEStatus(ceId, status) {
            const dateKey = this.formatDate(this.selectedDate);
            try {
                if (status === '') {
                    await window.database.ref(`${window.DATA_ROOT}/ceStatus/byDate/${dateKey}/${ceId}`).remove();
                } else {
                    await window.database.ref(`${window.DATA_ROOT}/ceStatus/byDate/${dateKey}/${ceId}`).set(status);
                }
                window.showMessage('勤務状態を更新しました', 'success');
            } catch (error) {
                console.error('❌ CE勤務状態更新エラー:', error);
                window.showMessage('勤務状態の更新に失敗しました', 'error');
            }
        }

        async addNewCE() {
            const name = document.getElementById('newCEName').value.trim();
            const workType = document.getElementById('newCEWorkType').value;

            if (!name) {
                window.showMessage('CE名を入力してください', 'warning');
                return;
            }

            if (window.ceManager) {
                try {
                    await window.ceManager.addNewCE(name, workType);
                    document.getElementById('newCEName').value = '';
                    window.showMessage(`${name}を追加しました`, 'success');
                } catch (error) {
                    console.error('❌ CE追加エラー:', error);
                    window.showMessage('CEの追加に失敗しました', 'error');
                }
            }
        }

        async deleteCE(ceIndex) {
            if (!window.ceManager?.ceList[ceIndex]) return;

            const ceName = window.ceManager.ceList[ceIndex].name;
            
            if (!confirm(`${ceName} を削除しますか？\n\nこの操作は元に戻せません。`)) {
                return;
            }

            try {
                window.ceManager.ceList.splice(ceIndex, 1);
                await window.ceManager.saveCEList();
                window.showMessage(`${ceName} を削除しました`, 'success');
            } catch (error) {
                console.error('❌ CE削除エラー:', error);
                window.showMessage('CEの削除に失敗しました', 'error');
            }
        }

        async sortCEList(sortType) {
            if (!window.ceManager?.ceList) return;

            const ceList = window.ceManager.ceList;
            
            switch (sortType) {
                case 'name':
                    ceList.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
                    break;
                case 'workType':
                    ceList.sort((a, b) => a.workType.localeCompare(b.workType));
                    break;
                case 'department':
                    ceList.sort((a, b) => {
                        const deptA = a.department || 'zzz';
                        const deptB = b.department || 'zzz';
                        return deptA.localeCompare(deptB, 'ja');
                    });
                    break;
                default:
                    return;
            }

            try {
                await window.ceManager.saveCEList();
                window.showMessage(`${sortType}順で並び替えました`, 'success');
            } catch (error) {
                console.error('❌ 並び替えエラー:', error);
                window.showMessage('並び替えに失敗しました', 'error');
            }
        }

        renderCEManagementTable() {
            const tbody = document.getElementById('ceManagementTableBody');
            if (!tbody || !window.ceManager?.ceList) return;

            const ceList = window.ceManager.ceList;
            tbody.innerHTML = '';

            ceList.forEach((ce, index) => {
                const ceId = ce.id || `ce_${index}`;
                const currentStatus = this.statusData[ceId] || '';

                const row = document.createElement('tr');
                row.className = 'border-b hover:bg-gray-50';
                
                row.innerHTML = `
                    <td class="p-3">
                        <div class="ce-item-mini worktype-${ce.workType.toLowerCase()} px-2 py-1 rounded text-xs">
                            ${ce.name}
                        </div>
                    </td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-1 rounded text-xs worktype-${ce.workType.toLowerCase()}">
                            ${ce.workType}
                        </span>
                    </td>
                    <td class="p-3 text-center">${ce.department || '未設定'}</td>
                    <td class="p-3 text-center">
                        <select class="px-2 py-1 border rounded text-xs" onchange="window.ceDailyStatus.updateCEStatus('${ceId}', this.value)">
                            <option value="" ${currentStatus === '' ? 'selected' : ''}>通常</option>
                            <option value="早" ${currentStatus === '早' ? 'selected' : ''}>早出</option>
                            <option value="当" ${currentStatus === '当' ? 'selected' : ''}>当直</option>
                            <option value="非" ${currentStatus === '非' ? 'selected' : ''}>非番</option>
                            <option value="休" ${currentStatus === '休' ? 'selected' : ''}>休み</option>
                            <option value="出" ${currentStatus === '出' ? 'selected' : ''}>出張</option>
                        </select>
                    </td>
                    <td class="p-3 text-center">
                        <button onclick="window.ceManager.openCEEditModal(${index})" 
                                class="text-blue-600 hover:text-blue-800 text-xs mr-2">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="window.ceDailyStatus.deleteCE(${index})" 
                                class="text-red-600 hover:text-red-800 text-xs">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            // CE管理フォーム（最下部）
            const controlRow = document.createElement('tr');
            controlRow.innerHTML = `
                <td colspan="5" class="p-3 bg-gray-50">
                    <div class="flex items-center gap-3 flex-wrap">
                        <input type="text" id="newCEName" placeholder="新しいCE名" 
                               class="px-3 py-2 border rounded-lg">
                        <select id="newCEWorkType" class="px-3 py-2 border rounded-lg">
                            <option value="ME">ME</option>
                            <option value="OPE">OPE</option>
                            <option value="HD">HD</option>
                            <option value="FLEX">FLEX</option>
                        </select>
                        <button onclick="window.ceDailyStatus.addNewCE()" 
                                class="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm">
                            <i class="fas fa-plus mr-1"></i>追加
                        </button>
                        <div class="border-l pl-3 ml-3">
                            <label class="text-sm font-medium mr-2">並び替え:</label>
                            <button onclick="window.ceDailyStatus.sortCEList('name')" 
                                    class="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs mr-1">
                                名前順
                            </button>
                            <button onclick="window.ceDailyStatus.sortCEList('workType')" 
                                    class="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs mr-1">
                                勤務区分順
                            </button>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(controlRow);
        }

        updateMainCEList() {
            if (window.ceManager?.displayCEList) {
                window.ceManager.currentDisplayDate = this.selectedDate;
                window.ceManager.displayCEList();
            }
            
            if (window.dashboardAuth) {
                window.dashboardAuth.selectedDate = this.selectedDate;
                window.dashboardAuth.renderDailySchedule();
            }
        }

        getStatusForCE(ceId, targetDate = null) {
            const dateKey = this.formatDate(targetDate || this.selectedDate);
            if (dateKey === this.formatDate(this.selectedDate)) {
                return this.statusData[ceId] || '';
            } else {
                // 異なる日付の場合は非同期で取得
                return new Promise(async (resolve) => {
                    try {
                        const snapshot = await window.database.ref(`${window.DATA_ROOT}/ceStatus/byDate/${dateKey}/${ceId}`).once('value');
                        resolve(snapshot.val() || '');
                    } catch (e) {
                        console.error('getStatusForCE error:', e);
                        resolve('');
                    }
                });
            }
        }

        formatDate(date) {
            return date.toISOString().slice(0, 10);
        }

        destroy() {
            if (this.statusListener) {
                this.statusListener.off();
            }
        }
    }

    window.CEDailyStatusManager = CEDailyStatusManager;
    console.log('📅 CE日別勤務状態管理システム読み込み完了（Firebase同期対応）');
})();
