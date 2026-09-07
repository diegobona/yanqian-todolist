const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');const path=require('path');
function component(filename, overrides={}){
 const source=fs.readFileSync(path.join(__dirname,'../src/views',filename),'utf8');
 const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?$/gm,'').replace('export default','module.exports =');
 const sandbox={module:{exports:{}},draggable:{},TaskScreenshots:{},taskClient:overrides.client||{},getDateStr:s=>s,window:{addEventListener(){},removeEventListener(){}},setTimeout,clearTimeout,Promise};
 vm.runInNewContext(script,sandbox);const c=sandbox.module.exports;const o={...c.data(),$set:(a,k,v)=>a[k]=v,$nextTick:fn=>fn(),$emit(){}};
 for(const [k,v] of Object.entries(c.methods||{}))o[k]=v.bind(o);
 return {c,o,source};
}
test('Todo uses stable identity and persists edits during input, including IME',()=>{
 const {o,source}=component('Todo.vue');
 assert.ok(source.includes(':key="todo.id"'));
 assert.equal(typeof o.persistInput,'function');
 assert.ok(source.includes('@compositionend='));
 assert.ok(source.includes('@input='));
});
test('main header has no branding labels and todos use checkboxes instead of a completion button',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 const {source}=component('Todo.vue');
 assert.ok(!app.includes('Powered by 小黑'));
 assert.ok(!app.includes('{{ appName }}'));
 assert.ok(source.includes('type="checkbox"'));
 assert.ok(!source.includes('class="complete"'));
 assert.ok(!source.includes('@dblclick.stop="done'));
});
test('completion banner is removed and the title bar exposes minimize and close controls',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(!app.includes('事项已完成'));
 assert.ok(!app.includes('撤销完成'));
 assert.match(app,/class="[^"]*icon-minus[^"]*"/);
 assert.match(app,/class="[^"]*icon-close[^"]*"/);
 assert.ok(app.includes('ipcRenderer.invoke("minimizeWindow")'));
 assert.ok(app.includes('ipcRenderer.invoke("closeWindow")'));
});
test('header eye controls all task visibility instead of hiding the window',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes('toggleAllTasksVisibility'));
 assert.ok(app.includes('setAllVisibility'));
 assert.ok(app.includes('显示所有事项'));
 assert.ok(app.includes('隐藏所有事项'));
 assert.ok(!app.includes('@click="hideWindow"'));
});
test('settings presents simple data choices without backup internals',()=>{
 const settings=fs.readFileSync(path.join(__dirname,'../src/views/Settings.vue'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 const background=fs.readFileSync(path.join(__dirname,'../src/utils/backgroundExtra.js'),'utf8');
 assert.ok(settings.includes('<h2>设置</h2>'));
 assert.ok(settings.includes('事项自动保存在这台电脑上'));
 assert.ok(settings.includes("run('export')\">导出数据"));
 assert.ok(settings.includes("run('import')\">导入数据"));
 for(const copy of ['备份与设置','立即备份','导出完整备份','导入备份','打开数据目录','恢复此备份'])
  assert.ok(!settings.includes(copy),`settings should hide ${copy}`);
 assert.ok(!settings.includes('v-for="backup in backups"'));
 assert.ok(background.includes('{ label: "设置", click: showSettings }'));
 assert.ok(!background.includes('备份与设置'));
 assert.ok(background.includes('title: "导出数据"'));
 assert.ok(background.includes('title: "导入数据"'));
 for(const copy of ['显示／隐藏快捷键','CommandOrControl+Shift+Space',"run('shortcut')"])
  assert.ok(!settings.includes(copy),`settings should hide ${copy}`);
 assert.ok(!app.includes('备份、回收站与快捷键'));
});
test('Done heading leaves room for completed tasks at minimum window height',()=>{
 const {source}=component('Done.vue');
 const group=source.slice(source.indexOf('.group {'));
 assert.ok(!/height:\s*224px/.test(group),'history header consumes almost entire viewport');
 assert.ok(!/z-index:\s*-999/.test(group),'history headings must not be hidden behind window');
});
test('hide, quit and route leave have a save guard and recover synchronizes renderer lock',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes('window:flush-request'),'native hide/quit must flush pending text');
 assert.ok(app.includes('window:locked'),'recovered window must synchronize the persisted lock');
 const {c}=component('Todo.vue');assert.equal(typeof c.beforeRouteLeave,'function');
});
test('navigation uses editable todo tabs with one permanent completed tab',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes('v-for="tab in tabs"'));assert.ok(app.includes('>已完成</router-link'));assert.ok(app.includes('aria-label="新建清单"'));assert.ok(app.includes('startTabName'));assert.ok(app.includes('deleteTab'));
 assert.ok(!app.includes('>Todo</router-link>'));assert.ok(!app.includes('>Done</router-link>'));
});
test('tab navigation supports drag ordering separators and overflow arrows',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes('<draggable'));assert.ok(app.includes('@end="reorderTabs"'));assert.ok(app.includes('reorderTabs'));
 assert.ok(app.includes('tab-scroll-left'));assert.ok(app.includes('tab-scroll-right'));assert.ok(app.includes('updateTabOverflow'));
 assert.match(app,/\.tab-shell\s*\{[\s\S]*?border-right:/);assert.match(app,/\.done-tab\s*\{[\s\S]*?border-right:/);
});
test('changing routes closes the tab action row',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.match(app,/"\$route\.fullPath"\(\)\s*\{[\s\S]*?closeTabActions\(\)/);
});
test('the saved transparency changes only the interface background',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes(':style="interfaceStyle"'));
 assert.match(app,/interfaceTransparency[\s\S]*?backgroundColor/);
 assert.ok(app.includes('rgba(0, 0, 0,'));
 const settings=fs.readFileSync(path.join(__dirname,'../src/views/Settings.vue'),'utf8');
 assert.ok(settings.includes('setInterfaceTransparency'));
 assert.ok(!settings.includes('只调整背景，文字和图标保持清晰'));
});
test('lock control uses real window locking without mouse passthrough',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.vue'),'utf8');
 assert.ok(app.includes('setWindowLocked'));
 assert.ok(app.includes('window:locked'));
 assert.ok(app.includes('locked: windowLocked'));
 assert.ok(!app.includes('setIgnoreMouseEvents'));
 assert.ok(!app.includes('class="mask"'));
});
