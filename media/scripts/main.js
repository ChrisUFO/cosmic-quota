(function () {
    const vscode = acquireVsCodeApi();

    function animateBars() {
        const bars = document.querySelectorAll('.progress-bar');
        bars.forEach(bar => {
            const targetWidth = bar.getAttribute('data-width');
            bar.style.width = targetWidth + '%';
        });
    }

    function animateNumbers() {
        const numbers = document.querySelectorAll('.animate-number');
        numbers.forEach(num => {
            const target = parseFloat(num.getAttribute('data-target'));
            const duration = 1500;
            const start = 0;
            let startTime = null;

            function step(timestamp) {
                if (!startTime) startTime = timestamp;
                const progress = Math.min((timestamp - startTime) / duration, 1);
                const current = progress * (target - start) + start;
                num.textContent = current.toFixed(num.getAttribute('data-decimals') || 0);
                if (progress < 1) {
                    window.requestAnimationFrame(step);
                }
            }
            window.requestAnimationFrame(step);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            animateBars();
            animateNumbers();
        }, 100);
    });

    window.refresh = function () {
        vscode.postMessage({ command: 'refresh' });
    };
})();
