const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const modulePath = path.resolve(__dirname, '../src/services/taskRepository.js');

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
