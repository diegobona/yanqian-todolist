const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');const vm=require('vm');
const {JSDOM}=require('jsdom');const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
for(const key of ['window','document','Element','HTMLElement','HTMLBodyElement','Node','Event','navigator'])Object.defineProperty(global,key,{value:dom.window[key],configurable:true,writable:true});
const Vue=require('vue');Vue.config.productionTip=false;Vue.config.devtools=false;const {mount}=require('@vue/test-utils');const compiler=require('vue-template-compiler');const babel=require('@babel/core');const {TaskRepository}=require('../src/services/taskRepository');
function setup(t,name='Todo.vue'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-ui-'));const repo=new TaskRepository({directory});let fail=false;const flushers=new Set();
 const client={snapshot:()=>repo.snapshot(),command:(action,payload)=>{if(fail)throw Error('disk denied');return repo.command(action,payload);},changed:()=>window.dispatchEvent(new Event('tasks:changed')),registerFlush:fn=>{flushers.add(fn);return()=>flushers.delete(fn);},flush:()=>Array.from(flushers).every(fn=>fn()!==false)};
 const source=compiler.parseComponent(fs.readFileSync(path.join(__dirname,'../src/views',name),'utf8'));
 const code=babel.transformSync(source.script.content,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-modules-commonjs']}).code;
 const box={module:{exports:{}},exports:{},window,setTimeout,clearTimeout,require:id=>id==='@/utils/taskClient'?{default:client,__esModule:true}:id==='@/utils/common'?{getDateStr:x=>x}:require(id)};box.exports=box.module.exports;vm.runInNewContext(code,box);
 const options=box.module.exports.default;Object.assign(options,compiler.compileToFunctions(source.template.content));
 const wrapper=mount(options,{attachTo:document.body});
 t.after(()=>{wrapper.destroy();fs.rmSync(directory,{recursive:true,force:true});});
 return {wrapper,repo,client,directory,setFailure:v=>fail=v,options};
}
test('input, IME and immediate leave persist without waiting for a timer',async t=>{
 const {wrapper,repo,client}=setup(t);wrapper.vm.add();await Vue.nextTick();const input=wrapper.find('input[aria-label="编辑事项"]');
 input.element.value='中文输入';await input.trigger('compositionend');assert.equal(repo.snapshot().todoList[0].content,'中文输入');
 input.element.value='最后一个字';assert.equal(client.flush(),true);assert.equal(repo.snapshot().todoList[0].content,'最后一个字');
});
test('a failed action with no editor can recover through Retry Save',async t=>{
 const {wrapper,repo,setFailure}=setup(t);setFailure(true);wrapper.vm.add();assert.ok(wrapper.vm.error);setFailure(false);
 assert.equal(wrapper.vm.edited(),true);wrapper.vm.add();assert.equal(repo.snapshot().todoList.length,1);
});
test('failed save keeps text and blocks route leave until storage recovers',async t=>{
 const {wrapper,repo,setFailure,options}=setup(t);wrapper.vm.add();await Vue.nextTick();const input=wrapper.find('input[aria-label="编辑事项"]');setFailure(true);
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
 wrapper.vm.editing(a.id);await Vue.nextTick();await wrapper.find('input[aria-label="编辑事项"]').setValue('');wrapper.vm.editing(b.id);await Vue.nextTick();
 assert.equal(wrapper.vm.editId,b.id);assert.equal(wrapper.find('input[aria-label="编辑事项"]').element.value,'B');assert.equal(repo.snapshot().trashList[0].task.content,'A');
});
test('Escape restores original persisted text and completion can be undone',async t=>{
 const {wrapper,repo}=setup(t);repo.command('add',{content:'Original'});wrapper.vm.reload();const id=repo.snapshot().todoList[0].id;
 wrapper.vm.editing(id);await Vue.nextTick();await wrapper.find('input[aria-label="编辑事项"]').setValue('Changed');wrapper.vm.cancel({});assert.equal(repo.snapshot().todoList[0].content,'Original');
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
