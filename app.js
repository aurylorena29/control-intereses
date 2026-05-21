// ─────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxKn5pOhmBlEQmiJtj8evg9nGh3J2LoJKe8yO5TqGgr0P0wY_adbTv-ak7FNL_DgXQ-/exec',
};

const MESES_N = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const COLORES_RESP = [
  {bg:'#CBF0E2',text:'#0A5E48'},{bg:'#D2E5F9',text:'#183E7A'},
  {bg:'#E5DDFB',text:'#3D1F8A'},{bg:'#FDEABF',text:'#6B3F07'},
  {bg:'#FBDADA',text:'#721B1B'},{bg:'#F0E4FB',text:'#6B1B8F'},
];

// ── Caché local ──────────────────────────────────────────────────
const CACHE_KEY = 'ci_v1';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos — ajusta según necesites

function cacheGuardar(d) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({...d, _ts: Date.now()})); } catch {}
}
function cacheLeer() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function cacheEsFresca(c) { return c && c._ts && (Date.now() - c._ts) < CACHE_TTL; }
function cacheAplicar(c) {
  S.responsables = c.responsables || [];
  S.prestamos    = c.prestamos    || [];
  S.dineroLibre  = c.dineroLibre  || [];
  S.nextId       = c.nextId       || 1;
  S.nextDineroId = c.nextDineroId || 1;
  S.loaded = true;
}

// ── Estado local ─────────────────────────────────────────────────
let S = {
  responsables: [], prestamos: [], dineroLibre: [],
  nextId: 1, nextDineroId: 1, tabActivo: 'lista',
  filtroQuincena: 'todos', filtroResp: null, loaded: false,
  usandoCache: false,
};

// ── API Google Sheets ─────────────────────────────────────────────
async function apiCall(action, data={}) {
  if (!CONFIG.SCRIPT_URL) return null;
  setSyncStatus('syncing', 'Sincronizando...');
  try {
    const url = CONFIG.SCRIPT_URL + '?action=' + action;
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(data) });
    const json = await res.json();
    setSyncStatus('ok', 'Sincronizado');
    return json;
  } catch(e) {
    setSyncStatus('error', 'Error al sincronizar');
    console.error('API error:', e);
    return null;
  }
}

async function cargarDatos() {
  if (!CONFIG.SCRIPT_URL) {
    setSyncStatus('error', 'Sin configurar');
    renderSetupBanner();
    render();
    return;
  }

  const cached = cacheLeer();

  // Cache fresca → render instantáneo, sin llamar a GAS
  if (cacheEsFresca(cached)) {
    cacheAplicar(cached);
    setSyncStatus('ok', 'Datos en caché');
    render();
    return;
  }

  // Cache vieja → mostrar inmediatamente y refrescar en segundo plano
  if (cached) {
    cacheAplicar(cached);
    render();
    setSyncStatus('syncing', 'Actualizando...');
  } else {
    setSyncStatus('syncing', 'Cargando...');
  }

  const data = await apiCall('getData');
  if (data && data.ok) {
    S.responsables = data.responsables || [];
    S.prestamos    = data.prestamos    || [];
    S.dineroLibre  = data.dineroLibre  || [];
    S.nextId       = data.nextId       || 1;
    S.nextDineroId = data.nextDineroId || 1;
    S.loaded = true;
    S.usandoCache = false;
    cacheGuardar({ responsables:S.responsables, prestamos:S.prestamos, dineroLibre:S.dineroLibre, nextId:S.nextId, nextDineroId:S.nextDineroId });
    setSyncStatus('ok', 'Sincronizado');
  } else {
    // GAS falló — usar cache de emergencia si existe (cualquier antigüedad)
    S.usandoCache = !!cached;
    if (!cached) setSyncStatus('error', 'No se pudo cargar');
  }
  render();
}

async function guardarTodo() {
  if (!CONFIG.SCRIPT_URL) return;
  const result = await apiCall('saveData', {
    responsables: S.responsables,
    prestamos:    S.prestamos,
    dineroLibre:  S.dineroLibre,
    nextId:       S.nextId,
    nextDineroId: S.nextDineroId,
  });
  // Actualizar cache local solo si el guardado fue exitoso
  if (result && result.ok) {
    cacheGuardar({ responsables:S.responsables, prestamos:S.prestamos, dineroLibre:S.dineroLibre, nextId:S.nextId, nextDineroId:S.nextDineroId });
  }
}

function setSyncStatus(tipo, texto) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (!dot) return;
  dot.className = 'sync-dot' + (tipo !== 'ok' ? ' ' + tipo : '');
  txt.textContent = texto;
}

// ── Helpers ──────────────────────────────────────────────────────
const HOY = new Date(); HOY.setHours(0,0,0,0);
function fmt(n)       { return '$' + Math.round(n).toLocaleString('es-CO'); }
function fechaDisp(f) { if(!f)return''; const[y,m,d]=f.split('-'); return`${d}/${m}/${y}`; }
function diasHoy(f)   { return Math.round((new Date(f+'T00:00:00') - HOY) / 86400000); }
function diaCobro(p)  { return parseInt(p.fecha_inicio.split('-')[2]); }
function colorResp(idx){ return COLORES_RESP[idx % COLORES_RESP.length]; }

function prestsFiltrados(){
  let list = S.prestamos;
  if(S.filtroQuincena === 'primera') list = list.filter(p => diaCobro(p) <= 15);
  if(S.filtroQuincena === 'segunda') list = list.filter(p => diaCobro(p) > 15);
  if(S.filtroResp !== null) list = list.filter(p => p.responsableId === S.filtroResp);
  return list;
}

// ── Stats ────────────────────────────────────────────────────────
function calcStats(){
  let capital=0, cobrado=0, pendiente=0, vencido=0, libre=0, mensual=0, cobradoMes=0, pendienteMes=0;
  const hoy = new Date();
  const hy = hoy.getFullYear(), hm = hoy.getMonth()+1;
  S.prestamos.forEach(p => {
    capital  += p.capital;
    mensual  += getCuotaParaMes(p, hm, hy);
    (p.cobros||[]).forEach(c => {
      if(c.estado === 'pagado')        cobrado   += c.monto;
      else if(c.estado === 'pendiente') pendiente += c.monto;
      else                              vencido   += c.monto;
    });
    const ini = new Date(p.fecha_inicio+'T00:00:00');
    let fcm = ini.getMonth()+2, fcy = ini.getFullYear();
    if(fcm>12){ fcm=1; fcy++; }
    const activoEsteMes = hy>fcy || (hy===fcy && hm>=fcm);
    if(activoEsteMes){
      const cobroMes = (p.cobros||[]).find(c => c.mes===hm && c.anio===hy);
      if(cobroMes){
        if(cobroMes.estado==='pagado') cobradoMes += cobroMes.monto;
        else pendienteMes += cobroMes.monto;
      } else {
        pendienteMes += getCuotaParaMes(p, hm, hy);
      }
    }
  });
  S.dineroLibre.forEach(d => {
    const a = (d.asignaciones||[]).reduce((s,x) => s+x.monto, 0);
    libre += d.monto - a;
  });
  return { capital, cobrado, pendiente, vencido, libre, mensual, cobradoMes, pendienteMes, hm, hy };
}

// ── Render ────────────────────────────────────────────────────────
function render(){
  renderSetupBanner();
  renderSummary();
  renderBanner();
  renderDinero();
  renderTabs();
  renderContenido();
}

function renderSetupBanner(){
  const el = document.getElementById('setup-banner');
  if (CONFIG.SCRIPT_URL) { el.innerHTML=''; return; }
  el.innerHTML=`<div class="banner setup" style="margin-bottom:16px">
    <div>
      <div class="banner-text"><i class="ti ti-table" style="vertical-align:-2px;margin-right:5px"></i>Conecta tu Google Sheets para guardar los datos</div>
      <div class="banner-sub">Sin conexión, los datos se pierden al cerrar el navegador</div>
    </div>
    <button class="btn-setup" onclick="abrirSetup()">Configurar →</button>
  </div>`;
}

function renderSummary(){
  const s = calcStats();
  document.getElementById('summary').innerHTML=`
    <div class="metric"><div class="metric-label">Capital prestado</div><div class="metric-value">${fmt(s.capital)}</div></div>
    <div class="metric"><div class="metric-label">Intereses al mes</div><div class="metric-value green">${fmt(s.mensual)}</div></div>
    <div class="metric"><div class="metric-label">Sin asignar</div><div class="metric-value amber">${fmt(s.libre)}</div></div>
    <div class="metric metric-mes">
      <div class="metric-label">${MESES_N[s.hm-1]} ${s.hy}</div>
      <div class="metric-mes-row">
        <div class="metric-mes-item">
          <div class="metric-mes-sub">Cobrado</div>
          <div class="metric-value green">${fmt(s.cobradoMes)}</div>
        </div>
        <div class="metric-mes-sep"></div>
        <div class="metric-mes-item">
          <div class="metric-mes-sub">Falta cobrar</div>
          <div class="metric-value amber">${fmt(s.pendienteMes)}</div>
        </div>
      </div>
    </div>`;
}

function renderBanner(){
  const el = document.getElementById('libre-banner');
  if (S.usandoCache) {
    el.innerHTML = `<div class="banner amber" style="margin-bottom:16px">
      <div>
        <div class="banner-text"><i class="ti ti-wifi-off" style="vertical-align:-2px;margin-right:5px"></i>Sin conexión con Google Sheets</div>
        <div class="banner-sub">Mostrando datos guardados localmente · Los cambios no se guardarán hasta reconectar</div>
      </div>
    </div>`;
  } else {
    el.innerHTML = '';
  }
}

function renderDinero(){
  const con = S.dineroLibre.filter(d => {
    const a = (d.asignaciones||[]).reduce((s,x) => s+x.monto, 0);
    return d.monto - a > 0;
  });
  const el = document.getElementById('dinero-section');
  if(!con.length){ el.innerHTML=''; return; }
  el.innerHTML=`<div class="section-label">Dinero recibido — sin asignar</div>
    <div class="dinero-grid">${con.map(d => {
      const a = (d.asignaciones||[]).reduce((s,x) => s+x.monto, 0);
      const saldo = d.monto - a;
      return`<div class="dinero-card">
        <div style="display:flex;align-items:center;gap:9px;min-width:0">
          <div class="dinero-icon"><i class="ti ti-receipt"></i></div>
          <div style="min-width:0">
            <div class="dinero-desc" title="${d.desc}">${d.desc}</div>
            <div class="dinero-date">${fechaDisp(d.fecha)}</div>
          </div>
        </div>
        <div class="dinero-right">
          <div class="dinero-monto">${fmt(saldo)}</div>
          <div style="font-size:10px;color:var(--text3)">de ${fmt(d.monto)}</div>
          <button class="btn-asignar" onclick="abrirAsignar(${d.id})">Asignar →</button>
        </div>
      </div>`;
    }).join('')}</div>`;
}

function renderTabs(){
  const enLista = S.tabActivo !== 'historial';
  const segHtml = `<div class="seg-ctrl">
    <button class="seg-btn${enLista && S.filtroQuincena==='todos'  ?' active':''}" onclick="setFiltroQuincena('todos')">Todos</button>
    <button class="seg-btn${enLista && S.filtroQuincena==='primera'?' active':''}" onclick="setFiltroQuincena('primera')">1ª</button>
    <button class="seg-btn${enLista && S.filtroQuincena==='segunda'?' active':''}" onclick="setFiltroQuincena('segunda')">2ª</button>
  </div>`;

  const respHtml = S.responsables.length > 1
    ? S.responsables.map((r, ri) => {
        const c = colorResp(ri);
        const activo = S.filtroResp === r.id;
        return `<button class="resp-chip${activo?' active':''}"
          style="background:${c.bg};color:${c.text};border-color:${activo?c.text:'transparent'}"
          onclick="setFiltroResp(${r.id})">${r.nombre}</button>`;
      }).join('')
    : '';

  const histHtml = `<button class="hist-btn${S.tabActivo==='historial'?' active':''}" onclick="setTab('historial')">
    <i class="ti ti-history" style="font-size:12px"></i> Historial
  </button>`;

  document.getElementById('tabs').innerHTML =
    `<div class="filtros-bar">${segHtml}${respHtml}<span class="filtros-gap"></span>${histHtml}</div>`;
}

function setTab(t){ S.tabActivo=t; S.filtroQuincena='todos'; S.filtroResp=null; renderTabs(); renderContenido(); }
function setFiltroQuincena(q){ S.filtroQuincena=q; S.tabActivo='lista'; renderTabs(); renderContenido(); }
function setFiltroResp(id){ S.filtroResp = S.filtroResp===id ? null : id; renderTabs(); renderContenido(); }

function renderContenido(){
  if(S.tabActivo === 'historial'){ renderHistorial(); return; }
  S.tabActivo = 'lista';
  const prests = prestsFiltrados();
  const grupos = {};
  prests.forEach(p => { if(!grupos[p.responsableId]) grupos[p.responsableId]=[]; grupos[p.responsableId].push(p); });
  const el = document.getElementById('contenido');
  if(!Object.keys(grupos).length){
    el.innerHTML='<div class="empty"><i class="ti ti-users"></i>'+(S.prestamos.length?'No hay préstamos en esta fecha':'No hay préstamos registrados')+'</div>';
    return;
  }
  el.innerHTML = Object.entries(grupos).map(([rId,ps]) => {
    const resp     = S.responsables.find(r => r.id===parseInt(rId));
    const nombre   = resp ? resp.nombre : 'Sin responsable';
    const ri       = S.responsables.indexOf(resp);
    const color    = colorResp(ri);
    const iniciales= nombre.split(/[\s\/]+/).map(x=>x[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
    const totalPend= ps.reduce((s,p) => s+p.cobros.filter(c=>c.estado!=='pagado').reduce((a,c)=>a+c.monto,0), 0);

    ps.sort((a, b) => diaCobro(a) - diaCobro(b));
    const cards = ps.map(p => {
      const dia = diaCobro(p);
      const meses = getMesesPrestamo(p);
      const mesesHtml = meses.map(({mes,anio,cobro}) => {
        const pagado  = cobro && cobro.estado === 'pagado';
        const asignado= cobro ? getAsignadoACobro(cobro.id) : 0;
        const parcial = cobro && !pagado && asignado > 0;
        const clase   = pagado ? 'pagado' : parcial ? 'parcial' : cobro ? cobro.estado : 'sin-cobro';
        const monto   = cobro ? cobro.monto : getCuotaParaMes(p, mes, anio);
        const delBtn  = cobro
          ? `<button class="icon-btn" onclick="eliminarCobro(${p.id},'${cobro.id}')" title="Eliminar mes"><i class="ti ti-x"></i></button>`
          : `<button class="icon-btn" onclick="ocultarMes(${p.id},${mes},${anio})" title="Ocultar mes"><i class="ti ti-x"></i></button>`;
        const chkClass= pagado ? ' pagado' : parcial ? ' parcial' : '';
        const chkIcon = pagado ? '<i class="ti ti-check"></i>' : parcial ? '<i class="ti ti-minus"></i>' : '';
        const montoHtml = parcial
          ? `<div style="text-align:right">
              <span class="mes-monto">${fmt(monto)}</span>
              <div class="mes-parcial-sub"><span style="color:var(--green-mid)">Pagado ${fmt(asignado)}</span> · <span style="color:var(--amber-mid)">Debe ${fmt(monto-asignado)}</span></div>
            </div>`
          : `<span class="mes-monto">${fmt(monto)}</span>`;
        return `<div class="mes-row ${clase}">
          <div class="mes-left">
            <button class="chk-btn${chkClass}" onclick="toggleCobro(${p.id},${mes},${anio})" title="${pagado?'Marcar pendiente':'Marcar pagado'}">${chkIcon}</button>
            <span class="mes-name">${MESES_C[mes-1]} ${anio}</span>
          </div>
          <div class="mes-right">
            ${montoHtml}
            ${delBtn}
          </div>
        </div>`;
      }).join('') || '<div style="font-size:12px;color:var(--text3);padding:4px 0">Sin meses registrados</div>';

      const desembolsosHtml = p.desembolsos && p.desembolsos.length > 1
        ? '<div class="desembolsos-wrap">' + p.desembolsos.map(d =>
            '<div class="desembolso-item">' +
              '<span class="desembolso-fecha"><i class="ti ti-corner-down-right" style="font-size:10px;margin-right:3px;color:var(--text3)"></i>' + fechaDisp(d.fecha) + '</span>' +
              '<span class="desembolso-monto">' + fmt(d.monto) + '</span>' +
            '</div>'
          ).join('') + '</div>'
        : '';

      return `<div class="pcard">
        <div class="pcard-head">
          <div class="dia-grande">
            <span class="dia-g-num">${dia}</span>
            <span class="dia-g-label">c/mes</span>
          </div>
          <div class="pcard-info">
            <div class="pcard-capital">${fmt(p.capital)}</div>
            <div class="pcard-cuota">Cuota: ${fmt(p.tasa_mensual)} / mes</div>
            ${desembolsosHtml}
            <div class="pcard-desde"><i class="ti ti-calendar-event" style="font-size:10px;vertical-align:-1px;margin-right:3px"></i>Desde ${fechaDisp(p.fecha_inicio)}</div>
          </div>
          <div class="pcard-actions">
            <button class="icon-btn pcard-btn-cash" onclick="abrirAgregarCapital(${p.id})" title="Agregar plata"><i class="ti ti-cash"></i></button>
            <button class="icon-btn pcard-btn-del" onclick="eliminarPrestamo(${p.id})" title="Eliminar préstamo"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div class="pcard-body">
          ${mesesHtml}
          <button class="btn-add-mes" onclick="agregarMesSiguiente(${p.id})"><i class="ti ti-plus" style="font-size:12px"></i> Agregar mes</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="responsable-block">
      <div class="resp-header">
        <div class="resp-avatar" style="background:${color.bg};color:${color.text}">${iniciales}</div>
        <div><div class="resp-name">${nombre}</div><div class="resp-info">${ps.length} préstamo${ps.length>1?'s':''}</div></div>
        <div class="resp-estado ${totalPend>0?'pend':'ok'}">${totalPend>0?fmt(totalPend)+' pendiente':'Al día ✓'}</div>
      </div>
      <div class="prestamos-grid">${cards}</div>
    </div>`;
  }).join('');
}

// ── Helpers de asignaciones ──────────────────────────────────────
function getAsignadoACobro(cobroId){
  let total = 0;
  S.dineroLibre.forEach(d => (d.asignaciones||[]).forEach(a => { if(a.cobroId===cobroId) total+=a.monto; }));
  return total;
}

// ── Historial ────────────────────────────────────────────────────
function renderHistorial(){
  const el = document.getElementById('contenido');
  const eventos = [];
  S.prestamos.forEach(p => {
    const resp   = S.responsables.find(r => r.id===p.responsableId);
    const nombre = resp ? resp.nombre : 'Sin responsable';
    p.cobros.forEach(c => {
      const asignado = getAsignadoACobro(c.id);
      const parcial  = c.estado !== 'pagado' && asignado > 0;
      eventos.push({ tipo:'cobro', fecha:c.fecha_cobro, mes:c.mes, anio:c.anio,
        monto:c.monto, estado:parcial?'parcial':c.estado, asignado, responsable:nombre });
    });
  });
  S.dineroLibre.forEach(d => {
    const partes = d.fecha.split('-');
    eventos.push({ tipo:'ingreso', fecha:d.fecha, mes:parseInt(partes[1]), anio:parseInt(partes[0]),
      monto:d.monto, desc:d.desc, asignaciones:d.asignaciones||[] });
  });
  if(!eventos.length){
    el.innerHTML='<div class="empty"><i class="ti ti-history"></i>Sin historial registrado</div>';
    return;
  }
  eventos.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  const grupos = {};
  eventos.forEach(e => {
    const k = e.anio + '-' + String(e.mes).padStart(2,'0');
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(e);
  });
  el.innerHTML = Object.entries(grupos).sort((a,b) => b[0].localeCompare(a[0])).map(([k,evs]) => {
    const [y,m] = k.split('-').map(Number);
    const rows  = evs.map(e => {
      if(e.tipo === 'cobro'){
        const icon = e.estado==='pagado' ? 'ti-check' : e.estado==='parcial' ? 'ti-minus' : 'ti-clock';
        const subParcial = e.estado==='parcial'
          ? `<div class="hist-sub"><span style="color:var(--green-mid)">Pagado ${fmt(e.asignado)}</span> · <span style="color:var(--amber-mid)">Debe ${fmt(e.monto-e.asignado)}</span></div>` : '';
        return `<div class="hist-row">
          <div class="hist-icon ${e.estado}"><i class="ti ${icon}"></i></div>
          <div class="hist-info"><div class="hist-title">${e.responsable}</div>${subParcial}</div>
          <div class="hist-right">
            <span class="hist-monto ${e.estado}">${fmt(e.monto)}</span>
            <span class="hist-badge ${e.estado}">${e.estado.charAt(0).toUpperCase()+e.estado.slice(1)}</span>
          </div>
        </div>`;
      } else {
        const asigT = (e.asignaciones||[]).reduce((s,a) => s+a.monto, 0);
        const sub   = asigT>0 ? `<div class="hist-sub">Asignado: ${fmt(asigT)}${asigT<e.monto?' · Sin asignar: '+fmt(e.monto-asigT):''}</div>` : '';
        return `<div class="hist-row">
          <div class="hist-icon ingreso"><i class="ti ti-arrow-down-circle"></i></div>
          <div class="hist-info"><div class="hist-title">${e.desc}</div>${sub}</div>
          <div class="hist-right">
            <span class="hist-monto ingreso">${fmt(e.monto)}</span>
            <span class="hist-badge ingreso">Ingreso</span>
          </div>
        </div>`;
      }
    }).join('');
    return `<div class="hist-grupo"><div class="hist-mes-label">${MESES_N[m-1]} ${y}</div>${rows}</div>`;
  }).join('');
}

// ── Helpers de meses ────────────────────────────────────────────
function getCuotaParaMes(p, mes, anio){
  const desembolsos = p.desembolsos || [{monto:p.capital, fecha:p.fecha_inicio, inicial:true}];
  const capital = desembolsos.filter(d => {
    const df = new Date(d.fecha+'T00:00:00');
    const dy = df.getFullYear(), dm = df.getMonth()+1;
    if(d.inicial) return dy<anio || (dy===anio && dm<=mes);
    else          return dy<anio || (dy===anio && dm<mes);
  }).reduce((s,d) => s+d.monto, 0);
  return Math.round(capital * (p.tasa_pct||2) / 100);
}

function getMesesPrestamo(p){
  const ocultos  = p.mesesOcultos || [];
  const esOculto = (m,y) => ocultos.some(o => o.mes===m && o.anio===y);
  const inicio   = new Date(p.fecha_inicio+'T00:00:00');
  const hoyDate  = new Date();
  let y = inicio.getFullYear(), m = inicio.getMonth()+2;
  if(m>12){ m=1; y++; }
  const hy = hoyDate.getFullYear(), hm = hoyDate.getMonth()+1;
  const result = [];
  while(y < hy || (y===hy && m<=hm)){
    if(!esOculto(m,y)){
      const cobro = (p.cobros||[]).find(c => c.mes===m && c.anio===y) || null;
      result.push({mes:m, anio:y, cobro});
    }
    m++; if(m>12){ m=1; y++; }
  }
  (p.cobros||[]).forEach(c => {
    const esFuturo = c.anio>hy || (c.anio===hy && c.mes>hm);
    if(esFuturo && !esOculto(c.mes,c.anio) && !result.find(r => r.mes===c.mes && r.anio===c.anio)){
      result.push({mes:c.mes, anio:c.anio, cobro:c});
    }
  });
  result.sort((a,b) => a.anio!==b.anio ? a.anio-b.anio : a.mes-b.mes);
  return result;
}

// ── Acciones con sync ────────────────────────────────────────────
async function toggleCobro(pid, mes, anio){
  const p     = S.prestamos.find(x => x.id===pid);
  const cobro = (p.cobros||[]).find(c => c.mes===mes && c.anio===anio);
  if(cobro){
    cobro.estado = cobro.estado==='pagado' ? 'pendiente' : 'pagado';
  } else {
    const dia = diaCobro(p);
    const fc  = anio+'-'+String(mes).padStart(2,'0')+'-'+String(dia).padStart(2,'0');
    p.cobros.push({id:'c'+S.nextId++, mes, anio, monto:getCuotaParaMes(p,mes,anio), estado:'pagado', fecha_cobro:fc});
  }
  render();
  await guardarTodo();
}

async function eliminarCobro(pid, cid){
  const p     = S.prestamos.find(x => x.id===pid);
  const cobro = p.cobros.find(c => c.id===cid);
  if(cobro){
    if(!p.mesesOcultos) p.mesesOcultos = [];
    p.mesesOcultos.push({mes:cobro.mes, anio:cobro.anio});
    p.cobros = p.cobros.filter(c => c.id!==cid);
  }
  render();
  await guardarTodo();
}

async function ocultarMes(pid, mes, anio){
  const p = S.prestamos.find(x => x.id===pid);
  if(!p.mesesOcultos) p.mesesOcultos = [];
  p.mesesOcultos.push({mes, anio});
  render();
  await guardarTodo();
}

async function agregarMesSiguiente(pid){
  const p     = S.prestamos.find(x => x.id===pid);
  if(!p) return;
  if(!p.cobros) p.cobros = [];
  const meses = getMesesPrestamo(p);
  let nm, ny;
  if(meses.length){
    const last = meses[meses.length-1];
    nm = last.mes+1; ny = last.anio;
    if(nm>12){ nm=1; ny++; }
  } else {
    const hoy = new Date();
    nm = hoy.getMonth()+2; ny = hoy.getFullYear();
    if(nm>12){ nm=1; ny++; }
  }
  const dia = diaCobro(p);
  const fc  = ny+'-'+String(nm).padStart(2,'0')+'-'+String(dia).padStart(2,'0');
  p.cobros.push({id:'c'+S.nextId++, mes:nm, anio:ny, monto:getCuotaParaMes(p,nm,ny), estado:'pendiente', fecha_cobro:fc});
  render();
  await guardarTodo();
}

async function marcarPagado(pid, cid){
  const p = S.prestamos.find(x => x.id===pid);
  const c = p.cobros.find(x => x.id===cid);
  if(c) c.estado = 'pagado';
  render();
  await guardarTodo();
}

async function eliminarPrestamo(id){
  if(!confirm('¿Eliminar este préstamo?')) return;
  S.prestamos = S.prestamos.filter(x => x.id!==id);
  render();
  await guardarTodo();
}

// ── Modales ───────────────────────────────────────────────────────
function cerrar(){ document.getElementById('modal').innerHTML=''; }

function modal(titulo, bodyHtml, footHtml){
  document.getElementById('modal').innerHTML=`
  <div class="overlay" onclick="if(event.target===this)cerrar()">
    <div class="modal">
      <div class="modal-head">
        <h2>${titulo}</h2>
        <button class="modal-close" onclick="cerrar()"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">${footHtml}</div>
    </div>
  </div>`;
}

// ── Setup Google Sheets ───────────────────────────────────────────
function abrirSetup(){
  modal('Conectar Google Sheets',`
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-title">Crea un Google Sheet nuevo</div>
        <div class="step-desc">Ve a <a href="https://sheets.new" target="_blank" style="color:var(--blue)">sheets.new</a> y crea una hoja en blanco.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-title">Abre el editor de Apps Script</div>
        <div class="step-desc">En el Sheet, ve a <code>Extensiones → Apps Script</code>. Borra el código y pega este:</div>
        <button class="copy-btn" onclick="copiarScript()"><i class="ti ti-copy" style="font-size:12px;vertical-align:-1px"></i> Copiar código</button>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-title">Despliega como aplicación web</div>
        <div class="step-desc">Click en <code>Implementar → Nueva implementación</code>. Tipo: <code>Aplicación web</code>. Acceso: <code>Cualquier persona</code>. Copia la URL.</div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <div class="step-title">Pega la URL aquí</div>
        <div class="form-group" style="margin-top:8px;margin-bottom:0">
          <input id="setup-url" type="text" placeholder="https://script.google.com/macros/s/..." value="${CONFIG.SCRIPT_URL}">
        </div>
      </div>
    </div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarSetup()">Conectar</button>`
  );
}

function copiarScript(){
  const code = `const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doPost(e) {
  const action = e.parameter.action;
  const data = JSON.parse(e.postData.contents || '{}');
  let result;
  try {
    if (action === 'getData') result = getData();
    else if (action === 'saveData') result = saveData(data);
    else result = { ok: false, error: 'Acción desconocida' };
  } catch(err) {
    result = { ok: false, error: err.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) { return doPost(e); }

function getData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('datos');
  if (!sheet) { sheet = ss.insertSheet('datos'); sheet.getRange('A1').setValue('{}'); }
  const raw = sheet.getRange('A1').getValue();
  return { ok: true, ...( raw ? JSON.parse(raw) : {} ) };
}

function saveData(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('datos');
  if (!sheet) sheet = ss.insertSheet('datos');
  sheet.getRange('A1').setValue(JSON.stringify(data));
  actualizarHojasLegibles(ss, data);
  return { ok: true };
}

function actualizarHojasLegibles(ss, data) {
  let hPrests = ss.getSheetByName('préstamos');
  if (!hPrests) hPrests = ss.insertSheet('préstamos');
  hPrests.clearContents();
  hPrests.getRange(1,1,1,7).setValues([['Responsable','Descripción','Tipo','Capital','Fecha inicio','Día cobro','Cuota mensual']]);
  if (data.prestamos && data.prestamos.length) {
    const rows = data.prestamos.map(p => {
      const resp = (data.responsables||[]).find(r=>r.id===p.responsableId);
      return [resp?resp.nombre:'', p.desc, p.tipo, p.capital, p.fecha_inicio, parseInt((p.fecha_inicio||'').split('-')[2]||0), p.tasa_mensual||0];
    });
    hPrests.getRange(2,1,rows.length,7).setValues(rows);
  }
  let hCobros = ss.getSheetByName('cobros');
  if (!hCobros) hCobros = ss.insertSheet('cobros');
  hCobros.clearContents();
  hCobros.getRange(1,1,1,6).setValues([['Responsable','Préstamo','Mes','Año','Monto','Estado']]);
  const meses = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const allCobros = [];
  (data.prestamos||[]).forEach(p => {
    const resp = (data.responsables||[]).find(r=>r.id===p.responsableId);
    (p.cobros||[]).forEach(c => { allCobros.push([resp?resp.nombre:'', p.desc, meses[c.mes]||c.mes, c.anio, c.monto, c.estado]); });
  });
  if (allCobros.length) hCobros.getRange(2,1,allCobros.length,6).setValues(allCobros);
}`;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector('.copy-btn');
    if(btn){ btn.textContent='✓ Copiado'; setTimeout(()=>{ btn.innerHTML='<i class="ti ti-copy" style="font-size:12px;vertical-align:-1px"></i> Copiar código'; }, 2000); }
  });
}

async function guardarSetup(){
  const url = document.getElementById('setup-url').value.trim();
  if(!url){ alert('Pega la URL del script'); return; }
  CONFIG.SCRIPT_URL = url;
  localStorage.setItem('gas_url', url);
  cerrar();
  await cargarDatos();
}

// ── Modal: Nuevo préstamo ─────────────────────────────────────────
function abrirModalPrestamo(){
  const hoy      = new Date().toISOString().split('T')[0];
  const tieneResp= S.responsables.length > 0;
  let selectHtml = '';
  if(tieneResp){
    const opts = S.responsables.map(r => '<option value="'+r.id+'">'+r.nombre+'</option>').join('');
    selectHtml = '<div class="form-group"><label>Responsable</label>'
      + '<select id="p-resp" onchange="toggleNuevoResp(this.value)">'
      + opts + '<option value="nuevo">+ Nuevo responsable...</option>'
      + '</select></div>';
  }
  modal('Nuevo préstamo',
    selectHtml
    + '<div id="p-nuevo-wrap"'+(tieneResp?' style="display:none"':'')+'>'+
        '<div class="form-group"><label>Nombre del responsable</label>'+
        '<input id="p-nuevo-nombre" type="text" placeholder="Ej: CARLOS" style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">'+
        '</div></div>'
    + '<div class="form-group"><label>Capital prestado ($)</label>'+
        '<input id="p-capital" type="number" placeholder="18000000" oninput="actualizarCuota()">'+
      '</div>'
    + '<div class="form-row">'
        + '<div class="form-group"><label>Tasa de interés mensual (%)</label>'
          + '<input id="p-tasa" type="number" value="2" step="0.1" min="0" oninput="actualizarCuota()"></div>'
        + '<div class="form-group"><label>Cuota mensual</label>'
          + '<input id="p-cuota-display" type="text" readonly placeholder="—" style="background:var(--surface2);color:var(--green);font-family:\'IBM Plex Mono\',monospace;font-weight:700;cursor:default"></div>'
      + '</div>'
    + '<div class="form-group"><label>Fecha del préstamo</label>'
        + '<input id="p-fecha" type="date" value="'+hoy+'" oninput="actualizarHint()">'
        + '<div class="form-hint">El día de esta fecha define el día de cobro de cada mes</div>'
      + '</div>'
    + '<div class="dia-hint-box" id="p-hint" style="display:none"></div>',
    '<button class="btn-cancel" onclick="cerrar()">Cancelar</button>'
    + '<button class="btn-save" onclick="guardarPrestamo()">Guardar</button>'
  );
  actualizarHint();
  actualizarCuota();
}

function actualizarCuota(){
  const capital = parseFloat(document.getElementById('p-capital')?.value) || 0;
  const tasa    = parseFloat(document.getElementById('p-tasa')?.value) || 0;
  const el      = document.getElementById('p-cuota-display');
  if(el) el.value = capital && tasa ? fmt(Math.round(capital*tasa/100)) : '';
}

function toggleNuevoResp(v){ document.getElementById('p-nuevo-wrap').style.display = v==='nuevo' ? 'block' : 'none'; }

function actualizarHint(){
  const f = document.getElementById('p-fecha');
  const h = document.getElementById('p-hint');
  if(!f||!h) return;
  const dia = f.value ? parseInt(f.value.split('-')[2]) : '';
  h.innerHTML = dia ? `<i class="ti ti-calendar-repeat" style="vertical-align:-2px;margin-right:5px"></i>Se cobrará el <strong>día ${dia}</strong> de cada mes` : '';
  h.style.display = dia ? 'block' : 'none';
}

async function guardarPrestamo(){
  const respEl = document.getElementById('p-resp');
  const rv     = respEl ? respEl.value : 'nuevo';
  const capital= parseFloat(document.getElementById('p-capital').value) || 0;
  const tasa   = parseFloat(document.getElementById('p-tasa').value) || 2;
  const fecha  = document.getElementById('p-fecha').value;
  if(!capital || !fecha){ alert('Completa capital y fecha'); return; }
  const cuota = Math.round(capital * tasa / 100);
  let rid;
  if(rv === 'nuevo'){
    const nn = document.getElementById('p-nuevo-nombre').value.trim();
    if(!nn){ alert('Ingresa el nombre del responsable'); return; }
    rid = S.nextId++;
    S.responsables.push({id:rid, nombre:nn, color:COLORES_RESP[S.responsables.length%COLORES_RESP.length]});
  } else { rid = parseInt(rv); }
  const id = S.nextId++;
  S.prestamos.push({
    id, responsableId:rid, desc:'Préstamo', tipo:'Intereses', capital,
    fecha_inicio:fecha, tasa_mensual:cuota, tasa_pct:tasa,
    desembolsos:[{id:'d'+S.nextId++, monto:capital, fecha, inicial:true}],
    consignaciones:[{id:S.nextId++, desc:'Ingreso inicial', monto:capital, fecha}],
    cobros:[],
  });
  cerrar(); render();
  await guardarTodo();
}

// ── Modal: Agregar capital ────────────────────────────────────────
function abrirAgregarCapital(pid){
  const p           = S.prestamos.find(x => x.id===pid);
  const diaOriginal = parseInt(p.fecha_inicio.split('-')[2]);
  const tasa        = p.tasa_pct || 2;
  modal('Agregar más plata',
    '<p style="font-size:13px;color:var(--text2);margin-bottom:10px">Capital actual: <strong style="font-family:\'IBM Plex Mono\',monospace">'+fmt(p.capital)+'</strong> · Tasa: '+tasa+'%</p>'
    + '<div class="dia-hint-box" style="margin-bottom:12px"><i class="ti ti-info-circle" style="vertical-align:-2px;margin-right:5px"></i>La fecha debe ser día <strong>'+diaOriginal+'</strong> de cualquier mes — si es otro día es un préstamo nuevo</div>'
    + '<div class="form-group"><label>Monto adicional ($)</label>'
      + '<input id="ca-monto" type="number" placeholder="5000000" oninput="actualizarCuotaAdicional('+pid+')"></div>'
    + '<div class="form-group"><label>Fecha del desembolso</label>'
      + '<input id="ca-fecha" type="date" oninput="actualizarCuotaAdicional('+pid+')"></div>'
    + '<div style="background:var(--surface2);border-radius:7px;padding:9px 12px;font-size:13px;" id="ca-preview">'
      + 'Los intereses del nuevo monto aplican desde el mes siguiente al desembolso</div>',
    '<button class="btn-cancel" onclick="cerrar()">Cancelar</button>'
    + '<button class="btn-save" onclick="guardarCapitalAdicional('+pid+')">Agregar</button>'
  );
}

function actualizarCuotaAdicional(pid){
  const p          = S.prestamos.find(x => x.id===pid);
  const adicional  = parseFloat(document.getElementById('ca-monto')?.value) || 0;
  const tasa       = p.tasa_pct || 2;
  const nuevoCapital= p.capital + adicional;
  const nuevaCuota = Math.round(nuevoCapital * tasa / 100);
  const el         = document.getElementById('ca-preview');
  if(el) el.innerHTML = adicional > 0
    ? 'Nuevo capital: <strong style="font-family:\'IBM Plex Mono\',monospace">'+fmt(nuevoCapital)+'</strong> · Nueva cuota: <strong style="font-family:\'IBM Plex Mono\',monospace;color:var(--green)">'+fmt(nuevaCuota)+'</strong>'
    : 'Los intereses del nuevo monto aplican desde el mes siguiente al desembolso';
}

async function guardarCapitalAdicional(pid){
  const monto = parseFloat(document.getElementById('ca-monto').value) || 0;
  const fecha = document.getElementById('ca-fecha').value;
  if(!monto || !fecha){ alert('Completa monto y fecha'); return; }
  const p          = S.prestamos.find(x => x.id===pid);
  const diaOriginal= parseInt(p.fecha_inicio.split('-')[2]);
  const diaNew     = parseInt(fecha.split('-')[2]);
  if(diaOriginal !== diaNew){
    alert('El día '+diaNew+' no coincide con el día de cobro ('+diaOriginal+'). Crea un nuevo préstamo para una fecha diferente.');
    return;
  }
  if(!p.desembolsos) p.desembolsos = [{id:'d'+S.nextId++, monto:p.capital, fecha:p.fecha_inicio, inicial:true}];
  p.desembolsos.push({id:'d'+S.nextId++, monto, fecha});
  p.capital      = p.desembolsos.reduce((s,d) => s+d.monto, 0);
  p.tasa_mensual = Math.round(p.capital * (p.tasa_pct||2) / 100);
  cerrar(); render();
  await guardarTodo();
}

// ── Modal: Registrar dinero ───────────────────────────────────────
function abrirModalDinero(){
  modal('Registrar dinero recibido',`
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Registra el monto recibido sin saber aún de qué préstamo es. Luego lo asignas cuando confirmen.</p>
    <div class="form-group"><label>Descripción / Quién pagó</label><input id="d-desc" type="text" placeholder="Ej: Consignó Paola"></div>
    <div class="form-row">
      <div class="form-group"><label>Monto ($)</label><input id="d-monto" type="number" placeholder="500000"></div>
      <div class="form-group"><label>Fecha</label><input id="d-fecha" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
    </div>`,
    `<button class="btn-cancel" onclick="cerrar()">Cancelar</button>
     <button class="btn-save" onclick="guardarDinero()">Registrar</button>`
  );
}

async function guardarDinero(){
  const desc  = document.getElementById('d-desc').value.trim();
  const monto = parseFloat(document.getElementById('d-monto').value) || 0;
  const fecha = document.getElementById('d-fecha').value;
  if(!monto){ alert('Ingresa el monto'); return; }
  S.dineroLibre.push({id:S.nextDineroId++, desc:desc||'Sin descripción', monto, fecha, asignaciones:[]});
  cerrar(); render();
  await guardarTodo();
}

// ── Modal: Asignar dinero ─────────────────────────────────────────
function abrirAsignar(dineroId){
  const d     = S.dineroLibre.find(x => x.id===dineroId);
  const asigT = (d.asignaciones||[]).reduce((s,x) => s+x.monto, 0);
  const saldo = d.monto - asigT;
  const opciones = [];
  S.prestamos.forEach(p => {
    const resp = S.responsables.find(r => r.id===p.responsableId);
    p.cobros.filter(c => c.estado!=='pagado').forEach(c => {
      const ya = (d.asignaciones||[]).find(a => a.cobroId===c.id);
      opciones.push({p, c, resp, ya});
    });
  });
  const opHtml = opciones.length ? opciones.map(o => `
    <div class="asign-item${o.ya?' selected':''}" onclick="toggleAsig(${dineroId},'${o.c.id}',${o.p.id},${o.c.monto})">
      <div>
        <div class="asign-name">${o.resp?o.resp.nombre:''} — ${o.p.desc}</div>
        <div class="asign-sub">${MESES_N[o.c.mes-1]} ${o.c.anio} · ${o.c.estado}</div>
        ${o.ya?`<div style="font-size:11px;color:var(--green);font-weight:600">Asignado: ${fmt(o.ya.monto)}</div>`:''}
      </div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--amber)">${fmt(o.c.monto)}</div>
    </div>`).join('')
    : '<div style="font-size:13px;color:var(--text3);padding:8px 0">No hay cobros pendientes</div>';
  modal('Asignar dinero a un cobro',`
    <div style="background:var(--amber-bg);border:1px solid var(--amber-border);border-radius:8px;padding:10px 13px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;color:var(--amber);font-weight:500">${d.desc}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;color:var(--amber)">${fmt(saldo)}</span>
    </div>
    <div class="section-label" style="margin-bottom:8px">Cobros pendientes</div>${opHtml}`,
    `<button class="btn-cancel" onclick="cerrar()">Cerrar</button>
     <button class="btn-save" onclick="cerrar();render()">Listo</button>`
  );
}

async function toggleAsig(dineroId, cobroId, pid, montoCobro){
  const d   = S.dineroLibre.find(x => x.id===dineroId);
  const idx = (d.asignaciones||[]).findIndex(a => a.cobroId===cobroId);
  if(idx >= 0){
    d.asignaciones.splice(idx, 1);
  } else {
    const at    = d.asignaciones.reduce((s,x) => s+x.monto, 0);
    const saldo = d.monto - at;
    const ma    = Math.min(saldo, montoCobro);
    if(ma <= 0){ alert('Sin saldo disponible'); return; }
    d.asignaciones.push({cobroId, pid, monto:ma});
    if(ma >= montoCobro){
      const p = S.prestamos.find(x => x.id===pid);
      const c = p.cobros.find(x => x.id===cobroId);
      if(c) c.estado = 'pagado';
    }
  }
  await guardarTodo();
  abrirAsignar(dineroId);
  render();
}

// ── Init ─────────────────────────────────────────────────────────
cargarDatos();
