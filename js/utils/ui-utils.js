/**
 * UI操作ユーティリティ 
 */

// ========= メッセージ表示システム =========
function showMessage(text, type = 'info', duration = 4000) {
    const container = document.getElementById('messageContainer') || 
                     document.getElementById('notificationContainer') ||
                     createMessageContainer();

    const messageDiv = document.createElement('div');
    
    const icons = {
        success: 'check-circle',
        error: 'times-circle', 
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };
    
    const colors = {
        success: 'bg-green-100 border-green-400 text-green-700',
        error: 'bg-red-100 border-red-400 text-red-700',
        warning: 'bg-yellow-100 border-yellow-400 text-yellow-700',
        info: 'bg-blue-100 border-blue-400 text-blue-700'
    };
    
    messageDiv.className = `${colors[type]} border px-4 py-3 rounded mb-2 shadow-lg fade-in`;
    messageDiv.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center">
                <i class="fas fa-${icons[type]} mr-2"></i>
                <span>${text}</span>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" 
                    class="ml-4 font-bold hover:opacity-75 cursor-pointer">×</button>
        </div>
    `;
    
    container.appendChild(messageDiv);
    
    // 自動削除
    if (duration > 0) {
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.style.opacity = '0';
                messageDiv.style.transform = 'translateX(100%)';
                setTimeout(() => messageDiv.remove(), 300);
            }
        }, duration);
    }
    
    return messageDiv;
}

function createMessageContainer() {
    const container = document.createElement('div');
    container.id = 'messageContainer';
    container.className = 'fixed top-4 right-4 z-50 space-y-2';
    document.body.appendChild(container);
    return container;
}

// ========= モーダル管理システム =========
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.warn(`モーダル ${modalId} が見つかりません`);
        return false;
    }
    
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // フォーカス管理
    const firstInput = modal.querySelector('input, select, textarea, button');
    if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
    }
    
    return true;
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return false;
    
    modal.style.display = 'none';
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    
    // 動的モーダルの削除
    if (modalId === 'templateModal' || modal.hasAttribute('data-dynamic')) {
        modal.remove();
    }
    
    return true;
}

// ========= 印刷システム =========
function printElement(elementId, title = '印刷') {
    const element = document.getElementById(elementId);
    if (!element) {
        showMessage('印刷対象が見つかりません', 'error');
        return;
    }
    
    const printWindow = window.open('', 'printWindow', 'width=800,height=600');
    if (!printWindow) {
        showMessage('印刷ウィンドウを開けませんでした', 'error');
        return;
    }
    
    const css = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map(el => el.outerHTML)
        .join('\n');
    
    printWindow.document.write(`
        <html>
            <head>
                <title>${title}</title>
                ${css}
                <style>
                    body { margin: 20px; font-family: 'Noto Sans JP', sans-serif; }
                    @media print {
                        body { margin: 0; }
                        .no-print, .btn-primary, button { display: none !important; }
                    }
                </style>
            </head>
            <body>
                ${element.outerHTML}
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

function printCanvas(canvasId, title = 'グラフ印刷') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        showMessage('グラフが見つかりません', 'error');
        return;
    }
    
    const printWindow = window.open('', 'printCanvas', 'width=800,height=600');
    if (!printWindow) {
        showMessage('印刷ウィンドウを開けませんでした', 'error');
        return;
    }
    
    printWindow.document.write(`
        <html>
            <head>
                <title>${title}</title>
                <style>
                    body { 
                        margin: 20px; 
                        text-align: center; 
                        font-family: 'Noto Sans JP', sans-serif;
                    }
                    img { 
                        max-width: 100%; 
                        height: auto; 
                        border: 1px solid #ccc;
                        border-radius: 4px;
                    }
                    h1 {
                        color: #333;
                        margin-bottom: 20px;
                    }
                </style>
            </head>
            <body>
                <h1>${title}</h1>
                <img src="${canvas.toDataURL('image/png')}" alt="${title}"/>
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

// ========= グローバル公開 =========
window.showMessage = showMessage;
window.showModal = showModal;
window.closeModal = closeModal;
window.printElement = printElement;
window.printCanvas = printCanvas;

console.log('🎨 UI ユーティリティ読み込み完了');
