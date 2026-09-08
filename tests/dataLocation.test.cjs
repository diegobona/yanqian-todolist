const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {prepareDataLocation}=require('../src/services/dataLocation');
const {relocateData,readDataLocation,inspectDataLocation}=require('../src/services/dataLocation');
const {TaskRepository}=require('../src/services/taskRepository');
test('changing location preserves tasks and directs future writes and restart to new folder',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-relocate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=new TaskRepository({directory:path.join(root,'old')});repo.command('add',{content:'keep me'});
 const config=path.join(root,'data-location.json');const target=relocateData(repo,path.join(root,'chosen'),config);
 assert.equal(readDataLocation(config,'fallback'),target);assert.equal(repo.snapshot().todoList[0].content,'keep me');repo.command('add',{content:'new item'});
 assert.equal(new TaskRepository({directory:target}).snapshot().todoList.length,2);assert.equal(new TaskRepository({directory:path.join(root,'old')}).snapshot().todoList.length,1);
 const occupied=new TaskRepository({directory:path.join(root,'yanqian-todo-list')});occupied.command('add',{content:'existing'});assert.throws(()=>relocateData(repo,path.join(root,'yanqian-todo-list'),config),/已有/);
});
test('failed location preference write keeps the original repository active',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-fail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'old');const repo=new TaskRepository({directory:source});repo.command('add',{content:'safe'});repo.backup();
 const config=path.join(root,'config.json');const write=repo.atomicWrite.bind(repo);repo.atomicWrite=(file,data)=>{if(file===config)throw Error('disk denied');return write(file,data);};
 assert.throws(()=>relocateData(repo,path.join(root,'new'),config),/disk denied/);assert.equal(repo.directory,source);assert.equal(readDataLocation(config,source),source);
});
test('migrates existing tasks and screenshots without deleting originals or replacing migrated data',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const old=path.join(root,'xhznl-todo-list');fs.mkdirSync(path.join(old,'attachments'),{recursive:true});
 fs.writeFileSync(path.join(old,'data.json'),'original');fs.writeFileSync(path.join(old,'attachments','image.png'),'image');
 const next=prepareDataLocation(root,old);assert.equal(next,path.join(root,'yanqian-todo-list'));
 assert.equal(fs.readFileSync(path.join(next,'data.json'),'utf8'),'original');assert.equal(fs.readFileSync(path.join(next,'attachments','image.png'),'utf8'),'image');
 assert.ok(fs.existsSync(path.join(old,'data.json')));fs.writeFileSync(path.join(next,'data.json'),'updated');prepareDataLocation(root,old);assert.equal(fs.readFileSync(path.join(next,'data.json'),'utf8'),'updated');
});

test('selecting the data folder itself never creates a duplicate nested folder',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-direct-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'old');const repo=new TaskRepository({directory:source});repo.command('add',{content:'move once'});
 const target=path.join(root,'yanqian-todo-list');fs.mkdirSync(target);
 const config=path.join(root,'data-location.json');const moved=relocateData(repo,target,config);
 assert.equal(moved,target);assert.equal(repo.directory,target);assert.equal(fs.existsSync(path.join(target,'yanqian-todo-list')),false);
 assert.equal(new TaskRepository({directory:target}).snapshot().todoList[0].content,'move once');
});

test('an existing empty app folder accepts migration instead of requiring another location',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-empty-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'old');const repo=new TaskRepository({directory:source});repo.command('add',{content:'safe move'});
 const parent=path.join(root,'chosen');const target=parent;fs.mkdirSync(path.join(target,'attachments'),{recursive:true});
 const config=path.join(root,'data-location.json');assert.equal(relocateData(repo,parent,config),target);
 assert.equal(new TaskRepository({directory:target}).snapshot().todoList[0].content,'safe move');
});

test('existing data requires confirmation and is replaced with the current tasks',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-existing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'current');const repo=new TaskRepository({directory:source});repo.command('add',{content:'current item'});
 const parent=path.join(root,'chosen');const target=parent;const existing=new TaskRepository({directory:target});existing.command('add',{content:'existing item'});
 const info=inspectDataLocation(repo,parent);assert.equal(info.directory,target);assert.equal(info.hasExistingData,true);assert.equal(info.current,false);
 const config=path.join(root,'data-location.json');assert.equal(relocateData(repo,target,config,{replace:true}),target);
 assert.equal(repo.snapshot().todoList[0].content,'current item');assert.equal(readDataLocation(config,source),target);
 assert.equal(new TaskRepository({directory:source}).snapshot().todoList[0].content,'current item');
});

function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-transaction-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'chosen','yanqian-todo-list','yanqian-todo-list');
 const repo=new TaskRepository({directory:source});repo.command('add',{content:'latest'});
 return {root,source,repo,target:path.join(root,'chosen'),config:path.join(root,'pointer.json')};
}
test('flattening an old nested folder uses exactly the selected parent and preserves screenshots and restart',t=>{
 const {repo,source,target,config}=fixture(t);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const id=repo.snapshot().todoList[0].id;repo.addScreenshot({list:'todoList',taskId:id,png});
 const before=repo.snapshot();assert.equal(relocateData(repo,target,config),target);
 assert.deepEqual(new TaskRepository({directory:readDataLocation(config,'unused')}).snapshot(),before);
 const shot=before.todoList[0].screenshots[0];assert.ok(fs.readFileSync(path.join(target,'attachments',shot.fileName)).equals(png));
 assert.ok(fs.existsSync(path.join(source,'data.json')));
 assert.equal(inspectDataLocation(repo,target).current,true);
});
test('replacement preserves unrelated files and saves old target bytes outside rolling backups',t=>{
 const {repo,target,config}=fixture(t);fs.writeFileSync(path.join(target,'data.json'),'broken old data');fs.writeFileSync(path.join(target,'personal.txt'),'unrelated');
 assert.throws(()=>relocateData(repo,target,config),/确认/);
 relocateData(repo,target,config,{replace:true});
 assert.equal(fs.readFileSync(path.join(target,'personal.txt'),'utf8'),'unrelated');
 const saved=fs.readdirSync(target).find(name=>name.startsWith('.yanqian-transfer-'));
 assert.equal(fs.readFileSync(path.join(target,saved,'previous','data.json'),'utf8'),'broken old data');
 assert.equal(repo.snapshot().todoList[0].content,'latest');
});
test('failed pointer persistence rolls back replacement and leaves both repositories intact',t=>{
 const {repo,source,target,config}=fixture(t);const old=new TaskRepository({directory:target});old.command('add',{content:'old target'});
 const bytes=fs.readFileSync(old.file);const write=repo.atomicWrite.bind(repo);repo.atomicWrite=(file,data)=>{if(file===config)throw Error('pointer denied');return write(file,data);};
 assert.throws(()=>relocateData(repo,target,config,{replace:true}),/pointer denied/);
 assert.equal(repo.directory,source);assert.ok(fs.readFileSync(old.file).equals(bytes));assert.equal(readDataLocation(config,source),source);
});
test('copy failure never changes the active location or target data',t=>{
 const {repo,source,target,config}=fixture(t);const old=new TaskRepository({directory:target});old.command('add',{content:'old target'});const bytes=fs.readFileSync(old.file);
 const extra=require('fs-extra'),copy=extra.copySync;extra.copySync=()=>{throw Error('copy denied');};
 try {assert.throws(()=>relocateData(repo,target,config,{replace:true}),/copy denied/);} finally {extra.copySync=copy;}
 assert.equal(repo.directory,source);assert.ok(fs.readFileSync(old.file).equals(bytes));
});
test('same directory is a no-op and an internal child is rejected',t=>{
 const {repo,source,config}=fixture(t);const before=fs.readFileSync(repo.file);
 assert.equal(relocateData(repo,source,config),source);assert.ok(fs.readFileSync(repo.file).equals(before));
 assert.throws(()=>relocateData(repo,path.join(source,'inside'),config),/内部/);
});
test('legacy installation migration retains the custom location pointer',t=>{
 const {root,source,config}=fixture(t);const appData=path.join(root,'appdata'),legacy=path.join(appData,'xhznl-todo-list');fs.mkdirSync(legacy,{recursive:true});
 fs.writeFileSync(path.join(legacy,'data-location.json'),JSON.stringify({directory:source}));
 const base=prepareDataLocation(appData,legacy);assert.equal(readDataLocation(path.join(base,'data-location.json'),base),source);
});
