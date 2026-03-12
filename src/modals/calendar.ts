export function buildCalendar(containerId: string, initialDate: string, onSelect: (d: string) => void) {
    const container = document.getElementById(containerId)!;
    const curr = initialDate ? new Date(initialDate + "T00:00:00") : new Date();
    let vY = curr.getFullYear();
    let vM = curr.getMonth();
    
    let activeDateStr = initialDate;

    const render = () => {
        const firstDay = new Date(vY, vM, 1).getDay();
        const daysInMonth = new Date(vY, vM + 1, 0).getDate();
        
        let html = `
            <div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.5rem; width: 230px; user-select: none;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <button type="button" class="btn btn-ghost" style="padding: 0 0.5rem; height: 24px; min-width: 24px; font-size: 0.8rem;" id="c-p-${containerId}">&lt;</button>
                    <span style="font-size: 0.9rem; font-weight: 500;">${vY} / ${vM + 1}</span>
                    <button type="button" class="btn btn-ghost" style="padding: 0 0.5rem; height: 24px; min-width: 24px; font-size: 0.8rem;" id="c-n-${containerId}">&gt;</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                    <div style="color: #ff4757;">Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div style="color: #1e90ff;">Sa</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
        `;
        for (let i = 0; i < firstDay; i++) html += `<div></div>`;
        for (let i = 1; i <= daysInMonth; i++) {
            const pad = (n: number) => n.toString().padStart(2, '0');
            const dStr = `${vY}-${pad(vM + 1)}-${pad(i)}`;
            const isSel = dStr === activeDateStr;
            const bg = isSel ? 'var(--accent-blue)' : 'transparent';
            const fg = isSel ? '#fff' : 'var(--text-primary)';
            
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
            const isToday = dStr === todayStr;

            html += `<div class="cal-day ${isToday ? 'today' : ''}" data-date="${dStr}" style="text-align: center; cursor: pointer; padding: 0.3rem 0; font-size: 0.85rem; border-radius: 4px; background: ${bg}; color: ${fg};">${i}</div>`;

        }
        html += `</div></div>`;
        container.innerHTML = html;
        
        container.querySelector(`#c-p-${containerId}`)!.addEventListener('click', (e) => { e.preventDefault(); vM--; if(vM < 0){vM=11; vY--;} render(); });
        container.querySelector(`#c-n-${containerId}`)!.addEventListener('click', (e) => { e.preventDefault(); vM++; if(vM > 11){vM=0; vY++;} render(); });
        container.querySelectorAll('.cal-day').forEach(el => {
            el.addEventListener('click', (e) => {
                const date = (e.target as HTMLElement).dataset.date!;
                activeDateStr = date;
                render();
                onSelect(activeDateStr);
            });
        });
    };
    render();
}
