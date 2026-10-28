/** Browser-owned administration interactions; server values are inserted only through text nodes. */
import { adminCopy } from './web-copy.ts'

/** Same-origin browser application with locale-owned copy and document-scoped state. */
export const adminScript = `
(() => {
'use strict';
const copy = ${JSON.stringify(adminCopy)};
const $ = id => document.getElementById(id);
function preference(key, value) {
  try { return value === undefined ? localStorage.getItem(key) : localStorage.setItem(key, value); }
  catch (_error) { /* Browser storage restrictions leave preferences scoped to this document. */ }
}
const language = new URLSearchParams(location.search).get('lang') || preference('enterprise-language') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
const t = copy[language === 'zh' ? 'zh' : 'en'];
const state = { employees: [], departments: [], collapsedDepartments: new Set(), platformDefault: null, mode: 'basic', viewerId: '', page: 1, route: 'overview', revision: 0, editing: null };
const routes = { overview: ['overview', 'overviewDescription'], users: ['userManagement', 'usersDescription'], departments: ['departments', 'departmentsDescription'], models: ['modelConfiguration', 'modelsDescription'], usage: ['budgetUsage', 'usageDescription'] };
const paths = {
  command: 'M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7',
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  building: 'M4 21V7h8v14 M12 3h8v18 M2 21h20 M7 10h2 M7 14h2 M15 7h2 M15 11h2 M15 15h2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M15 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  boxes: 'M12 3l9 5-9 5-9-5z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5',
  chart: 'M3 3v18h18 M7 14v3 M12 9v8 M17 5v12',
  shield: 'M12 3l8 3v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  panel: 'M3 3h18v18H3z M9 3v18', chevrons: 'M8 9l4-4 4 4 M8 15l4 4 4-4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
  moon: 'M21 12.8A9 9 0 0 1 11.2 3a9 9 0 1 0 9.8 9.8',
  refresh: 'M20 11a8 8 0 0 0-14-5L3 9 M3 3v6h6 M4 13a8 8 0 0 0 14 5l3-3 M21 21v-6h-6',
  plus: 'M12 5v14 M5 12h14', search: 'M21 21l-4.5-4.5 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  x: 'M6 6l12 12 M6 18L18 6', more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  arrow: 'M5 12h14 M14 7l5 5-5 5', sparkles: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  info: 'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};
function node(tag, className = '', text) { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; }
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
}
function format(key, values) { return Object.entries(values).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), t[key]); }
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; document.title = t.title;
document.querySelectorAll('[data-copy]').forEach(el => el.textContent = t[el.dataset.copy]);
document.querySelectorAll('[data-label]').forEach(el => { el.setAttribute('aria-label', t[el.dataset.label]); el.title = t[el.dataset.label]; });
document.querySelectorAll('[data-placeholder]').forEach(el => el.placeholder = t[el.dataset.placeholder]);
document.querySelectorAll('[data-icon]').forEach(el => el.replaceChildren(icon(el.dataset.icon)));
$('language').textContent = language === 'zh' ? 'EN' : '中文';
$('language').onclick = () => { const next = language === 'zh' ? 'en' : 'zh'; preference('enterprise-language', next); const url = new URL(location.href); url.searchParams.set('lang', next); location.assign(url); };
const theme = preference('enterprise-theme'); if (theme === 'dark' || theme === 'light') document.documentElement.className = theme;
function isDark() { return document.documentElement.classList.contains('dark') || (!document.documentElement.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches); }
function themeIcon() { $('theme').replaceChildren(icon(isDark() ? 'moon' : 'sun')); }
themeIcon(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeIcon);
$('theme').onclick = () => { const next = isDark() ? 'light' : 'dark'; document.documentElement.className = next; preference('enterprise-theme', next); themeIcon(); };
function notice(message, error = false) {
  const el = $('notice'); el.textContent = message; el.hidden = !message; el.dataset.error = String(error);
  el.classList.toggle('login-notice', $('workspace').hidden);
  if ($('workspace').hidden) document.body.append(el); else $('content').insertBefore(el, $('page-overview'));
}
function lock() {
  state.revision++; state.employees = []; state.departments = []; state.collapsedDepartments.clear(); state.platformDefault = null; state.viewerId = ''; state.editing = null;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('assignment-form').reset(); $('models').replaceChildren(); $('editor-fields').replaceChildren();
  $('employees').replaceChildren(); $('departments').replaceChildren(); $('model-assignments').replaceChildren();
  $('recent-users').replaceChildren(); $('usage-result').replaceChildren();
  $('platform-default-summary').replaceChildren();
  $('profile-name').textContent = ''; $('profile-email').textContent = '';
  $('workspace').hidden = true; $('login').hidden = false; setMenu(false);
}
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) {
    const error = new Error(t.failed); error.status = response.status;
    try { error.code = (await response.json()).error?.code; } catch (_error) { /* Non-JSON failures retain the HTTP status. */ }
    throw error;
  }
  return response.json();
}
async function run(button, fn) {
  button.disabled = true; notice('');
  const dialog = button.closest('dialog'); const local = dialog && $(dialog.id + '-notice'); if (local) local.hidden = true;
  if (dialog) { dialog.setAttribute('aria-busy', 'true'); dialog.querySelectorAll('[data-close]').forEach(button => button.disabled = true); }
  try { await fn(); }
  catch (error) {
    if (error.status === 401 || error.status === 403) lock();
    const message = error.status === 401 ? t.credentials : error.status === 403 ? t.forbidden : t[error.code] || t.failed;
    notice(message, true); if (local && dialog.open) { local.textContent = message; local.hidden = false; }
  } finally { button.disabled = false; if (dialog) { dialog.removeAttribute('aria-busy'); dialog.querySelectorAll('[data-close]').forEach(button => button.disabled = false); } }
}
function action(label, fn, className = 'secondary') { const el = node('button', className, label); el.type = 'button'; el.onclick = () => run(el, fn); return el; }
function fields(form) { return Object.fromEntries(new FormData(form)); }
function badge(label, variant = '') { return node('span', 'badge ' + variant, label); }
function identity(user) {
  const el = node('div', 'identity'); const avatar = node('span', 'avatar', user.name.slice(0, 2).toUpperCase()); avatar.setAttribute('aria-hidden', 'true');
  const text = node('div', 'identity-text'); text.append(node('strong', '', user.name), node('small', '', user.email)); el.append(avatar, text); return el;
}
function status(user) { return badge(user.gatewayState === 'cleanup-required' ? t.cleanup : user.banned ? t.disabled : user.assignment ? t.active : t.unconfigured, user.gatewayState === 'cleanup-required' ? 'warning' : user.banned ? 'neutral' : user.assignment ? 'success' : 'warning'); }
function cell(content, className = '') { const td = node('td', className); td.append(typeof content === 'string' ? document.createTextNode(content) : content); return td; }
function stat(label, value, description, symbol) {
  const el = node('div', 'stat-card'); const head = node('div', 'stat-heading', label); head.append(icon(symbol));
  el.append(head, node('div', 'stat-number', String(value)), node('p', 'stat-description', description)); return el;
}
function setOptions(select, options, selected = select.value) { select.replaceChildren(...options.map(([name, value]) => new Option(name, value))); if ([...select.options].some(option => option.value === selected)) select.value = selected; }
function employeePath(user, operation) { return '/v1/admin/employees/' + encodeURIComponent(user.id) + '/' + operation; }
async function refresh() {
  const revision = ++state.revision;
  const [data, departments, defaults] = await Promise.all([api('/v1/admin/employees'), api('/v1/admin/departments'), api('/v1/admin/platform-default')]);
  if (revision !== state.revision) return;
  state.employees = data.employees; state.departments = departments.departments; state.mode = data.mode; state.viewerId = data.viewerId;
  state.platformDefault = defaults.configuration;
  $('login').hidden = true; $('workspace').hidden = false;
  const viewer = state.employees.find(user => user.id === state.viewerId);
  $('profile-name').textContent = viewer?.name || t.administrator; $('profile-email').textContent = viewer?.email || '';
  $('profile-avatar').textContent = $('top-avatar').textContent = (viewer?.name || t.administrator).slice(0, 2).toUpperCase();
  $('usage-nav').hidden = state.mode !== 'managed'; $('managed').hidden = state.mode !== 'managed';
  $('sidebar-mode').textContent = $('footer-mode').textContent = t[state.mode + 'Label'];
  $('mode').textContent = $('model-mode').textContent = t[state.mode];
  $('department-count').textContent = state.departments.length; $('user-count').textContent = state.employees.length;
  setOptions($('department-filter'), [[t.allDepartments, ''], [t.unassigned, 'unassigned'], ...departmentOptions()]);
  const selected = $('budget-form').elements.userId.value;
  setOptions($('budget-form').elements.userId, state.employees.map(user => [user.name + ' · ' + user.email, user.id]), selected);
  render(); navigate(false);
}
function render() { renderOverview(); renderUsers(); renderDepartments(); renderModels(); }
function renderOverview() {
  const assigned = state.employees.filter(user => user.assignment).length;
  $('overview-stats').replaceChildren(stat(t.totalUsers, state.employees.length, t.totalUsersHint, 'users'), stat(t.activeUsers, state.employees.filter(user => !user.banned).length, t.activeUsersHint, 'shield'), stat(t.totalDepartments, state.departments.length, t.departmentsHint, 'building'), stat(t.configuredUsers, assigned, t.configuredHint, 'boxes'));
  $('recent-users').replaceChildren(...state.employees.slice(0, 5).map(user => { const row = node('div', 'recent-user'); row.append(identity(user), status(user)); return row; }));
  $('setup-actions').replaceChildren(...[[t.createEmployee, t.createEmployeeHint, 'users', createEmployee], [t.departments, t.departmentSetupHint, 'building', () => go('departments')], [t.modelConfiguration, t.modelSetupHint, 'boxes', () => go('models')]].map(([label, hint, symbol, fn]) => {
    const button = action('', fn, 'setup-action'); const holder = node('span'); holder.append(icon(symbol)); const text = node('span'); text.append(node('strong', '', label), node('small', '', hint)); button.append(holder, text, icon('arrow')); return button;
  }));
}
function renderUsers() {
  const search = $('user-search').value.trim().toLocaleLowerCase(); const department = $('department-filter').value; const role = $('role-filter').value; const filterStatus = $('status-filter').value;
  const users = state.employees.filter(user => (!search || (user.name + ' ' + user.email).toLocaleLowerCase().includes(search)) && (!department || (department === 'unassigned' ? !user.departmentId : user.departmentId === department)) && (!role || user.role === role) && (!filterStatus || Boolean(user.banned) === (filterStatus === 'disabled')));
  const pages = Math.max(1, Math.ceil(users.length / 10)); state.page = Math.min(state.page, pages); const start = (state.page - 1) * 10;
  $('employees').replaceChildren(...users.slice(start, start + 10).map(user => {
    const row = node('tr'); const department = state.departments.find(d => d.id === user.departmentId);
    const role = badge(user.role === 'admin' ? t.administrator : t.employee, 'role-badge');
    const actions = node('div', 'row-actions'); actions.append(action(t.configure, () => edit(user)));
    const menu = node('details', 'row-menu'); const trigger = node('summary'); trigger.setAttribute('aria-label', format('moreActions', { name: user.name })); trigger.append(icon('more'));
    const list = node('div', 'row-menu-content');
    for (const [label, fn, disabled, danger] of [
      [t.changeDepartment, () => changeDepartment(user), false, false],
      [t.reset, () => resetPassword(user), false, false],
      [t.changeRole, () => changeRole(user), user.id === state.viewerId, false],
      [user.gatewayState === 'cleanup-required' ? t.retry : t.disable, () => disable(user), user.id === state.viewerId || (user.banned && user.gatewayState !== 'cleanup-required'), true],
    ]) { const button = action(label, () => { menu.open = false; fn(); }, danger ? 'danger' : ''); button.disabled = disabled; list.append(button); }
    menu.append(trigger, list); menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget)) menu.open = false; }); actions.append(menu);
    row.append(cell(identity(user)), cell(department ? department.name : t.unassigned, department ? '' : 'muted'), cell(role), cell(status(user)), cell(actions)); return row;
  }));
  $('user-empty').hidden = users.length !== 0;
  $('user-results').textContent = format('results', { start: users.length ? start + 1 : 0, end: Math.min(start + 10, users.length), total: users.length });
  $('user-page').textContent = format('pageCount', { page: state.page, pages });
  $('previous-page').disabled = state.page <= 1; $('next-page').disabled = state.page >= pages;
}
function departmentRows() {
  const rows = [];
  const visit = (parentId, ancestors) => {
    for (const department of state.departments.filter(d => d.parentId === parentId)) {
      rows.push({ department, ancestors }); visit(department.id, [...ancestors, department]);
    }
  };
  visit(null, []); return rows;
}
function departmentOptions(exclude) {
  return departmentRows().filter(({ department, ancestors }) => department.id !== exclude && !ancestors.some(d => d.id === exclude)).map(({ department, ancestors }) => [[...ancestors, department].map(d => d.name).join(' / '), department.id]);
}
function renderDepartments() {
  const members = state.departments.reduce((count, department) => count + department.memberCount, 0);
  $('department-stats').replaceChildren(stat(t.totalDepartments, state.departments.length, t.departmentsHint, 'building'), stat(t.assignedMembers, members, t.assignedMembersHint, 'users'), stat(t.unassignedMembers, state.employees.filter(user => !user.departmentId).length, t.unassignedMembersHint, 'users'));
  const search = $('department-search').value.trim().toLocaleLowerCase();
  const rows = departmentRows(); const matched = new Set();
  for (const { department, ancestors } of rows) if ((department.name + ' ' + department.description).toLocaleLowerCase().includes(search)) [department, ...ancestors].forEach(d => matched.add(d.id));
  const departments = rows.filter(({ department, ancestors }) => search ? matched.has(department.id) : !ancestors.some(d => state.collapsedDepartments.has(d.id)));
  $('departments').replaceChildren(...departments.map(({ department, ancestors }) => {
    const row = node('tr'); const name = node('div', 'identity department-name');
    for (const ancestor of ancestors) { const indent = node('span', 'tree-indent'); indent.setAttribute('aria-hidden', 'true'); name.append(indent); }
    const hasChildren = state.departments.some(d => d.parentId === department.id); const expanded = Boolean(search) || !state.collapsedDepartments.has(department.id);
    if (hasChildren) {
      const toggle = action('', () => { if (expanded) state.collapsedDepartments.add(department.id); else state.collapsedDepartments.delete(department.id); renderDepartments(); }, 'tree-toggle' + (expanded ? ' expanded' : ''));
      toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-label', format(expanded ? 'collapseDepartment' : 'expandDepartment', { name: department.name })); toggle.disabled = Boolean(search); toggle.append(icon('arrow')); name.append(toggle);
    } else name.append(node('span', 'tree-spacer'));
    name.append(icon('building'), node('strong', '', department.name));
    const count = action(String(department.memberCount), () => { $('department-filter').value = department.id; state.page = 1; renderUsers(); go('users'); }, 'text-button'); count.setAttribute('aria-label', department.name + ' · ' + t.members + ': ' + department.memberCount);
    const buttons = node('div', 'row-actions'); buttons.append(action(t.addChildDepartment, () => editDepartment(undefined, department.id)), action(t.editDepartment, () => editDepartment(department)), action(t.deleteDepartment, () => deleteDepartment(department), 'text-button danger'));
    row.append(cell(name), cell(department.description || '—', 'department-description'), cell(count), cell(buttons)); return row;
  })); $('department-empty').hidden = departments.length !== 0;
}
function renderModels() {
  $('platform-default-summary').textContent = state.platformDefault ? state.platformDefault.models.map(model => model.name).join(' · ') + ' · ' + state.platformDefault.defaultModel : t.platformDefaultMissing;
  const configured = state.employees.filter(user => user.assignment); const modelIds = new Set(configured.flatMap(user => user.assignment.models.map(model => model.id)));
  $('model-stats').replaceChildren(stat(t.uniqueModels, modelIds.size, t.uniqueModelsHint, 'boxes'), stat(t.configuredUsers, configured.length, t.configuredHint, 'shield'), stat(t.unconfiguredUsers, state.employees.length - configured.length, t.unconfiguredHint, 'users'));
  const search = $('model-search').value.trim().toLocaleLowerCase();
  const users = state.employees.filter(user => (user.name + ' ' + user.email + ' ' + (user.assignment?.models.map(model => model.id + ' ' + model.name).join(' ') || '')).toLocaleLowerCase().includes(search));
  $('model-assignments').replaceChildren(...users.map(user => {
    const row = node('tr'); const models = node('div', 'badge-list');
    if (user.assignment) user.assignment.models.forEach(model => models.append(badge(model.name))); else models.append(badge(t.unconfigured, 'warning'));
    models.append(badge(user.assignmentSource === 'platform' ? t.platformDefault : t.personalAssignment, 'neutral'));
    const endpoint = node('div'); endpoint.append(node('span', 'endpoint', user.assignment?.baseURL || '—'), node('small', 'protocol-label', user.assignment?.api || ''));
    const actions = node('div', 'row-actions'); actions.append(action(t.configure, () => edit(user)));
    row.append(cell(identity(user)), cell(models), cell(endpoint), cell(user.assignment?.defaultModel || '—'), cell(actions)); return row;
  })); $('model-empty').hidden = users.length !== 0;
}
function navigate(focus = true) {
  const requested = location.hash.slice(1); state.route = Object.hasOwn(routes, requested) && (requested !== 'usage' || state.mode === 'managed') ? requested : 'overview';
  for (const name of Object.keys(routes)) $('page-' + name).hidden = name !== state.route;
  document.querySelectorAll('[data-route]').forEach(link => { if (link.dataset.route === state.route) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); link.title = t[routes[link.dataset.route][0]]; });
  $('page-title').textContent = $('breadcrumb').textContent = t[routes[state.route][0]]; $('page-description').textContent = t[routes[state.route][1]];
  $('primary-action').hidden = state.route === 'usage'; $('primary-label').textContent = state.route === 'departments' ? t.createDepartment : state.route === 'models' ? t.modelConfiguration : t.createEmployee;
  $('primary-action').onclick = () => state.route === 'departments' ? editDepartment() : state.route === 'models' ? chooseEmployee() : createEmployee();
  closeMenus(); setMenu(false); if (focus && !$('workspace').hidden) $('page-title').focus();
}
function go(route) { if (location.hash === '#' + route) navigate(); else location.hash = route; }
addEventListener('hashchange', () => navigate());
function setMenu(open) {
  document.body.classList.toggle('sidebar-open', open); $('sidebar-backdrop').hidden = !open;
  $('menu-toggle').setAttribute('aria-expanded', String(open));
  if (matchMedia('(max-width: 767px)').matches) {
    $('sidebar').inert = !open;
    if (open) { $('sidebar').setAttribute('role', 'dialog'); $('sidebar').setAttribute('aria-modal', 'true'); $('sidebar').querySelector('a').focus(); }
    else { $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal'); }
  } else { $('sidebar').inert = false; $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal'); $('menu-toggle').setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-collapsed'))); }
}
$('menu-toggle').onclick = () => { if (matchMedia('(max-width: 767px)').matches) setMenu(!document.body.classList.contains('sidebar-open')); else { document.body.classList.toggle('sidebar-collapsed'); $('menu-toggle').setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-collapsed'))); } };
$('sidebar-backdrop').onclick = () => { setMenu(false); $('menu-toggle').focus(); };
matchMedia('(max-width: 767px)').addEventListener('change', () => { const sidebarFocused = $('sidebar').contains(document.activeElement); setMenu(false); if (sidebarFocused) $('menu-toggle').focus(); });
function closeMenus(except) { document.querySelectorAll('.row-menu[open]').forEach(menu => { if (menu !== except) menu.open = false; }); }
document.addEventListener('click', event => { const menu = event.target.closest('.row-menu'); closeMenus(menu); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { const menu = document.querySelector('.row-menu[open]'); if (menu) { menu.open = false; menu.querySelector('summary').focus(); } if (document.body.classList.contains('sidebar-open')) { setMenu(false); $('menu-toggle').focus(); } }
  if (event.key === 'Tab' && document.body.classList.contains('sidebar-open')) {
    const controls = [...$('sidebar').querySelectorAll('a,button')].filter(el => !el.hidden && !el.closest('[hidden]')); const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel', event => { if (dialog.getAttribute('aria-busy') === 'true') event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!document.activeElement || document.activeElement === document.body) $('page-title').focus(); });
}
function field(label, name, type = 'text', value = '') {
  const wrapper = node('label', '', label); const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  input.name = name; input.setAttribute('aria-label', label); if (input.tagName === 'INPUT') input.type = type; input.value = value; input.required = true; wrapper.append(input); return { wrapper, input };
}
function editor(title, description, build, submit, label = t.save, danger = false) {
  const form = $('editor-form'); form.reset(); $('editor-fields').replaceChildren(); $('editor-notice').hidden = true;
  $('editor-title').textContent = title; $('editor-description').textContent = description; $('editor-save').textContent = label; $('editor-save').className = danger ? 'primary danger' : 'primary';
  build($('editor-fields')); form.onsubmit = event => { event.preventDefault(); run(event.submitter, () => submit(fields(form))); }; $('editor').showModal();
}
async function mutation(path, data, dialog = 'editor', message = t.saved) { const result = await api(path, data); $(dialog).close(); await refresh(); notice(typeof message === 'function' ? message(result) : message); }
function createEmployee() {
  editor(t.createEmployee, t.createEmployeeDescription, body => {
    const name = field(t.name, 'name'); name.input.maxLength = 256;
    const email = field(t.email, 'email', 'email'); email.input.autocomplete = 'off';
    const password = field(t.initialPassword, 'password', 'password'); password.input.minLength = 12; password.input.maxLength = 128; password.input.autocomplete = 'new-password';
    const role = field(t.role, 'role', 'select'); setOptions(role.input, [[t.employee, 'user'], [t.administrator, 'admin']], 'user');
    body.append(name.wrapper, email.wrapper, password.wrapper, role.wrapper);
  }, data => mutation('/v1/admin/employees', data), t.createEmployee);
}
function editDepartment(department, parentId = null) {
  editor(department ? t.editDepartment : t.createDepartment, t.createDepartmentDescription, body => {
    const name = field(t.departmentName, 'name', 'text', department?.name || ''); name.input.maxLength = 100;
    const description = field(t.description, 'description', 'textarea', department?.description || ''); description.input.maxLength = 500; description.input.required = false;
    const parent = field(t.parentDepartment, 'parentId', 'select'); parent.input.required = false;
    setOptions(parent.input, [[t.rootDepartment, ''], ...departmentOptions(department?.id)], department?.parentId || parentId || '');
    body.append(parent.wrapper, name.wrapper, description.wrapper);
  }, data => mutation('/v1/admin/departments' + (department ? '/' + encodeURIComponent(department.id) : ''), { ...data, parentId: data.parentId || null }), department ? t.save : t.createDepartment);
}
function deleteDepartment(department) { editor(t.deleteDepartment, department.name, body => body.append(node('p', '', department.memberCount ? t.department_not_empty : t.confirmDeleteDepartment)), () => mutation('/v1/admin/departments/' + encodeURIComponent(department.id) + '/delete', {}), t.deleteDepartment, true); }
function changeDepartment(user) {
  editor(t.changeDepartment, user.name + ' · ' + t.departmentHelp, body => { const select = field(t.department, 'departmentId', 'select'); select.input.required = false; setOptions(select.input, [[t.unassigned, ''], ...departmentOptions()], user.departmentId || ''); body.append(select.wrapper); }, data => mutation(employeePath(user, 'department'), { departmentId: data.departmentId || null }));
}
function resetPassword(user) {
  editor(t.reset, user.name + ' · ' + t.passwordDescription, body => { const password = field(t.newPassword, 'password', 'password'); password.input.minLength = 12; password.input.maxLength = 128; password.input.autocomplete = 'new-password'; body.append(password.wrapper); }, data => mutation(employeePath(user, 'password'), data));
}
function changeRole(user) {
  editor(t.changeRole, user.name, body => body.append(node('p', '', t.confirmRole + ' ' + (user.role === 'admin' ? t.administrator + ' → ' + t.employee : t.employee + ' → ' + t.administrator))), () => mutation(employeePath(user, 'role'), { role: user.role === 'admin' ? 'user' : 'admin' }));
}
function disable(user) {
  const cleanup = user.gatewayState === 'cleanup-required';
  editor(cleanup ? t.retry : t.disable, user.name, body => body.append(node('p', '', t.confirmDisable)), () => mutation(employeePath(user, cleanup ? 'retry-cleanup' : 'disable'), {}, 'editor', result => result.upstreamRevocation === 'provider-action-required' ? t.revoke : t.saved), cleanup ? t.retry : t.disable, true);
}
function chooseEmployee() {
  editor(t.chooseEmployee, t.chooseEmployeeDescription, body => { const user = field(t.employee, 'userId', 'select'); setOptions(user.input, state.employees.map(user => [user.name + ' · ' + user.email, user.id])); body.append(user.wrapper); }, async data => { const user = state.employees.find(user => user.id === data.userId); if (user) { $('editor').close(); await edit(user); } }, t.continue);
}
async function edit(user) {
  if (state.mode === 'managed') { const catalog = await api('/v1/admin/models'); $('gateway-models').replaceChildren(...catalog.models.map(id => new Option(id, id))); }
  state.editing = user; const configuration = user ? user.assignment : state.platformDefault; const form = $('assignment-form'); form.reset(); $('models').replaceChildren(); $('assignment-notice').hidden = true;
  $('assignment-title').textContent = user ? user.name + ' · ' + t.modelConfiguration : t.platformDefault;
  $('inherit-assignment').hidden = !user; $('inherit-assignment').disabled = !state.platformDefault;
  $('key-field').hidden = state.mode === 'managed'; form.elements.apiKey.required = state.mode === 'basic';
  form.elements.baseURL.value = configuration?.baseURL || location.origin + '/v1'; form.elements.baseURL.readOnly = state.mode === 'managed';
  form.elements.api.value = configuration?.api || 'openai-completions';
  for (const model of configuration?.models || [undefined]) addModel(model);
  if (configuration) form.elements.defaultModel.value = configuration.defaultModel;
  $('assignment').showModal();
}
function addModel(value = { id: '', name: '', contextWindow: 128000, maxTokens: 8192, input: ['text'] }) {
  const group = node('fieldset'); group.append(node('legend', '', t.modelConfiguration));
  for (const [key, label, type] of [['id', t.modelId, 'text'], ['name', t.modelName, 'text'], ['contextWindow', t.context, 'number'], ['maxTokens', t.output, 'number']]) {
    const item = field(label, key, type, value[key]); if (type === 'number') item.input.min = '1'; else item.input.maxLength = 256;
    if (key === 'id') { item.input.oninput = defaults; if (state.mode === 'managed') item.input.setAttribute('list', 'gateway-models'); } group.append(item.wrapper);
  }
  const input = field(t.input, 'input', 'select'); setOptions(input.input, [[t.text, 'text'], [t.image, 'image']], value.input.includes('image') ? 'image' : 'text');
  group.append(input.wrapper, action(t.remove, () => { group.remove(); defaults(); }, 'text-button danger')); $('models').append(group); defaults();
}
function defaults() { const select = $('assignment-form').elements.defaultModel; setOptions(select, [...$('models').querySelectorAll('input[name=id]')].filter(input => input.value).map(input => [input.value, input.value])); }
$('add-model').onclick = () => addModel();
$('assignment').addEventListener('close', () => { $('assignment-form').reset(); $('models').replaceChildren(); state.editing = null; });
$('editor').addEventListener('close', () => { $('editor-form').reset(); });
$('assignment-form').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => {
  const data = fields(event.target); const models = [...$('models').querySelectorAll('fieldset')].map(group => { const get = name => group.querySelector('[name=' + name + ']').value; return { id: get('id'), name: get('name'), contextWindow: Number(get('contextWindow')), maxTokens: Number(get('maxTokens')), input: get('input') === 'image' ? ['text', 'image'] : ['text'] }; });
  await mutation(state.editing ? employeePath(state.editing, 'assignment') : '/v1/admin/platform-default', { mode: state.mode, baseURL: data.baseURL, api: data.api, apiKey: state.mode === 'managed' ? 'server-managed' : data.apiKey, models, defaultModel: data.defaultModel }, 'assignment');
}); };
$('configure-platform-default').onclick = () => run($('configure-platform-default'), () => edit(null));
$('inherit-assignment').onclick = () => run($('inherit-assignment'), () => mutation(employeePath(state.editing, 'assignment'), { usePlatformDefault: true }, 'assignment'));
$('expand-departments').onclick = () => { state.collapsedDepartments.clear(); renderDepartments(); };
$('collapse-departments').onclick = () => { state.departments.forEach(d => state.collapsedDepartments.add(d.id)); renderDepartments(); };
$('login-form').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => { await api('/api/auth/sign-in/email', fields(event.target)); event.target.reset(); await refresh(); }); };
$('refresh').onclick = () => run($('refresh'), refresh);
$('logout').onclick = () => run($('logout'), async () => { await api('/api/auth/sign-out', {}); lock(); $('login-form').elements.email.focus(); });
$('view-users').onclick = () => go('users'); $('empty-create-department').onclick = () => editDepartment();
for (const id of ['user-search', 'department-filter', 'role-filter', 'status-filter']) $(id).addEventListener(id === 'user-search' ? 'input' : 'change', () => { state.page = 1; renderUsers(); });
$('department-search').oninput = renderDepartments; $('model-search').oninput = renderModels;
$('clear-filters').onclick = () => { for (const id of ['user-search', 'department-filter', 'role-filter', 'status-filter']) $(id).value = ''; state.page = 1; renderUsers(); $('user-search').focus(); };
$('previous-page').onclick = () => { state.page--; renderUsers(); }; $('next-page').onclick = () => { state.page++; renderUsers(); };
$('budget-form').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => { const data = fields(event.target); await api('/v1/admin/employees/' + encodeURIComponent(data.userId) + '/budget', { maxBudget: Number(data.maxBudget) }); notice(t.saved); }); };
$('budget-form').elements.userId.onchange = () => { $('usage-result').textContent = t.usagePrompt; $('budget-form').elements.maxBudget.value = ''; };
$('usage-filters').onsubmit = event => { event.preventDefault(); run(event.submitter, async () => {
  if (!$('budget-form').elements.userId.reportValidity()) return;
  $('usage-result').textContent = t.usageUnavailable;
  const result = await api('/v1/admin/employees/' + encodeURIComponent($('budget-form').elements.userId.value) + '/usage?' + new URLSearchParams(fields(event.target)));
  const container = $('usage-result'); container.replaceChildren(); const summary = node('div', 'usage-summary');
  for (const [label, value] of [[t.managedSince, result.managedSince || '—'], [t.resetDate, result.budget.budget_reset_at || '—'], [t.budgetSpend, result.budget.spend], [t.budget, result.budget.max_budget === null ? '—' : result.budget.max_budget], [t.requests, result.history.total], [t.page, result.history.page + '/' + result.history.total_pages]]) { const item = node('span', '', label); item.append(node('strong', '', String(value))); summary.append(item); }
  const scroll = node('div', 'table-scroll'); const table = node('table'); const head = node('thead'); const heading = node('tr');
  for (const label of [t.modelId, t.time, t.tokens, t.spend]) heading.append(node('th', '', label)); head.append(heading); const body = node('tbody');
  for (const row of result.history.data) { const tr = node('tr'); for (const value of [row.model, row.startTime, row.prompt_tokens + ' / ' + row.completion_tokens, row.spend]) tr.append(cell(String(value))); body.append(tr); }
  table.append(head, body); scroll.append(table); container.append(summary, scroll);
}); };
const today = new Date().toISOString().slice(0, 10); $('usage-filters').elements.end.value = today; $('usage-filters').elements.start.value = today.slice(0, 8) + '01';
setMenu(false); navigate(false);
refresh().catch(error => { if (error.status !== 401) notice(error.status === 403 ? t.forbidden : t.failed, true); });
})();
`
