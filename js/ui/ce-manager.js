/**
 * CE管理システム - V2統合版（日別ステータス完全対応）
 */
(function() {
    'use strict';

    class CEManager {
        constructor() {
            this.ceList = [];
            this.isInitialized = false;
            this.editingCEIndex = -1;
            this.dbRef = null;
            this.currentDisplayDate = new Date();
            this.init();
        }

        async init() {
            try {
                await this.waitForDependencies();
                await this.setupRealtimeListener();
                this.setupEventListeners();
                this.isInitialized = true;
                console.log('👥 CEマネージャー初期化完了');
            } catch (error) {
                console.error('❌ CEマネージャー初期化エラー:', error);
            }
        }

        async waitForDependencies() {
            let attempts = 0;
            while (attempts < 50) {
                if (window.database && window.DATA_ROOT && window.showMessage && 
                    window.CE_LIST_INITIAL && window.showModal) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            throw new Error('CEManager: 依存関係の初期化タイムアウト');
        }

// setupRealtimeListener() の置換
async setupRealtimeListener() {
    this.dbRef = window.database.ref(`${window.DATA_ROOT}/ceList`);

    this.dbRef.on('value', snapshot => {
        const raw = snapshot.val();
        let list = [];
        
        // データ形式の統一処理
        if (Array.isArray(raw)) {
            // 旧形式（配列直置き）
            list = raw;
        } else if (raw?.list && Array.isArray(raw.list)) {
            // 新形式 {list: [...]}
            list = raw.list;
        } else if (raw && typeof raw === 'object') {
            // フォールバック
            list = Array.isArray(raw) ? raw : Object.values(raw);
        }

        if (list.length > 0) {
            this.ceList = list;
            this.normalizeCEData();
        } else {
            // 27名で初期化
            this.ceList = this.create27CEList();
            this.saveCEList();
        }

        this.displayCEList();
    }, error => {
        console.error('❌ CEリストリアルタイム監視エラー:', error);
    });
}

// saveCEList() の置換
async saveCEList() {
    try {
        const ceListData = {
            list: this.ceList,
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        };
        await window.database.ref(`${window.DATA_ROOT}/ceList`).set(ceListData);
        console.log('✅ CEリスト保存完了');
    } catch (error) {
        console.error('❌ CEリスト保存エラー:', error);
        window.showMessage('CEリストの保存に失敗しました', 'error');
    }
}

// 27名初期化メソッドの追加
create27CEList() {
    const normalOrder = [
        '安孫子明博', '八鍬純', '杉山陽子', '中村圭佑', '石山智之', 
        '亀井祐哉', '丸藤健', '三春摩弥', '斎藤大樹', '田中隆昭', 
        '宇井勇気', '宇野沢徹', '佐藤将志', '庄司由紀', '小沼和樹', 
        '武田優斗', '設樂佑介', '伊藤大晟', '上松野聖', '笹生貴之', 
        '和田彩花', '伊藤大稀', '佐藤千優', '桑島亜依', '村田七星', 
        '小林将己', '寒河江悠輝'
    ];
    
    return normalOrder.map((name, index) => ({
        id: `ce_${index + 1}_${Date.now()}`,
        name: this.getLastName(name),
        fullName: name,
        displayName: this.getLastName(name),
        iconName: this.getLastName(name),
        workType: ['OPE', 'ME', 'HD', 'FLEX'][index % 4],
        status: {
            monday: '', tuesday: '', wednesday: '', thursday: '',
            friday: '', saturday: '', sunday: ''
        },
        createdAt: Date.now()
    }));
}

getLastName(fullName) {
    if (fullName.length <= 2) return fullName;
    return fullName.substring(0, Math.min(3, Math.floor(fullName.length / 2)));
}

        normalizeCEData() {
            this.ceList = this.ceList.map((ce, index) => {
                const validWorkTypes = ['OPE', 'ME', 'HD', 'FLEX'];
                const workType = (ce.workType || 'ME').toUpperCase();
                const normalizedWorkType = validWorkTypes.includes(workType) ? workType : 'ME';

                const defaultStatus = {
                    monday: '', tuesday: '', wednesday: '', thursday: '',
                    friday: '', saturday: '', sunday: ''
                };
                const status = Object.assign({}, defaultStatus, ce.status || {});

                return {
                    id: ce.id || `normalized_ce_${index}_${Date.now()}`,
                    ...ce,
                    workType: normalizedWorkType,
                    status: status,
                    name: ce.name || '名前なし'
                };
            });
        }

        async saveCEList() {
            try {
                await window.database.ref(`${window.DATA_ROOT}/ceList`).set(this.ceList);
                console.log('✅ CEリスト保存完了');
            } catch (error) {
                console.error('❌ CEリスト保存エラー:', error);
                window.showMessage('CEリストの保存に失敗しました', 'error');
            }
        }

        displayCEList() {
            const container = document.getElementById('ceListContainer');
            if (!container) {
                console.warn('CEリストコンテナが見つかりません');
                return;
            }
            
            container.innerHTML = '';
            this.ceList.forEach((ce, index) => {
                const ceElement = document.createElement('div');
                ceElement.className = `ce-item worktype-${ce.workType.toLowerCase()}`;
                
                // 日別ステータス表示（CEDailyStatusManagerから取得）
                const statusBadge = this.renderStatusBadge(ce);
                
                ceElement.innerHTML = `
                    ${statusBadge}
                    <div class="font-medium">${ce.name}</div>
                    <div class="text-xs opacity-75">${ce.workType}</div>
                `;
                ceElement.draggable = window.userRole !== 'viewer';
                ceElement.dataset.ceId = ce.id;
                ceElement.dataset.ceIndex = index;
                ceElement.dataset.ceName = ce.name;
                ceElement.dataset.workType = ce.workType;
                
                // ドラッグ機能（閲覧者以外）
                if (window.userRole !== 'viewer') {
                    ceElement.addEventListener('dragstart', (e) => {
                        const dragData = {
                            ceId: ce.id,
                            ceName: ce.name,
                            workType: ce.workType
                        };
                        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
                        e.dataTransfer.effectAllowed = 'copy';
                        ceElement.classList.add('opacity-50');
                        console.log('🖱️ CEドラッグ開始:', ce.name);
                    });

                    ceElement.addEventListener('dragend', () => {
                        ceElement.classList.remove('opacity-50');
                    });
                }
                
                container.appendChild(ceElement);
            });
            
            // 人数表示の更新
            const countEl = document.getElementById('ceListCount');
            if (countEl) {
                countEl.textContent = this.ceList.length;
            }
            
            console.log('✅ CEリスト表示完了:', this.ceList.length, '名');
        }

        renderStatusBadge(ce) {
            // CEDailyStatusManagerから現在の表示日付のステータスを取得
            if (window.ceDailyStatus && window.ceDailyStatus.isInitialized) {
                const status = window.ceDailyStatus.getStatusForCE(ce.id, this.currentDisplayDate);
                if (typeof status === 'string' && status) {
                    return `<span class="status-badge status-${status}">${status}</span>`;
                } else if (status && typeof status.then === 'function') {
                    // Promiseの場合は非同期で更新
                    status.then(s => {
                        if (s) {
                            const element = document.querySelector(`[data-ce-id="${ce.id}"]`);
                            if (element) {
                                const existingBadge = element.querySelector('.status-badge');
                                if (existingBadge) existingBadge.remove();
                                element.insertAdjacentHTML('afterbegin', `<span class="status-badge status-${s}">${s}</span>`);
                            }
                        }
                    });
                }
            }
            
            // フォールバック：曜日テンプレートから取得
            const today = this.currentDisplayDate || new Date();
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const currentDay = dayNames[today.getDay()];
            const status = ce.status?.[currentDay] || '';
            
            if (!status) return '';
            return `<span class="status-badge status-${status}">${status}</span>`;
        }

        setupEventListeners() {
            const saveCEButton = document.getElementById('saveCEButton');
            if (saveCEButton && !saveCEButton.dataset.ceManagerBound) {
                saveCEButton.dataset.ceManagerBound = 'true';
                saveCEButton.addEventListener('click', () => this.saveCEFromModal());
            }
        }

        openCEEditModal(index) {
            if (window.userRole === 'viewer') {
                window.showMessage('編集権限がありません', 'warning');
                return;
            }

            this.editingCEIndex = index;
            const ce = this.ceList[index];
            if (!ce) return;

            const nameInput = document.getElementById('editCEName');
            const workTypeSelect = document.getElementById('editCEWorkType');
            
            if (nameInput) nameInput.value = ce.name || '';
            if (workTypeSelect) workTypeSelect.value = ce.workType || 'ME';

            const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            dayNames.forEach(day => {
                const select = document.getElementById(`ceStatus_${day}`);
                if (select) {
                    select.value = ce.status?.[day] || '';
                }
            });
            
            console.log('📝 CE編集モーダル表示:', ce.name);
            window.showModal('ceEditModal');
        }

        async saveCEFromModal() {
            if (this.editingCEIndex === -1) return;
            
            const ce = this.ceList[this.editingCEIndex];
            if (!ce) return;

            const nameInput = document.getElementById('editCEName');
            const workTypeSelect = document.getElementById('editCEWorkType');
            
            const newName = nameInput?.value?.trim();
            const newWorkType = workTypeSelect?.value;

            if (!newName) {
                window.showMessage('名前を入力してください', 'warning');
                return;
            }

            const duplicateIndex = this.ceList.findIndex((other, idx) => 
                idx !== this.editingCEIndex && other.name === newName
            );
            if (duplicateIndex !== -1) {
                window.showMessage('同じ名前のCEが既に存在します', 'warning');
                return;
            }

            ce.name = newName;
            ce.workType = newWorkType;
            
            if (!ce.status) ce.status = {};
            const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            dayNames.forEach(day => {
                const select = document.getElementById(`ceStatus_${day}`);
                if (select) {
                    ce.status[day] = select.value;
                }
            });
            
            ce.updatedAt = Date.now();
            ce.updatedBy = window.currentUserData?.displayName || 'unknown';

            try {
                await this.saveCEList();
                window.closeModal('ceEditModal');
                window.showMessage('CEを更新しました', 'success');
                
                if (window.ceDailyStatus) {
                    window.ceDailyStatus.renderCEManagementTable();
                }
            } catch (error) {
                console.error('❌ CE保存エラー:', error);
                window.showMessage('CEの保存に失敗しました', 'error');
            } finally {
                this.editingCEIndex = -1;
            }
        }

        async addNewCE(name, workType = 'ME') {
            if (window.userRole === 'viewer') {
                window.showMessage('編集権限がありません', 'warning');
                return;
            }

            if (!name || !name.trim()) {
                window.showMessage('CE名を入力してください', 'warning');
                return;
            }

            if (this.ceList.some(ce => ce.name === name.trim())) {
                window.showMessage('同じ名前のCEが既に存在します', 'warning');
                return;
            }

            const newCE = {
                id: `ce_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: name.trim(),
                workType: workType.toUpperCase(),
                department: null,
                status: {
                    monday: '', tuesday: '', wednesday: '', thursday: '',
                    friday: '', saturday: '', sunday: ''
                },
                createdAt: Date.now(),
                createdBy: window.currentUserData?.displayName || 'unknown'
            };

            this.ceList.push(newCE);
            
            try {
                await this.saveCEList();
                console.log(`✅ CE追加完了: ${name}`);
            } catch (error) {
                console.error('❌ CE追加エラー:', error);
                throw error;
            }
        }
    }

    window.CEManager = CEManager;
    console.log('👥 CEマネージャークラス読み込み完了（日別ステータス完全対応版）');
})();
