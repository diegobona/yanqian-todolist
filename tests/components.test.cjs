const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');const vm=require('vm');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
for(const key of ['window','document','Element','HTMLElement','HTMLBodyElement','Node','Event','navigator'])Object.defineProperty(global,key,{value:dom.window[key],configurable:true,writable:true});
const Vue=require('vue');Vue.config.productionTip=false;Vue.config.devtools=false;const {mount}=require('@vue/test-utils');const compiler=require('vue-template-compiler');const babel=require('@babel/core');const {TaskRepository}=require('../src/services/taskRepository');
const png1x1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function vueComponent(file,client){
 const source=compiler.parseComponent(fs.readFileSync(file,'utf8'));
 const code=babel.transformSync(source.script.content,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-modules-commonjs']}).code;
 const box={module:{exports:{}},exports:{},window,document,setTimeout,clearTimeout,setInterval,clearInterval,require:id=>{
  if(id==='../../package.json')return require('../package.json');
  if(id==='@/utils/taskClient')return{default:client,__esModule:true};
  if(id==='@/utils/fireworks')return{fireworks:()=>()=>{}};
  if(id==='@/utils/common')return{getDateStr:x=>x};
  if(id==='@/components/TaskScreenshots.vue')return{default:vueComponent(path.join(__dirname,'../src/components/TaskScreenshots.vue'),client),__esModule:true};
  return require(id);
 }};box.exports=box.module.exports;vm.runInNewContext(code,box);
 const options=box.module.exports.default;Object.assign(options,compiler.compileToFunctions(source.template.content));return options;
}
function setup(t,name='Todo.vue'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-ui-'));const repo=new TaskRepository({directory});let fail=false;const flushers=new Set();
 const client={setModal(){},snapshot:()=>repo.snapshot(),metadata:()=>({directory}),command:(action,payload)=>{if(fail)throw Error('disk denied');return repo.command(action,payload);},changed:()=>window.dispatchEvent(new Event('tasks:changed')),registerFlush:fn=>{flushers.add(fn);return()=>flushers.delete(fn);},flush:()=>Array.from(flushers).every(fn=>fn()!==false),attachment:async(action,payload)=>{if(fail)throw Error('disk denied');if(action==='pasteScreenshot')return repo.addScreenshot({...payload,png:png1x1});if(action==='readScreenshot')return`data:image/png;base64,${repo.readScreenshot(payload).toString('base64')}`;if(action==='deleteScreenshot')return repo.removeScreenshot(payload);throw Error('unsupported');}};
 const options=vueComponent(path.join(__dirname,'../src/views',name),client);
 const route={path:name==='Done.vue'?'/done':'/',query:{tab:'todo'}};const router={push(){},replace(){}};
 const wrapper=mount(options,{attachTo:document.body,mocks:{$route:route,$router:router}});
 t.after(()=>{wrapper.destroy();fs.rmSync(directory,{recursive:true,force:true});});
 return {wrapper,repo,client,directory,route,router,setFailure:v=>fail=v,options};
}
test('input, IME and immediate leave persist without waiting for a timer',async t=>{
 const {wrapper,repo,client}=setup(t);wrapper.vm.add();await Vue.nextTick();const input=wrapper.find('textarea[aria-label="编辑事项"]');
 input.element.value='中文输入';await input.trigger('compositionend');assert.equal(repo.snapshot().todoList[0].content,'中文输入');
 input.element.value='最后一个字';assert.equal(client.flush(),true);assert.equal(repo.snapshot().todoList[0].content,'最后一个字');
});
test('a failed action with no editor can recover through Retry Save',async t=>{
 const {wrapper,repo,setFailure}=setup(t);setFailure(true);wrapper.vm.add();assert.ok(wrapper.vm.error);setFailure(false);
 assert.equal(wrapper.vm.edited(),true);wrapper.vm.add();assert.equal(repo.snapshot().todoList.length,1);
});
test('failed save keeps text and blocks route leave until storage recovers',async t=>{
 const {wrapper,repo,setFailure,options}=setup(t);wrapper.vm.add();await Vue.nextTick();const input=wrapper.find('textarea[aria-label="编辑事项"]');setFailure(true);
 await input.setValue('keep this unsaved text');let nextValue;options.beforeRouteLeave.call(wrapper.vm,{}, {},v=>nextValue=v);
 assert.equal(nextValue,false);assert.equal(input.element.value,'keep this unsaved text');assert.equal(repo.snapshot().todoList[0].content,'');
 setFailure(false);options.beforeRouteLeave.call(wrapper.vm,{}, {},v=>nextValue=v);assert.equal(nextValue,undefined);assert.equal(repo.snapshot().todoList[0].content,'keep this unsaved text');
});
test('checking an item completes it without opening the editor',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'check me'});wrapper.vm.reload();await Vue.nextTick();
 const checkbox=wrapper.find('input[type="checkbox"]');assert.ok(checkbox.exists(),'each todo needs a checkbox');
 await checkbox.setChecked(true);await Vue.nextTick();assert.equal(repo.snapshot().doneList.length,1);assert.equal(repo.snapshot().todoList.length,0);assert.equal(wrapper.findAll('.item').length,0);
});
test('each todo eye conceals its content locally and can reveal it again',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'secret todo'});wrapper.vm.reload();await Vue.nextTick();
 const eye=wrapper.find('.visibility-toggle');assert.ok(eye.exists(),'each todo needs a visibility control');
 await eye.trigger('click');await Vue.nextTick();assert.equal(repo.snapshot().todoList[0].hidden,true);
 assert.ok(!wrapper.html().includes('secret todo'),'hidden content must not remain in rendered attributes');assert.match(wrapper.text(),/••••••/);
 await wrapper.find('.visibility-toggle').trigger('click');await Vue.nextTick();assert.equal(repo.snapshot().todoList[0].hidden,false);assert.match(wrapper.text(),/secret todo/);
});
test('clearing one item then editing another retains the second identity',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'A'});repo.command('add',{content:'B'});wrapper.vm.reload();const [a,b]=repo.snapshot().todoList;
 wrapper.vm.editing(a.id);await Vue.nextTick();await wrapper.find('textarea[aria-label="编辑事项"]').setValue('');wrapper.vm.editing(b.id);await Vue.nextTick();
 assert.equal(wrapper.vm.editId,b.id);assert.equal(wrapper.find('textarea[aria-label="编辑事项"]').element.value,'B');assert.equal(repo.snapshot().trashList[0].task.content,'A');
});
test('Escape restores original persisted text and completion can be undone',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'Original'});wrapper.vm.reload();const id=repo.snapshot().todoList[0].id;
 wrapper.vm.editing(id);await Vue.nextTick();await wrapper.find('textarea[aria-label="编辑事项"]').setValue('Changed');wrapper.vm.cancel({});assert.equal(repo.snapshot().todoList[0].content,'Original');
 wrapper.vm.done({},id);repo.command('undoComplete');assert.equal(repo.snapshot().todoList[0].id,id);
});
test('Done renders completed items and restore updates repository',async t=>{
 const {wrapper,repo}=setup(t,'Done.vue');const id=repo.command('add',{content:'Visible completed task'}).todoList[0].id;repo.command('complete',{id});wrapper.vm.reload();await Vue.nextTick();
 assert.match(wrapper.text(),/Visible completed task/);await wrapper.find('button').trigger('click');assert.equal(repo.snapshot().todoList[0].id,id);assert.equal(wrapper.findAll('.item').length,0);
});
test('each completed item eye conceals and reveals its content',async t=>{
 const {wrapper,repo}=setup(t,'Done.vue');const id=repo.command('add',{content:'secret completed'}).todoList[0].id;repo.command('complete',{id});wrapper.vm.reload();await Vue.nextTick();
 const eye=wrapper.find('.visibility-toggle');assert.ok(eye.exists(),'each completed item needs a visibility control');
 await eye.trigger('click');await Vue.nextTick();assert.equal(repo.snapshot().doneList[0].hidden,true);assert.ok(!wrapper.html().includes('secret completed'));assert.match(wrapper.text(),/••••••/);
 await wrapper.find('.visibility-toggle').trigger('click');await Vue.nextTick();assert.equal(repo.snapshot().doneList[0].hidden,false);assert.match(wrapper.text(),/secret completed/);
});

test('todo screenshots start folded, expand one task at a time, preview and delete',async t=>{
 const {wrapper,repo}=setup(t);const a=repo.command('add',{content:'A'}).todoList[0].id;const b=repo.command('add',{content:'B'}).todoList[1].id;
 repo.addScreenshot({list:'todoList',taskId:a,png:png1x1});repo.addScreenshot({list:'todoList',taskId:b,png:png1x1});wrapper.vm.reload();await Vue.nextTick();
 assert.equal(wrapper.findAll('.screenshot-summary').length,2);assert.equal(wrapper.find('.screenshot-gallery').exists(),false);
 await wrapper.findAll('.screenshot-summary').at(0).trigger('click');await new Promise(resolve=>setImmediate(resolve));await Vue.nextTick();
 assert.equal(wrapper.vm.expandedId,a);assert.equal(wrapper.findAll('.screenshot-gallery').length,1);assert.equal(wrapper.find('.screenshot-thumb img').exists(),true);
 await wrapper.find('.screenshot-thumb').trigger('click');await Vue.nextTick();assert.equal(wrapper.find('.screenshot-preview').exists(),true);
 await wrapper.findAll('.screenshot-summary').at(1).trigger('click');await Vue.nextTick();assert.equal(wrapper.vm.expandedId,b);assert.equal(wrapper.find('.screenshot-preview').exists(),false);
 await new Promise(resolve=>setImmediate(resolve));await wrapper.find('.screenshot-delete').trigger('click');assert.equal(repo.snapshot().todoList.find(item=>item.id===b).screenshots.length,1);await wrapper.find('.confirm-actions .danger').trigger('click');await new Promise(resolve=>setImmediate(resolve));await Vue.nextTick();
 assert.equal(repo.snapshot().todoList.find(item=>item.id===b).screenshots.length,0);
});

test('image paste targets the selected todo while text paste remains native',async t=>{
 const {wrapper,repo}=setup(t);const id=repo.command('add',{content:'paste target'}).todoList[0].id;wrapper.vm.reload();await Vue.nextTick();
 let prevented=false;wrapper.vm.onPaste({clipboardData:{items:[{type:'text/plain'}]},preventDefault(){prevented=true;}});assert.equal(prevented,false);
 wrapper.vm.onPaste({clipboardData:{items:[{type:'image/png'}]},preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.match(wrapper.vm.notice,/先点一下/);
 wrapper.vm.editing(id);await Vue.nextTick();prevented=false;wrapper.vm.onPaste({clipboardData:{items:[{type:'image/png'}]},preventDefault(){prevented=true;}});
 await wrapper.vm.pasteQueue;await new Promise(resolve=>setImmediate(resolve));await Vue.nextTick();assert.equal(prevented,true);assert.equal(repo.snapshot().todoList[0].screenshots.length,1);assert.equal(wrapper.vm.expandedId,id);
});

test('hidden tasks expose neither screenshot controls nor image content',async t=>{
 const {wrapper,repo}=setup(t);const id=repo.command('add',{content:'private image'}).todoList[0].id;repo.addScreenshot({list:'todoList',taskId:id,png:png1x1});repo.command('setVisibility',{list:'todoList',id,hidden:true});wrapper.vm.reload();await Vue.nextTick();
 assert.equal(wrapper.find('.screenshot-paste').exists(),false);assert.equal(wrapper.find('.task-screenshots').exists(),false);assert.ok(!wrapper.html().includes(png1x1.toString('base64')));
});

test('completed tasks keep screenshots folded and can reveal them',async t=>{
 const {wrapper,repo}=setup(t,'Done.vue');const id=repo.command('add',{content:'done image'}).todoList[0].id;repo.addScreenshot({list:'todoList',taskId:id,png:png1x1});repo.command('complete',{id});wrapper.vm.reload();await Vue.nextTick();
 assert.match(wrapper.text(),/1 张截图/);assert.equal(wrapper.find('.screenshot-gallery').exists(),false);await wrapper.find('.screenshot-summary').trigger('click');await new Promise(resolve=>setImmediate(resolve));await Vue.nextTick();assert.equal(wrapper.find('.screenshot-thumb img').exists(),true);
});

test('Todo renders and creates tasks only in the selected tab',async t=>{
 const {wrapper,repo,route}=setup(t);const work=repo.command('addTab',{name:'工作'}).tabs.find(tab=>tab.name==='工作');repo.command('add',{content:'personal',tabId:'todo'});repo.command('add',{content:'work item',tabId:work.id});route.query.tab=work.id;wrapper.vm.reload();await Vue.nextTick();
 assert.match(wrapper.text(),/work item/);assert.ok(!wrapper.text().includes('personal'));wrapper.vm.add();await Vue.nextTick();assert.equal(repo.snapshot().todoList.filter(item=>item.tabId===work.id).length,2);
});

test('single click edits immediately and multiline text survives saving and completion',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'第一行'});wrapper.vm.reload();await Vue.nextTick();
 await wrapper.find('.item').trigger('click');const editor=wrapper.find('textarea[aria-label="编辑事项"]');assert.ok(editor.exists());
 await editor.setValue('第一行\n第二行');await editor.trigger('keydown',{key:'Enter',keyCode:13});assert.ok(wrapper.vm.editId,'Enter must keep editing');
 const id=wrapper.vm.editId;wrapper.vm.edited();assert.equal(repo.snapshot().todoList[0].content,'第一行\n第二行');repo.command('complete',{id});assert.equal(repo.snapshot().doneList[0].content,'第一行\n第二行');
});

test('same-view tab navigation is blocked when the current draft cannot save',async t=>{
 const {wrapper,repo,route,setFailure,options}=setup(t);const work=repo.command('addTab',{name:'工作'}).tabs.find(tab=>tab.name==='工作');wrapper.vm.add();await Vue.nextTick();await wrapper.find('textarea[aria-label="编辑事项"]').setValue('unsaved');setFailure(true);let result;
 options.beforeRouteUpdate.call(wrapper.vm,{path:'/',query:{tab:work.id}},{path:'/',query:{tab:'todo'}},value=>{result=value;if(value!==false)route.query.tab=work.id;});assert.equal(result,false);assert.equal(route.query.tab,'todo');
});

test('Ctrl+S saves multiline text and the editor hint disappears',async t=>{
 const {wrapper,repo}=setup(t);wrapper.vm.add();await Vue.nextTick();
 assert.match(wrapper.find('.editor-hint').text(),/Ctrl\+S/);
 const editor=wrapper.find('textarea');await editor.setValue('一\n二');await editor.trigger('keydown',{key:'s',keyCode:83,ctrlKey:true});
 assert.equal(wrapper.vm.editId,'');assert.equal(wrapper.find('.editor-hint').exists(),false);assert.equal(repo.snapshot().todoList[0].content,'一\n二');
});

test('pinning moves a task to the top without opening editor and can be cancelled',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'ordinary'});repo.command('add',{content:'important'});wrapper.vm.reload();await Vue.nextTick();
 await wrapper.findAll('.pin-toggle').at(1).trigger('click');assert.equal(wrapper.vm.editId,'');assert.equal(wrapper.vm.todoList[0].content,'important');assert.equal(wrapper.find('.pin-toggle').attributes('aria-pressed'),'true');
 assert.equal(wrapper.vm.allowTaskMove({draggedContext:{element:{pinned:true}},relatedContext:{element:{pinned:false}}}),false);
 await wrapper.find('.pin-toggle').trigger('click');assert.ok(repo.snapshot().todoList.every(item=>!item.pinned));
});
test('long tasks show 100 characters with a full hover title and remain intact in editing',async t=>{
 const {wrapper,repo}=setup(t);const full='文'.repeat(100)+'😀末尾';repo.command('add',{content:full});wrapper.vm.reload();await Vue.nextTick();
 const text=wrapper.find('.item-main p');assert.equal(text.text(),'1.'+'文'.repeat(100)+'…');assert.equal(text.attributes('title'),full);
 await wrapper.find('.item').trigger('click');assert.equal(wrapper.find('textarea').element.value,full);
});

test('settings trash confirmation cancels safely and deletes only after confirmation', async t => {
 const {wrapper,repo,client}=setup(t,'Settings.vue');
 client.metadata=()=>({directory:'C:/test'});
 const id=repo.command('add',{content:'to delete'}).todoList[0].id;
 repo.command('delete',{id,list:'todoList'});
 wrapper.vm.reload(); await Vue.nextTick();
 assert.match(wrapper.text(),/保留 30 天，到期自动清理/);
 assert.doesNotMatch(wrapper.text(),/删除后保留/);
 const findButton=text=>wrapper.findAll('button').wrappers.find(b=>b.text()===text);
 await findButton('彻底删除').trigger('click');
 assert.ok(wrapper.find('[role="alertdialog"]').exists());
 await findButton('取消').trigger('click');
 assert.equal(repo.snapshot().trashList.length,1);
 await findButton('清空回收站').trigger('click');
 assert.match(wrapper.find('[role="alertdialog"]').text(),/1 项/);
 await findButton('确认清空').trigger('click');
 assert.equal(repo.snapshot().trashList.length,0);
 assert.match(wrapper.text(),/暂无删除的事项/);
 assert.equal(findButton('清空回收站'),undefined);
});

test('settings shows concise retention copy and saves interface transparency live', async t => {
 const {wrapper,repo,client}=setup(t,'Settings.vue');
 client.metadata=()=>({directory:'C:/test'});
 wrapper.vm.reload(); await Vue.nextTick();
 assert.match(wrapper.text(),/保留 30 天，到期自动清理/);
 assert.doesNotMatch(wrapper.text(),/删除后保留/);
 const slider=wrapper.find('input[aria-label="界面透明度"]');
 assert.equal(slider.attributes('min'),'0');assert.equal(slider.attributes('max'),'70');
 slider.element.value='55';await slider.trigger('input');
 assert.equal(repo.snapshot().settings.interfaceTransparency,55);
  assert.match(wrapper.text(),/55%/);
});

test('settings confirms switching to existing local data inside the app', async t => {
 const {wrapper,client}=setup(t,'Settings.vue');client.metadata=()=>({directory:'C:/current/yanqian-todo-list'});
 const actions=[];client.action=async action=>{actions.push(action);return action==='changeDirectory'?{confirmation:'replaceData',directory:'D:/notes/yanqian-todo-list'}:'已切换到该位置的眼前数据';};
 await wrapper.vm.run('changeDirectory');await Vue.nextTick();
 const dialog=wrapper.find('[role="alertdialog"]');assert.ok(dialog.exists());assert.match(dialog.text(),/此位置已有数据/);assert.match(dialog.text(),/原数据会自动保留一份副本/);
 const use=wrapper.findAll('button').wrappers.find(button=>button.text()==='替换并迁移');await use.trigger('click');await new Promise(resolve=>setImmediate(resolve));await Vue.nextTick();
 assert.deepEqual(actions,['changeDirectory','replaceDirectory']);assert.equal(wrapper.find('[role="alertdialog"]').exists(),false);assert.match(wrapper.text(),/已切换到该位置/);
});
