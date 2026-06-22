const SETTINGS_KEY = 'config';

const DEFAULT_CONFIG = {
  mode: 'param',
  paramName: null,
  filterName: null,
  multiSelect: false,
  filterRequired: false,
  containerBg: '#ffffff',
  activeBg: '#E8622A',
  activeColor: '#ffffff',
  inactiveBg: '#ffffff',
  inactiveColor: '#333333',
  radius: 50,
  fontSize: 12,
  fontFamily: 'Tableau Book',
  gap: 6,
  padH: 18,
  padV: 6,
};

let config = { ...DEFAULT_CONFIG };
let currentParam = null;
let filterListeners = [];

function loadConfig() {
  try {
    const saved = tableau.extensions.settings.get(SETTINGS_KEY);
    if (saved) config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {}
}

async function saveConfig() {
  tableau.extensions.settings.set(SETTINGS_KEY, JSON.stringify(config));
  await tableau.extensions.settings.saveAsync();
}

function applyButtonStyles(btn, isActive) {
  btn.style.backgroundColor = isActive ? config.activeBg : config.inactiveBg;
  btn.style.color = isActive ? config.activeColor : config.inactiveColor;
  btn.style.borderRadius = config.radius + 'px';
  btn.style.fontSize = config.fontSize + 'px';
  btn.style.fontFamily = config.fontFamily || 'Tableau Book';
  btn.style.padding = `${config.padV}px ${config.padH}px`;
}

function showError(msg) {
  document.getElementById('btn-group').innerHTML = `<span style="color:red;font-size:12px;">${msg}</span>`;
}

// ── MODE PARAMÈTRE ────────────────────────────────────────────────────────────

function renderParamButtons() {
  const group = document.getElementById('btn-group');
  group.innerHTML = '';
  group.style.gap = config.gap + 'px';
  document.body.style.background = config.containerBg || '#ffffff';

  if (!currentParam) return;

  const values = currentParam.allowableValues.allowableValues;
  const active = currentParam.currentValue.value;

  values.forEach(({ value }) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (value === active ? ' active' : '');
    btn.textContent = value;
    applyButtonStyles(btn, value === active);
    btn.addEventListener('click', async () => {
      await currentParam.changeValueAsync(value);
      renderParamButtons();
    });
    group.appendChild(btn);
  });
}

async function loadParam(dashboard, name) {
  const allParams = await dashboard.getParametersAsync();
  currentParam = allParams.find(p => p.name === name) || null;
  renderParamButtons();
}

// ── MODE FILTRE ───────────────────────────────────────────────────────────────

let filterEntries = [];
let filterValues = [];
let selectedFilterValues = new Set();
let applyInProgress = false;
let applyTimer = null;
let filterDomainLoaded = false;

async function getFilterOnSheets(dashboard, filterName) {
  const result = [];
  for (const ws of dashboard.worksheets) {
    const filters = await ws.getFiltersAsync();
    const f = filters.find(f => f.fieldName === filterName);
    if (f) result.push({ ws, filter: f });
  }
  return result;
}

async function getFilterDomainValues(filterEntry) {
  try {
    const domain = await filterEntry.filter.getDomainAsync(tableau.FilterDomainType.Relevant);
    if (domain?.values?.length > 0) return domain.values.map(v => v.formattedValue);
  } catch (e) {}
  try {
    const domain = await filterEntry.filter.getDomainAsync(tableau.FilterDomainType.Database);
    if (domain?.values?.length > 0) return domain.values.map(v => v.formattedValue);
  } catch (e) {}
  return filterEntry.filter.appliedValues.map(v => v.formattedValue);
}

function updateFilterButtonStates() {
  const group = document.getElementById('btn-group');
  group.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = selectedFilterValues.has(btn.dataset.value);
    btn.className = 'tab-btn' + (isActive ? ' active' : '');
    applyButtonStyles(btn, isActive);
  });
}

async function applyFilterToSheets(values) {
  applyInProgress = true;
  const toApply = [...values];
  try {
    await Promise.all(filterEntries.map(({ ws }) =>
      toApply.length === 0
        ? ws.applyFilterAsync(config.filterName, [], tableau.FilterUpdateType.All)
        : ws.applyFilterAsync(config.filterName, toApply, tableau.FilterUpdateType.Replace)
    ));
  } finally {
    applyInProgress = false;
  }
}

function buildFilterButtons(group) {
  group.innerHTML = '';
  filterValues.forEach(value => {
    const btn = document.createElement('button');
    btn.dataset.value = value;
    const isActive = selectedFilterValues.has(value);
    btn.className = 'tab-btn' + (isActive ? ' active' : '');
    btn.textContent = value;
    applyButtonStyles(btn, isActive);

    btn.addEventListener('click', () => {
      if (config.multiSelect) {
        if (selectedFilterValues.has(value)) {
          if (config.filterRequired && selectedFilterValues.size === 1) return;
          selectedFilterValues.delete(value);
        } else {
          selectedFilterValues.add(value);
        }
      } else {
        selectedFilterValues = new Set([value]);
      }
      updateFilterButtonStates();
      clearTimeout(applyTimer);
      applyTimer = setTimeout(() => applyFilterToSheets(selectedFilterValues), 80);
    });

    group.appendChild(btn);
  });
}

async function renderFilterButtons(dashboard) {
  const group = document.getElementById('btn-group');
  group.style.gap = config.gap + 'px';
  document.body.style.background = config.containerBg || '#ffffff';

  if (!config.filterName) return;

  filterEntries = await getFilterOnSheets(dashboard, config.filterName);
  if (filterEntries.length === 0) return;

  const f = filterEntries[0].filter;

  if (!filterDomainLoaded) {
    // Affichage immédiat avec les valeurs appliquées uniquement
    const applied = f.isAllSelected ? [] : f.appliedValues.map(v => v.formattedValue);
    selectedFilterValues = new Set(applied);
    filterValues = applied;
    if (applied.length > 0) buildFilterButtons(group);

    // Chargement du domaine complet en arrière-plan
    getFilterDomainValues(filterEntries[0]).then(values => {
      filterValues = values;
      filterDomainLoaded = true;
      if (f.isAllSelected) selectedFilterValues = new Set(values);
      buildFilterButtons(group);
    });
    return;
  }

  if (f.isAllSelected) {
    selectedFilterValues = new Set(filterValues);
  } else {
    selectedFilterValues = new Set(f.appliedValues.map(v => v.formattedValue));
  }
  buildFilterButtons(group);
}

function clearFilterListeners() {
  filterListeners.forEach(({ ws, handler }) => {
    ws.removeEventListener(tableau.TableauEventType.FilterChanged, handler);
  });
  filterListeners = [];
}

async function setupFilterListeners(dashboard) {
  clearFilterListeners();
  const entries = await getFilterOnSheets(dashboard, config.filterName);
  entries.forEach(({ ws }) => {
    const handler = () => { if (!applyInProgress) renderFilterButtons(dashboard); };
    ws.addEventListener(tableau.TableauEventType.FilterChanged, handler);
    filterListeners.push({ ws, handler });
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────

async function initDisplay(dashboard) {
  if (config.mode === 'filter' && config.filterName) {
    await renderFilterButtons(dashboard);
  } else if (config.mode === 'param' && config.paramName) {
    await loadParam(dashboard, config.paramName);
    if (currentParam) {
      currentParam.addEventListener(tableau.TableauEventType.ParameterChanged, renderParamButtons);
    }
  } else {
    document.getElementById('btn-group').innerHTML =
      '<span style="font-size:12px;color:#aaa;">Menu ▾ → Configurer</span>';
  }
}

async function openConfigDialog(dashboard) {
  const base = window.location.href.split('?')[0].replace(/\/?[^/]*$/, '/');
  const dialogUrl = base + 'configure.html?v=' + Date.now();
  try {
    const result = await tableau.extensions.ui.displayDialogAsync(
      dialogUrl,
      JSON.stringify(config),
      { height: 660, width: 720 }
    );
    if (result) {
      config = JSON.parse(result);
      await saveConfig();

      if (currentParam) {
        currentParam.removeEventListener(tableau.TableauEventType.ParameterChanged, renderParamButtons);
        currentParam = null;
      }
      clearFilterListeners();
      filterEntries = [];
      filterDomainLoaded = false;

      await initDisplay(dashboard);
    }
  } catch (e) {
    if (e.errorCode !== tableau.ErrorCodes.DialogClosedByUser) {
      console.error('Erreur dialog :', e);
    }
  }
}

tableau.extensions.initializeAsync({ 'configure': () => {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  openConfigDialog(dashboard);
}}).then(async () => {
  loadConfig();

  const status = document.getElementById('status');
  if (status) status.remove();

  const dashboard = tableau.extensions.dashboardContent.dashboard;
  await initDisplay(dashboard);

}).catch(err => {
  showError('Init: ' + (err.message || JSON.stringify(err)));
});
