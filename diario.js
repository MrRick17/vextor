function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`view-${tabId}`).classList.add('active');
    document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add('active');
}

let fechaActual = new Date();
let mesActual = fechaActual.getMonth();
let añoActual = fechaActual.getFullYear();
let chartInstance = null;
let tradesGlobales = []; // Almacena los trades en memoria

document.addEventListener("DOMContentLoaded", () => {
    // Controles de navegación de meses
    document.getElementById('btn-prev-month').addEventListener('click', () => {
        mesActual--;
        if (mesActual < 0) { mesActual = 11; añoActual--; }
        renderizarCalendario(tradesGlobales);
    });

    document.getElementById('btn-next-month').addEventListener('click', () => {
        mesActual++;
        if (mesActual > 11) { mesActual = 0; añoActual++; }
        renderizarCalendario(tradesGlobales);
    });
});

function actualizarKPIs(trades) {
    tradesGlobales = trades; // Guardar referencia global
    let beneficioTotal = 0;
    let operacionesGanadoras = 0;
    let totalOperaciones = trades.length;

    trades.forEach(t => {
        beneficioTotal += t.resultado;
        if (t.resultado > 0) operacionesGanadoras++;
    });

    const winRate = totalOperaciones > 0 ? ((operacionesGanadoras / totalOperaciones) * 100).toFixed(1) : 0;

    const kpiProfit = document.getElementById('kpi-profit');
    kpiProfit.textContent = `$${beneficioTotal.toFixed(2)}`;
    kpiProfit.style.color = beneficioTotal >= 0 ? '#34D399' : '#F87171';

    document.getElementById('kpi-winrate').textContent = `${winRate}%`;
    document.getElementById('kpi-trades').textContent = totalOperaciones;
}

function renderizarGrafica(trades) {
    const tradesOrdenados = [...trades].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    let balanceAcumulado = 0;
    const etiquetas = [];
    const datosBalance = [];

    tradesOrdenados.forEach(t => {
        balanceAcumulado += t.resultado;
        etiquetas.push(t.fecha);
        datosBalance.push(balanceAcumulado);
    });

    const canvasElement = document.getElementById('equityChart');
    if (!canvasElement) return;
    const ctx = canvasElement.getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: etiquetas,
            datasets: [{
                label: 'Equity',
                data: datosBalance,
                borderColor: '#38BDF8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: '#070B14',
                pointBorderColor: '#38BDF8',
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94A3B8' } },
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94A3B8' } }
            }
        }
    });
}

function renderizarCalendario(trades) {
    const contenedor = document.getElementById('calendar-days-container');
    const tituloMes = document.getElementById('mes-actual');
    const totalMesSpan = document.getElementById('mes-total-profit');
    
    if (!contenedor || !tituloMes) return;
    contenedor.innerHTML = '';

    const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    tituloMes.textContent = `${nombresMeses[mesActual]} ${añoActual}`;

    let profitMensual = 0;
    const tradesPorDia = {};
    
    trades.forEach(t => {
        if (t.fecha) {
            if (!tradesPorDia[t.fecha]) tradesPorDia[t.fecha] = 0;
            tradesPorDia[t.fecha] += t.resultado;
            const [y, m, d] = t.fecha.split('-');
            if (parseInt(y) === añoActual && parseInt(m) === mesActual + 1) {
                profitMensual += t.resultado;
            }
        }
    });

    if (totalMesSpan) {
        totalMesSpan.textContent = `Total Mes: $${profitMensual.toFixed(2)}`;
        if (profitMensual > 0) totalMesSpan.style.color = '#34D399';
        else if (profitMensual < 0) totalMesSpan.style.color = '#F87171';
        else totalMesSpan.style.color = '#94A3B8';
    }

    const primerDiaObj = new Date(añoActual, mesActual, 1);
    const diasEnMes = new Date(añoActual, mesActual + 1, 0).getDate();
    let indicePrimerDia = (primerDiaObj.getDay() + 6) % 7;

    let diasAgregados = 0;
    let profitSemanal = 0;

    for (let i = 0; i < indicePrimerDia; i++) {
        contenedor.innerHTML += `<div class="cal-day day-empty"></div>`;
        diasAgregados++;
    }

    for (let dia = 1; dia <= diasEnMes; dia++) {
        const mesStr = String(mesActual + 1).padStart(2, '0');
        const diaStr = String(dia).padStart(2, '0');
        const fechaString = `${añoActual}-${mesStr}-${diaStr}`;

        const profitDelDia = tradesPorDia[fechaString] || 0;
        profitSemanal += profitDelDia;

        let claseCss = '';
        let textoProfit = '';

        if (profitDelDia !== 0) {
            claseCss = profitDelDia > 0 ? 'day-win' : 'day-loss';
            textoProfit = `$${profitDelDia.toFixed(2)}`;
        }

        contenedor.innerHTML += `
            <div class="cal-day ${claseCss}">
                <span class="day-num">${dia}</span>
                <span class="day-profit">${textoProfit}</span>
            </div>
        `;
        diasAgregados++;

        if (diasAgregados % 7 === 0 || dia === diasEnMes) {
            while (diasAgregados % 7 !== 0) {
                contenedor.innerHTML += `<div class="cal-day day-empty"></div>`;
                diasAgregados++;
            }

            let claseSemana = '';
            if (profitSemanal > 0) claseSemana = 'day-win';
            else if (profitSemanal < 0) claseSemana = 'day-loss';

            contenedor.innerHTML += `
                <div class="cal-day weekly-total ${claseSemana}">
                    <span class="day-num">Total</span>
                    <span class="day-profit">$${profitSemanal.toFixed(2)}</span>
                </div>
            `;
            profitSemanal = 0; 
        }
    }
}