/**
 * テーマ切り替えシステム
 */
(function() {
    'use strict';

    class ThemeSwitcher {
        constructor() {
            this.currentTheme = localStorage.getItem('app-theme') || 'dark';
            this.init();
        }

        init() {
            this.applyTheme(this.currentTheme);
            this.createToggleButton();
            console.log('🎨 テーマスイッチャー初期化完了:', this.currentTheme);
        }

        createToggleButton() {
            // 既存のボタンがあれば削除
            const existing = document.getElementById('themeToggleButton');
            if (existing) existing.remove();

            const button = document.createElement('button');
            button.id = 'themeToggleButton';
            button.className = 'theme-toggle-btn';
            button.innerHTML = this.currentTheme === 'dark' 
                ? '<i class="fas fa-sun"></i>' 
                : '<i class="fas fa-moon"></i>';
            button.title = this.currentTheme === 'dark' ? 'ライトテーマへ切替' : 'ダークテーマへ切替';
            
            button.onclick = () => this.toggleTheme();
            
            document.body.appendChild(button);
        }

        toggleTheme() {
            this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
            this.applyTheme(this.currentTheme);
            localStorage.setItem('app-theme', this.currentTheme);
            
            // ボタンアイコン更新
            const button = document.getElementById('themeToggleButton');
            if (button) {
                button.innerHTML = this.currentTheme === 'dark' 
                    ? '<i class="fas fa-sun"></i>' 
                    : '<i class="fas fa-moon"></i>';
                button.title = this.currentTheme === 'dark' ? 'ライトテーマへ切替' : 'ダークテーマへ切替';
            }

            // アニメーション効果
            document.body.style.transition = 'background 0.5s ease, color 0.5s ease';
            setTimeout(() => {
                document.body.style.transition = '';
            }, 500);
        }

        applyTheme(theme) {
            if (theme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
                document.body.classList.add('theme-dark');
                document.body.classList.remove('theme-light');
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                document.body.classList.add('theme-light');
                document.body.classList.remove('theme-dark');
            }
        }
    }

    // ページ読み込み時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.themeSwitcher = new ThemeSwitcher();
        });
    } else {
        window.themeSwitcher = new ThemeSwitcher();
    }
})();
