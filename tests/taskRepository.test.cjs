const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const modulePath = path.resolve(__dirname, '../src/services/taskRepository.js');
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function fixture(t, raw, io) {
  assert.ok(fs.existsSync(modulePath), 'local repository must exist');
  const { TaskRepository } = require(modulePath);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yanqian-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (raw !== undefined) fs.writeFileSync(path.join(directory, 'data.json'), JSON.stringify(raw));
  const repo = new TaskRepository({ directory, filename: 'data.json', fs: io || fs });
  return { repo, directory, reopen: () => new TaskRepository({ directory, filename: 'data.json' }) };
}
function add(repo, content) {
  const state = repo.command('add', { content });
  return state.todoList[state.todoList.length - 1].id;
}

test('migrates missing and duplicate IDs without losing records or custom fields', t => {
  const { repo, directory, reopen } = fixture(t, { todoList: [{content:'A', custom:'kept'}, {id:'same',content:'B'}], doneList:[{id:'same',content:'C'}], settings:{old:true} });
  const s = repo.snapshot();
  assert.equal(new Set([...s.todoList,...s.doneList].map(x=>x.id)).size, 3);
  assert.equal(s.todoList[0].custom, 'kept');
  assert.equal(s.settings.old, true);
  assert.deepEqual(reopen().snapshot(), s);
  assert.ok(fs.readdirSync(path.join(directory,'safety')).length);
});
test('completion moves exactly one task atomically and stays visible after restart', t => {
  const {repo,reopen}=fixture(t); const id=add(repo,'交材料');
  repo.command('complete',{id}); const s=reopen().snapshot();
  assert.equal(s.todoList.length,0); assert.equal(s.doneList[0].id,id);
  assert.equal(s.doneList[0].content,'交材料'); assert.ok(s.doneList[0].done_date);
});
test('undo completion restores original position and survives restart', t=>{
  const {repo,reopen}=fixture(t); const a=add(repo,'A'); const b=add(repo,'B');
  repo.command('complete',{id:a});
  const next=reopen(); next.command('undoComplete');
  assert.deepEqual(next.snapshot().todoList.map(x=>x.id),[a,b]);
  assert.equal(next.snapshot().doneList.length,0);
  assert.throws(()=>next.command('undoComplete'));
});
test('rapid edits and reorder are persisted immediately using identity',t=>{
  const {repo,reopen}=fixture(t); const a=add(repo,'A');const b=add(repo,'B');
  for(const content of ['修','修改','修改报价']) repo.command('update',{id:a,content});
  repo.command('reorder',{ids:[b,a]});repo.command('delete',{id:b,list:'todoList'});
  assert.equal(reopen().snapshot().todoList[0].content,'修改报价');
  assert.throws(()=>repo.command('reorder',{ids:[a,a]}));
});
test('per-item and global visibility persist across todo and done lists',t=>{
  const {repo,reopen}=fixture(t);const todoId=add(repo,'private todo');const doneId=add(repo,'private done');
  repo.command('complete',{id:doneId});
  repo.command('setVisibility',{list:'todoList',id:todoId,hidden:true});
  let state=reopen().snapshot();assert.equal(state.todoList[0].hidden,true);assert.equal(state.doneList[0].hidden,false);
  repo.command('setAllVisibility',{hidden:true});state=reopen().snapshot();
  assert.ok([...state.todoList,...state.doneList].every(item=>item.hidden===true));
  repo.command('setAllVisibility',{hidden:false});state=reopen().snapshot();
  assert.ok([...state.todoList,...state.doneList].every(item=>item.hidden===false));
});
test('deleted todo and done tasks can be restored after restart',t=>{
  const {repo,reopen}=fixture(t);const a=add(repo,'A');const b=add(repo,'B');
  repo.command('complete',{id:b});
  repo.command('delete',{id:a,list:'todoList'});repo.command('delete',{id:b,list:'doneList'});
  const next=reopen();next.command('restoreTrash',{id:a});next.command('restoreTrash',{id:b});
  assert.equal(next.snapshot().todoList[0].id,a);assert.equal(next.snapshot().doneList[0].id,b);
  assert.equal(next.snapshot().trashList.length,0);
});
test('failed rename leaves both live state and disk unchanged',t=>{
  let fail=false; const io=Object.create(fs);io.renameSync=(...args)=>{if(fail)throw Error('disk denied');return fs.renameSync(...args);};
  const {repo,reopen}=fixture(t,undefined,io);const id=add(repo,'safe');const before=repo.snapshot();fail=true;
  assert.throws(()=>repo.command('complete',{id}),/disk denied/);
  assert.deepEqual(repo.snapshot(),before);assert.deepEqual(reopen().snapshot(),before);
});
test('failed temporary write or required safety snapshot never changes live state',t=>{
  let fail='';const io=Object.create(fs);io.writeFileSync=(file,...args)=>{if(fail && String(file).includes(fail)) throw Error('write failed');return fs.writeFileSync(file,...args);};
  const {repo,reopen,directory}=fixture(t,undefined,io);const id=add(repo,'safe');const before=repo.snapshot();
  fail='.tmp';assert.throws(()=>repo.command('update',{id,content:'lost'}),/write failed/);assert.deepEqual(repo.snapshot(),before);
  fail='safety';const source=path.join(directory,'import.json');fs.writeFileSync(source,JSON.stringify(before));
  assert.throws(()=>repo.importFrom(source),/write failed/);assert.deepEqual(reopen().snapshot(),before);
});
test('full export/import preserves order, settings, undo and trash',t=>{
  const {repo,directory}=fixture(t);const a=add(repo,'A');const b=add(repo,'B');
  repo.command('complete',{id:a});repo.command('delete',{id:b,list:'todoList'});repo.command('settings',{accelerator:'Control+Shift+K'});
  const before=repo.snapshot();const file=path.join(directory,'roundtrip.json');repo.exportTo(file);
  add(repo,'extra');repo.importFrom(file);assert.deepEqual(repo.snapshot(),before);
  assert.ok(fs.readdirSync(path.join(directory,'safety')).some(x=>x.includes('import')));
});
test('invalid import fails before touching data and cannot overwrite live DB during export',t=>{
  const {repo,directory}=fixture(t);add(repo,'safe');const before=repo.snapshot();const file=path.join(directory,'bad.json');
  for(const value of [{},{todoList:'bad',doneList:[]},{schemaVersion:999,todoList:[],doneList:[]},{todoList:[{content:7}],doneList:[]}]){
    fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>repo.importFrom(file));assert.deepEqual(repo.snapshot(),before);
  }
  assert.throws(()=>repo.exportTo(path.join(directory,'data.json')));
});
test('rolling backups are bounded while manual and migration copies survive',t=>{
  const {repo,directory}=fixture(t,{todoList:[],doneList:[],settings:{}});const safety=fs.readdirSync(path.join(directory,'safety'));
  for(let i=0;i<15;i++){add(repo,'task '+i);repo.backup();}
  assert.ok(repo.listBackups().length<=10);assert.ok(repo.listBackups().length>0);
  assert.deepEqual(fs.readdirSync(path.join(directory,'safety')),safety);
});
test('corrupt primary recovers from valid backup and preserves corrupt bytes',t=>{
  const {repo,directory,reopen}=fixture(t);add(repo,'recover me');repo.backup();
  fs.writeFileSync(path.join(directory,'data.json'),'{broken');const next=reopen();
  assert.equal(next.snapshot().todoList[0].content,'recover me');assert.ok(next.recoveryNotice);
  const files=fs.readdirSync(path.join(directory,'safety'));assert.ok(files.some(f=>fs.readFileSync(path.join(directory,'safety',f),'utf8')==='{broken'));
});
test('unrecoverable or future-version data is never silently replaced',t=>{
  const {directory,reopen}=fixture(t);const file=path.join(directory,'data.json');fs.writeFileSync(file,'{broken');
  assert.throws(reopen);assert.equal(fs.readFileSync(file,'utf8'),'{broken');
  const future=JSON.stringify({schemaVersion:999,todoList:[],doneList:[]});fs.writeFileSync(file,future);assert.throws(reopen);assert.equal(fs.readFileSync(file,'utf8'),future);
});

test('screenshots live outside data JSON and follow a task through completion and trash restore',t=>{
  const {repo,directory,reopen}=fixture(t);const id=add(repo,'with screenshot');
  const state=repo.addScreenshot({list:'todoList',taskId:id,png:png1x1});
  const shot=state.todoList[0].screenshots[0];
  assert.equal(shot.width,1);assert.equal(shot.height,1);assert.equal(shot.size,png1x1.length);
  assert.deepEqual(repo.readScreenshot({list:'todoList',taskId:id,screenshotId:shot.id}),png1x1);
  const live=fs.readFileSync(path.join(directory,'data.json'),'utf8');
  assert.ok(!live.includes(png1x1.toString('base64')),'live JSON must not embed image bytes');
  assert.ok(fs.existsSync(path.join(directory,'attachments',shot.fileName)));
  repo.command('complete',{id});
  assert.deepEqual(reopen().readScreenshot({list:'doneList',taskId:id,screenshotId:shot.id}),png1x1);
  repo.command('delete',{list:'doneList',id});repo.command('restoreTrash',{id});
  assert.deepEqual(reopen().readScreenshot({list:'doneList',taskId:id,screenshotId:shot.id}),png1x1);
});

test('full export and import carry screenshot bytes across data directories',t=>{
  const first=fixture(t);const id=add(first.repo,'portable');
  first.repo.addScreenshot({list:'todoList',taskId:id,png:png1x1});
  const backup=path.join(first.directory,'portable.json');first.repo.exportTo(backup);
  const exported=JSON.parse(fs.readFileSync(backup,'utf8'));
  assert.equal(Object.keys(exported.attachmentData).length,1);
  const second=fixture(t);add(second.repo,'replace me');second.repo.importFrom(backup);
  const task=second.repo.snapshot().todoList[0];const shot=task.screenshots[0];
  assert.equal(task.content,'portable');assert.deepEqual(second.repo.readScreenshot({list:'todoList',taskId:task.id,screenshotId:shot.id}),png1x1);
  assert.notEqual(path.resolve(first.directory,shot.fileName),path.resolve(second.directory,shot.fileName));
});

test('invalid screenshot data and attachment bundles fail without changing live state',t=>{
  const {repo,directory}=fixture(t);const id=add(repo,'safe');const before=repo.snapshot();
  assert.throws(()=>repo.addScreenshot({list:'todoList',taskId:id,png:Buffer.from('not png')}),/PNG|截图/);
  repo.command('setVisibility',{list:'todoList',id,hidden:true});
  assert.throws(()=>repo.addScreenshot({list:'todoList',taskId:id,png:png1x1}),/隐藏/);
  repo.command('setVisibility',{list:'todoList',id,hidden:false});
  const file=path.join(directory,'bad-attachments.json');
  fs.writeFileSync(file,JSON.stringify({...before,todoList:[{...before.todoList[0],screenshots:[{id:'missing',fileName:'../../escape.png',created_at:'now',width:1,height:1,size:1}]}],attachmentData:{missing:'%%%'}}));
  assert.throws(()=>repo.importFrom(file));
  assert.equal(repo.snapshot().todoList[0].content,'safe');
  assert.equal(repo.snapshot().todoList[0].screenshots?.length||0,0);
});

test('failed attachment staging during import leaves current tasks and images untouched',t=>{
  const source=fixture(t);const sourceId=add(source.repo,'incoming');source.repo.addScreenshot({list:'todoList',taskId:sourceId,png:png1x1});const backup=path.join(source.directory,'bundle.json');source.repo.exportTo(backup);
  let fail=false;const io=Object.create(fs);io.writeFileSync=(file,...args)=>{if(fail&&String(file).includes(`${path.sep}attachments${path.sep}`))throw Error('attachment disk denied');return fs.writeFileSync(file,...args);};
  const target=fixture(t,undefined,io);const safeId=add(target.repo,'keep current');target.repo.addScreenshot({list:'todoList',taskId:safeId,png:png1x1});const before=target.repo.snapshot();const oldFiles=fs.readdirSync(path.join(target.directory,'attachments')).sort();fail=true;
  assert.throws(()=>target.repo.importFrom(backup),/attachment disk denied/);assert.deepEqual(target.repo.snapshot(),before);assert.deepEqual(fs.readdirSync(path.join(target.directory,'attachments')).sort(),oldFiles);assert.deepEqual(target.repo.readScreenshot({list:'todoList',taskId:safeId,screenshotId:before.todoList[0].screenshots[0].id}),png1x1);
});

test('legacy data migrates into one editable default todo tab',t=>{
  const {repo,reopen}=fixture(t,{todoList:[{content:'legacy'}],doneList:[],settings:{}});const state=repo.snapshot();
  assert.deepEqual(state.tabs,[{id:'todo',name:'待办'}]);assert.equal(state.todoList[0].tabId,'todo');assert.equal(state.todoList[0].tabName,'待办');assert.deepEqual(reopen().snapshot(),state);
});

test('todo tabs can be added renamed and deleted while completed remains outside editable tabs',t=>{
  const {repo}=fixture(t);let state=repo.command('addTab',{name:'工作'});const tab=state.tabs.find(item=>item.name==='工作');assert.ok(tab);
  state=repo.command('renameTab',{id:tab.id,name:'项目'});assert.equal(state.tabs.find(item=>item.id===tab.id).name,'项目');
  const id=repo.command('add',{content:'tab task',tabId:tab.id}).todoList.find(item=>item.tabId===tab.id).id;
  state=repo.addScreenshot({list:'todoList',taskId:id,png:png1x1});const shot=state.todoList.find(item=>item.id===id).screenshots[0];
  state=repo.command('deleteTab',{id:tab.id});assert.ok(!state.tabs.some(item=>item.id===tab.id));assert.ok(!state.todoList.some(item=>item.id===id));assert.equal(state.trashList[0].task.id,id);
  state=repo.command('restoreTrash',{id});assert.ok(state.tabs.some(item=>item.id===tab.id&&item.name==='项目'));assert.ok(state.todoList.some(item=>item.id===id&&item.tabId===tab.id));
  assert.deepEqual(repo.readScreenshot({list:'todoList',taskId:id,screenshotId:shot.id}),png1x1);
  assert.throws(()=>repo.command('deleteTab',{id:'done'}),/已完成|不存在/);
});

test('deleting the last editable tab remains empty after restart and a new tab can be added',t=>{
  const {repo,reopen}=fixture(t);repo.command('deleteTab',{id:'todo'});const next=reopen();assert.deepEqual(next.snapshot().tabs,[]);
  const state=next.command('addTab',{name:'重新开始'});assert.equal(state.tabs.length,1);assert.equal(state.tabs[0].name,'重新开始');
});

test('task creation and reorder are scoped to the selected tab',t=>{
  const {repo}=fixture(t);const work=repo.command('addTab',{name:'工作'}).tabs.find(tab=>tab.name==='工作');
  const a=repo.command('add',{content:'A',tabId:'todo'}).todoList.find(item=>item.content==='A');const b=repo.command('add',{content:'B',tabId:work.id}).todoList.find(item=>item.content==='B');const c=repo.command('add',{content:'C',tabId:'todo'}).todoList.find(item=>item.content==='C');
  const state=repo.command('reorder',{tabId:'todo',ids:[c.id,a.id]});assert.deepEqual(state.todoList.filter(item=>item.tabId==='todo').map(item=>item.id),[c.id,a.id]);assert.equal(state.todoList.find(item=>item.id===b.id).tabId,work.id);
});

test('editable tabs can be reordered and the order survives restart',t=>{
  const {repo,reopen}=fixture(t);const work=repo.command('addTab',{name:'工作'}).tabs.find(tab=>tab.name==='工作');const life=repo.command('addTab',{name:'生活'}).tabs.find(tab=>tab.name==='生活');
  const state=repo.command('reorderTabs',{ids:[life.id,'todo',work.id]});assert.deepEqual(state.tabs.map(tab=>tab.id),[life.id,'todo',work.id]);assert.deepEqual(reopen().snapshot().tabs.map(tab=>tab.id),[life.id,'todo',work.id]);
  assert.throws(()=>repo.command('reorderTabs',{ids:['todo',work.id,work.id]}),/排序/);
});

test('completed tasks remember their source tab and restore it after tab deletion',t=>{
  const {repo}=fixture(t);const tab=repo.command('addTab',{name:'客户'}).tabs.find(item=>item.name==='客户');const id=repo.command('add',{content:'报价',tabId:tab.id}).todoList.find(item=>item.tabId===tab.id).id;
  repo.command('complete',{id});repo.command('deleteTab',{id:tab.id});const state=repo.command('restoreDone',{id});assert.ok(state.tabs.some(item=>item.id===tab.id&&item.name==='客户'));assert.ok(state.todoList.some(item=>item.id===id&&item.tabId===tab.id));
});
