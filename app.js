const SETTINGS_KEY = 'config';

const DEFAULT_CONFIG = {
  paramName: null,
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

function renderButtons() {
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
      renderButtons();
    });
    group.appendChild(btn);
  });
}

async function loadParam(dashboard, name) {
  const allParams = await dashboard.getParametersAsync();
  currentParam = allParams.find(p => p.name === name) || null;
  renderButtons();
}

function showError(msg) {
  document.getElementById('btn-group').innerHTML = `<span style="color:red;font-size:12px;">${msg}</span>`;
}

async function openConfigDialog(dashboard) {
  const base = window.location.href.split('?')[0].replace(/\/?[^/]*$/, '/');
  const dialogUrl = base + 'configure.html';
  try {
    const result = await tableau.extensions.ui.displayDialogAsync(
      dialogUrl,
      JSON.stringify(config),
      { height: 560, width: 720 }
    );
    if (result) {
      const newConfig = JSON.parse(result);
      const prevParam = config.paramName;
      config = newConfig;
      await saveConfig();
      if (currentParam) {
        currentParam.removeEventListener(tableau.TableauEventType.ParameterChanged, renderButtons);
      }
      if (config.paramName !== prevParam) {
        await loadParam(dashboard, config.paramName);
      } else {
        renderButtons();
      }
      if (currentParam) {
        currentParam.addEventListener(tableau.TableauEventType.ParameterChanged, renderButtons);
      }
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

  if (config.paramName) {
    await loadParam(dashboard, config.paramName);
    if (currentParam) {
      currentParam.addEventListener(tableau.TableauEventType.ParameterChanged, renderButtons);
    }
  } else {
    document.getElementById('btn-group').innerHTML =
      '<span style="font-size:12px;color:#aaa;">Menu ▾ → Configurer</span>';
  }

}).catch(err => {
  showError('Init: ' + (err.message || JSON.stringify(err)));
});
