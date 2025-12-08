/**
 * 月間カレンダー表示 - V2統合版（修正版）
 */
(function() {
    'use strict';

    class CalendarView {
        constructor() {
            this.currentDate = new Date();
            this.scheduleCore = null;
            this.init();
        }

        async init() {
            try {
                // ScheduleCoreの初期化を待つ
                await this.waitForDependencies();
                
                this.scheduleCore = new window.ScheduleCore();
                this.setupEventListeners();
                this.render();
                this.startMonthListener();
                
                console.log('📅 カレンダービュー初期化完了');
            } catch (error) {
                console.error('❌ カレンダービュー初期化エラー:', error);
            }
        }

        async waitForDependencies() {
            let attempts = 0;
            while (attempts < 30) {
                if (window.DateUtils && window.ScheduleCore && window.database) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            throw new Error('依存関係の初期化タイムアウト');
        }

        setupEventListeners() {
            // 月切り替えボタンの再利用
            const prevBtn = document.getElementById('prevWeekBtn');
            const nextBtn = document.getElementById('nextWeekBtn');

            if (prevBtn) {
                prevBtn.onclick = () => this.changeMonth(-1);
                prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
                prevBtn.title = '前月';
            }

            if (nextBtn) {
                nextBtn.onclick = () => this.changeMonth(1);
                nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
                nextBtn.title = '次月';
            }

            // 今月ボタンの追加
            this.addTodayButton();
        }

        addTodayButton() {
            const weekSelector = document.querySelector('.flex.justify-center.items-center.mb-6');
            if (weekSelector && !document.getElementById('todayBtn')) {
                const todayBtn = document.createElement('button');
                todayBtn.id = 'todayBtn';
                todayBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md transition-colors text-sm ml-2';
                todayBtn.innerHTML = '<i class="fas fa-calendar-day mr-1"></i>今月';
                todayBtn.onclick = () => this.goToToday();
                weekSelector.appendChild(todayBtn);
            }
        }

        changeMonth(delta) {
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
            this.currentDate.setDate(1); // 月初に設定
            this.startMonthListener();
            this.render();
        }

        goToToday() {
            this.currentDate = new Date();
            this.startMonthListener();
            this.render();
        }

        startMonthListener() {
            if (this.scheduleCore) {
                const year = this.currentDate.getFullYear();
                const month = this.currentDate.getMonth() + 1;
                
                this.scheduleCore.listenToMonth(year, month, () => {
                    this.render();
                });
            }
        }

        render() {
            this.updateHeader();
            this.renderCalendar();
        }

        updateHeader() {
            const currentWeekElement = document.getElementById('currentWeek');
            if (currentWeekElement) {
                currentWeekElement.textContent = window.DateUtils.formatMonthYear(this.currentDate);
            }
        }

        renderCalendar() {
            const tableBody = document.getElementById('scheduleTableBody');
            if (!tableBody) return;

            const year = this.currentDate.getFullYear();
            const month = this.currentDate.getMonth() + 1;
            const dates = window.DateUtils.generateCalendarDates(year, month);

            let html = '';
            
            // 週単位でレンダリング
            for (let week = 0; week < 6; week++) {
                html += '<tr>';
                
                for (let day = 0; day < 7; day++) {
                    const index = week * 7 + day;
                    if (index >= dates.length) break;
                    
                    const dateInfo = dates[index];
                    const dateKey = window.DateUtils.formatDateISO(dateInfo.date);
                    const events = this.scheduleCore ? this.scheduleCore.getEventsByDate(dateKey) : [];
                    
                    const isToday = window.DateUtils.isToday(dateInfo.date);
                    const cellClass = [
                        'schedule-cell',
                        !dateInfo.isCurrentMonth ? 'bg-gray-50 opacity-50' : '',
                        isToday ? 'bg-blue-50 border-blue-300' : ''
                    ].filter(Boolean).join(' ');

                    html += `
                        <td class="${cellClass}" data-date="${dateKey}" onclick="window.openDateModal('${dateKey}')">
                            <div class="h-full w-full min-h-[80px] p-2">
                                <div class="font-medium text-sm mb-1 ${isToday ? 'text-blue-700' : dateInfo.isCurrentMonth ? '' : 'text-gray-400'}">
                                    ${dateInfo.date.getDate()}
                                </div>
                                <div class="space-y-1">
                                    ${this.renderEventChips(events, dateKey)}
                                </div>
                            </div>
                        </td>
                    `;
                }
                
                html += '</tr>';
                
                // 当月の日付が全て表示されたら終了
                if (dates[week * 7 + 6] && dates[week * 7 + 6].date.getMonth() !== (month - 1)) {
                    break;
                }
            }

            tableBody.innerHTML = html;
            console.log('✅ カレンダー描画完了');
        }

        renderEventChips(events, dateKey) {
            if (!events || events.length === 0) return '';

            const maxDisplay = 3;
            let html = '';

            events.slice(0, maxDisplay).forEach(event => {
                const color = window.getDepartmentColor ? window.getDepartmentColor(event.department) : '#2563eb';
                const timeDisplay = event.startTime && event.endTime ? ` (${event.startTime}-${event.endTime})` : '';
                
                html += `
                    <div class="text-xs p-1 rounded text-white truncate cursor-pointer hover:opacity-80 transition-opacity" 
                         style="background-color: ${color};"
                         title="${event.name}${timeDisplay}&#10;部門: ${event.department}&#10;必要人数: ${event.requiredPeople || 1}名"
                         onclick="event.stopPropagation(); window.openEventEditModal('${dateKey}', '${event.id}')">
                        <i class="fas fa-briefcase mr-1"></i>${event.name}
                    </div>
                `;
            });

            if (events.length > maxDisplay) {
                html += `<div class="text-xs text-gray-500 cursor-pointer hover:text-gray-700" onclick="window.openDateModal('${dateKey}')">+${events.length - maxDisplay}件 クリックで詳細</div>`;
            }

            return html;
        }

        // サンプルデータ追加（開発用）
        async addSampleData() {
            if (!this.scheduleCore) return;

            const today = new Date();
            const todayKey = window.DateUtils.formatDateISO(today);

            const sampleEvent = {
                date: todayKey,
                name: 'サンプル業務',
                department: '血液浄化',
                startTime: '09:00',
                endTime: '12:00',
                count: 1,
                requiredPeople: 1
            };

            try {
                await this.scheduleCore.addEvent(sampleEvent);
                console.log('✅ サンプルデータ追加完了');
            } catch (error) {
                console.error('❌ サンプルデータ追加エラー:', error);
            }
        }
    }

    // 🔧 重要: 古いプレースホルダー関数を削除
    // 以下のような関数定義があれば削除またはコメントアウトしてください
    /*
    window.openDateModal = (dateKey) => {
        console.log('📅 日付クリック:', dateKey);
        alert(`${dateKey}の詳細画面を表示します（実装予定）`);
    };
    */

    // グローバル公開
    window.CalendarView = CalendarView;
    console.log('📅 カレンダービュー読み込み完了');
})();
