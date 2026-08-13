const firebaseConfig = {
    apiKey: "AIzaSyBhY_LqT0DXU9mI27VNrIZZVboOlNFQzSs",
    authDomain: "vextor-d627c.firebaseapp.com",
    projectId: "vextor-d627c",
    storageBucket: "vextor-d627c.firebasestorage.app",
    messagingSenderId: "158596639790",
    appId: "1:158596639790:web:88f98a25dba712a61783bf"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. NAVEGACIÓN ENTRE VISTAS ---
    const navLinks = document.querySelectorAll('.nav-link');
    const viewSections = document.querySelectorAll('.view-section');
    const tituloVista = document.getElementById('titulo-vista');

    const titulosMap = {
        'dashboard': 'Rendimiento General',
        'calendario': 'Calendario de Trading',
        'playbook': 'Playbook y Estrategias',
        'copy-trading': 'Replicar Cuentas (Copy Trading)'
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            viewSections.forEach(v => v.classList.remove('active'));

            link.classList.add('active');
            const targetView = link.getAttribute('data-view');
            const sectionToShow = document.getElementById(`view-${targetView}`);
            if (sectionToShow) {
                sectionToShow.classList.add('active');
                tituloVista.textContent = titulosMap[targetView] || 'Panel';
            }
        });
    });

    // --- 2. DATOS Y FIREBASE (TRADES Y SETUPS) ---
    let misTrades = [];
    let misSetups = [];

    db.collection("quant_edge").doc("diario_personal").onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            misTrades = data.trades || [];
            misSetups = data.setups || [];
            actualizarInterfaz(misTrades);
            renderizarPlaybook(misSetups);
        } else {
            db.collection("quant_edge").doc("diario_personal").set({ trades: [], setups: [] });
        }
    });

    // --- 3. PROCESAR ARCHIVO MT5 ---
    document.getElementById('input-archivo-mt5').addEventListener('change', (e) => {
        const archivo = e.target.files[0];
        if (!archivo) return;

        const lector = new FileReader();
        lector.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const primeraHojaName = workbook.SheetNames[0];
            const hoja = workbook.Sheets[primeraHojaName];
            const filas = XLSX.utils.sheet_to_json(hoja, { header: 1 });
            let indiceEncabezado = -1;
            
            for (let i = 0; i < filas.length; i++) {
                if (filas[i].some(celda => typeof celda === 'string' && (celda.toLowerCase().includes("profit") || celda.toLowerCase().includes("beneficio")))) {
                    indiceEncabezado = i;
                    break;
                }
            }

            if (indiceEncabezado === -1) {
                alert("No se encontró la columna de ganancias en el reporte.");
                document.getElementById('input-archivo-mt5').value = '';
                return;
            }

            const encabezados = filas[indiceEncabezado];
            let idxTicket = -1, idxTime = -1, idxType = -1, idxVolume = -1, idxSymbol = -1, idxPriceIn = -1, idxPriceOut = -1, idxProfit = -1;

            encabezados.forEach((col, idx) => {
                if (!col) return;
                const c = col.toString().toLowerCase().trim();
                
                if ((c.includes('ticket') || c.includes('order') || c.includes('deal') || c.includes('transacción')) && idxTicket === -1) {
                    idxTicket = idx;
                } else if ((c.includes('time') || c.includes('tiempo') || c.includes('fecha')) && idxTime === -1) {
                    idxTime = idx;
                } else if ((c.includes('type') || c.includes('tipo')) && idxType === -1) {
                    idxType = idx;
                } else if ((c.includes('volume') || c.includes('volumen') || c.includes('lotes')) && idxVolume === -1) {
                    idxVolume = idx;
                } else if ((c.includes('symbol') || c.includes('símbolo')) && idxSymbol === -1) {
                    idxSymbol = idx;
                } else if (c.includes('price') || c.includes('precio')) {
                    if (idxPriceIn === -1) idxPriceIn = idx;
                    else if (idxPriceOut === -1) idxPriceOut = idx;
                } else if ((c.includes('profit') || c.includes('beneficio') || c.includes('ganancia')) && !c.includes('balance')) {
                    idxProfit = idx;
                }
            });

            const nuevosTradesLeidos = [];

            for (let i = indiceEncabezado + 1; i < filas.length; i++) {
                const fila = filas[i];
                if (fila.length < 3) continue;

                const tipo = idxType !== -1 ? (fila[idxType] || '').toString().toLowerCase() : '';
                const lotes = idxVolume !== -1 ? parseFloat(fila[idxVolume]) || 0 : 0;
                const precioEntrada = idxPriceIn !== -1 ? parseFloat(fila[idxPriceIn]) || 0 : 0;
                const precioSalida = idxPriceOut !== -1 ? parseFloat(fila[idxPriceOut]) || 0 : precioEntrada;
                const resultado = idxProfit !== -1 ? parseFloat(fila[idxProfit]) || 0 : 0;
                const simbolo = idxSymbol !== -1 ? (fila[idxSymbol] || 'N/A').toString() : 'N/A';
                const ticket = idxTicket !== -1 ? fila[idxTicket] : Date.now() + Math.random();
                
                let fechaCruda = idxTime !== -1 ? (fila[idxTime] || '').toString() : '';
                let fechaLimpia = fechaCruda.split(' ')[0].replace(/\./g, '-');
                if (!fechaLimpia || fechaLimpia.length < 8) {
                    fechaLimpia = new Date().toISOString().split('T')[0];
                }

                if (!isNaN(resultado) && resultado !== 0 && !isNaN(lotes) && lotes > 0 && precioEntrada > 0 && (tipo === 'buy' || tipo === 'sell')) {
                    nuevosTradesLeidos.push({
                        id: ticket,
                        fecha: fechaLimpia,
                        simbolo: simbolo,
                        tipo: tipo,
                        lotes: lotes,
                        precioEntrada: precioEntrada,
                        precioSalida: precioSalida > 0 ? precioSalida : precioEntrada,
                        resultado: resultado
                    });
                }
            }

            const tradesNuevosFiltrados = nuevosTradesLeidos.filter(tradeNuevo => {
                return !misTrades.some(tradeGuardado => tradeGuardado.id == tradeNuevo.id);
            });

            if (tradesNuevosFiltrados.length === 0) {
                alert("No se encontraron operaciones nuevas. Tu diario ya está actualizado.");
                document.getElementById('input-archivo-mt5').value = '';
                return;
            }

            db.collection("quant_edge").doc("diario_personal").set({
                trades: [...tradesNuevosFiltrados, ...misTrades],
                setups: misSetups
            }, { merge: true }).then(() => {
                alert(`¡Éxito! Se agregaron ${tradesNuevosFiltrados.length} operaciones reales.`);
                document.getElementById('input-archivo-mt5').value = '';
            });
        };
        lector.readAsArrayBuffer(archivo);
    });

    // --- 4. ACTUALIZAR INTERFAZ Y KPIS ---
    function actualizarInterfaz(trades) {
        const tbody = document.getElementById('tabla-trades');
        tbody.innerHTML = '';

        if (trades.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No hay operaciones registradas aún.</td></tr>`;
            document.getElementById('kpi-profit').textContent = "$0.00";
            document.getElementById('kpi-winrate').textContent = "0.0%";
            document.getElementById('kpi-trades').textContent = "0";
            document.getElementById('kpi-pf').textContent = "0.00";
            renderizarCalendario(trades);
            return;
        }

        let profitTotal = 0;
        let ganadas = 0;
        let sumaGanancias = 0;
        let sumaPerdidas = 0;

        trades.forEach(t => {
            profitTotal += t.resultado;
            if (t.resultado > 0) {
                ganadas++;
                sumaGanancias += t.resultado;
            } else {
                sumaPerdidas += Math.abs(t.resultado);
            }

            const claseResultado = t.resultado >= 0 ? 'win' : 'loss';
            tbody.innerHTML += `
                <tr>
                    <td><strong>${t.simbolo}</strong></td>
                    <td>${t.tipo}</td>
                    <td>${t.lotes}</td>
                    <td>${t.precioEntrada}</td>
                    <td>${t.precioSalida}</td>
                    <td class="${claseResultado}">$${t.resultado.toFixed(2)}</td>
                </tr>
            `;
        });

        const winRate = (ganadas / trades.length) * 100;
        const profitFactor = sumaPerdidas === 0 ? sumaGanancias : (sumaGanancias / sumaPerdidas);

        document.getElementById('kpi-profit').textContent = `$${profitTotal.toFixed(2)}`;
        document.getElementById('kpi-profit').style.color = profitTotal >= 0 ? '#10B981' : '#EF4444';
        document.getElementById('kpi-winrate').textContent = `${winRate.toFixed(1)}%`;
        document.getElementById('kpi-trades').textContent = trades.length;
        document.getElementById('kpi-pf').textContent = profitFactor.toFixed(2);

        renderizarCalendario(trades);
    }

    // --- 5. LÓGICA DEL CALENDARIO ---
    let añoActual = new Date().getFullYear();
    let mesActual = new Date().getMonth();

    function renderizarCalendario(trades) {
        const contenedor = document.getElementById('calendar-days-container');
        const tituloMes = document.getElementById('mes-actual');
        
        if (!contenedor || !tituloMes) return;

        contenedor.innerHTML = '';

        const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        tituloMes.textContent = `${nombresMeses[mesActual]} ${añoActual}`;

        const tradesPorDia = {};
        trades.forEach(t => {
            if (t.fecha) {
                if (!tradesPorDia[t.fecha]) tradesPorDia[t.fecha] = 0;
                tradesPorDia[t.fecha] += t.resultado;
            }
        });

        const primerDiaObj = new Date(añoActual, mesActual, 1);
        const primerDia = primerDiaObj.getDay();
        const diasEnMes = new Date(añoActual, mesActual + 1, 0).getDate();
        let indicePrimerDia = (primerDia + 6) % 7;

        for (let i = 0; i < indicePrimerDia; i++) {
            contenedor.innerHTML += `<div class="cal-day day-empty"></div>`;
        }

        for (let dia = 1; dia <= diasEnMes; dia++) {
            const mesFormateado = String(mesActual + 1).padStart(2, '0');
            const diaFormateado = String(dia).padStart(2, '0');
            const fechaString = `${añoActual}-${mesFormateado}-${diaFormateado}`;

            const profitDelDia = tradesPorDia[fechaString];
            let claseCss = '';
            let textoProfit = '';

            if (profitDelDia !== undefined) {
                claseCss = profitDelDia >= 0 ? 'day-win' : 'day-loss';
                textoProfit = `$${profitDelDia.toFixed(2)}`;
            }

            contenedor.innerHTML += `
                <div class="cal-day ${claseCss}">
                    <span class="day-num">${dia}</span>
                    <span class="day-profit">${textoProfit}</span>
                </div>
            `;
        }
    }

    const btnAnterior = document.getElementById('btn-prev-month');
    const btnSiguiente = document.getElementById('btn-next-month');

    if (btnAnterior && btnSiguiente) {
        btnAnterior.onclick = () => {
            mesActual--;
            if (mesActual < 0) { mesActual = 11; añoActual--; }
            renderizarCalendario(misTrades);
        };
        btnSiguiente.onclick = () => {
            mesActual++;
            if (mesActual > 11) { mesActual = 0; añoActual++; }
            renderizarCalendario(misTrades);
        };
    }

    // --- 6. LÓGICA DEL PLAYBOOK (CREAR Y ELIMINAR SETUPS) ---
    const btnAbrirModal = document.getElementById('btn-abrir-modal');
    const btnCancelarSetup = document.getElementById('btn-cancelar-setup');
    const formContainer = document.getElementById('form-setup-container');
    const formNuevoSetup = document.getElementById('form-nuevo-setup');

    if (btnAbrirModal && formContainer) {
        btnAbrirModal.addEventListener('click', () => {
            if (formContainer.style.display === 'none' || formContainer.style.display === '') {
                formContainer.style.display = 'block';
            } else {
                formContainer.style.display = 'none';
            }
        });
    }

    if (btnCancelarSetup && formContainer) {
        btnCancelarSetup.addEventListener('click', () => {
            formContainer.style.display = 'none';
            formNuevoSetup.reset();
        });
    }

    if (formNuevoSetup) {
        formNuevoSetup.addEventListener('submit', (e) => {
            e.preventDefault();

            const nuevoSetup = {
                id: Date.now(),
                titulo: document.getElementById('setup-titulo').value,
                tag: document.getElementById('setup-tag').value,
                desc: document.getElementById('setup-desc').value
            };

            const setupsActualizados = [...misSetups, nuevoSetup];

            db.collection("quant_edge").doc("diario_personal").set({
                trades: misTrades,
                setups: setupsActualizados
            }, { merge: true }).then(() => {
                formNuevoSetup.reset();
                formContainer.style.display = 'none';
                alert("¡Setup guardado con éxito en el Playbook!");
            });
        });
    }

    window.eliminarSetup = function(idSetup) {
        if (confirm("¿Seguro que deseas eliminar este setup del playbook?")) {
            const setupsActualizados = misSetups.filter(s => s.id != idSetup);
            db.collection("quant_edge").doc("diario_personal").set({
                trades: misTrades,
                setups: setupsActualizados
            }, { merge: true });
        }
    };

    function renderizarPlaybook(setups) {
        const contenedorPlaybook = document.getElementById('playbook-container');
        if (!contenedorPlaybook) return;

        contenedorPlaybook.innerHTML = '';

        if (setups.length === 0) {
            contenedorPlaybook.innerHTML = `<p style="color: #94A3B8; grid-column: span 2;">No tienes setups registrados en tu playbook todavía.</p>`;
            return;
        }

        setups.forEach(s => {
            contenedorPlaybook.innerHTML += `
                <div class="playbook-card">
                    <button class="btn-eliminar-setup" onclick="eliminarSetup(${s.id})"><i class="fa-solid fa-trash"></i></button>
                    <div class="pb-tag pb-smc">${s.tag}</div>
                    <h3>${s.titulo}</h3>
                    <p>${s.desc}</p>
                    <div class="pb-stats">
                        <span><i class="fa-solid fa-crosshairs"></i> Estado: Activo</span>
                        <span><i class="fa-solid fa-chart-pie"></i> Custom</span>
                    </div>
                </div>
            `;
        });
    }
});